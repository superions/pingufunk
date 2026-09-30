#!/usr/bin/env bash
set -euo pipefail

# Disposable, loopback-only PostgreSQL for fork CI and local development gates.
# Trust auth is safe only inside this short-lived local container; never reuse
# this setup for a shared host or production endpoint.
CI_PG_CONTAINER="pingufunk-ci-pg-${RANDOM}-${RANDOM}"
CI_PG_NETWORK="${CI_PG_CONTAINER}-net"
CI_PG_STARTED=0
CI_PG_NETWORK_CREATED=0
cleanup() {
  if [[ "$CI_PG_STARTED" == "1" ]]; then
    docker stop "$CI_PG_CONTAINER" >/dev/null
  fi
  if [[ "$CI_PG_NETWORK_CREATED" == "1" ]]; then
    docker network rm "$CI_PG_NETWORK" >/dev/null
  fi
}
trap cleanup EXIT

docker network create "$CI_PG_NETWORK" >/dev/null
CI_PG_NETWORK_CREATED=1
docker run --rm -d --name "$CI_PG_CONTAINER" --network "$CI_PG_NETWORK" \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  -p 127.0.0.1::5432 postgres:17-alpine >/dev/null
CI_PG_STARTED=1

ready=0
for ((attempt = 0; attempt < 30; attempt++)); do
  if docker exec "$CI_PG_CONTAINER" pg_isready -q -U postgres; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" != "1" ]]; then
  echo "Disposable PostgreSQL did not become ready" >&2
  exit 1
fi

address="$(docker port "$CI_PG_CONTAINER" 5432/tcp)"
port="${address##*:}"
if [[ ! "$port" =~ ^[0-9]+$ ]]; then
  echo "Disposable PostgreSQL loopback port unavailable" >&2
  exit 1
fi

docker exec "$CI_PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c 'CREATE ROLE pingufunk_qa_import LOGIN' >/dev/null
docker exec "$CI_PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c 'CREATE ROLE pingufunk_qa_runtime LOGIN' >/dev/null
docker exec "$CI_PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c 'CREATE ROLE pingufunk_qa_denied LOGIN' >/dev/null
for database in pingufunk_qa pingufunk_qa_fresh; do
  docker exec "$CI_PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "CREATE DATABASE ${database}" >/dev/null
  DATABASE_URL="postgresql://postgres@127.0.0.1:${port}/${database}" \
    npx prisma migrate deploy
done

docker exec "$CI_PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d pingufunk_qa_fresh \
  -c 'GRANT CONNECT ON DATABASE pingufunk_qa_fresh TO pingufunk_qa_import' \
  -c 'GRANT USAGE ON SCHEMA public TO pingufunk_qa_import' \
  -c 'GRANT ALL ON ALL TABLES IN SCHEMA public TO pingufunk_qa_import' \
  -c 'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO pingufunk_qa_import' \
  >/dev/null
docker exec "$CI_PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d pingufunk_qa \
  -c 'GRANT CONNECT ON DATABASE pingufunk_qa TO pingufunk_qa_runtime' \
  -c 'GRANT USAGE ON SCHEMA public TO pingufunk_qa_runtime' \
  -c 'GRANT SELECT ON TABLE "_prisma_migrations" TO pingufunk_qa_runtime' \
  -c 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "TvdbSeries", "TvdbEpisode", "Download", "Config", "GeneratedRuleset", "TopicCategory", "MigrationCheckpoint" TO pingufunk_qa_runtime' \
  -c 'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO pingufunk_qa_runtime' \
  >/dev/null
docker exec "$CI_PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d pingufunk_qa \
  -c 'GRANT CONNECT ON DATABASE pingufunk_qa TO pingufunk_qa_denied' \
  -c 'GRANT USAGE ON SCHEMA public TO pingufunk_qa_denied' \
  -c 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "Config" TO pingufunk_qa_denied' \
  -c 'GRANT SELECT ON TABLE "MigrationCheckpoint" TO pingufunk_qa_denied' \
  >/dev/null

PINGUFUNK_REQUIRE_PG_TESTS=1 \
  PINGUFUNK_TEST_DATABASE_URL="postgresql://pingufunk_qa_runtime@127.0.0.1:${port}/pingufunk_qa" \
  DATABASE_URL="postgresql://pingufunk_qa_runtime@127.0.0.1:${port}/pingufunk_qa" \
  npx vitest run src/lib/db-schema.test.ts scripts/postgresql-runtime.test.ts

PINGUFUNK_REQUIRE_PG_TESTS=1 \
  PINGUFUNK_TEST_DENIED_URL="postgresql://pingufunk_qa_denied@127.0.0.1:${port}/pingufunk_qa" \
  DATABASE_URL="postgresql://pingufunk_qa_denied@127.0.0.1:${port}/pingufunk_qa" \
  npx vitest run scripts/postgresql-write-boundary.test.ts

PINGUFUNK_REQUIRE_PG_IMPORT_TESTS=1 \
  PINGUFUNK_TEST_IMPORT_URL="postgresql://pingufunk_qa_import@127.0.0.1:${port}/pingufunk_qa_fresh" \
  DATABASE_URL="postgresql://pingufunk_qa_import@127.0.0.1:${port}/pingufunk_qa_fresh" \
  npx vitest run scripts/postgresql-import.test.ts
