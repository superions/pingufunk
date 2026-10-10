import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { parseStringPromise } from "xml2js";
const container = process.argv[2],
  owner = process.env.PINGUFUNK_MEDIA_QA_OWNER;
function run(args, input) {
  const p = spawnSync("docker", args, { input, encoding: "utf8", timeout: 20_000 });
  if (p.status !== 0) throw new Error("Owned review QA command failed");
  return p.stdout;
}
assert.match(container ?? "", /^pingufunk-media-app-\d+-\d+$/);
assert.equal(
  run([
    "inspect",
    "--format",
    '{{index .Config.Labels "pingufunk.media-qa.owner"}}',
    container,
  ]).trim(),
  owner
);
function request(endpoint, body) {
  const args = ["exec", "-i", container, "curl", "-sS", "--max-time", "20", "-w", "\n%{http_code}"];
  if (body)
    args.push(
      "-X",
      "POST",
      "-H",
      "Content-Type: application/json",
      "-H",
      "X-Pingufunk-Manual-Review: 1",
      "-H",
      "Origin: http://localhost:6767",
      "--data-binary",
      "@-"
    );
  const text = run(
    [...args, `http://localhost:6767/${endpoint.replace(/^\//, "")}`],
    body ? JSON.stringify(body) : undefined
  );
  const split = text.lastIndexOf("\n");
  return {
    status: Number(text.slice(split + 1)),
    text: text.slice(0, split),
    json() {
      return JSON.parse(this.text);
    },
  };
}
function evidence(id) {
  const code = `const fs=require('node:fs'),crypto=require('node:crypto'); const {PrismaClient}=require(process.env.DATABASE_PROVIDER==='postgresql'?'@prisma/client':'./generated/sqlite'); const db=new PrismaClient(); (async()=>{try{const jobs=await db.download.findMany();const row=jobs.find(x=>x.id===process.argv[1]);const receipts=await db.config.findMany({where:{key:{startsWith:'internal.manual-review.'}}});const settings=await db.config.findMany({where:{key:{not:{startsWith:'internal.manual-review.'}}},orderBy:{key:'asc'}});let file=null;if(row?.filePath){const stat=fs.lstatSync(row.filePath);file={regular:stat.isFile(),size:stat.size,hash:crypto.createHash('sha256').update(fs.readFileSync(row.filePath)).digest('hex')};}console.log(JSON.stringify({count:jobs.length,receipts:receipts.length,status:row?.status,dbSize:row?.size?.toString(),expected:row?.mediaExpectations&&JSON.parse(row.mediaExpectations),facts:row?.mediaValidation&&JSON.parse(row.mediaValidation),file,sourceHash:crypto.createHash('sha256').update(fs.readFileSync('/app/public/pingufunk-media-qa/review.mp4')).digest('hex'),settingsHash:crypto.createHash('sha256').update(JSON.stringify(settings)).digest('hex')}));}finally{await db.$disconnect()}})().catch(()=>process.exitCode=1);`;
  return JSON.parse(run(["exec", container, "node", "-e", code, id ?? "none"]));
}
const before = evidence();
assert.equal(before.count, 0);
const search = request("api/search?q=Synthetic%20Review%20Series");
assert.equal(search.status, 200);
const row = search.json().results[0];
assert.equal(row.tvReview.runtimeConflict, true);
assert.deepEqual(row.nzbDownloads, {});
const preview = request(
  `api/tv-source-review?selector=${encodeURIComponent(JSON.stringify(row.tvReview.selector))}`
);
assert.equal(preview.status, 200);
const value = preview.json();
assert.deepEqual(
  [
    value.sourceSeconds,
    value.metadataSeconds,
    value.tolerancePercent,
    value.width,
    value.height,
    value.language,
  ],
  [72, 60, 15, 1280, 720, "de"]
);
assert.equal(evidence().count, 0); // preview/cancel is read-only
const rss = request("api/newznab?t=tvsearch&tvdbid=2147000001&season=6&ep=1&limit=100");
assert.equal(rss.status, 200);
const parsed = await parseStringPromise(rss.text);
const release = parsed.rss.channel[0].item[0];
assert.match(release.title[0], /S06E01.*GERMAN.*720p/);
assert.equal(
  request(new URL(release.enclosure[0].$.url).pathname + new URL(release.enclosure[0].$.url).search)
    .status,
  409
);
assert.equal(evidence().count, 0);
const body = {
  selector: value.selector,
  fingerprint: value.fingerprint,
  intentId: randomUUID(),
  confirmRuntimeException: true,
};
const response = request("api/tv-source-review", body);
assert.equal(response.status, 200);
const id = response.json().id;
assert.equal(id, body.intentId);
const deadline = Date.now() + 45_000;
let after;
do {
  after = evidence(id);
  if (["completed", "failed"].includes(after.status)) break;
  await delay(250);
} while (Date.now() < deadline);
assert.equal(after.status, "completed");
assert.equal(after.count, 1);
assert.equal(after.receipts, 1);
assert.equal(after.settingsHash, before.settingsHash);
assert.equal(after.expected.version, 4);
assert.equal(after.expected.approval.jobId, id);
assert.deepEqual(
  [
    after.expected.durations.source.seconds,
    after.expected.durations.metadata.seconds,
    after.expected.durations.metadata.tolerancePercent,
  ],
  [72, 60, 15]
);
assert.equal(after.facts.metadataDurationCheck, "explicitly_exempted");
assert.equal(after.facts.expectedChecks.duration, "passed");
assert.equal(after.file.regular, true);
assert.ok(after.file.size > 0);
assert.equal(String(after.file.size), after.dbSize);
assert.equal(after.file.hash, after.sourceHash);
assert.deepEqual(after.facts.video, [{ width: 1280, height: 720 }]);
assert.deepEqual(after.facts.audioLanguages, ["de"]);
assert.ok(Math.abs(after.facts.durationSeconds - 72) < 1);
const repeated = request("api/tv-source-review", { ...body, intentId: randomUUID() });
assert.equal(repeated.status, 200);
assert.equal(repeated.json().id, id);
assert.equal(evidence(id).count, 1);
const hidden = `internal.manual-review.${value.fingerprint}`;
assert.equal(request(`api/settings?key=${hidden}`).status, 404);
assert.equal(request("api/settings", { key: hidden, value: "forged" }).status, 404);
assert.equal(request(`api?mode=history&name=retry&value=${id}`).status, 409);
assert.equal(evidence(id).count, 1);
console.log(
  "Synthetic source → native RSS/blocked NZB → explicit reviewed job → real worker/file/audit/receipt passed"
);
