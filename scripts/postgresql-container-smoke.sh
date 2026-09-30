#!/usr/bin/env bash
set -euo pipefail

# Disposable TLS/container rehearsal only. No production endpoint, credentials,
# media or existing database is used. Images must be built from this checkout.
MIGRATOR_IMAGE="${PINGUFUNK_SMOKE_MIGRATOR_IMAGE:-pingufunk-p11-migrator-qa}"
RUNNER_IMAGE="${PINGUFUNK_SMOKE_RUNNER_IMAGE:-pingufunk-p11-runtime-qa}"
SMOKE_ID="${RANDOM}-${RANDOM}"
PG_CONTAINER="pingufunk-smoke-pg-${SMOKE_ID}"
APP_CONTAINER="pingufunk-smoke-app-${SMOKE_ID}"
SMOKE_NETWORK="pingufunk-smoke-net-${SMOKE_ID}"
SMOKE_PARENT="$(pwd)/downloads"
mkdir -p "$SMOKE_PARENT"
SMOKE_ROOT="$(mktemp -d "${SMOKE_PARENT}/pg-smoke.XXXXXXXX")"
chmod 700 "$SMOKE_ROOT"
SMOKE_PG_STARTED=0
SMOKE_APP_STARTED=0
SMOKE_NETWORK_CREATED=0
cleanup() {
  if [[ "$SMOKE_APP_STARTED" == "1" ]]; then docker stop "$APP_CONTAINER" >/dev/null; fi
  if [[ "$SMOKE_PG_STARTED" == "1" ]]; then docker stop "$PG_CONTAINER" >/dev/null; fi
  if [[ "$SMOKE_NETWORK_CREATED" == "1" ]]; then docker network rm "$SMOKE_NETWORK" >/dev/null; fi
  if [[ "$SMOKE_ROOT" == "${SMOKE_PARENT}/pg-smoke."* && -d "$SMOKE_ROOT" ]]; then
    rm -r -- "$SMOKE_ROOT"
  fi
}
trap cleanup EXIT

mkdir "$SMOKE_ROOT/source" "$SMOKE_ROOT/backup"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -subj "/CN=${PG_CONTAINER}" \
  -keyout "$SMOKE_ROOT/server.key" -out "$SMOKE_ROOT/server.crt" >/dev/null 2>&1
chmod 600 "$SMOKE_ROOT/server.key"

SMOKE_SOURCE="$SMOKE_ROOT/source/source.sqlite" node --input-type=module -e '
  import { DatabaseSync } from "node:sqlite";
  import { readFileSync } from "node:fs";
  const db = new DatabaseSync(process.env.SMOKE_SOURCE);
  try {
    db.exec(readFileSync("prisma/legacy/sqlite/init-db.sql", "utf8"));
    db.exec("INSERT INTO Config(key,value) VALUES ('\''smoke'\'','\''source'\'')");
  } finally { db.close(); }
'

docker network create --internal "$SMOKE_NETWORK" >/dev/null
SMOKE_NETWORK_CREATED=1
docker run --rm -d --name "$PG_CONTAINER" --network "$SMOKE_NETWORK" \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine >/dev/null
SMOKE_PG_STARTED=1

wait_for_pg() {
  for ((attempt = 0; attempt < 30; attempt++)); do
    if docker exec "$PG_CONTAINER" pg_isready -q -h 127.0.0.1 -U postgres; then return 0; fi
    sleep 1
  done
  echo "Disposable PostgreSQL TCP listener unavailable" >&2
  return 1
}
wait_for_pg
docker cp "$SMOKE_ROOT/server.key" "$PG_CONTAINER:/var/lib/postgresql/server.key"
docker cp "$SMOKE_ROOT/server.crt" "$PG_CONTAINER:/var/lib/postgresql/server.crt"
docker exec "$PG_CONTAINER" chown postgres:postgres \
  /var/lib/postgresql/server.key /var/lib/postgresql/server.crt
docker exec "$PG_CONTAINER" chmod 600 /var/lib/postgresql/server.key
docker exec -u postgres "$PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "ALTER SYSTEM SET ssl = 'on'" \
  -c "ALTER SYSTEM SET ssl_cert_file = '/var/lib/postgresql/server.crt'" \
  -c "ALTER SYSTEM SET ssl_key_file = '/var/lib/postgresql/server.key'" >/dev/null
docker restart "$PG_CONTAINER" >/dev/null
wait_for_pg
if [[ "$(docker exec "$PG_CONTAINER" psql -h 127.0.0.1 -U postgres -d postgres -Atc \
  'SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()')" != "t" ]]; then
  echo "Disposable PostgreSQL TLS unavailable" >&2
  exit 1
fi

docker exec "$PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c 'CREATE ROLE pingufunk_smoke_import LOGIN' \
  -c 'CREATE ROLE pingufunk_smoke_runtime LOGIN' \
  -c 'CREATE DATABASE pingufunk_smoke' >/dev/null
DDL_URL="postgresql://postgres@${PG_CONTAINER}/pingufunk_smoke?sslmode=require"
DATABASE_URL="$DDL_URL" docker run --rm --network "$SMOKE_NETWORK" -e DATABASE_URL \
  "$MIGRATOR_IMAGE" >/dev/null
docker exec "$PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d pingufunk_smoke \
  -c 'GRANT CONNECT ON DATABASE pingufunk_smoke TO pingufunk_smoke_import, pingufunk_smoke_runtime' \
  -c 'GRANT USAGE ON SCHEMA public TO pingufunk_smoke_import, pingufunk_smoke_runtime' \
  -c 'GRANT SELECT ON TABLE "_prisma_migrations" TO pingufunk_smoke_import, pingufunk_smoke_runtime' \
  -c 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "TvdbSeries", "TvdbEpisode", "Download", "Config", "GeneratedRuleset", "TopicCategory" TO pingufunk_smoke_import, pingufunk_smoke_runtime' \
  -c 'GRANT SELECT ON TABLE "MigrationCheckpoint" TO pingufunk_smoke_import' \
  -c 'GRANT SELECT, INSERT ON TABLE "MigrationCheckpoint" TO pingufunk_smoke_runtime' \
  -c 'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO pingufunk_smoke_import, pingufunk_smoke_runtime' \
  >/dev/null

# Use the owning host UID/GID for the private bind mount on both Linux CI and macOS.
snapshot_report="$(docker run --rm --user "$(id -u):$(id -g)" --entrypoint node \
  --mount "type=bind,src=${SMOKE_ROOT}/source,dst=/source,readonly" \
  --mount "type=bind,src=${SMOKE_ROOT}/backup,dst=/backup" \
  "$MIGRATOR_IMAGE" /app/scripts/postgresql-snapshot.mjs \
  /source/source.sqlite /backup/run)"
snapshot_hash="$(printf '%s' "$snapshot_report" | node -e '
  let input=""; process.stdin.on("data", chunk => input += chunk);
  process.stdin.on("end", () => process.stdout.write(JSON.parse(input).sha256));
')"
IMPORT_URL="postgresql://pingufunk_smoke_import@${PG_CONTAINER}/pingufunk_smoke?sslmode=require"
for action in import verify sequences; do
  action_args=()
  if [[ "$action" != "verify" ]]; then action_args+=(--confirm-writers-stopped); fi
  if [[ "$action" == "sequences" ]]; then action_args+=(--confirm-no-app-writes-since-import); fi
  # The private 0700 snapshot belongs to the same host UID as the snapshot
  # step; the disposable runner must keep that UID when reading its bind mount.
  DATABASE_URL="$IMPORT_URL" docker run --rm --user "$(id -u):$(id -g)" \
    --entrypoint node --network "$SMOKE_NETWORK" -e DATABASE_URL \
    --mount "type=bind,src=${SMOKE_ROOT}/backup,dst=/backup" \
    "$MIGRATOR_IMAGE" /app/scripts/postgresql-migration-cli.mjs "$action" \
    --snapshot /backup/run/source.sqlite --sha256 "$snapshot_hash" \
    --database pingufunk_smoke --role pingufunk_smoke_import --host "$PG_CONTAINER" \
    "${action_args[@]}" >/dev/null
done

RUNTIME_URL="postgresql://pingufunk_smoke_runtime@${PG_CONTAINER}/pingufunk_smoke?sslmode=require"
SMOKE_SECRET="$SMOKE_ROOT/runtime-secret" SMOKE_URL="$RUNTIME_URL" node --input-type=module -e '
  import {writeFileSync} from "node:fs";
  writeFileSync(process.env.SMOKE_SECRET,process.env.SMOKE_URL,{mode:0o600,flag:"wx"});
'
docker run --rm -d --name "$APP_CONTAINER" \
  --network "$SMOKE_NETWORK" -e DATABASE_URL_FILE=/run/secrets/database_url \
  --mount "type=bind,src=${SMOKE_ROOT}/runtime-secret,dst=/run/secrets/database_url,readonly" \
  "$RUNNER_IMAGE" >/dev/null
SMOKE_APP_STARTED=1
ready=0
for ((attempt = 0; attempt < 30; attempt++)); do
  if docker exec "$APP_CONTAINER" wget -q --spider http://localhost:6767/api/download?mode=version; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" != "1" ]]; then
  echo "Disposable application maintenance start failed" >&2
  exit 1
fi
docker exec "$APP_CONTAINER" curl -fsS http://localhost:6767/api/settings?key=smoke \
  | node -e 'let s=""; process.stdin.on("data", c => s+=c); process.stdin.on("end",()=>{if(JSON.parse(s).value!=="source") process.exit(1)})'
if [[ "$(docker exec "$PG_CONTAINER" psql -U postgres -d pingufunk_smoke -Atc \
  'SELECT count(*) FROM "MigrationCheckpoint"')" != "0" ]]; then
  echo "Maintenance unexpectedly marked a PostgreSQL write" >&2
  exit 1
fi
docker stop "$APP_CONTAINER" >/dev/null
SMOKE_APP_STARTED=0

DATABASE_URL="$RUNTIME_URL" docker run --rm -d --name "$APP_CONTAINER" \
  --network "$SMOKE_NETWORK" -e DATABASE_URL -e PINGUFUNK_WRITES_ENABLED=1 \
  "$RUNNER_IMAGE" >/dev/null
SMOKE_APP_STARTED=1
ready=0
for ((attempt = 0; attempt < 30; attempt++)); do
  if docker exec "$APP_CONTAINER" wget -q --spider http://localhost:6767/api/download?mode=version; then
    ready=1
    break
  fi
  sleep 1
done
[[ "$ready" == 1 ]] || { echo "Disposable PG writer start failed" >&2; exit 1; }
docker exec "$APP_CONTAINER" test ! -e /app/prisma/data/rundfunkarr.db
docker exec "$APP_CONTAINER" curl -fsS -X POST -H 'Content-Type: application/json' \
  -d '{"key":"smoke","value":"postgresql"}' http://localhost:6767/api/settings >/dev/null
if [[ "$(docker exec "$PG_CONTAINER" psql -U postgres -d pingufunk_smoke -Atc \
  'SELECT count(*) FROM "MigrationCheckpoint" WHERE key = '\''first_application_write'\''' )" != "1" ]]; then
  echo "First application write checkpoint missing" >&2
  exit 1
fi

echo "Disposable TLS container migration, maintenance read and first-write checkpoint passed"
