#!/usr/bin/env bash
set -euo pipefail
# Keep mode is for desktop QA only; outputs identify exact owned resources to clean up.
provider="${1:-sqlite}"
[[ "$provider" == sqlite || "$provider" == postgresql ]]
owner="${RANDOM}-${RANDOM}"
app="pingufunk-media-app-${owner}"
pg="pingufunk-media-pg-${owner}"
net="pingufunk-review-net-${owner}"
mkdir -p "$(pwd)/downloads"
root="$(mktemp -d "$(pwd)/downloads/tv-review.XXXXXXXX")"
keep_ready=0
cleanup() {
  if [[ "$keep_ready" == 1 ]]; then return; fi
  for container in "$app" "$pg"; do
    if docker container inspect "$container" >/dev/null 2>&1; then
      [[ "$(docker inspect --format '{{index .Config.Labels "pingufunk.media-qa.owner"}}' "$container")" == "$owner" ]] || return 1
      docker stop "$container" >/dev/null
      # Remove only this owned fixture's anonymous volumes, never shared/named data.
      docker rm --volumes "$container" >/dev/null
    fi
  done
  if docker network inspect "$net" >/dev/null 2>&1; then docker network rm "$net" >/dev/null; fi
  if [[ "$root" == "$(pwd)/downloads/tv-review."* ]]; then rm -r -- "$root"; fi
}
trap cleanup EXIT
docker network create --internal "$net" >/dev/null
if [[ "$provider" == postgresql ]]; then
  docker run -d --name "$pg" --network "$net" --label "pingufunk.media-qa.owner=$owner" -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine >/dev/null
  ready=0
  for ((n=0;n<30;n++)); do if docker exec "$pg" pg_isready -q -h 127.0.0.1 -U postgres; then ready=1; break; fi; sleep 1; done
  [[ "$ready" == 1 ]]
  docker exec "$pg" psql -v ON_ERROR_STOP=1 -U postgres -c 'CREATE ROLE pingufunk_media_qa LOGIN' -c 'CREATE DATABASE pingufunk_media_qa OWNER pingufunk_media_qa' >/dev/null
  url="postgresql://pingufunk_media_qa@${pg}/pingufunk_media_qa"
else
  url=file:/qa/database.sqlite
fi
DATABASE_URL="$url" docker run --rm --network "$net" --user "$(id -u):$(id -g)" -e DATABASE_URL -e "DATABASE_PROVIDER=$provider" --mount "type=bind,src=$root,dst=/qa" --entrypoint node "${PINGUFUNK_SMOKE_MIGRATOR_IMAGE:?}" /app/scripts/database-migrate.mjs >/dev/null
DATABASE_URL="$url" docker run -d --name "$app" --network "$net" --label "pingufunk.media-qa.owner=$owner" -p 127.0.0.1::6767 \
  -e DATABASE_URL -e "DATABASE_PROVIDER=$provider" -e PINGUFUNK_WRITES_ENABLED=1 -e PINGUFUNK_SONARR_API_KEY=synthetic-only \
  -e "PINGUFUNK_MEDIA_QA_OWNER=$owner" -e "PUID=$(id -u)" -e "PGID=$(id -g)" \
  -e NODE_OPTIONS='--import /qa/review-provider.mjs' \
  --mount "type=bind,src=$root,dst=/qa" \
  --mount "type=bind,src=$(pwd)/scripts/media-container-provider.mjs,dst=/qa/media-provider.mjs,readonly" \
  --mount "type=bind,src=$(pwd)/scripts/tv-review-container-provider.mjs,dst=/qa/review-provider.mjs,readonly" \
  --entrypoint sh "${PINGUFUNK_SMOKE_RUNNER_IMAGE:?}" -ec '
    mkdir -p /app/public/pingufunk-media-qa
    ffmpeg -y -v error -f lavfi -i color=size=1280x720:rate=1 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 72 -c:v libx264 -preset ultrafast -c:a aac -metadata:s:a:0 language=deu -movflags +faststart /app/public/pingufunk-media-qa/review.mp4
    exec /entrypoint.sh node server.js
  ' >/dev/null
ready=0
for ((n=0;n<40;n++)); do if docker exec "$app" curl -fsS 'http://localhost:6767/api/download?mode=version' >/dev/null 2>&1; then ready=1; break; fi; sleep 1; done
[[ "$ready" == 1 ]]
docker exec -i "$app" curl -fsS -X POST -H 'Content-Type: application/json' --data-binary '{"integration.sonarr.enabled":"true","integration.sonarr.url":"http://sonarr:8989","matching.sonarr.tolerancePercent":"15","matching.minDuration":"0","download.convertToMkv":"false"}' http://localhost:6767/api/settings >/dev/null
if [[ "${2:-}" != keep ]]; then
  PINGUFUNK_MEDIA_QA_OWNER="$owner" node scripts/tv-review-container-contract.mjs "$app"
  exit 0
fi
docker network connect bridge "$app"
keep_ready=1
echo "{\"app\":\"$app\",\"pg\":\"$pg\",\"network\":\"$net\",\"root\":\"$root\",\"provider\":\"$provider\",\"address\":\"$(docker port "$app" 6767/tcp)\"}"
