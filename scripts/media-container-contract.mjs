import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { parseStringPromise } from "xml2js";
import { randomUUID } from "node:crypto";

const container = process.argv[2];
const owner = process.env.PINGUFUNK_MEDIA_QA_OWNER;
function run(args, input) {
  const result = spawnSync("docker", args, {
    input,
    encoding: "utf8",
    timeout: args[0] === "stop" ? 20_000 : 10_000,
  });
  if (result.error || result.status !== 0) {
    const closedCode = result.stderr?.match(
      /Owned database read failed: (P1001|P1002|P2024|P2025)\b/
    )?.[1];
    const cause =
      result.error?.code === "ETIMEDOUT" ? "timeout" : closedCode || `exit ${result.status}`;
    // Command arguments, URLs and raw database exceptions can contain secrets.
    throw new Error(`Disposable media command failed (${args[0]}: ${cause})`);
  }
  return args[0] === "logs" ? result.stdout + result.stderr : result.stdout;
}
if (
  !container ||
  !owner ||
  !/^pingufunk-media-app-\d+-\d+$/.test(container) ||
  run([
    "inspect",
    "--format",
    '{{index .Config.Labels "pingufunk.media-qa.owner"}}',
    container,
  ]).trim() !== owner
)
  throw new Error("Exact harness-owned media application required");
function request(endpoint, body, enqueueKey, expectedStatus) {
  const args = [
    "exec",
    ...(body === undefined ? [] : ["-i"]),
    container,
    "curl",
    expectedStatus === undefined ? "-fsS" : "-sS",
    "--max-time",
    "5",
  ];
  if (body !== undefined) args.push("-X", "POST", "--data-binary", "@-");
  if (enqueueKey !== undefined) args.push("-H", `X-Pingufunk-Enqueue-Key: ${enqueueKey}`);
  if (expectedStatus !== undefined) args.push("-w", "\n%{http_code}");
  const result = run([...args, `http://localhost:6767/${endpoint}`], body);
  if (expectedStatus === undefined) return JSON.parse(result);
  const split = result.lastIndexOf("\n");
  if (Number(result.slice(split + 1)) !== expectedStatus)
    throw new Error("Owned media response status mismatch");
  return JSON.parse(result.slice(0, split));
}
function rawRequest(url) {
  return run(["exec", container, "curl", "-fsS", "--max-time", "5", url]);
}
function nzb(filename, duration, resolution = null) {
  const expected =
    duration === undefined
      ? null
      : {
          version: 1,
          duration:
            duration === null ? null : { seconds: duration, provenance: "source_catalogue" },
          audio: null,
          resolution:
            resolution === null ? null : { ...resolution, provenance: "provider_dimensions" },
        };
  return expectedNzb(filename, expected);
}
function expectedNzb(filename, expected) {
  const title = `Synthetic.${filename.replaceAll(".", "-")}`;
  const url = `http://127.0.0.1:6767/pingufunk-media-qa/${filename}`;
  return {
    expected,
    body: `<?xml version="1.0"?><nzb><!-- ${Buffer.from(title).toString("base64")} --><!-- ${Buffer.from(url).toString("base64")} --><head>${expected === null ? "" : `<meta type="pingufunk-media-expectations">${Buffer.from(JSON.stringify(expected)).toString("base64")}</meta>`}</head></nzb>`,
  };
}
function readJob(id) {
  // Inspect persisted facts inside this owned image; never emit a URL or raw diagnostics.
  const code = `const pg=process.env.DATABASE_PROVIDER==='postgresql'; const {PrismaClient}=require(pg?'@prisma/client':'./generated/sqlite'); const db=new PrismaClient({log:[]}); (async()=>{try{const row=await db.download.findUniqueOrThrow({where:{id:process.argv[1]}});console.log(JSON.stringify({status:row.status,expectations:row.mediaExpectations,validation:row.mediaValidation,category:row.category,filePath:row.filePath}));}finally{await db.$disconnect();}})().catch(error=>{if(['P1001','P1002','P2024','P2025'].includes(error?.code))console.error('Owned database read failed: '+error.code);process.exitCode=1});`;
  return JSON.parse(run(["exec", container, "node", "-e", code, id]));
}
const terminalSnapshots = new Map();
function assertCompletedDiagnosis(id, job) {
  const diagnosis = request(`api/downloads/${id}/diagnostics`);
  if (
    diagnosis.job !== "completed" ||
    diagnosis.file !== "verified_present" ||
    diagnosis.import.state !== "unknown" ||
    diagnosis.import.reason !== "integration_disabled" ||
    JSON.stringify(diagnosis).includes(job.filePath)
  )
    throw new Error("Closed job diagnosis lost physical evidence or invented an Arr import");
}
request(
  "api/settings",
  JSON.stringify({
    "matching.minDuration": "0",
    "download.quality": "all",
    "download.convertToMkv": "false",
  })
);
let previousGuid;
let keyedReceipt;
for (const endpoint of ["api/newznab", "api/newznab/api"]) {
  const rss = rawRequest(`http://localhost:6767/${endpoint}?t=search&q=Synthetic&limit=1`);
  // Parse the actual producer with the same XML library used by this product;
  // this is not a hand-authored NZB or a string-only RSS success assertion.
  // Next bundles this dependency; it is not a standalone Node module in the
  // runner image. Parse in the harness's npm-ci environment instead.
  const parsed = await parseStringPromise(rss);
  const channel = parsed.rss.channel[0];
  if (channel.item?.length !== 1 || channel["newznab:response"][0].$.total !== "1")
    throw new Error("Source RSS count mismatch");
  const item = channel.item[0];
  const guid = item.guid[0]._;
  if (previousGuid !== undefined && guid !== previousGuid)
    throw new Error("Newznab aliases changed source GUID");
  previousGuid = guid;
  const nzbUrl = new URL(item.enclosure[0].$.url);
  if (
    !["localhost", "127.0.0.1"].includes(nzbUrl.hostname) ||
    nzbUrl.port !== "6767" ||
    nzbUrl.pathname !== "/api/newznab/fake_nzb_download"
  )
    throw new Error("Unexpected source enclosure");
  const body = rawRequest(nzbUrl.href);
  const key = endpoint === "api/newznab" ? `${randomUUID()}:${Date.now()}` : undefined;
  const added = request("api/download?mode=addfile&cat=sonarr", body, key);
  if (added.status !== true || added.nzo_ids.length !== 1)
    throw new Error("RSS NZB enqueue failed");
  const id = added.nzo_ids[0];
  if (key) {
    keyedReceipt = { key, body, id };
    if (request("api?mode=addfile&cat=sonarr", body, key).nzo_ids[0] !== id)
      throw new Error("Lost-response acknowledgement created another transfer");
  }
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && !["completed", "failed"].includes(readJob(id).status))
    await delay(200);
  const row = readJob(id);
  const expected = JSON.parse(row.expectations ?? "null");
  const facts = JSON.parse(row.validation ?? "null");
  const history = request("api?mode=history").history.slots.find((slot) => slot.nzo_id === id);
  if (
    row.status !== "completed" ||
    expected?.version !== 3 ||
    expected.mediaKind !== "unknown" ||
    expected.durations.source?.seconds !== 2 ||
    expected.durations.source.provenance !== "source_catalogue" ||
    expected.durations.source.tolerancePercent !== 10 ||
    expected.durations.metadata !== null ||
    expected.audio !== null ||
    facts?.version !== 3 ||
    facts?.expectedChecks.duration !== "passed" ||
    history?.status !== "Completed" ||
    history.storage !== row.filePath.slice(0, row.filePath.lastIndexOf("/"))
  )
    throw new Error("RSS to verified-media consumer mismatch");
  terminalSnapshots.set(id, row);
}
console.log("Both actual Newznab paths to NZB, queue, verified file and SAB history passed");

// Saved v3 references, not the currently configured legacy series tolerance,
// own completion. Keep the v1/legacy matrix below unchanged.
request("api/settings", JSON.stringify({ "matching.sonarr.tolerancePercent": "0" }));
for (const [mediaKind, sourceSeconds, metadataSeconds, status, filename] of [
  ["movie", 2, null, "completed", "valid.mp4"],
  ["series", 2, 2, "completed", "valid.mp4"],
  ["unknown", 2, null, "completed", "valid.mp4"],
  ["unknown", 2, null, "completed", "stream.m3u8"],
  ["series", 2, 120, "failed", "valid.mp4"],
  ["series", 120, 2, "failed", "valid.mp4"],
  ["series", null, 120, "failed", "valid.mp4"],
  ["series", 120, null, "failed", "valid.mp4"],
  ["movie", 120, null, "failed", "valid.mp4"],
]) {
  const expected = {
    version: 3,
    mediaKind,
    durations: {
      source:
        sourceSeconds === null
          ? null
          : { seconds: sourceSeconds, provenance: "source_catalogue", tolerancePercent: 10 },
      metadata:
        metadataSeconds === null
          ? null
          : { seconds: metadataSeconds, provenance: "episode_metadata", tolerancePercent: 15 },
    },
    audio: null,
    sourceAudio: null,
    resolution: null,
  };
  if (
    sourceSeconds !== null &&
    metadataSeconds !== null &&
    Math.abs(sourceSeconds - metadataSeconds) > Math.max(5, metadataSeconds * 0.15)
  ) {
    const beforeQueue = request("api?mode=queue").queue;
    const beforeHistory = request("api?mode=history").history;
    for (const endpoint of ["api", "api/download"]) {
      const rejected = request(
        `${endpoint}?mode=addfile&cat=sonarr`,
        expectedNzb(filename, expected).body,
        undefined,
        409
      );
      if (!rejected.error?.includes("Source duration conflicts"))
        throw new Error("Runtime conflict lost its structured rejection");
    }
    if (
      JSON.stringify(request("api?mode=queue").queue) !== JSON.stringify(beforeQueue) ||
      JSON.stringify(request("api?mode=history").history) !== JSON.stringify(beforeHistory)
    )
      throw new Error("Blocked known runtime conflict wrote queue/history");
    continue;
  }
  const added = request("api?mode=addfile&cat=sonarr", expectedNzb(filename, expected).body);
  if (added.status !== true || added.nzo_ids.length !== 1)
    throw new Error("Frozen fixture enqueue failed");
  const id = added.nzo_ids[0];
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && !["completed", "failed"].includes(readJob(id).status))
    await delay(200);
  const job = readJob(id);
  if (job.status !== status || job.expectations !== JSON.stringify(expected))
    throw new Error("Frozen media contract mismatch");
  const facts = JSON.parse(job.validation ?? "null");
  if (status === "completed") {
    assertCompletedDiagnosis(id, job);
    const references = Object.values(expected.durations).filter(Boolean);
    if (
      facts?.version !== 3 ||
      JSON.stringify(facts.durationChecks) !==
        JSON.stringify(references.map((reference) => ({ ...reference, result: "passed" })))
    )
      throw new Error("Frozen duration references were not independently confirmed");
    const physical = run([
      "exec",
      container,
      "node",
      "-e",
      'const fs=require("node:fs");const s=fs.lstatSync(process.argv[1]);console.log(s.isFile()&&!s.isSymbolicLink()&&s.size>0)',
      job.filePath,
    ]).trim();
    if (physical !== "true") throw new Error("Frozen completion has no physical file");
  } else if (facts !== null) throw new Error("Rejected frozen reference exposed completion facts");
  terminalSnapshots.set(id, job);
}
request("api/settings", JSON.stringify({ "matching.sonarr.tolerancePercent": "10" }));
console.log("Frozen v3 film/series/unknown references, HLS and independent negative gates passed");

for (const [filename, duration, status, convert, resolution] of [
  ["valid.mp4", undefined, "completed", false],
  ["valid.mp4", null, "completed", false],
  ["valid.mp4", 2, "completed", false],
  ["valid.mp4", 120, "failed", false],
  ["no-audio.mp4", null, "failed", false],
  ["invalid.mp4", null, "failed", false],
  ["truncated.mp4", null, "failed", false],
  ["stream.m3u8", 2, "completed", false],
  ["stream.m3u8", 2, "completed", true],
  ["valid.mp4", 2, "completed", true],
  ["720p.mp4", 2, "completed", false, { width: 1280, height: 720 }],
  ["720p.mp4", 2, "failed", false, { width: 1920, height: 1080 }],
  ["720p.mp4", 2, "failed", false, { width: 1920, height: 720 }],
]) {
  request("api/settings", JSON.stringify({ key: "download.convertToMkv", value: String(convert) }));
  const fixture = nzb(filename, duration, resolution);
  const added = request("api?mode=addfile&cat=sonarr", fixture.body);
  if (added.status !== true || added.nzo_ids.length !== 1)
    throw new Error("Synthetic enqueue failed");
  const id = added.nzo_ids[0];
  const deadline = Date.now() + 60_000;
  let job;
  do {
    job = readJob(id);
    if (["completed", "failed"].includes(job.status)) break;
    await delay(250);
  } while (Date.now() < deadline);
  if (
    job.status !== status ||
    job.expectations !== (fixture.expected === null ? null : JSON.stringify(fixture.expected)) ||
    job.category !== "sonarr"
  )
    throw new Error("Synthetic media status/persistence mismatch");
  const history = request("api?mode=history").history.slots.find((slot) => slot.nzo_id === id);
  const aliasHistory = request("api/download?mode=history").history.slots.find(
    (slot) => slot.nzo_id === id
  );
  if (JSON.stringify(aliasHistory) !== JSON.stringify(history))
    throw new Error("SAB aliases disagree on persisted history");
  if (!history || history.status !== (status === "completed" ? "Completed" : "Failed"))
    throw new Error("SAB consumer status mismatch");
  if (status === "completed") {
    const facts = JSON.parse(job.validation);
    assertCompletedDiagnosis(id, job);
    if (
      facts.version !== 1 ||
      !Number.isFinite(facts.durationSeconds) ||
      facts.durationSeconds <= 0 ||
      facts.video.length === 0 ||
      facts.audioLanguages.length !== 0 ||
      facts.expectedChecks.duration !== (duration == null ? "unknown" : "passed") ||
      facts.expectedChecks.audio !== "unknown" ||
      facts.expectedChecks.resolution !== (resolution ? "passed" : "unknown") ||
      (resolution &&
        !facts.video.some(
          (video) => video.width === resolution.width && video.height === resolution.height
        )) ||
      !job.filePath ||
      history.storage !== job.filePath.slice(0, job.filePath.lastIndexOf("/"))
    )
      throw new Error("Synthetic completed facts/import path mismatch");
  } else if (
    job.validation !== null ||
    history.fail_message === "" ||
    (resolution && job.filePath !== null)
  ) {
    throw new Error("Failed media exposed validation success");
  }
  terminalSnapshots.set(id, job);
}
run(["restart", container]);
let restartReady = false;
const restartDeadline = Date.now() + 30_000;
do {
  try {
    request("api/download?mode=version");
    restartReady = true;
  } catch {
    await delay(200);
  }
} while (!restartReady && Date.now() < restartDeadline);
if (!restartReady) throw new Error("Disposable media runtime failed to restart");
for (const [id, before] of terminalSnapshots) {
  if (JSON.stringify(readJob(id)) !== JSON.stringify(before))
    throw new Error("Restart changed persisted terminal media facts");
}
if (!keyedReceipt) throw new Error("Keyed enqueue fixture missing");
const totalJobs = () =>
  request("api?mode=history").history.noofslots_total +
  request("api?mode=queue").queue.noofslots_total;
const beforeRepeat = totalJobs();
for (const endpoint of ["api", "api/download"]) {
  if (
    request(`${endpoint}?mode=addfile&cat=sonarr`, keyedReceipt.body, keyedReceipt.key)
      .nzo_ids[0] !== keyedReceipt.id
  )
    throw new Error("Container restart lost durable enqueue receipt");
}
if (
  totalJobs() !== beforeRepeat ||
  JSON.stringify(readJob(keyedReceipt.id)) !==
    JSON.stringify(terminalSnapshots.get(keyedReceipt.id))
)
  throw new Error("Acknowledgement changed completed job/history");
console.log(
  "Durable keyed acknowledgement survived real container restart without another transfer"
);
console.log(
  "Real progressive/mux/HLS probe, negative media, queue continuation and SAB history passed"
);

// Real consumer mutations use only this harness's rows and private job files.
const completedIds = [...terminalSnapshots]
  .filter(([, row]) => row.status === "completed")
  .map(([id]) => id);
function fileExists(file) {
  return (
    run([
      "exec",
      container,
      "node",
      "-e",
      'console.log(require("node:fs").existsSync(process.argv[1]))',
      file,
    ]).trim() === "true"
  );
}
const neighborPath = terminalSnapshots.get(completedIds[2]).filePath;
for (const [index, endpoint] of ["api", "api/download"].entries()) {
  const id = completedIds[index];
  const ownPath = terminalSnapshots.get(id).filePath;
  if (!fileExists(ownPath) || !fileExists(neighborPath))
    throw new Error("Missing owned completion fixture");
  const removed = request(`${endpoint}?mode=history&name=delete&value=${id}&del_files=1`);
  if (
    removed.status !== true ||
    fileExists(ownPath) ||
    !fileExists(neighborPath) ||
    request(`${endpoint}?mode=history`).history.slots.some((row) => row.nzo_id === id)
  )
    throw new Error("History removal failed to isolate its completed file");
}
const failedEntry = [...terminalSnapshots].find(([, row]) => row.status === "failed");
const retried = request(`api/download?mode=history&name=retry&value=${failedEntry[0]}`);
if (retried.status !== true || !retried.nzo_id || retried.nzo_id === failedEntry[0])
  throw new Error("Retry failed to create an independent job");
const retryDeadline = Date.now() + 30_000;
while (
  Date.now() < retryDeadline &&
  !["completed", "failed"].includes(readJob(retried.nzo_id).status)
)
  await delay(200);
const retryRow = readJob(retried.nzo_id);
if (
  retryRow.status !== "failed" ||
  retryRow.validation !== null ||
  retryRow.expectations !== failedEntry[1].expectations ||
  request("api?mode=history").history.slots.some((row) => row.nzo_id === failedEntry[0])
)
  throw new Error("Retry lost expectations or bypassed the failed-media gate");
console.log("Both SAB aliases, real isolated completed-file removal and re-probed retry passed");

// Stop the actual writing Next process during an actual FFmpeg stream-copy mux,
// not merely a mocked kill call. The fixture wrapper slows only this next mux.
request("api/settings", JSON.stringify({ "download.convertToMkv": "true" }));
run([
  "exec",
  container,
  "node",
  "-e",
  'const fs=require("node:fs");fs.writeFileSync("/tmp/slow-next-mux","synthetic",{flag:"wx"});fs.chownSync("/tmp/slow-next-mux",Number(process.env.PUID),Number(process.env.PGID));',
]);
const shutdownId = request("api?mode=addfile&cat=sonarr", nzb("slow-mux.mp4", 10).body).nzo_ids[0];
const muxDeadline = Date.now() + 30_000;
let actualMux = false;
do {
  actualMux =
    run([
      "exec",
      container,
      "node",
      "-e",
      'const fs=require("node:fs");console.log(fs.existsSync("/tmp/media-mux-ready")&&fs.readdirSync("/proc").filter(x=>/^\\d+$/.test(x)).some(pid=>{try{const a=fs.readFileSync("/proc/"+pid+"/cmdline","utf8").split("\\0");return a[0]==="/usr/bin/ffmpeg"&&a.includes("-re");}catch{return false}}));',
    ]).trim() === "true";
  if (!actualMux) await delay(100);
} while (!actualMux && Date.now() < muxDeadline);
if (!actualMux || readJob(shutdownId).status !== "converting")
  throw new Error("Actual owned mux was not running before shutdown");
const neighborBefore = run([
  "exec",
  container,
  "node",
  "-e",
  'console.log(require("node:crypto").createHash("sha256").update(require("node:fs").readFileSync(process.argv[1])).digest("hex"))',
  neighborPath,
]);
request("api/settings", JSON.stringify({ "download.convertToMkv": "false" }));
const followingId = request("api?mode=addfile&cat=sonarr", nzb("valid.mp4", 2).body).nzo_ids[0];
run(["stop", "--time", "15", container]);
if (run(["inspect", "--format", "{{.State.ExitCode}}", container]).trim() !== "143")
  throw new Error("Writer did not drain through its controlled SIGTERM handler");
run(["start", container]);
let afterStopReady = false;
const afterStopDeadline = Date.now() + 30_000;
do {
  try {
    request("api?mode=version");
    afterStopReady = true;
  } catch {
    await delay(200);
  }
} while (!afterStopReady && Date.now() < afterStopDeadline);
if (!afterStopReady) throw new Error("Writer did not restart after mux shutdown");
const shutRow = readJob(shutdownId);
if (shutRow.status !== "failed" || shutRow.validation !== null)
  throw new Error(
    `Mux shutdown left status=${shutRow.status}; validation=${shutRow.validation === null ? "absent" : "present"}`
  );
while (readJob(followingId).status === "queued" && Date.now() < afterStopDeadline) await delay(100);
while (
  !["completed", "failed"].includes(readJob(followingId).status) &&
  Date.now() < afterStopDeadline
)
  await delay(100);
if (readJob(followingId).status !== "completed" || !fileExists(readJob(followingId).filePath))
  throw new Error("Following queue job lost progress after mux shutdown");
if (
  run([
    "exec",
    container,
    "node",
    "-e",
    'console.log(require("node:crypto").createHash("sha256").update(require("node:fs").readFileSync(process.argv[1])).digest("hex"))',
    neighborPath,
  ]) !== neighborBefore
)
  throw new Error("Mux shutdown changed a neighboring file");
console.log("Actual mux SIGTERM drain, failed persistence and following queue progress passed");

const pgContainer = process.env.PINGUFUNK_MEDIA_QA_PG_CONTAINER;
if (pgContainer) {
  if (
    !/^pingufunk-media-pg-\d+-\d+$/.test(pgContainer) ||
    run([
      "inspect",
      "--format",
      '{{index .Config.Labels "pingufunk.media-qa.owner"}}',
      pgContainer,
    ]).trim() !== owner
  )
    throw new Error("Exact harness-owned PostgreSQL required");
  run([
    "exec",
    container,
    "node",
    "-e",
    'const fs=require("node:fs");fs.writeFileSync("/tmp/pause-next-probe","synthetic test control");fs.chownSync("/tmp/pause-next-probe",Number(process.env.PUID),Number(process.env.PGID));',
  ]);
  const fixture = nzb("valid.mp4", 2);
  const interruptedId = request("api?mode=addfile&cat=sonarr", fixture.body).nzo_ids[0];
  const deadline = Date.now() + 30_000;
  let ready = false;
  do {
    ready =
      run([
        "exec",
        container,
        "node",
        "-e",
        'console.log(require("node:fs").existsSync("/tmp/media-probe-ready"))',
      ]).trim() === "true";
    if (!ready) await delay(100);
  } while (!ready && Date.now() < deadline);
  if (!ready) throw new Error("Owned probe synchronization failed");
  const priorFailures = run(["logs", container]).split(
    "Failed to start download processing"
  ).length;
  run(["pause", pgContainer]);
  try {
    let pausedFailure = false;
    do {
      pausedFailure =
        run(["logs", container]).split("Failed to start download processing").length >
        priorFailures;
      if (!pausedFailure) await delay(200);
    } while (!pausedFailure && Date.now() < deadline);
    if (!pausedFailure) throw new Error("Worker did not pause at its failed DB write");
    const unavailable = run([
      "exec",
      container,
      "curl",
      "-sS",
      "--max-time",
      "5",
      "-o",
      "/dev/null",
      "-w",
      "%{http_code}",
      "http://localhost:6767/api/download?mode=queue",
    ]).trim();
    if (unavailable !== "500") throw new Error("DB outage still reported healthy queue API");
  } finally {
    run(["unpause", pgContainer]);
  }
  const interrupted = readJob(interruptedId);
  if (
    !["downloading", "converting", "failed"].includes(interrupted.status) ||
    interrupted.validation !== null
  )
    throw new Error(
      `DB outage left unexpected ${interrupted.status} with validation=${interrupted.validation !== null}`
    );
  const reconnectReceipt = request("api?mode=addfile&cat=sonarr", fixture.body);
  if (
    reconnectReceipt.status !== true ||
    reconnectReceipt.nzo_ids?.length !== 1 ||
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(reconnectReceipt.nzo_ids[0])
  )
    throw new Error("Owned reconnect enqueue did not acknowledge one UUID job");
  const nextId = reconnectReceipt.nzo_ids[0];
  if (nextId === interruptedId)
    throw new Error("Owned unkeyed reconnect enqueue reused the interrupted job");
  const reconnectDeadline = Date.now() + 30_000;
  while (Date.now() < reconnectDeadline && readJob(nextId).status !== "completed") await delay(200);
  if (readJob(interruptedId).status !== "failed" || readJob(nextId).status !== "completed")
    throw new Error("Worker reconnect did not reconcile and drain safely");
  console.log("Owned PostgreSQL worker outage, failed-write pause and next-wakeup recovery passed");
}
