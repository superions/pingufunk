import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseStringPromise } from "xml2js";
import {
  up,
  load,
  api,
  docker,
  bootstrap,
  seriesFixture,
  fixtureIndexersReady,
} from "./arr-test-instances.mjs";

const transport = process.argv[2],
  backend = process.argv[3];
assert(["direct", "forwarded"].includes(transport));
assert(["sqlite", "postgresql"].includes(backend));
const candidateTag = process.env.PINGUFUNK_ARR_QA_RUNNER_IMAGE;
const receiverTag = "pingufunk-programme-receiver-qa";
assert(candidateTag);
const candidateImage = docker(["image", "inspect", candidateTag, "--format", "{{.Id}}"]);
const receiverImage = docker(["image", "inspect", receiverTag, "--format", "{{.Id}}"]);
process.env.PINGUFUNK_ARR_QA_TV_DELIVERY = "1";
process.env.PINGUFUNK_ARR_QA_PROGRAMME = "1";
process.env.PINGUFUNK_ARR_QA_DATABASE = backend;
process.env.PINGUFUNK_ARR_QA_RUNNER_IMAGE = receiverTag;
let root, manifest;
const fail = (message) => {
  throw Error("Owned programme: " + message);
};
function mode(value) {
  writeFileSync(
    join(root, "pingufunk", "programme-mode.json"),
    JSON.stringify({ binding: true, source: "valid", ...value })
  );
}
function request(path, body, extraHeaders = {}) {
  load(root);
  const code =
    'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",async()=>{try{const x=JSON.parse(s),r=await fetch("http://127.0.0.1:6767"+x.path,{method:x.body===undefined?"GET":"POST",headers:x.headers,body:x.body,signal:AbortSignal.timeout(5000)});console.log(JSON.stringify({status:r.status,text:await r.text()}))}catch{console.log(JSON.stringify({status:0,text:""}))}});';
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", manifest.apps.pingufunk.name, "node", "-e", code], {
      input: JSON.stringify({
        path,
        body,
        headers: { ...(body ? { "Content-Type": "application/x-nzb" } : {}), ...extraHeaders },
      }),
      encoding: "utf8",
      timeout: 7000,
      stdio: ["pipe", "pipe", "pipe"],
    })
  );
}
async function ready() {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const response = request("/api/health");
    if (response.status === 200) return;
    if (![0, 503].includes(response.status))
      fail("unexpected runtime readiness status " + response.status);
    await delay(250);
  }
  fail("runtime readiness deadline");
}
async function command(body) {
  const created = await api(root, manifest, "sonarr", "/api/v3/command", body);
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const row = await api(root, manifest, "sonarr", "/api/v3/command/" + created.id);
    if (row.status === "completed") return;
    if (["failed", "aborted"].includes(row.status)) fail("native command failed, no retry");
    await delay(250);
  }
  fail("native command deadline");
}
function jobs() {
  load(root);
  const code = String.raw`const fs=require('node:fs'),crypto=require('node:crypto'),{PrismaClient}=require(process.env.DATABASE_PROVIDER==='postgresql'?'@prisma/client':'./generated/sqlite');
if(process.env.PINGUFUNK_ARR_QA_PROGRAMME!=='1'||!/^\d+-\d+$/.test(process.env.PINGUFUNK_MEDIA_QA_OWNER??''))throw Error('Owned programme runtime required');
const db=new PrismaClient({log:[]}),json=x=>JSON.stringify(x,(_k,v)=>typeof v==='bigint'?String(v):v),hash=x=>crypto.createHash('sha256').update(json(x)).digest('hex');
(async()=>{try{const rows=await db.download.findMany({orderBy:{id:'asc'}}),config=await db.config.findMany({where:{NOT:{key:{startsWith:'internal.'}}},orderBy:{key:'asc'}}),receipts=await db.enqueueIntent.findMany({orderBy:{id:'asc'}});console.log(json({jobs:rows.map(row=>{let file=null;if(row.filePath&&fs.existsSync(row.filePath)){const s=fs.lstatSync(row.filePath);file={regular:s.isFile(),size:s.size,inode:s.ino,mtime:s.mtimeMs,hash:crypto.createHash('sha256').update(fs.readFileSync(row.filePath)).digest('hex')}}return {id:row.id,status:row.status,category:row.category,title:row.title,expected:row.mediaExpectations&&JSON.parse(row.mediaExpectations),rowHash:hash(row),file,inputHash:hash([row.id,row.createdAt,row.url,row.title,row.category,row.mediaExpectations])}}),settingsHash:hash(config),receiptsHash:hash(receipts),receipts:receipts.length}));}finally{await db.$disconnect()}})().catch(()=>process.exitCode=1);`;
  return JSON.parse(docker(["exec", manifest.apps.pingufunk.name, "node", "-e", code]));
}
async function replaceRuntime(image) {
  load(root);
  assert([candidateImage, receiverImage].includes(image));
  const name = manifest.apps.pingufunk.name;
  docker(["stop", name]);
  docker(["rm", name]);
  const databaseUrl =
    backend === "postgresql"
      ? `postgresql://pingufunk_media_qa@${manifest.database.name}/pingufunk_media_qa`
      : "file:/qa/database.sqlite";
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
    `pingufunk.arr-qa.owner=${manifest.owner}`,
    "-e",
    `DATABASE_URL=${databaseUrl}`,
    "-e",
    `DATABASE_PROVIDER=${backend}`,
    "-e",
    "PINGUFUNK_WRITES_ENABLED=1",
    "-e",
    "PINGUFUNK_PUBLIC_URL=http://pingufunk:6767",
    "-e",
    `PUID=${process.getuid()}`,
    "-e",
    `PGID=${process.getgid()}`,
    "-e",
    `PINGUFUNK_MEDIA_QA_OWNER=${manifest.owner}`,
    "-e",
    "PINGUFUNK_ARR_QA_PROGRAMME=1",
    "-e",
    "PINGUFUNK_ARR_QA_TV_DELIVERY=1",
    "-e",
    "PINGUFUNK_SONARR_API_KEY_FILE=/qa/sonarr-api-key",
    "-e",
    "NODE_OPTIONS=--import /qa/provider.mjs",
    "-e",
    "DOWNLOAD_FOLDER_PATH=/downloads",
    "--mount",
    `type=bind,src=${join(root, "pingufunk")},dst=/qa`,
    "--mount",
    `type=bind,src=${join(root, "shared-downloads")},dst=/downloads`,
    "--mount",
    `type=bind,src=${resolve("scripts/arr-test-provider.mjs")},dst=/qa/provider.mjs,readonly`,
    "--mount",
    `type=bind,src=${resolve("scripts/programme-arr-provider.mjs")},dst=/qa/programme-provider.mjs,readonly`,
    "--mount",
    `type=bind,src=${resolve("scripts/media-container-provider.mjs")},dst=/qa/media-provider.mjs,readonly`,
    image,
  ]);
  manifest.apps.pingufunk.image = image;
  writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest), { mode: 0o600 });
  await ready();
}
const history = async () =>
  (await api(root, manifest, "sonarr", "/api/v3/history?page=1&pageSize=100")).records;
async function releases() {
  const response = request("/api/newznab?t=tvsearch&tvdbid=2147483002&season=8&ep=1");
  assert.equal(response.status, 200);
  return (await parseStringPromise(response.text)).rss.channel[0].item ?? [];
}
function assertPreserved(before, after, legacyId) {
  assert.equal(after.settingsHash, before.settingsHash);
  assert.equal(after.receiptsHash, before.receiptsHash);
  assert.equal(after.receipts, 1);
  assert.deepEqual(
    after.jobs.find((row) => row.id === legacyId),
    before.jobs.find((row) => row.id === legacyId)
  );
}

try {
  root = await up((allocated, current) => {
    root = allocated;
    manifest = current;
  });
  manifest = load(root);
  await bootstrap(root, manifest);
  await seriesFixture(root, manifest);
  const controller = manifest.apps.pingufunk.name;
  for (const [filename, language] of [
    ["programme.mp4", "deu"],
    ["programme-french.mp4", "fra"],
  ])
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
      "color=c=black:s=1280x720:r=1",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-t",
      "120",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-c:a",
      "aac",
      "-metadata:s:a:0",
      "language=" + language,
      "-movflags",
      "+faststart",
      "/qa/" + filename,
    ]);
  await api(root, manifest, "pingufunk", "/api/settings", {
    "integration.sonarr.enabled": "true",
    "integration.sonarr.url": "http://sonarr:8989",
    "matching.minDuration": "0",
    "matching.sonarr.tolerancePercent": "10",
    "download.quality": "best",
    "download.convertToMkv": "false",
    "download.path": "/downloads",
  });
  const series = (await api(root, manifest, "sonarr", "/api/v3/series")).find(
    (row) => row.tvdbId === 2147483002
  );
  assert(series?.monitored);
  const initialEpisodes = await api(
    root,
    manifest,
    "sonarr",
    `/api/v3/episode?seriesId=${series.id}`
  );
  const target = initialEpisodes.find((row) => row.seasonNumber === 8 && row.episodeNumber === 1);
  assert(target && target.runtime === 2 && !target.hasFile);
  assert.equal(initialEpisodes.length, 2);
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
  assert(selected && indexers.length === 2);
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
  assert(client);
  delete client.id;
  client.name = "Owned programme SAB";
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
  const legacyKey = randomUUID() + ":" + Date.now();
  const expected = {
    version: 3,
    mediaKind: "unknown",
    durations: {
      source: { seconds: 120, provenance: "source_catalogue", tolerancePercent: 10 },
      metadata: null,
    },
    audio: { language: "de", provenance: "provider_audio" },
    sourceAudio: null,
    resolution: { width: 1280, height: 720, provenance: "provider_dimensions" },
  };
  const legacyNzb = `<?xml version="1.0"?><!----><!-- ${Buffer.from("Preserved.Legacy").toString("base64")} --><!-- ${Buffer.from("https://rodlzdf-a.akamaihd.net/synthetic/programme-legacy.mp4").toString("base64")} --><nzb><head><meta type="pingufunk-media-expectations">${Buffer.from(JSON.stringify(expected)).toString("base64")}</meta></head></nzb>`;
  const admitted = request("/api?mode=addfile&cat=Default", legacyNzb, {
    "X-Pingufunk-Enqueue-Key": legacyKey,
  });
  assert.equal(admitted.status, 200);
  const legacyId = JSON.parse(admitted.text).nzo_ids[0];
  let before;
  for (let attempt = 0; attempt < 80; attempt++) {
    before = jobs();
    if (before.jobs[0]?.status === "failed") fail("legacy preservation seed failed");
    if (before.jobs.length === 1 && before.jobs[0].status === "completed") break;
    await delay(250);
  }
  assert.equal(before.jobs.length, 1);
  assert.equal(before.jobs[0].id, legacyId);
  assert.equal(before.jobs[0].status, "completed");
  assert(before.jobs[0].file?.regular && before.jobs[0].file.size > 0);
  assert.equal(before.receipts, 1);
  const neutralResponse = request("/api/newznab?t=search&q=Source%20Solstice");
  assert.equal(neutralResponse.status, 200);
  const neutralItems = (await parseStringPromise(neutralResponse.text)).rss.channel[0].item ?? [];
  assert(neutralItems.length > 0);
  const neutralGuids = neutralItems.map((row) => row.guid[0]._);
  await command({ name: "EpisodeSearch", episodeIds: [target.id] });
  assert.equal((await history()).filter((row) => row.eventType === "grabbed").length, 0);
  assert.equal(jobs().jobs.length, 1);

  // A new producer must reject an unverified target before advertising a release.
  mode({ unverifiedTarget: true });
  await replaceRuntime(candidateImage);
  assert.deepEqual(await releases(), []);
  mode({});
  await replaceRuntime(candidateImage);
  for (const source of ["foreign", "changed", "short", "ad", "language"]) {
    mode({ source });
    for (let attempt = 0; attempt < (source === "language" ? 8 : 1); attempt++) {
      assert.deepEqual(await releases(), [], "negative source escaped: " + source);
      if (source === "language") await delay(250);
    }
  }
  const negativeRequests = readFileSync(join(root, "pingufunk", "programme-requests.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert(negativeRequests.some((row) => row.kind === "french" && row.ranged));
  assert.equal(jobs().jobs.length, 1);
  assertPreserved(before, jobs(), legacyId);

  mode({});
  docker(["kill", "--signal=SIGUSR2", controller]);
  let drained = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    const state = (await api(root, manifest, "pingufunk", "/api/system")).runtime.worker;
    if (
      state.state === "paused" &&
      state.drainRequested &&
      state.exclusiveOwnership === "idle" &&
      Object.values(state.sourceWorkers).every((value) => value === "idle")
    ) {
      drained = true;
      break;
    }
    await delay(250);
  }
  assert(drained);
  await command({ name: "EpisodeSearch", episodeIds: [target.id] });
  let grabs;
  const admissionDeadline = Date.now() + 90000;
  for (let attempt = 0; attempt < 30 && Date.now() < admissionDeadline; attempt++) {
    grabs = (await history()).filter((row) => row.eventType === "grabbed");
    if (grabs.length === 1) break;
    await command({ name: "RssSync" });
    await delay(250);
  }
  assert.equal(grabs.length, 1);
  assert.equal(grabs[0].episodeId, target.id);
  assert.match(
    grabs[0].sourceTitle,
    /^Synthetic\.Series\.S08E01\.Canonical\.Solstice\.GERMAN\.720p\./
  );
  assert.equal(grabs[0].data.seriesMatchType === "Id", false);
  const frozen = jobs();
  assert.equal(frozen.jobs.length, 2);
  const pending = frozen.jobs.find((row) => row.id !== legacyId);
  assert.equal(pending.status, "queued");
  assert.equal(pending.id.toLowerCase(), grabs[0].downloadId.toLowerCase());
  assert.equal(pending.expected.version, 6);
  assert.deepEqual(pending.expected.sourceProgramme.source, {
    channel: "ZDF",
    title: "Source Solstice",
    season: 2019,
    episode: 1,
  });
  assert.deepEqual(pending.expected.sourceProgramme.target, { season: 8, episode: 1 });
  const canonical = await releases();
  assert.equal(canonical.length, 1);
  assert(!neutralGuids.includes(canonical[0].guid[0]._));
  assertPreserved(before, frozen, legacyId);
  // The fallback receiver processes the already accepted v6 without consulting
  // a later catalogue binding. It must still revalidate the exact source itself.
  mode({ binding: false });
  await replaceRuntime(receiverImage);
  let completed;
  for (let attempt = 0; attempt < 100; attempt++) {
    completed = jobs();
    const row = completed.jobs.find((row) => row.id === pending.id);
    if (row?.status === "failed") fail("compatible receiver failed accepted v6");
    if (row?.status === "completed") break;
    await delay(250);
  }
  const finished = completed.jobs.find((row) => row.id === pending.id);
  assert.equal(finished.status, "completed");
  assert.equal(finished.inputHash, pending.inputHash);
  assert.deepEqual(finished.expected, pending.expected);
  assertPreserved(before, completed, legacyId);
  const diagnosis = await api(
    root,
    manifest,
    "pingufunk",
    `/api/downloads/${pending.id}/diagnostics`
  );
  assert.deepEqual(diagnosis.checks, { duration: "passed", audio: "passed", resolution: "passed" });
  assert.equal(diagnosis.reason, null);
  await command({ name: "CheckForFinishedDownload" });
  let episodes;
  for (let attempt = 0; attempt < 100; attempt++) {
    episodes = await api(root, manifest, "sonarr", `/api/v3/episode?seriesId=${series.id}`);
    if (episodes.find((row) => row.id === target.id)?.hasFile) break;
    await delay(250);
  }
  const imported = episodes.find((row) => row.id === target.id);
  assert(imported.hasFile && imported.episodeFileId > 0);
  assert(
    episodes
      .filter((row) => row.id !== target.id)
      .every((row) => !row.hasFile && row.episodeFileId === 0)
  );
  const file = await api(root, manifest, "sonarr", `/api/v3/episodefile/${imported.episodeFileId}`);
  assert.equal(file.seriesId, series.id);
  assert.equal(file.quality.quality.name, "WEBDL-720p");
  assert(file.path.startsWith("/config/synthetic-library/") && file.size > 0);
  assert.equal(
    Number(docker(["exec", manifest.apps.sonarr.name, "stat", "-c", "%s", file.path])),
    file.size
  );
  docker(["exec", manifest.apps.sonarr.name, "test", "!", "-L", file.path]);
  const importedHistory = await history();
  const imports = importedHistory.filter((row) => row.eventType === "downloadFolderImported");
  assert.equal(imports.length, 1);
  assert.equal(imports[0].downloadId, grabs[0].downloadId);
  assert.equal(imports[0].episodeId, target.id);
  docker([
    "cp",
    `${manifest.apps.sonarr.name}:${file.path}`,
    join(root, "pingufunk", "verified-programme.mp4"),
  ]);
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
      "/qa/verified-programme.mp4",
    ])
  );
  assert.equal(
    probe.streams.filter(
      (row) => row.codec_type === "video" && row.width === 1280 && row.height === 720
    ).length,
    1
  );
  assert.equal(
    probe.streams.filter(
      (row) => row.codec_type === "audio" && ["deu", "ger", "de"].includes(row.tags?.language)
    ).length,
    1
  );
  assert(Math.abs(Number(probe.format.duration) - 120) < 1);
  assert.equal(probe.streams.filter((row) => row.codec_type === "video").length, 1);
  assert.equal(probe.streams.filter((row) => row.codec_type === "audio").length, 1);
  mode({});
  await replaceRuntime(candidateImage);
  await command({ name: "RssSync" });
  await command({ name: "EpisodeSearch", episodeIds: [target.id] });
  const replay = request("/api?mode=addfile&cat=Default", legacyNzb, {
    "X-Pingufunk-Enqueue-Key": legacyKey,
  });
  assert.equal(replay.status, 200);
  assert.equal(JSON.parse(replay.text).nzo_ids[0], legacyId);
  assert.equal((await history()).filter((row) => row.eventType === "grabbed").length, 1);
  assert.equal(jobs().jobs.length, 2);
  assertPreserved(before, jobs(), legacyId);
  const requests = readFileSync(join(root, "pingufunk", "programme-requests.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(requests.filter((row) => !row.ranged && row.kind === "legacy").length, 1);
  assert.equal(requests.filter((row) => !row.ranged && row.kind === "solstice").length, 1);
  assert.equal(requests.filter((row) => !row.ranged && row.kind === "french").length, 0);
  console.log(
    `Owned programme ${backend} ${transport}: neutral -> canonical GUID, exactly one native S08E01 grab/file, paired history, v6 receiver rollback/return, preserved legacy job/file/receipt, no duplicate transfer`
  );
} catch (error) {
  console.error(
    error.message?.startsWith("Owned")
      ? error.message
      : `Owned programme gate failed (${error.name}); payloads suppressed`
  );
  const line = error.stack?.match(/programme-arr-smoke\.mjs:(\d+):\d+/)?.[1];
  if (line) console.error("Owned programme assertion at source line " + line);
  process.exitCode = 1;
} finally {
  if (manifest) {
    const names = [
      ...Object.values(manifest.apps).map((row) => row.name),
      ...(manifest.database ? [manifest.database.name] : []),
    ];
    let clean = true;
    for (const name of names) {
      try {
        const ids = docker(["ps", "-aq", "--filter", `name=^/${name}$`])
          .split(/\s+/)
          .filter(Boolean);
        if (!ids.length) continue;
        assert.equal(ids.length, 1);
        const container = JSON.parse(docker(["inspect", ids[0]]))[0];
        assert.equal(container.Config.Labels["pingufunk.arr-qa.owner"], manifest.owner);
        docker(["stop", name]);
        docker(["rm", "--volumes", name]);
      } catch {
        clean = false;
      }
    }
    try {
      const networks = docker(["network", "ls", "--format", "{{.Name}}"])
        .split("\n")
        .filter((name) => name === manifest.network);
      if (networks.length) {
        assert.equal(networks.length, 1);
        const network = JSON.parse(docker(["network", "inspect", networks[0]]))[0];
        assert(network.Internal && network.Labels["pingufunk.arr-qa.owner"] === manifest.owner);
        assert.equal(Object.keys(network.Containers).length, 0);
        docker(["network", "rm", manifest.network]);
      }
      if (clean) {
        assert(
          root.startsWith(resolve("downloads") + "/arr-qa.") &&
            !lstatSync(root).isSymbolicLink() &&
            realpathSync(root) === root
        );
        assert.equal(
          JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")).owner,
          manifest.owner
        );
        rmSync(root, { recursive: true });
      }
    } catch {
      clean = false;
    }
    if (!clean) {
      console.error("Owned programme cleanup incomplete; retained exact fixture for inspection");
      process.exitCode = 1;
    }
  }
}
