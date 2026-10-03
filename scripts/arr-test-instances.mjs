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
    const directory = join(root, app);
    if (lstatSync(directory).isSymbolicLink() || realpathSync(directory) !== directory)
      throw new Error("Owned canonical non-symlink app directory required");
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
async function api(root, manifest, app, path, body, method, expectedStatus, credentialOverride) {
  // Internal Docker networks deliberately have no host-published reachability.
  // The owned Pingufunk container is the controller; secrets travel via stdin,
  // not docker argv, environment, URLs or diagnostic output.
  const request = {
    url: `http://${app}:${ports[app]}${path}`,
    options: {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        "Content-Type": "application/json",
        ...(app === "pingufunk" ? {} : { "X-Api-Key": credentialOverride ?? apiKey(root, app) }),
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
  if (expectedStatus !== undefined) {
    if (result.status !== expectedStatus)
      throw new Error(`Owned ${app} expected HTTP ${expectedStatus}, received ${result.status}`);
    return result.data;
  }
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
  const runnerTag = process.env.PINGUFUNK_ARR_QA_RUNNER_IMAGE ?? "pingufunk-p10-arr-qa";
  const migratorTag =
    process.env.PINGUFUNK_ARR_QA_MIGRATOR_IMAGE ?? "pingufunk-p10-arr-migrator-qa";
  const movieCorrelation = process.env.PINGUFUNK_ARR_QA_MOVIE_CORRELATION === "1";
  for (const app of ["sonarr", "radarr", "prowlarr"])
    docker(["image", "inspect", `lscr.io/linuxserver/${app}:latest`, "--format", "{{.Id}}"]);
  docker(["image", "inspect", runnerTag, "--format", "{{.Id}}"]);
  const migrator = docker(["image", "inspect", migratorTag, "--format", "{{.Id}}"]);
  const parent = resolve("downloads");
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, "arr-qa."));
  const owner = `${process.pid}-${Date.now()}`;
  const manifest = {
    owner,
    network: `pingufunk-arr-${owner}`,
    migrator,
    movieCorrelation,
    apps: {},
  };
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
  if (movieCorrelation)
    writeFileSync(join(dir, "radarr-api-key"), apiKey(root, "radarr"), { mode: 0o600 });
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
  const image = docker(["image", "inspect", runnerTag, "--format", "{{.Id}}"]);
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
    ...(movieCorrelation
      ? [
          "-e",
          "PINGUFUNK_ARR_QA_MOVIE_CORRELATION=1",
          "-e",
          "PINGUFUNK_RADARR_API_KEY_FILE=/qa/radarr-api-key",
        ]
      : []),
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
  if (movieCorrelation)
    await api(root, manifest, "pingufunk", "/api/settings", {
      "integration.radarr.enabled": "true",
      "integration.radarr.url": "http://radarr:7878",
      "integration.radarr.inventoryMaxMiB": "10",
      "matching.movie.tolerancePercent": "10",
    });
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

async function bootstrap(root, manifest) {
  // Radarr's create forceSave still tests enabled definitions. Bootstrap disabled,
  // then explicitly enable interactive search via its supported update contract.
  // This does not turn an empty-feed validation error into a passing test.
  for (const app of ["prowlarr", "radarr", "sonarr"]) {
    const prefix = `/api/${app === "prowlarr" ? "v1" : "v3"}`;
    const schema = (await api(root, manifest, app, `${prefix}/indexer/schema`)).find(
      (row) => row.implementation === "Newznab"
    );
    if (!schema) throw new Error(`Owned ${app} Newznab schema missing`);
    const paths = app !== "prowlarr" ? ["direct", "forwarded"] : ["source"];
    for (const transport of paths) {
      const name = `Pingufunk isolated QA ${transport}`;
      const existing = (await api(root, manifest, app, `${prefix}/indexer`)).filter(
        (row) => row.name === name
      );
      if (existing.length > 1) throw new Error("Owned duplicate QA indexer");
      const model = {
        ...schema,
        name,
        enable: false,
        enableRss: false,
        enableAutomaticSearch: false,
        enableInteractiveSearch: false,
        fields: schema.fields.map((field) => ({ ...field })),
      };
      delete model.id;
      const values = {
        baseUrl: "http://pingufunk:6767",
        apiPath: "/api/newznab",
        apiKey: "synthetic-qa-not-a-secret",
        categories: app === "sonarr" ? [5000] : [2000],
        animeCategories: [],
      };
      if (app === "prowlarr") {
        const profiles = await api(root, manifest, app, `${prefix}/appprofile`);
        if (!profiles.length) throw new Error("Owned prowlarr application profile missing");
        model.appProfileId = profiles[0].id;
        model.enable = true;
      } else if (transport === "forwarded") {
        const sources = await api(root, manifest, "prowlarr", "/api/v1/indexer");
        const source = sources.find((row) => row.name === "Pingufunk isolated QA source");
        if (!source) throw new Error("Owned forwarded source missing");
        values.baseUrl = `http://prowlarr:9696/${source.id}`;
        values.apiPath = "/api";
        values.apiKey = apiKey(root, "prowlarr");
      }
      for (const field of model.fields) if (field.name in values) field.value = values[field.name];
      const record = existing[0] ?? (await api(root, manifest, app, `${prefix}/indexer`, model));
      if (app !== "prowlarr") {
        model.id = record.id;
        model.enableInteractiveSearch = true;
        await api(
          root,
          manifest,
          app,
          `${prefix}/indexer/${record.id}?forceSave=true`,
          model,
          "PUT"
        );
      }
      const saved = await api(root, manifest, app, `${prefix}/indexer/${record.id}`);
      for (const [key, value] of Object.entries(values)) {
        if (!model.fields.some((field) => field.name === key)) continue;
        // Arr intentionally redacts secret fields on GET. Their correctness is
        // proved by consumer requests, never by logging or unmasking readback.
        if (key === "apiKey") continue;
        if (
          JSON.stringify(saved.fields.find((field) => field.name === key)?.value) !==
          JSON.stringify(value)
        )
          throw new Error(`Owned ${app} persisted field mismatch: ${key}`);
      }
      if (app === "radarr") {
        if (!saved.enableInteractiveSearch || saved.enableRss || saved.enableAutomaticSearch)
          throw new Error("Owned radarr search flags mismatch");
        const errors = await api(root, manifest, app, `${prefix}/indexer/test`, saved, "POST", 400);
        if (
          !Array.isArray(errors) ||
          !errors.some((error) =>
            String(error.errorMessage).includes(
              "Query successful, but no results in the configured categories"
            )
          )
        )
          throw new Error("Owned radarr unexpected validation error; not the empty-feed contract");
      }
      if (app === "sonarr") {
        if (!saved.enableInteractiveSearch || saved.enableRss || saved.enableAutomaticSearch)
          throw new Error("Owned sonarr search flags mismatch");
        await api(root, manifest, app, `${prefix}/indexer/test`, saved);
      }
      console.log(
        `${app}: ${transport} persisted/read back; ${app === "prowlarr" ? "no application sync configured" : "automatic searches disabled"}${app === "radarr" ? "; empty-feed test remains HTTP 400 (not a pass)" : ""}`
      );
    }
  }
}

async function movieFixture(root, manifest) {
  if ((await api(root, manifest, "radarr", "/api/v3/system/status")).version !== "6.4.4.10685")
    throw new Error("Owned Radarr fixture requires its inspected schema/version");
  if (lstatSync(join(root, "radarr", "radarr.db")).isSymbolicLink())
    throw new Error("Owned non-symlink fixture database required");
  // Official AddMovie always calls external Skyhook. This offline fixture seeds
  // only the stopped disposable DB, not a product validation feed or live movie.
  const { DatabaseSync } = await import("node:sqlite");
  const name = manifest.apps.radarr.name;
  docker(["stop", name]);
  const db = new DatabaseSync(join(root, "radarr", "radarr.db"));
  try {
    if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
      throw new Error("Owned Radarr fixture source integrity failed");
    const columns = (table) =>
      new Set(
        db
          .prepare(`PRAGMA table_info("${table}")`)
          .all()
          .map((row) => row.name)
      );
    if (!columns("MovieMetadata").has("TmdbId") || !columns("Movies").has("MovieMetadataId"))
      throw new Error("Owned Radarr fixture schema mismatch");
    const backup = join(root, "radarr", `before-fixture-${Date.now()}.sqlite`);
    db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
    db.exec("BEGIN IMMEDIATE");
    try {
      const id = 2147483001;
      const previous = db.prepare("SELECT * FROM MovieMetadata WHERE TmdbId=?").get(id);
      if (previous && previous.Title !== "Synthetic Media")
        throw new Error("Owned synthetic fixture identity conflict");
      if (!previous)
        db.prepare(
          `INSERT INTO MovieMetadata
        (TmdbId,Images,Title,SortTitle,CleanTitle,OriginalTitle,CleanOriginalTitle,OriginalLanguage,Status,Runtime,Year,Recommendations,Genres,Keywords,Ratings)
        VALUES (?, '[]', 'Synthetic Media', 'syntheticmedia', 'syntheticmedia', 'Synthetic Media', 'syntheticmedia', 1, 3, 0, 2024, '[]', '[]', '[]', '{}')`
        ).run(id);
      const metadata = db.prepare("SELECT Id FROM MovieMetadata WHERE TmdbId=?").get(id);
      if (manifest.movieCorrelation)
        db.prepare("UPDATE MovieMetadata SET Runtime=10 WHERE Id=?").run(metadata.Id);
      const profile = db.prepare("SELECT Id FROM QualityProfiles ORDER BY Id LIMIT 1").get();
      if (!profile) throw new Error("Owned Radarr fixture profile missing");
      if (!db.prepare("SELECT Id FROM Movies WHERE MovieMetadataId=?").get(metadata.Id))
        db.prepare(
          `INSERT INTO Movies (Path,Monitored,QualityProfileId,Added,Tags,AddOptions,MovieFileId,MinimumAvailability,MovieMetadataId)
          VALUES ('/config/synthetic-library/Synthetic Media (2024)', 0, ?, datetime('now'), '[]', '{}', 0, 0, ?)`
        ).run(profile.Id, metadata.Id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
    docker(["start", name]);
  }
  console.log(
    "radarr: unmonitored offline synthetic movie fixture seeded; backup retained; no Skyhook request or automatic grab"
  );
}

async function seriesFixture(root, manifest) {
  if ((await api(root, manifest, "sonarr", "/api/v3/system/status")).version !== "4.0.20.3014")
    throw new Error("Owned Sonarr fixture requires its inspected schema/version");
  if (lstatSync(join(root, "sonarr", "sonarr.db")).isSymbolicLink())
    throw new Error("Owned non-symlink fixture database required");
  const { DatabaseSync } = await import("node:sqlite");
  const name = manifest.apps.sonarr.name;
  docker(["stop", name]);
  const db = new DatabaseSync(join(root, "sonarr", "sonarr.db"));
  try {
    if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
      throw new Error("Owned Sonarr fixture source integrity failed");
    const backup = join(root, "sonarr", `before-fixture-${Date.now()}.sqlite`);
    db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
    db.exec("BEGIN IMMEDIATE");
    try {
      const previous = db.prepare("SELECT Id,Title FROM Series WHERE TvdbId=?").get(2147483002);
      if (previous && previous.Title !== "Synthetic Series")
        throw new Error("Owned synthetic series identity conflict");
      const profile = db.prepare("SELECT Id FROM QualityProfiles ORDER BY Id LIMIT 1").get();
      if (!profile) throw new Error("Owned Sonarr fixture profile missing");
      if (!previous)
        db.prepare(
          `INSERT INTO Series (TvdbId,TvRageId,TvMazeId,Title,TitleSlug,CleanTitle,Status,Images,Path,Monitored,SeasonFolder,Runtime,SeriesType,UseSceneNumbering,OriginalLanguage,QualityProfileId,Seasons,Actors,Ratings,Genres,Tags,Added,Year,SortTitle)
        VALUES (?,0,0,'Synthetic Series','synthetic-series-qa','syntheticseries',1,'[]','/config/synthetic-library/Synthetic Series',0,1,10,0,0,1,?,'[{"seasonNumber":1,"monitored":false}]','[]','{}','[]','[]',datetime('now'),2024,'syntheticseries')`
        ).run(2147483002, profile.Id);
      const series = db.prepare("SELECT Id FROM Series WHERE TvdbId=?").get(2147483002);
      if (!db.prepare("SELECT Id FROM Episodes WHERE TvdbId=?").get(2147483003))
        db.prepare(
          `INSERT INTO Episodes (SeriesId,SeasonNumber,EpisodeNumber,Title,EpisodeFileId,Monitored,AirDateUtc,AirDate,UnverifiedSceneNumbering,TvdbId,Runtime,Images)
        VALUES (?,1,1,'Synthetic Episode',0,0,'2024-01-01 20:00:00','2024-01-01',0,?,10,'[]')`
        ).run(series.Id, 2147483003);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
    docker(["start", name]);
  }
  console.log(
    "sonarr: unmonitored offline synthetic series/episode seeded; backup retained; no external metadata or automatic grab"
  );
}

async function fixtureTarget(root, manifest, app) {
  if (app === "radarr") {
    const movies = await api(root, manifest, app, "/api/v3/movie");
    return movies.find(
      (row) => row.tmdbId === 2147483001 && row.title === "Synthetic Media" && !row.monitored
    );
  }
  const series = (await api(root, manifest, app, "/api/v3/series")).find(
    (row) => row.tvdbId === 2147483002 && row.title === "Synthetic Series" && !row.monitored
  );
  if (!series) throw new Error("Owned unmonitored series fixture required");
  return (await api(root, manifest, app, `/api/v3/episode?seriesId=${series.id}`)).find(
    (row) => row.tvdbId === 2147483003 && row.title === "Synthetic Episode" && !row.monitored
  );
}

async function movieSearch(root, manifest, app = "radarr") {
  await api(root, manifest, "pingufunk", "/api/settings", {
    "matching.minDuration": "0",
    "download.quality": "all",
  });
  const movie = await fixtureTarget(root, manifest, app);
  if (!movie || movie.monitored) throw new Error("Owned unmonitored synthetic movie required");
  const indexers = await api(root, manifest, app, "/api/v3/indexer");
  const owned = indexers.filter((row) =>
    ["direct", "forwarded"].some((transport) => row.name === `Pingufunk isolated QA ${transport}`)
  );
  if (
    owned.length !== 2 ||
    indexers.some((row) => !owned.includes(row) && row.enableInteractiveSearch)
  )
    throw new Error("Owned two-indexer isolated search scope required");
  try {
    for (const transport of ["direct", "forwarded"]) {
      const indexer = owned.find((row) => row.name === `Pingufunk isolated QA ${transport}`);
      // Run each real consumer path alone: native decision ranking may deduplicate
      // identical GUIDs from two indexers and is not a transport-failure proof.
      for (const row of owned)
        await api(
          root,
          manifest,
          app,
          `/api/v3/indexer/${row.id}?forceSave=true`,
          { ...row, enableInteractiveSearch: row.id === indexer.id },
          "PUT"
        );
      const releases = await api(
        root,
        manifest,
        app,
        `/api/v3/release?${app === "radarr" ? "movieId" : "episodeId"}=${movie.id}`
      );
      const candidates = releases.filter(
        (row) =>
          row.indexerId === indexer?.id &&
          row.title.includes(app === "radarr" ? "Synthetic.Media" : "Synthetic.Series")
      );
      if (candidates.length !== 1)
        throw new Error(
          `Owned ${app} ${transport} expected one native parsed candidate, received ${candidates.length}`
        );
      if (!candidates[0].guid || !candidates[0].downloadUrl)
        throw new Error("Owned Radarr candidate transport identity missing");
      if (
        app === "radarr" &&
        manifest.movieCorrelation &&
        (candidates[0].mappedMovieId !== movie.id ||
          candidates[0].tmdbId !== movie.tmdbId ||
          !candidates[0].title.includes(".2024.") ||
          candidates[0].rejections.some((reason) => /unable to parse|unknown movie/i.test(reason)))
      )
        throw new Error("Owned yearless source did not acquire verified native film identity");
      console.log(
        `${app}: ${transport} native search parsed one synthetic candidate; no grab submitted`
      );
    }
  } finally {
    for (const row of owned)
      await api(root, manifest, app, `/api/v3/indexer/${row.id}?forceSave=true`, row, "PUT");
  }
}

async function forwardedSearch(root, manifest) {
  const sources = await api(root, manifest, "prowlarr", "/api/v1/indexer");
  const source = sources.find((row) => row.name === "Pingufunk isolated QA source");
  if (!source) throw new Error("Owned forwarded source required");
  const rows = await api(
    root,
    manifest,
    "prowlarr",
    `/api/v1/search?query=Synthetic%20Media%202024&type=search&categories=2000&indexerIds=${source.id}`
  );
  console.log(`prowlarr: native text search returned ${rows.length} candidates`);
  if (
    rows.length !== 1 ||
    !rows[0].title.includes("Synthetic.Media") ||
    rows[0].indexerId !== source.id
  )
    throw new Error("Owned Prowlarr native text search expected one synthetic result");
  const absent = await api(
    root,
    manifest,
    "prowlarr",
    `/api/v1/search?query=Nonexistent%20Foreign%20Film&type=search&categories=2000&indexerIds=${source.id}`
  );
  if (absent.length !== 0)
    throw new Error("Owned foreign-title negative search returned a candidate");
  console.log("prowlarr: unrelated-title negative search correctly empty");
}

async function boundaries(root, manifest) {
  for (const app of ["sonarr", "radarr", "prowlarr"]) {
    const path = `/api/${app === "prowlarr" ? "v1" : "v3"}/system/status`;
    await api(root, manifest, app, path, undefined, "GET", 401, "synthetic-invalid-not-a-secret");
    const status = await api(root, manifest, app, path);
    if (status.version !== manifest.apps[app].version)
      throw new Error("Owned native version changed");
    console.log(
      `${app}: invalid credential rejected; actual credential still works; no secret disclosed`
    );
  }
  const code =
    "fetch('https://example.invalid/qa').then(()=>process.exit(1)).catch(()=>console.log('External fetch blocked by owned preload'))";
  console.log(docker(["exec", manifest.apps.pingufunk.name, "node", "-e", code]));
}

async function movieDownload(root, manifest, app = "radarr", transport = "direct") {
  if (!["direct", "forwarded"].includes(transport))
    throw new Error("Owned download transport must be direct or forwarded");
  if (!(await fixtureTarget(root, manifest, app)))
    throw new Error("Owned unmonitored download fixture required");
  const queueBefore = await api(root, manifest, "pingufunk", "/api/download?mode=queue");
  if (queueBefore.queue.slots.length)
    throw new Error("Owned empty queue required before media restart");
  const container = manifest.apps.pingufunk.name;
  docker([
    "exec",
    container,
    "node",
    "-e",
    "require('node:fs').mkdirSync('/app/public/pingufunk-media-qa',{recursive:true})",
  ]);
  docker([
    "exec",
    container,
    "ffmpeg",
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=640x360:r=1",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=44100",
    "-t",
    "600",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    "/app/public/pingufunk-media-qa/valid.mp4",
  ]);
  docker(["restart", container]);
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      await api(root, manifest, "pingufunk", "/api/download?mode=queue");
      ready = true;
      break;
    } catch {
      await delay(500);
    }
  }
  if (!ready) throw new Error("Owned media controller readiness failed");
  await api(root, manifest, "pingufunk", "/api/settings", {
    "matching.minDuration": "0",
    "download.quality": "all",
    "download.convertToMkv": "false",
  });
  const models = await api(root, manifest, app, "/api/v3/downloadclient/schema");
  const client = models.find((row) => row.implementation === "Sabnzbd");
  if (!client) throw new Error("Owned SAB schema missing");
  client.name = "Pingufunk isolated SAB QA";
  client.enable = true;
  delete client.id;
  const values = {
    host: "pingufunk",
    port: 6767,
    useSsl: false,
    urlBase: "",
    apiKey: "synthetic-qa-not-a-secret",
    movieCategory: "radarr",
    tvCategory: "sonarr",
    category: app,
  };
  for (const field of client.fields) if (field.name in values) field.value = values[field.name];
  const existing = (await api(root, manifest, app, "/api/v3/downloadclient")).filter(
    (row) => row.name === client.name
  );
  if (existing.length > 1) throw new Error("Owned duplicate SAB client");
  if (existing.length)
    await api(
      root,
      manifest,
      app,
      `/api/v3/downloadclient/${existing[0].id}`,
      { ...client, id: existing[0].id },
      "PUT"
    );
  const saved = existing[0] ?? (await api(root, manifest, app, "/api/v3/downloadclient", client));
  const movie = await fixtureTarget(root, manifest, app);
  if (!movie) throw new Error("Owned unmonitored movie fixture required");
  const indexers = await api(root, manifest, app, "/api/v3/indexer");
  const owned = indexers.filter((row) =>
    ["direct", "forwarded"].some((path) => row.name === `Pingufunk isolated QA ${path}`)
  );
  const selected = owned.find((row) => row.name === `Pingufunk isolated QA ${transport}`);
  if (
    owned.length !== 2 ||
    !selected ||
    indexers.some((row) => !owned.includes(row) && row.enableInteractiveSearch)
  )
    throw new Error("Owned isolated download indexer scope required");
  const before = (
    await api(root, manifest, "pingufunk", "/api/download?mode=history")
  ).history.slots.map((row) => row.nzo_id);
  try {
    for (const row of owned)
      await api(
        root,
        manifest,
        app,
        `/api/v3/indexer/${row.id}?forceSave=true`,
        { ...row, enableInteractiveSearch: row.id === selected.id },
        "PUT"
      );
    const releases = await api(
      root,
      manifest,
      app,
      `/api/v3/release?${app === "radarr" ? "movieId" : "episodeId"}=${movie.id}`
    );
    const candidate = releases.find(
      (row) =>
        row.title.includes(app === "radarr" ? "Synthetic.Media" : "Synthetic.Series") &&
        row.indexerId === selected.id
    );
    if (!candidate) throw new Error("Owned movie download candidate missing");
    await api(root, manifest, app, "/api/v3/release", {
      ...candidate,
      ...(app === "radarr"
        ? { movieId: movie.id }
        : { episodeIds: [movie.id], seriesId: movie.seriesId }),
      downloadClientId: saved.id,
      shouldOverride: true,
    });
  } finally {
    for (const row of owned)
      await api(root, manifest, app, `/api/v3/indexer/${row.id}?forceSave=true`, row, "PUT");
  }
  for (let attempt = 0; attempt < 60; attempt++) {
    const slots = (await api(root, manifest, "pingufunk", "/api/download?mode=history")).history
      .slots;
    const completed = slots.find((row) => !before.includes(row.nzo_id));
    if (completed) {
      if (completed.status !== "Completed" || completed.category !== app)
        throw new Error("Owned Radarr synthetic download failed or category mismatched");
      console.log(
        `${app}: ${transport} real release submission -> NZB -> SAB addfile -> completed synthetic media/history passed; import not yet attested`
      );
      return;
    }
    await delay(500);
  }
  throw new Error("Owned Radarr synthetic download completion timeout");
}

async function movieImport(root, manifest, app = "radarr") {
  const movie = await fixtureTarget(root, manifest, app);
  if (!movie) throw new Error("Owned unmonitored movie fixture required");
  const history = (await api(root, manifest, app, "/api/v3/history?page=1&pageSize=100")).records;
  const job = (
    await api(root, manifest, "pingufunk", "/api/download?mode=history")
  ).history.slots.find(
    (row) =>
      row.status === "Completed" &&
      row.category === app &&
      history.some(
        (record) =>
          record[app === "radarr" ? "movieId" : "episodeId"] === movie.id &&
          record.eventType === "grabbed" &&
          record.downloadId?.toLowerCase() === row.nzo_id.toLowerCase()
      )
  );
  const remoteRoot = job?.storage.startsWith("/app/downloads/") ? "/app/downloads/" : "/downloads/";
  if (!job || !job.storage.startsWith(remoteRoot) || resolve(job.storage) !== job.storage)
    throw new Error("Owned native grabbed/completed job and confined storage required");
  const relative = job.storage.slice(remoteRoot.length);
  const destination = join(root, app, "qa-completed", relative);
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  mkdirSync(join(root, app, "synthetic-library"), { recursive: true, mode: 0o700 });
  // A private copied test volume models a user-selected shared/path-mapped
  // installation. Never expose a real library or prescribe a production route.
  docker(["cp", `${manifest.apps.pingufunk.name}:${job.storage}/.`, destination]);
  const mappings = await api(root, manifest, app, "/api/v3/remotepathmapping");
  const mapping = {
    host: "pingufunk",
    remotePath: remoteRoot,
    localPath: "/config/qa-completed/",
  };
  const existing = mappings.filter(
    (row) => row.host === mapping.host && row.remotePath === mapping.remotePath
  );
  if (existing.length > 1 || existing.some((row) => row.localPath !== mapping.localPath))
    throw new Error("Owned remote path mapping conflict");
  if (!existing.length) await api(root, manifest, app, "/api/v3/remotepathmapping", mapping);
  await api(root, manifest, app, "/api/v3/command", { name: "CheckForFinishedDownload" });
  for (let attempt = 0; attempt < 60; attempt++) {
    const current = await api(
      root,
      manifest,
      app,
      `/api/v3/${app === "radarr" ? "movie" : "episode"}/${movie.id}`
    );
    if (current.hasFile) {
      const file = await api(
        root,
        manifest,
        app,
        `/api/v3/${app === "radarr" ? "moviefile" : "episodefile"}/${app === "radarr" ? current.movieFile.id : current.episodeFileId}`
      );
      if (
        (app === "radarr" ? file.movieId !== movie.id : file.seriesId !== movie.seriesId) ||
        !file.path.startsWith("/config/synthetic-library/") ||
        resolve(file.path) !== file.path ||
        !(file.size > 0)
      )
        throw new Error("Owned imported movie file contract mismatch");
      const size = Number(docker(["exec", manifest.apps[app].name, "stat", "-c", "%s", file.path]));
      if (size !== file.size)
        throw new Error("Owned imported physical file size differs from native API");
      const imported = (
        await api(root, manifest, app, "/api/v3/history?page=1&pageSize=100")
      ).records.some(
        (row) =>
          row[app === "radarr" ? "movieId" : "episodeId"] === movie.id &&
          row.eventType === "downloadFolderImported" &&
          row.downloadId?.toLowerCase() === job.nzo_id.toLowerCase()
      );
      if (!imported) throw new Error("Owned native import history missing");
      await consumerRemove(root, manifest, app, job, file);
      console.log(
        `${app}: native completed-download handling imported synthetic media; file identity/size/path and matching download history verified`
      );
      return;
    }
    await delay(500);
  }
  const queue = (await api(root, manifest, app, "/api/v3/queue?page=1&pageSize=100")).records;
  const tracked = queue.filter((row) => row.downloadId === job.nzo_id);
  console.log(
    `radarr: import pending; tracked=${tracked.length}; status=${tracked[0]?.trackedDownloadStatus ?? "absent"}`
  );
  throw new Error("Owned native movie import timeout; retained fixture and completed media");
}

async function consumerRemove(root, manifest, app, job, file) {
  if (!["sonarr", "radarr"].includes(app))
    throw new Error("Owned consumer removal selection required");
  const slots = (await api(root, manifest, "pingufunk", "/api/download?mode=history")).history
    .slots;
  if (!file.path.startsWith("/config/synthetic-library/") || resolve(file.path) !== file.path)
    throw new Error("Owned imported library path required");
  const clients = (await api(root, manifest, app, "/api/v3/downloadclient")).filter(
    (row) => row.name === "Pingufunk isolated SAB QA"
  );
  if (clients.length !== 1) throw new Error("Owned unique consumer client required");
  const client = clients[0];
  await api(
    root,
    manifest,
    app,
    `/api/v3/downloadclient/${client.id}`,
    { ...client, removeCompletedDownloads: true },
    "PUT"
  );
  try {
    await api(root, manifest, app, "/api/v3/command", { name: "CheckForFinishedDownload" });
    for (let attempt = 0; attempt < 60; attempt++) {
      const current = (await api(root, manifest, "pingufunk", "/api/download?mode=history")).history
        .slots;
      if (!current.some((row) => row.nzo_id === job.nzo_id)) {
        if (
          Number(docker(["exec", manifest.apps[app].name, "stat", "-c", "%s", file.path])) !==
          file.size
        )
          throw new Error("Owned native removal damaged the imported library file");
        const others = slots.filter((row) => row.category !== app);
        if (others.some((row) => !current.some((present) => present.nzo_id === row.nzo_id)))
          throw new Error("Owned native removal affected a different consumer's job");
        console.log(
          `${app}: native completed-history removal passed; imported file and other consumer jobs preserved; only own synthetic source removed`
        );
        return;
      }
      await delay(500);
    }
    throw new Error("Owned native consumer history removal timeout");
  } finally {
    await api(root, manifest, app, `/api/v3/downloadclient/${client.id}`, client, "PUT");
  }
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
    else if (command === "bootstrap") await bootstrap(root, manifest);
    else if (command === "movie-fixture") await movieFixture(root, manifest);
    else if (command === "series-fixture") await seriesFixture(root, manifest);
    else if (command === "movie-search") await movieSearch(root, manifest);
    else if (command === "episode-search") await movieSearch(root, manifest, "sonarr");
    else if (command === "forwarded-search") await forwardedSearch(root, manifest);
    else if (command === "boundaries") await boundaries(root, manifest);
    else if (command === "movie-download")
      await movieDownload(root, manifest, "radarr", process.argv[4] ?? "direct");
    else if (command === "episode-download")
      await movieDownload(root, manifest, "sonarr", process.argv[4] ?? "direct");
    else if (command === "movie-import") await movieImport(root, manifest);
    else if (command === "episode-import") await movieImport(root, manifest, "sonarr");
    else if (command === "stop") {
      for (const item of Object.values(manifest.apps)) docker(["stop", item.name]);
      console.log("Owned QA instances stopped; configuration retained, no deletion");
    } else throw new Error("Use up or a documented QA command with the exact QA directory");
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
