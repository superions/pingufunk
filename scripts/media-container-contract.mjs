import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const container = process.argv[2];
const owner = process.env.PINGUFUNK_MEDIA_QA_OWNER;
function run(args, input) {
  const result = spawnSync("docker", args, { input, encoding: "utf8", timeout: 10_000 });
  if (result.error || result.status !== 0) throw new Error("Disposable media command failed");
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
function request(endpoint, body) {
  const args = [
    "exec",
    ...(body === undefined ? [] : ["-i"]),
    container,
    "curl",
    "-fsS",
    "--max-time",
    "5",
  ];
  if (body !== undefined) args.push("-X", "POST", "--data-binary", "@-");
  return JSON.parse(run([...args, `http://localhost:6767/${endpoint}`], body));
}
function nzb(filename, duration) {
  const expected =
    duration === undefined
      ? null
      : {
          version: 1,
          duration:
            duration === null ? null : { seconds: duration, provenance: "source_catalogue" },
          audio: null,
          resolution: null,
        };
  const title = `Synthetic.${filename.replaceAll(".", "-")}`;
  const url = `http://127.0.0.1:6767/pingufunk-media-qa/${filename}`;
  return {
    expected,
    body: `<?xml version="1.0"?><nzb><!-- ${Buffer.from(title).toString("base64")} --><!-- ${Buffer.from(url).toString("base64")} --><head>${expected === null ? "" : `<meta type="pingufunk-media-expectations">${Buffer.from(JSON.stringify(expected)).toString("base64")}</meta>`}</head></nzb>`,
  };
}
function readJob(id) {
  // Inspect persisted facts inside this owned image; never emit a URL or raw diagnostics.
  const code = `const pg=process.env.DATABASE_PROVIDER==='postgresql'; const {PrismaClient}=require(pg?'@prisma/client':'./generated/sqlite'); const db=new PrismaClient({log:[]}); (async()=>{try{const row=await db.download.findUniqueOrThrow({where:{id:process.argv[1]}});console.log(JSON.stringify({status:row.status,expectations:row.mediaExpectations,validation:row.mediaValidation,category:row.category,filePath:row.filePath}));}finally{await db.$disconnect();}})().catch(()=>{process.exitCode=1});`;
  return JSON.parse(run(["exec", container, "node", "-e", code, id]));
}
const terminalSnapshots = new Map();
for (const [filename, duration, status, convert] of [
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
]) {
  request("api/settings", JSON.stringify({ key: "download.convertToMkv", value: String(convert) }));
  const fixture = nzb(filename, duration);
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
  if (!history || history.status !== (status === "completed" ? "Completed" : "Failed"))
    throw new Error("SAB consumer status mismatch");
  if (status === "completed") {
    const facts = JSON.parse(job.validation);
    if (
      facts.version !== 1 ||
      !Number.isFinite(facts.durationSeconds) ||
      facts.durationSeconds <= 0 ||
      facts.video.length === 0 ||
      facts.audioLanguages.length !== 0 ||
      facts.expectedChecks.duration !== (duration == null ? "unknown" : "passed") ||
      facts.expectedChecks.audio !== "unknown" ||
      facts.expectedChecks.resolution !== "unknown" ||
      !job.filePath ||
      history.storage !== job.filePath.slice(0, job.filePath.lastIndexOf("/"))
    )
      throw new Error("Synthetic completed facts/import path mismatch");
  } else if (job.validation !== null || history.fail_message === "") {
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
console.log(
  "Real progressive/mux/HLS probe, negative media, queue continuation and SAB history passed"
);

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
  const nextId = request("api?mode=addfile&cat=sonarr", fixture.body).nzo_ids[0];
  const reconnectDeadline = Date.now() + 30_000;
  while (Date.now() < reconnectDeadline && readJob(nextId).status !== "completed") await delay(200);
  if (readJob(interruptedId).status !== "failed" || readJob(nextId).status !== "completed")
    throw new Error("Worker reconnect did not reconcile and drain safely");
  console.log("Owned PostgreSQL worker outage, failed-write pause and next-wakeup recovery passed");
}
