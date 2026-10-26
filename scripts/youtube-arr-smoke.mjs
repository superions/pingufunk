import { execFileSync, spawnSync } from "node:child_process";
import {
  up,
  load,
  api,
  docker,
  bootstrap,
  seriesFixture,
  fixtureIndexersReady,
  movieFixture,
  movieDownload,
  movieImport,
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
  await movieFixture(root, manifest);
  const controller = manifest.apps.pingufunk.name;
  docker([
    "exec",
    controller,
    "node",
    "-e",
    'if(Number(process.versions.node.split(".")[0])!==24)process.exit(1)',
  ]);
  // Real packaged tools; all subsequent media and extractor inputs are synthetic.
  const toolVersion = JSON.parse(readFileSync("src/server/ytdlp-release.json", "utf8")).version;
  if (docker(["exec", controller, "/app/ytdlp/yt-dlp", "--version"]) !== toolVersion)
    fail("packaged extractor revision mismatch");
  // No usable extractor or network URL: qualify bundled EJS and selected Node
  // inside the actual image without requesting any public YouTube metadata.
  const offline = spawnSync(
    "docker",
    [
      "exec",
      controller,
      "/app/ytdlp/yt-dlp",
      "--ignore-config",
      "--no-plugin-dirs",
      "--no-remote-components",
      "--no-js-runtimes",
      "--js-runtimes",
      "node:/usr/local/bin/node",
      "--verbose",
      "--simulate",
      "--skip-download",
      "--use-extractors",
      "end",
      "--",
      "invalid:",
    ],
    { encoding: "utf8", timeout: 15000 }
  );
  const diagnostic = offline.stdout + offline.stderr;
  if (
    offline.error ||
    offline.status !== 1 ||
    !/Optional libraries:.*yt_dlp_ejs/.test(diagnostic) ||
    !/JS runtimes:.*node-24\./.test(diagnostic) ||
    !/Unsupported URL|No suitable extractor/.test(diagnostic)
  )
    fail("offline packaged Node/EJS capability missing");
  console.log("Owned YouTube tooling: pinned extractor, bundled EJS and Node 24 qualified offline");
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
  registry.programMappings.push({
    kind: "movie",
    channelId: "UCaaaaaaaaaaaaaaaaaaaaaa",
    sourceId: "00000000005",
    name: "Synthetic Media",
    targetId: 2147483001,
    enabled: true,
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
  if (catalogue?.scan.state !== "complete" || catalogue.scan.entries !== 7)
    fail(
      `complete warm metadata index required (${catalogue?.scan.state}, ${catalogue?.scan.entries} entries)`
    );
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
    const copy = `verified-episode-${episode.id}.mp4`;
    docker(["cp", `${manifest.apps.sonarr.name}:${file.path}`, join(root, "pingufunk", copy)]);
    const probe = JSON.parse(
      docker([
        "exec",
        controller,
        "ffprobe",
        "-v",
        "error",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        `/qa/${copy}`,
      ])
    );
    const video = probe.streams.filter((row) => row.codec_type === "video");
    const audio = probe.streams.filter((row) => row.codec_type === "audio");
    if (
      video.length !== 1 ||
      video[0].width !== 1920 ||
      video[0].height !== 1080 ||
      audio.length !== 1 ||
      !["deu", "ger", "de"].includes(audio[0].tags?.language) ||
      !Number.isFinite(Number(probe.format.duration)) ||
      Math.abs(Number(probe.format.duration) - 60) > 1
    )
      fail("independent imported-file audio/pixel/duration mismatch");
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
  for (let i = 0; i < 4; i++) {
    const id = String(i).padStart(11, "0");
    const detail = JSON.parse(
      readFileSync(join(root, "pingufunk", `youtube-metadata-${id}.json`), "utf8")
    );
    if (
      detail.count < 3 ||
      transfers.some(
        (row) => row.id === id && (!/^\d+$/.test(row.sig ?? "") || Number(row.sig) < 1)
      )
    )
      fail("transfer did not independently resolve rotated signed selectors and audio proof");
  }
  // The same source adapter also serves the existing film/NZB/SAB/Radarr owner.
  // Its native interactive fixture is separate from the single cold TV command.
  let filmReady = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const result = await api(
      root,
      manifest,
      "pingufunk",
      "/api/search?q=Synthetic%20Media&type=movie"
    );
    if (
      result.results?.some(
        (row) => row.title === "Synthetic Media (2024)" && Object.keys(row.nzbDownloads).length
      )
    ) {
      filmReady = true;
      break;
    }
    await delay(500);
  }
  if (!filmReady) fail("film did not use the shared bounded media-facts owner");
  await movieDownload(root, manifest, "radarr", transport);
  await movieImport(root, manifest, "radarr", true);
  const film = (await api(root, manifest, "radarr", "/api/v3/movie")).find(
    (row) => row.tmdbId === 2147483001
  );
  if (!film?.hasFile) fail("native YouTube film import absent");
  const filmFile = await api(root, manifest, "radarr", `/api/v3/moviefile/${film.movieFile.id}`);
  docker([
    "cp",
    `${manifest.apps.radarr.name}:${filmFile.path}`,
    join(root, "pingufunk", "verified-film.mp4"),
  ]);
  const filmProbe = JSON.parse(
    docker([
      "exec",
      controller,
      "ffprobe",
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      "/qa/verified-film.mp4",
    ])
  );
  if (
    filmFile.quality.quality.name !== "WEBDL-1080p" ||
    filmProbe.streams.filter((row) => row.codec_type === "video").length !== 1 ||
    filmProbe.streams.filter((row) => row.codec_type === "audio").length !== 1 ||
    filmProbe.streams.filter(
      (row) => row.codec_type === "video" && row.width === 1920 && row.height === 1080
    ).length !== 1 ||
    filmProbe.streams.filter(
      (row) => row.codec_type === "audio" && ["deu", "ger", "de"].includes(row.tags?.language)
    ).length !== 1 ||
    !Number.isFinite(Number(filmProbe.format.duration)) ||
    Math.abs(Number(filmProbe.format.duration) - 60) > 1
  )
    fail("independent imported film media mismatch");
  const finalTransfers = readFileSync(join(root, "pingufunk", "youtube-transfers.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  if (
    finalTransfers.length !== 10 ||
    new Set(finalTransfers.map((row) => row.id + ":" + row.stream)).size !== 10
  )
    fail("film transfer duplicated a source or bypassed the common adapter");
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
  if (
    before.length !== 5 ||
    before.some((job) => JSON.parse(job.mediaExpectations).version !== 5) ||
    before.filter((job) => JSON.parse(job.mediaExpectations).mediaKind === "movie").length !== 1
  )
    fail("five frozen series/film v5 jobs required");
  docker(["stop", controller]);
  // Roll back this source extension to its immediately preceding, v1-v4-aware
  // checkpoint; unrelated pre-protocol DB-cutover images cannot reject v5.
  const rollbackTag = "pingufunk-youtube-source-rollback-qa";
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
    "export PINGUFUNK_BOOT_QUEUE=0; if [ -f /qa/youtube-rollback-maintenance ]; then export PINGUFUNK_WRITES_ENABLED=0; fi; exec node server.js",
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
  const legacy = {
    version: 3,
    mediaKind: "unknown",
    durations: { source: null, metadata: null },
    audio: null,
    sourceAudio: null,
    resolution: null,
  };
  const controls = execFileSync(
    "docker",
    [
      "exec",
      "-i",
      rollbackContainer,
      "node",
      "-e",
      'let body="";process.stdin.on("data",part=>body+=part);process.stdin.on("end",async()=>{const values=JSON.parse(body),statuses=[];for(const expected of [values.legacy,values.current]){const query=new URLSearchParams({encodedTitle:Buffer.from(values.title).toString("base64"),encodedUrl:Buffer.from(values.url).toString("base64"),encodedExpectations:Buffer.from(JSON.stringify(expected)).toString("base64")});const result=await fetch("http://127.0.0.1:6767/api/newznab/fake_nzb_download?"+query);statuses.push(result.status);}console.log(JSON.stringify(statuses));});',
    ],
    {
      input: JSON.stringify({
        title: job.title,
        url: job.url,
        legacy,
        current: JSON.parse(job.mediaExpectations),
      }),
      encoding: "utf8",
      timeout: 25000,
    }
  ).trim();
  if (controls !== "[200,400]") fail("rollback protocol positive/unknown-version controls failed");
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
  // A prepared already-accepted queue row is opaque to the older reader. It
  // must survive maintenance and return without being interpreted/retransferred.
  docker([
    "exec",
    rollbackContainer,
    "node",
    "-e",
    'if(process.env.PINGUFUNK_ARR_QA_YOUTUBE!=="1"||!/^\\d+-\\d+$/.test(process.env.PINGUFUNK_MEDIA_QA_OWNER??""))throw Error("Owned fixture required");const {PrismaClient}=require(process.env.DATABASE_PROVIDER==="postgresql"?"./generated/postgresql":"./generated/sqlite"),{randomUUID,createHash}=require("node:crypto"),db=new PrismaClient({log:[]});(async()=>{const source=await db.download.findFirstOrThrow({where:{category:"sonarr",status:"completed"}}),id=randomUUID(),key=randomUUID()+":"+Date.now(),title="Synthetic.Rollback.Pending",data={id,title,url:source.url,category:"sonarr",status:"queued",progress:0,mediaExpectations:source.mediaExpectations};await db.$transaction(async tx=>{await tx.download.create({data});await tx.enqueueIntent.create({data:{id:createHash("sha256").update("ui-enqueue-v1\\0"+key).digest("hex"),payloadHash:createHash("sha256").update(JSON.stringify([1,data.url,data.title,data.category,data.mediaExpectations])).digest("hex"),downloadId:id,expiresAt:new Date(Date.now()+86400000)}});});await db.$disconnect()})().catch(()=>process.exitCode=1)',
  ]);
  const preserved = readJobs(rollbackContainer);
  if (
    preserved.length !== 6 ||
    preserved.filter((row) => row.status === "queued" && row.title === "Synthetic.Rollback.Pending")
      .length !== 1
  )
    fail("prepared queue baseline missing");
  const readReceipts = (container) =>
    JSON.parse(
      docker([
        "exec",
        container,
        "node",
        "-e",
        'const {PrismaClient}=require(process.env.DATABASE_PROVIDER==="postgresql"?"./generated/postgresql":"./generated/sqlite"),db=new PrismaClient({log:[]});(async()=>{console.log(JSON.stringify(await db.enqueueIntent.findMany({orderBy:{id:"asc"}})));await db.$disconnect()})().catch(()=>process.exitCode=1)',
      ])
    );
  const receipts = readReceipts(rollbackContainer);
  if (receipts.length !== 1) fail("prepared enqueue receipt missing");
  writeFileSync(join(root, "pingufunk", "youtube-rollback-maintenance"), "synthetic-read-only");
  docker(["restart", rollbackContainer]);
  ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      docker(["exec", rollbackContainer, "curl", "-fsS", "http://127.0.0.1:6767/api?mode=version"]);
      ready = true;
      break;
    } catch {
      await delay(500);
    }
  }
  if (!ready) fail("read-only rollback not ready");
  const maintenance = execFileSync(
    "docker",
    [
      "exec",
      "-i",
      rollbackContainer,
      "node",
      "-e",
      'let body="";process.stdin.on("data",part=>body+=part);process.stdin.on("end",async()=>{const result=await fetch("http://127.0.0.1:6767/api?mode=addfile&cat=sonarr",{method:"POST",headers:{"content-type":"application/x-nzb"},body});console.log(result.status);});',
    ],
    { input: nzb, encoding: "utf8", timeout: 25000 }
  ).trim();
  if (
    maintenance !== "503" ||
    JSON.stringify(readJobs(rollbackContainer)) !== JSON.stringify(preserved) ||
    JSON.stringify(readReceipts(rollbackContainer)) !== JSON.stringify(receipts)
  )
    fail("maintenance changed a preserved job or receipt");
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
  if (
    JSON.stringify(readJobs(controller)) !== JSON.stringify(preserved) ||
    JSON.stringify(readReceipts(controller)) !== JSON.stringify(receipts)
  )
    fail("current-image return changed existing jobs or receipts");
  if (
    readFileSync(join(root, "pingufunk", "youtube-transfers.jsonl"), "utf8")
      .trim()
      .split("\n").length !== 10
  )
    fail("rollback or return re-transferred a prepared accepted job");
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
