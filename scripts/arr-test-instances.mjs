import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  realpathSync,
  lstatSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Explicitly approved isolated integration only. No production endpoint input.
const ports = { sonarr: 8989, radarr: 7878, prowlarr: 9696, pingufunk: 6767 };
const label = "pingufunk.arr-qa.owner";
function docker(args) {
  try {
    return execFileSync("docker", args, {
      encoding: "utf8",
      timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new Error("Owned Docker operation failed; raw diagnostics suppressed");
  }
}
function save(root, manifest) {
  writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
}
function load(root) {
  const parent = realpathSync(resolve("downloads"));
  if (lstatSync(root).isSymbolicLink() || !realpathSync(root).startsWith(parent + "/arr-qa."))
    throw new Error("Exact ignored QA directory required");
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  if (!/^\d+-\d+$/.test(manifest.owner) || manifest.network !== `pingufunk-arr-${manifest.owner}`)
    throw new Error("Invalid QA identity");
  const containerIds = [];
  for (const [app, item] of Object.entries(manifest.apps)) {
    if (!(app in ports) || item.name !== `pingufunk-arr-${app}-${manifest.owner}`)
      throw new Error("Invalid QA container identity");
    const container = JSON.parse(docker(["inspect", item.name]))[0];
    if (container.Config.Labels[label] !== manifest.owner || container.Image !== item.image)
      throw new Error("QA owner/image mismatch");
    const networks = Object.keys(container.NetworkSettings.Networks);
    if (networks.length !== 1 || networks[0] !== manifest.network)
      throw new Error("QA network mismatch");
    const destination = app === "pingufunk" ? "/qa" : "/config";
    if (
      container.Mounts.find((mount) => mount.Destination === destination)?.Source !==
      join(root, app)
    )
      throw new Error("QA persisted mount mismatch");
    containerIds.push(container.Id);
  }
  const network = JSON.parse(docker(["network", "inspect", manifest.network]))[0];
  if (!network.Internal || network.Labels[label] !== manifest.owner)
    throw new Error("Internal owned QA network required");
  if (Object.keys(network.Containers).some((id) => !containerIds.includes(id)))
    throw new Error("Foreign container on QA network");
  return manifest;
}
function apiKey(root, app) {
  const key = readFileSync(join(root, app, "config.xml"), "utf8").match(
    /<ApiKey>([a-f0-9]{32})<\/ApiKey>/i
  )?.[1];
  if (!key) throw new Error("Owned API key unavailable");
  return key;
}
async function api(root, manifest, app, path, body) {
  // Internal Docker networks deliberately have no host-published reachability.
  // The owned Pingufunk container is the controller; secrets travel via stdin,
  // not docker argv, environment, URLs or diagnostic output.
  const request = {
    url: `http://${app}:${ports[app]}${path}`,
    options: {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(app === "pingufunk" ? {} : { "X-Api-Key": apiKey(root, app) }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  };
  const code =
    'let input="";process.stdin.on("data",part=>input+=part);process.stdin.on("end",async()=>{try{const request=JSON.parse(input);const response=await fetch(request.url,{...request.options,signal:AbortSignal.timeout(20000)});const text=await response.text();console.log(JSON.stringify({status:response.status,data:text?JSON.parse(text):null}));}catch{console.log(JSON.stringify({status:0}));}});';
  const result = JSON.parse(
    execFileSync("docker", ["exec", "-i", manifest.apps.pingufunk.name, "node", "-e", code], {
      input: JSON.stringify(request),
      encoding: "utf8",
      timeout: 25000,
      stdio: ["pipe", "pipe", "pipe"],
    })
  );
  if (result.status < 200 || result.status >= 300) {
    const fields = Array.isArray(result.data)
      ? result.data
          .map((row) => (/^[a-z.]*$/i.test(row.propertyName ?? "") ? row.propertyName : "redacted"))
          .join(",")
      : "unspecified";
    throw new Error(`Owned ${app} API failed: HTTP ${result.status}; fields=${fields}`);
  }
  return result.data;
}
async function up() {
  for (const app of ["sonarr", "radarr", "prowlarr"])
    docker(["image", "inspect", `lscr.io/linuxserver/${app}:latest`, "--format", "{{.Id}}"]);
  docker(["image", "inspect", "pingufunk-p10-arr-qa", "--format", "{{.Id}}"]);
  const migrator = docker([
    "image",
    "inspect",
    "pingufunk-p10-arr-migrator-qa",
    "--format",
    "{{.Id}}",
  ]);
  const parent = resolve("downloads");
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, "arr-qa."));
  const owner = `${process.pid}-${Date.now()}`;
  const manifest = { owner, network: `pingufunk-arr-${owner}`, migrator, apps: {} };
  save(root, manifest);
  docker(["network", "create", "--internal", "--label", `${label}=${owner}`, manifest.network]);
  for (const app of ["sonarr", "radarr", "prowlarr"]) {
    const dir = join(root, app);
    mkdirSync(dir, { mode: 0o700 });
    writeFileSync(
      join(dir, "config.xml"),
      `<Config><BindAddress>*</BindAddress><Port>${ports[app]}</Port><SslPort>0</SslPort><EnableSsl>False</EnableSsl><LaunchBrowser>False</LaunchBrowser><ApiKey>${randomBytes(16).toString("hex")}</ApiKey><AuthenticationMethod>None</AuthenticationMethod><AuthenticationRequired>DisabledForLocalAddresses</AuthenticationRequired><LogLevel>warn</LogLevel><UpdateAutomatically>False</UpdateAutomatically><AnalyticsEnabled>False</AnalyticsEnabled><Branch>master</Branch></Config>`,
      { mode: 0o600 }
    );
    const image = docker([
      "image",
      "inspect",
      `lscr.io/linuxserver/${app}:latest`,
      "--format",
      "{{.Id}}",
    ]);
    const name = `pingufunk-arr-${app}-${owner}`;
    manifest.apps[app] = { name, image };
    save(root, manifest);
    docker([
      "run",
      "-d",
      "--name",
      name,
      "--network",
      manifest.network,
      "--network-alias",
      app,
      "--label",
      `${label}=${owner}`,
      "-e",
      `PUID=${process.getuid()}`,
      "-e",
      `PGID=${process.getgid()}`,
      "--mount",
      `type=bind,src=${dir},dst=/config`,
      image,
    ]);
  }
  const dir = join(root, "pingufunk");
  mkdirSync(dir, { mode: 0o700 });
  // Initialize only this newly allocated SQLite test file, using the schema runner.
  docker([
    "run",
    "--rm",
    "--network",
    "none",
    "--user",
    `${process.getuid()}:${process.getgid()}`,
    "-e",
    "DATABASE_URL=file:/qa/database.sqlite",
    "--mount",
    `type=bind,src=${dir},dst=/qa`,
    "--entrypoint",
    "node",
    migrator,
    "/app/scripts/database-migrate.mjs",
  ]);
  const image = docker(["image", "inspect", "pingufunk-p10-arr-qa", "--format", "{{.Id}}"]);
  const name = `pingufunk-arr-pingufunk-${owner}`;
  manifest.apps.pingufunk = { name, image };
  save(root, manifest);
  // Reuse the externally blocked synthetic source, not a live catalogue.
  docker([
    "run",
    "-d",
    "--name",
    name,
    "--network",
    manifest.network,
    "--network-alias",
    "pingufunk",
    "--label",
    `${label}=${owner}`,
    "-e",
    `PUID=${process.getuid()}`,
    "-e",
    `PGID=${process.getgid()}`,
    "-e",
    "DATABASE_URL=file:/qa/database.sqlite",
    "-e",
    "PINGUFUNK_PUBLIC_URL=http://pingufunk:6767",
    "-e",
    `PINGUFUNK_MEDIA_QA_OWNER=${owner}`,
    "-e",
    "NODE_OPTIONS=--import /qa/provider.mjs",
    "--mount",
    `type=bind,src=${dir},dst=/qa`,
    "--mount",
    `type=bind,src=${resolve("scripts/arr-test-provider.mjs")},dst=/qa/provider.mjs,readonly`,
    "--mount",
    `type=bind,src=${resolve("scripts/media-container-provider.mjs")},dst=/qa/media-provider.mjs,readonly`,
    image,
  ]);
  load(root);
  for (const app of Object.keys(ports)) {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        const status = await api(
          root,
          manifest,
          app,
          app === "pingufunk"
            ? "/api/download?mode=queue"
            : `/api/${app === "prowlarr" ? "v1" : "v3"}/system/status`
        );
        manifest.apps[app].version = status.version ?? "1.3.0";
        ready = true;
        break;
      } catch {
        await delay(1000);
      }
    }
    if (!ready) throw new Error(`Owned ${app} readiness failed; retained QA state at ${root}`);
  }
  save(root, manifest);
  console.log(`QA_DIRECTORY=${root}`);
  await status(root, manifest);
}
async function status(root, manifest) {
  for (const app of Object.keys(manifest.apps)) {
    const item = manifest.apps[app];
    const result = await api(
      root,
      manifest,
      app,
      app === "pingufunk"
        ? "/api/download?mode=queue"
        : `/api/${app === "prowlarr" ? "v1" : "v3"}/system/status`
    );
    item.version = result.version ?? "1.3.0";
    const inspected = JSON.parse(docker(["inspect", item.name]))[0];
    console.log(
      `${app}: ${item.version}; ${inspected.State.Status}; internal http://${app}:${ports[app]}; ${item.image}`
    );
  }
  save(root, manifest);
}
async function schemas(root, manifest) {
  for (const app of ["sonarr", "radarr", "prowlarr"]) {
    const prefix = `/api/${app === "prowlarr" ? "v1" : "v3"}`;
    const rows = await api(root, manifest, app, `${prefix}/indexer/schema`);
    const relevant = rows.filter((row) => row.implementation === "Newznab").slice(0, 1);
    console.log(
      JSON.stringify({
        app,
        schemas: relevant.map((row) => ({
          implementation: row.implementation,
          configContract: row.configContract,
          fields: row.fields.map((field) => ({ name: field.name, type: field.type })),
        })),
      })
    );
  }
}

async function connections(root, manifest, selected) {
  if (selected && !["sonarr", "radarr", "prowlarr"].includes(selected))
    throw new Error("Invalid QA selection");
  for (const app of selected ? [selected] : ["sonarr", "radarr", "prowlarr"]) {
    const prefix = `/api/${app === "prowlarr" ? "v1" : "v3"}`;
    const rows = await api(root, manifest, app, `${prefix}/indexer/schema`);
    const schema = rows.find((row) => row.implementation === "Newznab");
    if (!schema) throw new Error(`Owned ${app} Newznab schema missing`);
    const model = {
      ...schema,
      name: "Pingufunk isolated QA",
      enable: false,
      enableRss: false,
      enableAutomaticSearch: false,
      enableInteractiveSearch: true,
      fields: schema.fields.map((field) => ({ ...field })),
    };
    delete model.id;
    if (app === "prowlarr") {
      const profiles = await api(root, manifest, app, `${prefix}/appprofile`);
      if (!profiles.length) throw new Error("Owned prowlarr application profile missing");
      model.appProfileId = profiles[0].id;
    }
    const values = {
      baseUrl: "http://pingufunk:6767",
      apiPath: "/api/newznab",
      apiKey: "synthetic-qa-not-a-secret",
      categories: app === "radarr" ? [2000] : [5000],
      animeCategories: [],
    };
    for (const field of model.fields) if (field.name in values) field.value = values[field.name];
    await api(root, manifest, app, `${prefix}/indexer/test`, model);
    console.log(
      `${app}: native Newznab connection test passed; no indexer saved or automatic grabs enabled`
    );
    if (app === "prowlarr") continue;
    await downloadClient(root, manifest, app);
  }
}
async function downloadClient(root, manifest, app) {
  if (!["sonarr", "radarr"].includes(app)) throw new Error("Invalid QA download client");
  const prefix = "/api/v3";
  const clients = await api(root, manifest, app, `${prefix}/downloadclient/schema`);
  const client = clients.find((row) => row.implementation === "Sabnzbd");
  if (!client) throw new Error(`Owned ${app} SAB schema missing`);
  client.name = "Pingufunk isolated SAB QA";
  client.enable = false;
  delete client.id;
  const settings = {
    host: "pingufunk",
    port: 6767,
    useSsl: false,
    urlBase: "",
    apiKey: "synthetic-qa-not-a-secret",
    tvCategory: "sonarr",
    movieCategory: "radarr",
    category: app,
  };
  for (const field of client.fields) if (field.name in settings) field.value = settings[field.name];
  await api(root, manifest, app, `${prefix}/downloadclient/test`, client);
  console.log(`${app}: native SAB connection test passed; no client saved or download submitted`);
}

try {
  const command = process.argv[2];
  if (command === "up") await up();
  else {
    const root = resolve(process.argv[3] ?? "invalid");
    const manifest = load(root);
    if (command === "status") await status(root, manifest);
    else if (command === "schemas") await schemas(root, manifest);
    else if (command === "connections") await connections(root, manifest, process.argv[4]);
    else if (command === "client") await downloadClient(root, manifest, process.argv[4]);
    else if (command === "stop") {
      for (const item of Object.values(manifest.apps)) docker(["stop", item.name]);
      console.log("Owned QA instances stopped; configuration retained, no deletion");
    } else
      throw new Error(
        "Use up, status, schemas, connections, client or stop with exact QA directory"
      );
  }
} catch (error) {
  // No fetch/Prisma/Docker payload or config values in errors.
  console.error(
    error.message.startsWith("Owned") ||
      error.message.startsWith("Exact") ||
      error.message.startsWith("Use")
      ? error.message
      : "Isolated QA operation failed; diagnostics suppressed"
  );
  process.exitCode = 1;
}
