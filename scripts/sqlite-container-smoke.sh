#!/usr/bin/env bash
set -euo pipefail

# Owned disposable fixtures only; network isolation prevents live integrations.
MIGRATOR_IMAGE="${PINGUFUNK_SMOKE_MIGRATOR_IMAGE:-pingufunk-p11-migrator-qa}"
RUNNER_IMAGE="${PINGUFUNK_SMOKE_RUNNER_IMAGE:-pingufunk-p11-runtime-qa}"
ROLLBACK_RUNNER_IMAGE="${PINGUFUNK_SMOKE_ROLLBACK_IMAGE:-}"
if [[ -n "$ROLLBACK_RUNNER_IMAGE" ]]; then
  [[ "$ROLLBACK_RUNNER_IMAGE" =~ ^sha256:[0-9a-f]{64}$ ]] || {
    echo 'SQLite rollback requires an immutable local image ID' >&2; exit 1;
  }
  [[ "$(docker image inspect "$ROLLBACK_RUNNER_IMAGE" --format '{{.Id}}')" == "$ROLLBACK_RUNNER_IMAGE" ]]
  [[ "$(docker image inspect "$RUNNER_IMAGE" --format '{{.Id}}')" != "$ROLLBACK_RUNNER_IMAGE" ]]
fi
SMOKE_PARENT="$(pwd)/downloads"
mkdir -p "$SMOKE_PARENT"
SMOKE_ROOT="$(mktemp -d "${SMOKE_PARENT}/sqlite-smoke.XXXXXXXX")"
APP_CONTAINER="pingufunk-sqlite-smoke-${RANDOM}-${RANDOM}"
APP_STARTED=0
stop_app() {
  # --rm removal can outlive docker stop; explicit removal must finish before
  # reusing this harness-owned name. Bind-mounted fixture data stays intact.
  docker stop "$APP_CONTAINER" >/dev/null
  docker rm "$APP_CONTAINER" >/dev/null
  APP_STARTED=0
}
cleanup() {
  if [[ "$APP_STARTED" == 1 ]]; then stop_app; fi
  if [[ "$SMOKE_ROOT" == "${SMOKE_PARENT}/sqlite-smoke."* && -d "$SMOKE_ROOT" ]]; then
    rm -r -- "$SMOKE_ROOT"
  fi
}
trap cleanup EXIT

ready() {
  for ((attempt=0; attempt<30; attempt++)); do
    if docker exec "$APP_CONTAINER" curl -fsS 'http://localhost:6767/api/download?mode=version' >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo 'Disposable SQLite application did not become ready' >&2
  return 1
}

for variant in fresh bootstrap; do
  mkdir "$SMOKE_ROOT/$variant"
  mkdir -m 750 "$SMOKE_ROOT/$variant/media"
  mkdir -m 700 "$SMOKE_ROOT/$variant/media/incomplete"
  SMOKE_VARIANT_ROOT="$SMOKE_ROOT/$variant" node --input-type=module -e '
    import {writeFileSync} from "node:fs";import path from "node:path";
    writeFileSync(path.join(process.env.SMOKE_VARIANT_ROOT,"media/sentinel.mkv"),"synthetic media sentinel",{mode:0o640,flag:"wx"});
    writeFileSync(path.join(process.env.SMOKE_VARIANT_ROOT,"neighbor"),"synthetic neighbor sentinel",{mode:0o600,flag:"wx"});
  '
  volume_fingerprint() {
    SMOKE_VARIANT_ROOT="$SMOKE_ROOT/$variant" node --input-type=module -e '
      import {statSync,readFileSync} from "node:fs";import path from "node:path";import {createHash} from "node:crypto";
      console.log(JSON.stringify(["media","media/incomplete","media/sentinel.mkv","neighbor"].map(name=>{
        const file=path.join(process.env.SMOKE_VARIANT_ROOT,name),s=statSync(file);
        return {name,uid:s.uid,gid:s.gid,mode:s.mode,content:s.isFile()?createHash("sha256").update(readFileSync(file)).digest("hex"):null};
      })));
    '
  }
  VOLUME_BEFORE="$(volume_fingerprint)"
  if [[ "$variant" == fresh ]]; then
    for attempt in 1 2; do
      docker run --rm --network none --user "$(id -u):$(id -g)" \
        -e DATABASE_URL=file:/qa/database.sqlite \
        --mount "type=bind,src=${SMOKE_ROOT}/${variant},dst=/qa" \
        --entrypoint node "$MIGRATOR_IMAGE" /app/scripts/database-migrate.mjs >/dev/null
    done
  fi
  SMOKE_SOURCE="$SMOKE_ROOT/$variant/database.sqlite" SMOKE_VARIANT="$variant" node --input-type=module -e '
    import {DatabaseSync} from "node:sqlite"; import {readFileSync} from "node:fs";
    const db=new DatabaseSync(process.env.SMOKE_SOURCE);
    try {
      if(process.env.SMOKE_VARIANT==="bootstrap") db.exec(readFileSync("prisma/legacy/sqlite/init-db.sql","utf8"));
      db.prepare("INSERT INTO Config(key,value) VALUES (?,?)").run("smoke", "original");
      db.prepare("INSERT INTO Config(key,value) VALUES (?,?)").run("download.path", "/qa/media");
      db.prepare("INSERT INTO Download(id,title,url,category,status,size,filePath,createdAt) VALUES (?,?,?,?,?,?,?,?)")
        .run("original-id","Synthetic","https://example.invalid/video","sonarr","failed",BigInt("9007199254741115"),"/synthetic/original.mkv",Date.now());
    } finally {db.close();}
  '
  RUNTIME_FILE=database.sqlite
  if [[ "$variant" == bootstrap ]]; then
    chmod 700 "$SMOKE_ROOT/$variant"
    SNAPSHOT_REPORT=$(docker run --rm --network none --user "$(id -u):$(id -g)" \
      --mount "type=bind,src=${SMOKE_ROOT}/${variant},dst=/qa" \
      --entrypoint node "$MIGRATOR_IMAGE" /app/scripts/postgresql-snapshot.mjs /qa/database.sqlite /qa/backup)
    SNAPSHOT_HASH=$(REPORT="$SNAPSHOT_REPORT" node -e 'console.log(JSON.parse(process.env.REPORT).sha256)')
    docker run --rm --network none --user "$(id -u):$(id -g)" \
      --mount "type=bind,src=${SMOKE_ROOT}/${variant},dst=/qa" \
      --entrypoint node "$MIGRATOR_IMAGE" /app/scripts/sqlite-baseline.mjs \
      /qa/backup/source.sqlite "$SNAPSHOT_HASH" /qa/current.sqlite --confirm-writers-stopped >/dev/null
    RUNTIME_FILE=current.sqlite
    if [[ -n "$ROLLBACK_RUNNER_IMAGE" ]]; then
      ORIGINAL_HASH=$(SOURCE="$SMOKE_ROOT/$variant/database.sqlite" node -e 'console.log(require("node:crypto").createHash("sha256").update(require("node:fs").readFileSync(process.env.SOURCE)).digest("hex"))')
      docker run -d --name "$APP_CONTAINER" --network none \
        -e "PUID=$(id -u)" -e "PGID=$(id -g)" -e PINGUFUNK_WRITES_ENABLED=0 \
        -e DATABASE_URL=file:/qa/database.sqlite \
        --mount "type=bind,src=${SMOKE_ROOT}/${variant},dst=/qa" "$ROLLBACK_RUNNER_IMAGE" >/dev/null
      APP_STARTED=1
      ready
      docker exec "$APP_CONTAINER" curl -fsS 'http://localhost:6767/api/settings?key=smoke' \
        | node -e 'let s=""; process.stdin.on("data",c=>s+=c); process.stdin.on("end",()=>{if(JSON.parse(s).value!=="original")process.exit(1)})'
      stop_app
      SOURCE="$SMOKE_ROOT/$variant/database.sqlite" EXPECTED_HASH="$ORIGINAL_HASH" node -e 'if(require("node:crypto").createHash("sha256").update(require("node:fs").readFileSync(process.env.SOURCE)).digest("hex")!==process.env.EXPECTED_HASH)process.exit(1)'
      echo 'Previous-image rollback on the unchanged source passed before target application writes'
    fi
  fi
  for cycle in initial restart; do
    docker run -d --name "$APP_CONTAINER" --network none \
      -e "PUID=$(id -u)" -e "PGID=$(id -g)" \
      -e "DATABASE_URL=file:/qa/${RUNTIME_FILE}" \
      --mount "type=bind,src=${SMOKE_ROOT}/${variant},dst=/qa" "$RUNNER_IMAGE" >/dev/null
    APP_STARTED=1
    ready
    # Unknown historical settings remain readable but cannot be newly written.
    docker exec "$APP_CONTAINER" curl -fsS 'http://localhost:6767/api/settings?key=smoke' \
      | node -e 'let s=""; process.stdin.on("data",c=>s+=c); process.stdin.on("end",()=>{if(JSON.parse(s).value!=="original")process.exit(1)})'
    expected=1
    if [[ "$cycle" == restart ]]; then expected=2; fi
    docker exec "$APP_CONTAINER" curl -fsS 'http://localhost:6767/api/settings?key=matching.movie.yearTolerance' \
      | EXPECTED="$expected" node -e 'let s=""; process.stdin.on("data",c=>s+=c); process.stdin.on("end",()=>{if(JSON.parse(s).value!==process.env.EXPECTED)process.exit(1)})'
    docker exec "$APP_CONTAINER" curl -fsS -X POST -H 'Content-Type: application/json' \
      -d '{"key":"matching.movie.yearTolerance","value":"02"}' http://localhost:6767/api/settings \
      | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const r=JSON.parse(s);if(r.success!==true||r.updated!==1||r.settings["matching.movie.yearTolerance"]!=="2")process.exit(1)})'
    docker exec "$APP_CONTAINER" curl -fsS http://localhost:6767/api/system >/dev/null
    docker exec "$APP_CONTAINER" curl -fsS http://localhost:6767/api/health?mode=ready \
      | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const r=JSON.parse(s);if(!r.schema.ready||r.writesEnabled!==true||!["idle","held","waiting"].includes(r.worker.exclusiveOwnership))process.exit(1)})'
    stop_app
    [[ "$(volume_fingerprint)" == "$VOLUME_BEFORE" ]] || { echo 'SQLite volume sentinel metadata changed' >&2; exit 1; }
  done
  # Maintenance must not try to repair/write even a readonly download mount.
  docker run -d --name "$APP_CONTAINER" --network none \
    -e "PUID=$(id -u)" -e "PGID=$(id -g)" -e PINGUFUNK_WRITES_ENABLED=0 \
    -e "DATABASE_URL=file:/qa/${RUNTIME_FILE}" \
    --mount "type=bind,src=${SMOKE_ROOT}/${variant},dst=/qa" \
    --mount "type=bind,src=${SMOKE_ROOT}/${variant}/media,dst=/qa/media,readonly" "$RUNNER_IMAGE" >/dev/null
  APP_STARTED=1
  ready
  docker exec "$APP_CONTAINER" curl -fsS http://localhost:6767/api/health \
    | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const r=JSON.parse(s);if(!r.schema.ready||r.writesEnabled!==false||r.worker.state!=="disabled")process.exit(1)})'
  stop_app
  [[ "$(volume_fingerprint)" == "$VOLUME_BEFORE" ]]
  docker run -d --name "$APP_CONTAINER" --network none \
    -e "PUID=$(id -u)" -e "PGID=$(id -g)" -e PINGUFUNK_WRITES_ENABLED=1 \
    -e "DATABASE_URL=file:/qa/${RUNTIME_FILE}" \
    --mount "type=bind,src=${SMOKE_ROOT}/${variant},dst=/qa" \
    --mount "type=bind,src=${SMOKE_ROOT}/${variant}/media,dst=/qa/media,readonly" "$RUNNER_IMAGE" >/dev/null
  APP_STARTED=1
  for ((attempt=0;attempt<20;attempt++)); do
    [[ "$(docker inspect "$APP_CONTAINER" --format '{{.State.Status}}')" == exited ]] && break
    sleep 1
  done
  [[ "$(docker inspect "$APP_CONTAINER" --format '{{.State.Status}}')" == exited ]] || { echo 'Readonly writer volume unexpectedly started' >&2; exit 1; }
  [[ "$(docker inspect "$APP_CONTAINER" --format '{{.State.ExitCode}}')" != 0 ]]
  stop_app
  [[ "$(volume_fingerprint)" == "$VOLUME_BEFORE" ]]
  SMOKE_SOURCE="$SMOKE_ROOT/$variant/$RUNTIME_FILE" SMOKE_VARIANT="$variant" node --input-type=module -e '
    import {DatabaseSync} from "node:sqlite"; const db=new DatabaseSync(process.env.SMOKE_SOURCE,{readOnly:true});
    try {
      const query=db.prepare("SELECT id,size,filePath,status FROM Download");query.setReadBigInts(true);const rows=query.all();
      if(rows.length!==1||rows[0].id!=="original-id"||rows[0].size!==BigInt("9007199254741115")||rows[0].filePath!=="/synthetic/original.mkv"||rows[0].status!=="failed")throw Error("SQLite data changed");
      if(db.prepare("SELECT value FROM Config WHERE key=?").get("smoke").value!=="original"||db.prepare("SELECT value FROM Config WHERE key=?").get("matching.movie.yearTolerance").value!=="2")throw Error("SQLite settings preservation or persistence failed");
      if(db.prepare("SELECT count(*) AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL").get().n!==5)throw Error("Current ledger incomplete");
    }finally{db.close();}
  '
done

# Missing source and mismatched provider must stop, never initialize a fallback.
mkdir "$SMOKE_ROOT/missing"
for provider in sqlite postgresql; do
  if docker run --rm --network none -e DATABASE_PROVIDER="$provider" \
    -e DATABASE_URL=file:/qa/missing.sqlite \
    --mount "type=bind,src=${SMOKE_ROOT}/missing,dst=/qa" "$RUNNER_IMAGE" >/dev/null 2>&1; then
    echo 'Invalid startup unexpectedly succeeded' >&2; exit 1
  fi
  [[ ! -e "$SMOKE_ROOT/missing/missing.sqlite" ]]
done
if docker run --rm --network none \
  -e 'DATABASE_URL=postgresql://synthetic@127.0.0.1:5432/disposable?connect_timeout=1' \
  --mount "type=bind,src=${SMOKE_ROOT}/missing,dst=/app/prisma/data" "$RUNNER_IMAGE" >/dev/null 2>&1; then
  echo 'Unreachable PostgreSQL unexpectedly started' >&2; exit 1
fi
[[ ! -e "$SMOKE_ROOT/missing/rundfunkarr.db" ]]
echo 'Disposable SQLite fresh/bootstrap starts, persistence, restarts and fail-closed checks passed'
