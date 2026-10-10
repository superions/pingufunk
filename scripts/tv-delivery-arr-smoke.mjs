import {
  up,
  load,
  api,
  docker,
  bootstrap,
  seriesFixture,
  fixtureIndexersReady,
} from "./arr-test-instances.mjs";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const transport = process.argv[2];
if (!["direct", "forwarded"].includes(transport))
  throw new Error("Owned direct/forwarded selection required");
process.env.PINGUFUNK_ARR_QA_TV_DELIVERY = "1";
let root, manifest;
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
      'const {PrismaClient}=require("./generated/sqlite");const db=new PrismaClient({log:[]});(async()=>{const row=await db.config.findUnique({where:{key:"internal.tv-delivery.v1"}});console.log(row?.value??"null");await db.$disconnect()})().catch(()=>process.exitCode=1)',
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
    "ffmpeg",
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=1920x1080:r=1",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    "60",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-c:a",
    "aac",
    "-metadata:s:a:0",
    "language=deu",
    "-movflags",
    "+faststart",
    "/qa/delivery.mp4",
  ]);
  await api(root, manifest, "pingufunk", "/api/settings", {
    "integration.sonarr.enabled": "true",
    "integration.sonarr.url": "http://sonarr:8989",
    "matching.minDuration": "0",
    "download.quality": "best",
    "download.convertToMkv": "false",
    "download.path": "/downloads",
  });
  const series = (await api(root, manifest, "sonarr", "/api/v3/series")).find(
    (row) => row.tvdbId === 2147483002
  );
  if (!series?.monitored) fail("verified monitored fixture missing");
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
  // Native indexer validation during bootstrap may already have read the
  // catalogue. Count the cold process's first real RSS poll relative to that
  // setup, rather than mistaking those earlier probes for another feed fetch.
  const setupStats = JSON.parse(
    readFileSync(join(root, "pingufunk", "delivery-source-stats.json"), "utf8")
  );
  await command({ name: "MissingEpisodeSearch", seriesId: series.id });
  const cold = (await histories()).filter((row) => row.eventType === "grabbed");
  console.log(
    `Owned ${transport}: cold bulk command completed; initial native grabs=${cold.length}/80`
  );
  if (cold.length >= 80) fail("fixture did not exercise deferred delivery");
  const initial = journal();
  if (initial?.entries.length !== 80) fail("cold discovery incomplete");
  for (
    let attempt = 0;
    attempt < 600 && journal().entries.some((row) => row.readyAt === null);
    attempt++
  )
    await delay(500);
  if (journal().entries.some((row) => row.readyAt === null)) fail("background proof deadline");
  // No second episode/season search, manual release, retry or profile override.
  await command({ name: "RssSync" });
  const firstPollStats = JSON.parse(
    readFileSync(join(root, "pingufunk", "delivery-source-stats.json"), "utf8")
  );
  if (firstPollStats.cataloguePages - (setupStats.cataloguePages ?? 0) !== 5)
    fail("cold primary source window did not fetch exactly five complete pages");
  console.log(`Owned ${transport}: native RSS delivery completed; awaiting physical imports`);
  for (let attempt = 0; attempt < 180; attempt++) {
    const slots = (await api(root, manifest, "pingufunk", "/api/download?mode=history&limit=100"))
      .history.slots;
    if (slots.some((row) => row.status === "Failed")) fail("synthetic transfer failed");
    if (slots.length === 80 && slots.every((row) => row.status === "Completed")) break;
    await delay(500);
  }
  await command({ name: "CheckForFinishedDownload" });
  let episodes;
  for (let attempt = 0; attempt < 120; attempt++) {
    episodes = await api(root, manifest, "sonarr", `/api/v3/episode?seriesId=${series.id}`);
    if (episodes.length === 80 && episodes.every((row) => row.hasFile)) break;
    await delay(500);
  }
  if (episodes?.length !== 80 || episodes.some((row) => !row.hasFile))
    fail("native physical import incomplete");
  const history = await histories();
  const grabs = history.filter((row) => row.eventType === "grabbed");
  if (grabs.length !== 80 || new Set(grabs.map((row) => row.downloadId)).size !== 80)
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
  if ((await histories()).filter((row) => row.eventType === "grabbed").length !== 80)
    fail("repeat RSS caused a duplicate");
  const stats = JSON.parse(
    readFileSync(join(root, "pingufunk", "delivery-source-stats.json"), "utf8")
  );
  if (stats.transfers !== 80 || stats.ranges < 80)
    fail("bounded proof/full-transfer cardinality mismatch");
  console.log(
    `Owned ${transport}: one cold bulk search (${cold.length}/80 initial grabs), background -> RSS -> 80/80 real native imports; repeat RSS produced no duplicate`
  );
} catch (error) {
  console.error(
    error.message.startsWith("Owned")
      ? error.message
      : "Owned cold delivery gate failed; private diagnostics suppressed"
  );
  process.exitCode = 1;
} finally {
  if (manifest) for (const item of Object.values(manifest.apps)) docker(["stop", item.name]);
}
