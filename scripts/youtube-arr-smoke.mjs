import { execFileSync } from "node:child_process";
import {
  up,
  load,
  api,
  docker,
  bootstrap,
  seriesFixture,
  fixtureIndexersReady,
} from "./arr-test-instances.mjs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const transport = process.argv[2];
if (!["direct", "forwarded"].includes(transport))
  throw new Error("Owned direct/forwarded selection required");
const backend = process.argv[3];
if (!["sqlite", "postgresql"].includes(backend)) throw Error("Owned database selection required");
process.env.PINGUFUNK_ARR_QA_TV_DELIVERY = "1";
process.env.PINGUFUNK_ARR_QA_YOUTUBE = "1";
process.env.PINGUFUNK_ARR_QA_DATABASE = backend;
let root, manifest, rollbackContainer;
const fail = (message) => {
  throw new Error(`Owned TV delivery: ${message}`);
};
async function command(body) {
  const created = await api(root, manifest, "sonarr", "/api/v3/command", body);
  // A bulk command also performs each real, freshly revalidated NZB grab;
  // its overall test deadline is not the indexer's 15-second request deadline.
  const deadline = Date.now() + 180_000;
  for (let attempt = 0; attempt < 360 && Date.now() < deadline; attempt++) {
    const result = await api(root, manifest, "sonarr", `/api/v3/command/${created.id}`);
    if (result.status === "completed") return;
    if (["failed", "aborted"].includes(result.status)) fail("native command failed (not retried)");
    await delay(500);
  }
  fail("native command deadline");
}
const histories = async () =>
  (await api(root, manifest, "sonarr", "/api/v3/history?page=1&pageSize=250")).records;
function journal() {
  return JSON.parse(
    docker([
      "exec",
      manifest.apps.pingufunk.name,
      "node",
      "-e",
      'const {PrismaClient}=require(process.env.DATABASE_PROVIDER==="postgresql"?"./generated/postgresql":"./generated/sqlite");const db=new PrismaClient({log:[]});(async()=>{const row=await db.config.findUnique({where:{key:"internal.tv-delivery.v2"}});console.log(row?.value??"null");await db.$disconnect()})().catch(()=>process.exitCode=1)',
    ])
  );
}
try {
  root = await up();
  manifest = load(root);
  await bootstrap(root, manifest);
  await seriesFixture(root, manifest);
  const controller = manifest.apps.pingufunk.name;
  docker([
    "exec",
    controller,
    "node",
    "-e",
    'if(Number(process.versions.node.split(".")[0])!==24)process.exit(1)',
  ]);
  // Real packaged tools; all subsequent media and extractor inputs are synthetic.
  docker(["exec", controller, "/app/ytdlp/yt-dlp", "--version"]);
  for (const [file, args] of [
    [
      "youtube-video.mp4",
      [
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=1920x1080:r=1",
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
      ],
    ],
    [
      "youtube-audio.m4a",
      [
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000",
        "-vn",
        "-c:a",
        "aac",
        "-metadata:s:a:0",
        "language=deu",
      ],
    ],
  ])
    docker(["exec", controller, "ffmpeg", "-v", "error", "-y", ...args, "-t", "60", "/qa/" + file]);
  writeFileSync(
    join(root, "pingufunk", "youtube-metadata"),
    readFileSync("scripts/youtube-arr-tool.mjs"),
    { mode: 0o755 }
  );
  await api(root, manifest, "pingufunk", "/api/settings", {
    "integration.sonarr.enabled": "true",
    "integration.sonarr.url": "http://sonarr:8989",
    "matching.minDuration": "0",
    "download.quality": "best",
    "download.convertToMkv": "false",
    "download.path": "/downloads",
    "download.ytdlpPath": "/qa/youtube-metadata",
  });
  const series = (await api(root, manifest, "sonarr", "/api/v3/series")).find(
    (row) => row.tvdbId === 2147483002
  );
  if (!series?.monitored) fail("verified monitored fixture missing");
  const initialCatalogue = await api(root, manifest, "pingufunk", "/api/youtube/catalogue");
  const registry = initialCatalogue.registry;
  registry.channels.push({
    id: "UCaaaaaaaaaaaaaaaaaaaaaa",
    name: "Synthetic YouTube channel",
    enabled: true,
  });
  registry.programMappings.push({
    kind: "series",
    channelId: "UCaaaaaaaaaaaaaaaaaaaaaa",
    sourceId: "PLsynthetic123456",
    name: "Synthetic Series",
    targetId: 2147483002,
    enabled: true,
    sourceNumbering: "publisher",
    targetOrder: "aired",
  });
  await api(root, manifest, "pingufunk", "/api/youtube/catalogue", {
    action: "save",
    revision: initialCatalogue.revision,
    enabled: true,
    registry,
  });
  const savedCatalogue = await api(root, manifest, "pingufunk", "/api/youtube/catalogue");
  await api(root, manifest, "pingufunk", "/api/youtube/catalogue", {
    action: "refresh",
    revision: savedCatalogue.revision,
  });
  let catalogue;
  for (let attempt = 0; attempt < 30; attempt++) {
    catalogue = await api(root, manifest, "pingufunk", "/api/youtube/catalogue");
    if (catalogue.scan.state !== "running") break;
    await delay(250);
  }
  if (catalogue?.scan.state !== "complete" || catalogue.scan.entries !== 6)
    fail("complete warm metadata index required");
  const definitions = await api(root, manifest, "sonarr", "/api/v3/qualitydefinition");
  await api(
    root,
    manifest,
    "sonarr",
    "/api/v3/qualitydefinition/update",
    definitions.map((row) => ({ ...row, minSize: 0 })),
    "PUT"
  );
  const indexers = await api(root, manifest, "sonarr", "/api/v3/indexer");
  const selected = indexers.find((row) => row.name === `Pingufunk isolated QA ${transport}`);
  if (!selected || indexers.length !== 2) fail("exact native fixture indexers required");
  for (const row of indexers)
    await api(
      root,
      manifest,
      "sonarr",
      `/api/v3/indexer/${row.id}?forceSave=true`,
      {
        ...row,
        enableRss: row.id === selected.id,
        enableAutomaticSearch: row.id === selected.id,
        enableInteractiveSearch: false,
      },
      "PUT"
    );
  await fixtureIndexersReady(
    root,
    manifest,
    "sonarr",
    indexers.map((row) => row.id)
  );
  const client = (await api(root, manifest, "sonarr", "/api/v3/downloadclient/schema")).find(
    (row) => row.implementation === "Sabnzbd"
  );
  if (!client) fail("native SAB schema missing");
  delete client.id;
  client.name = "Owned cold delivery SAB";
  client.enable = true;
  client.removeCompletedDownloads = false;
  const values = {
    host: "pingufunk",
    port: 6767,
    useSsl: false,
    urlBase: "",
    apiKey: "synthetic-qa-not-a-secret",
    tvCategory: "sonarr",
  };
  for (const field of client.fields) if (field.name in values) field.value = values[field.name];
  await api(root, manifest, "sonarr", "/api/v3/downloadclient", client);
  await api(root, manifest, "sonarr", "/api/v3/remotepathmapping", {
    host: "pingufunk",
    remotePath: "/downloads/",
    localPath: "/qa-downloads/",
  });
  mkdirSync(join(root, "sonarr", "synthetic-library", "Synthetic Series"), { recursive: true });
  docker(["restart", controller]); // Real cold process, not just a neutral RSS string assertion.
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      await api(root, manifest, "pingufunk", "/api/download?mode=queue");
      break;
    } catch {
      await delay(500);
    }
  }
  if (journal() !== null) fail("pre-existing discovery invalidates cold gate");
  await command({ name: "MissingEpisodeSearch", seriesId: series.id });
  const cold = (await histories()).filter((row) => row.eventType === "grabbed");
  console.log(
    `Owned ${transport}: cold bulk command completed; initial native grabs=${cold.length}/4`
  );
  if (cold.length >= 4) fail("fixture did not exercise deferred delivery");
  const initial = journal();
  if (initial?.entries.length !== 5)
    fail("cold discovery incomplete (including expired alternative)");
  const unprocessed = (row) => row.readyAt === null && row.blockedUrls.length === 0;
  for (let attempt = 0; attempt < 600 && journal().entries.some(unprocessed); attempt++)
    await delay(500);
  if (journal().entries.some(unprocessed)) fail("background proof deadline");
  if (journal().entries.filter((row) => row.blockedUrls.length === 1).length !== 1)
    fail("expired alternative not quarantined independently");
  // No second episode/season search, manual release, retry or profile override.
  await command({ name: "RssSync" });
  console.log(`Owned ${transport}: native RSS delivery completed; awaiting physical imports`);
  for (let attempt = 0; attempt < 180; attempt++) {
    const slots = (await api(root, manifest, "pingufunk", "/api/download?mode=history&limit=100"))
      .history.slots;
    if (slots.some((row) => row.status === "Failed")) fail("synthetic transfer failed");
    if (slots.length === 4 && slots.every((row) => row.status === "Completed")) break;
    await delay(500);
  }
  await command({ name: "CheckForFinishedDownload" });
  let episodes;
  for (let attempt = 0; attempt < 120; attempt++) {
    episodes = await api(root, manifest, "sonarr", `/api/v3/episode?seriesId=${series.id}`);
    if (episodes.length === 4 && episodes.every((row) => row.hasFile)) break;
    await delay(500);
  }
  if (episodes?.length !== 4 || episodes.some((row) => !row.hasFile))
    fail("native physical import incomplete");
  const history = await histories();
  const grabs = history.filter((row) => row.eventType === "grabbed");
  if (grabs.length !== 4 || new Set(grabs.map((row) => row.downloadId)).size !== 4)
    fail("duplicate/missing native grabs");
  for (const episode of episodes) {
    const file = await api(
      root,
      manifest,
      "sonarr",
      `/api/v3/episodefile/${episode.episodeFileId}`
    );
    const grab = grabs.find((row) => row.episodeId === episode.id);
    if (
      file.seriesId !== series.id ||
      !file.path.startsWith("/config/synthetic-library/") ||
      !(file.size > 0) ||
      file.quality.quality.name !== "WEBDL-1080p" ||
      !history.some(
        (row) =>
          row.episodeId === episode.id &&
          row.eventType === "downloadFolderImported" &&
          row.downloadId === grab?.downloadId
      )
    )
      fail("native file/quality/history binding mismatch");
    if (
      Number(docker(["exec", manifest.apps.sonarr.name, "stat", "-c", "%s", file.path])) !==
      file.size
    )
      fail("physical size mismatch");
    docker(["exec", manifest.apps.sonarr.name, "test", "-f", file.path]);
    docker(["exec", manifest.apps.sonarr.name, "test", "!", "-L", file.path]);
  }
  await command({ name: "RssSync" });
  if ((await histories()).filter((row) => row.eventType === "grabbed").length !== 4)
    fail("repeat RSS caused a duplicate");
  const transfers = readFileSync(join(root, "pingufunk", "youtube-transfers.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  if (
    transfers.length !== 8 ||
    new Set(transfers.map((row) => row.id + ":" + row.stream)).size !== 8 ||
    transfers.some((row) => row.id === "00000000004")
  )
    fail("exact video/audio transfer ownership mismatch");
  const readJobs = (container) =>
    JSON.parse(
      docker([
        "exec",
        container,
        "node",
        "-e",
        'const {PrismaClient}=require(process.env.DATABASE_PROVIDER==="postgresql"?"./generated/postgresql":"./generated/sqlite");const db=new PrismaClient({log:[]});(async()=>{console.log(JSON.stringify(await db.download.findMany({orderBy:{id:"asc"}}),(_key,value)=>typeof value==="bigint"?value.toString():value));await db.$disconnect()})().catch(()=>process.exitCode=1)',
      ])
    );
  const before = readJobs(controller);
  if (before.length !== 4 || before.some((job) => JSON.parse(job.mediaExpectations).version !== 5))
    fail("four frozen v5 jobs required");
  docker(["stop", controller]);
  const rollbackTag =
    backend === "postgresql"
      ? "pingufunk-pg-maintenance-rollback-qa"
      : "pingufunk-sqlite-source-rollback-qa";
  const rollbackImage = docker(["image", "inspect", rollbackTag, "--format", "{{.Id}}"]);
  rollbackContainer = `pingufunk-arr-youtube-rollback-${manifest.owner}`;
  const databaseUrl =
    backend === "postgresql"
      ? `postgresql://pingufunk_media_qa@${manifest.database.name}/pingufunk_media_qa`
      : "file:/qa/database.sqlite";
  docker([
    "run",
    "-d",
    "--name",
    rollbackContainer,
    "--network",
    manifest.network,
    "--label",
    `pingufunk.arr-qa.owner=${manifest.owner}`,
    "-e",
    `DATABASE_URL=${databaseUrl}`,
    "-e",
    `DATABASE_PROVIDER=${backend}`,
    "-e",
    "PINGUFUNK_WRITES_ENABLED=1",
    "-e",
    `PUID=${process.getuid()}`,
    "-e",
    `PGID=${process.getgid()}`,
    "-e",
    `PINGUFUNK_MEDIA_QA_OWNER=${manifest.owner}`,
    "-e",
    "PINGUFUNK_ARR_QA_YOUTUBE=1",
    "-e",
    "NODE_OPTIONS=--import /qa/provider.mjs",
    "--mount",
    `type=bind,src=${join(root, "pingufunk")},dst=/qa`,
    "--mount",
    `type=bind,src=${join(root, "shared-downloads")},dst=/downloads`,
    "--mount",
    `type=bind,src=${process.cwd()}/scripts/arr-test-provider.mjs,dst=/qa/provider.mjs,readonly`,
    "--mount",
    `type=bind,src=${process.cwd()}/scripts/media-container-provider.mjs,dst=/qa/media-provider.mjs,readonly`,
    rollbackImage,
    "sh",
    "-ec",
    "export PINGUFUNK_BOOT_QUEUE=0; exec node server.js",
  ]);
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      docker(["exec", rollbackContainer, "curl", "-fsS", "http://127.0.0.1:6767/api?mode=version"]);
      ready = true;
      break;
    } catch {
      await delay(500);
    }
  }
  if (!ready) fail("rollback reader not ready");
  const job = before[0];
  const nzb = `<?xml version="1.0"?><!-- ${Buffer.from(job.title).toString("base64")} --><!-- ${Buffer.from(job.url).toString("base64")} --><nzb><head><meta type="pingufunk-media-expectations">${Buffer.from(job.mediaExpectations).toString("base64")}</meta></head></nzb>`;
  const status = execFileSync(
    "docker",
    [
      "exec",
      "-i",
      rollbackContainer,
      "node",
      "-e",
      'let body="";process.stdin.on("data",part=>body+=part);process.stdin.on("end",async()=>{const response=await fetch("http://127.0.0.1:6767/api?mode=addfile&cat=sonarr",{method:"POST",headers:{"content-type":"application/x-nzb"},body});console.log(response.status);});',
    ],
    { input: nzb, encoding: "utf8", timeout: 25000 }
  ).trim();
  if (status !== "400" || JSON.stringify(readJobs(rollbackContainer)) !== JSON.stringify(before))
    fail("old image did not reject v5 without changing preserved jobs");
  docker(["stop", rollbackContainer]);
  docker(["rm", rollbackContainer]);
  rollbackContainer = undefined;
  docker(["start", controller]);
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await api(root, manifest, "pingufunk", "/api/download?mode=version");
      break;
    } catch {
      await delay(500);
    }
  }
  if (JSON.stringify(readJobs(controller)) !== JSON.stringify(before))
    fail("current-image return changed existing jobs or receipts");
  console.log(
    `Owned YouTube ${backend}: old image rejected v5; all job payloads, receipts, IDs and statuses unchanged through return`
  );
  console.log(
    `Owned YouTube ${backend} ${transport}: frozen format/audio mux and ffprobe confirmed by actual Sonarr files and paired history`
  );
  console.log(
    `Owned YouTube ${backend} ${transport}: one cold bulk search (${cold.length}/4 initial grabs), background -> RSS -> 4/4 real native imports; repeat RSS produced no duplicate`
  );
} catch (error) {
  console.error(
    error.message.startsWith("Owned")
      ? error.message
      : "Owned cold delivery gate failed; private diagnostics suppressed"
  );
  process.exitCode = 1;
} finally {
  if (rollbackContainer) {
    docker(["stop", rollbackContainer]);
    docker(["rm", rollbackContainer]);
  }
  if (manifest) {
    for (const item of Object.values(manifest.apps)) docker(["stop", item.name]);
    if (manifest.database) docker(["stop", manifest.database.name]);
  }
}
