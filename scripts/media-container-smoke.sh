#!/usr/bin/env bash
set -euo pipefail

# Synthetic media and owned disposable backends only, never broadcaster/Arr traffic.
RUNNER_IMAGE="${PINGUFUNK_SMOKE_RUNNER_IMAGE:-pingufunk-p09-runtime-qa}"
MIGRATOR_IMAGE="${PINGUFUNK_SMOKE_MIGRATOR_IMAGE:-pingufunk-p09-migrator-qa}"
MEDIA_QA_ID="${RANDOM}-${RANDOM}"
APP_CONTAINER="pingufunk-media-app-${MEDIA_QA_ID}"
PG_CONTAINER="pingufunk-media-pg-${MEDIA_QA_ID}"
QA_NETWORK="pingufunk-media-net-${MEDIA_QA_ID}"
QA_PARENT="$(pwd)/downloads"
mkdir -p "$QA_PARENT"
QA_ROOT="$(mktemp -d "${QA_PARENT}/media-smoke.XXXXXXXX")"
APP_STARTED=0
PG_STARTED=0
NETWORK_CREATED=0
cleanup() {
  if [[ "$APP_STARTED" == 1 ]]; then docker stop "$APP_CONTAINER" >/dev/null; docker rm "$APP_CONTAINER" >/dev/null; fi
  if [[ "$PG_STARTED" == 1 ]]; then
    if [[ "$(docker inspect --format '{{.State.Paused}}' "$PG_CONTAINER")" == true ]]; then docker unpause "$PG_CONTAINER" >/dev/null; fi
    docker stop "$PG_CONTAINER" >/dev/null
    docker rm "$PG_CONTAINER" >/dev/null
  fi
  if [[ "$NETWORK_CREATED" == 1 ]]; then docker network rm "$QA_NETWORK" >/dev/null; fi
  if [[ "$QA_ROOT" == "${QA_PARENT}/media-smoke."* && -d "$QA_ROOT" ]]; then rm -r -- "$QA_ROOT"; fi
}
trap cleanup EXIT
docker network create --internal "$QA_NETWORK" >/dev/null
NETWORK_CREATED=1
docker run -d --name "$PG_CONTAINER" --network "$QA_NETWORK" --label "pingufunk.media-qa.owner=$MEDIA_QA_ID" -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine >/dev/null
PG_STARTED=1
ready=0
for ((attempt=0;attempt<30;attempt++)); do
  if docker exec "$PG_CONTAINER" pg_isready -q -h 127.0.0.1 -U postgres; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]]
docker exec "$PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c 'CREATE ROLE pingufunk_media_qa LOGIN' -c 'CREATE DATABASE pingufunk_media_qa OWNER pingufunk_media_qa' >/dev/null

for provider in sqlite postgresql; do
  mkdir "$QA_ROOT/$provider"
  if [[ "$provider" == sqlite ]]; then
    QA_URL=file:/qa/database.sqlite
    QA_TRANSPORT=none
  else
    QA_URL="postgresql://pingufunk_media_qa@${PG_CONTAINER}/pingufunk_media_qa?connect_timeout=1&pool_timeout=1&socket_timeout=1"
    QA_TRANSPORT="$QA_NETWORK"
  fi
  DATABASE_URL="$QA_URL" docker run --rm --network "$QA_TRANSPORT" --user "$(id -u):$(id -g)" \
    -e DATABASE_URL -e "DATABASE_PROVIDER=$provider" \
    --mount "type=bind,src=${QA_ROOT}/${provider},dst=/qa" --entrypoint node "$MIGRATOR_IMAGE" /app/scripts/database-migrate.mjs >/dev/null
  # Fixtures are generated inside the new container before Next enumerates public files.
  # This static media is loopback-only and disappears with this exact test container.
  DATABASE_URL="$QA_URL" docker run -d --name "$APP_CONTAINER" --network "$QA_TRANSPORT" \
    --label "pingufunk.media-qa.owner=$MEDIA_QA_ID" \
    -e DATABASE_URL -e "DATABASE_PROVIDER=$provider" -e PINGUFUNK_WRITES_ENABLED=1 \
    -e PINGUFUNK_FFPROBE_PATH=/app/ffmpeg/ffprobe-qa \
    -e PINGUFUNK_PUBLIC_URL=http://127.0.0.1:6767 \
    -e "PINGUFUNK_MEDIA_QA_OWNER=$MEDIA_QA_ID" \
    -e NODE_OPTIONS='--import /qa/provider.mjs' \
    -e "PUID=$(id -u)" -e "PGID=$(id -g)" \
    --mount "type=bind,src=${QA_ROOT}/${provider},dst=/qa" \
    --mount "type=bind,src=$(pwd)/scripts/media-container-provider.mjs,dst=/qa/provider.mjs,readonly" \
    --entrypoint /bin/sh "$RUNNER_IMAGE" -ec '
      mkdir -p /app/public/pingufunk-media-qa
      ffmpeg -y -v error -f lavfi -i testsrc2=size=320x180:rate=25 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 2 -c:v libx264 -preset ultrafast -c:a aac /app/public/pingufunk-media-qa/valid.mp4
      ffmpeg -y -v error -f lavfi -i testsrc2=size=320x180:rate=1 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 10 -c:v libx264 -preset ultrafast -c:a aac /app/public/pingufunk-media-qa/slow-mux.mp4
      ffmpeg -y -v error -f lavfi -i color=size=1280x720:rate=1 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 2 -c:v libx264 -preset ultrafast -c:a aac /app/public/pingufunk-media-qa/720p.mp4
      ffmpeg -y -v error -i /app/public/pingufunk-media-qa/valid.mp4 -an -c:v copy /app/public/pingufunk-media-qa/no-audio.mp4
      ffmpeg -y -v error -i /app/public/pingufunk-media-qa/valid.mp4 -c copy -hls_time 1 -hls_list_size 0 /app/public/pingufunk-media-qa/stream.m3u8
      node -e '\''require("node:fs").writeFileSync("/app/public/pingufunk-media-qa/invalid.mp4","<!doctype html><title>Synthetic error</title>")'\''
      node -e '\''const fs=require("node:fs");const file=fs.readFileSync("/app/public/pingufunk-media-qa/valid.mp4");fs.writeFileSync("/app/public/pingufunk-media-qa/truncated.mp4",file.subarray(0,Math.floor(file.length/2)))'\''
      node -e '\''require("node:fs").writeFileSync("/app/ffmpeg/ffprobe-qa","#!/bin/sh\nif [ -f /tmp/pause-next-probe ]; then mv /tmp/pause-next-probe /tmp/media-probe-ready; sleep 8; fi\nexec /usr/bin/ffprobe \"$@\"\n",{mode:0o755})'\''
      node -e '\''const fs=require("node:fs"),p="/app/ffmpeg/ffmpeg",s="#!/bin/sh\nif [ -f /tmp/slow-next-mux ]; then mv /tmp/slow-next-mux /tmp/media-mux-ready; exec /usr/bin/ffmpeg -re \"$@\"; fi\nexec /usr/bin/ffmpeg \"$@\"\n";if(fs.lstatSync(p).isSymbolicLink()){if(fs.readlinkSync(p)!=="/usr/bin/ffmpeg")throw Error("Unexpected fixture tool");fs.unlinkSync(p);fs.writeFileSync(p,s,{mode:0o755,flag:"wx"});}else if(!fs.lstatSync(p).isFile()||fs.readFileSync(p,"utf8")!==s)throw Error("Unexpected fixture wrapper")'\''
      exec /entrypoint.sh node server.js
    ' >/dev/null
  APP_STARTED=1
  ready=0
  for ((attempt=0;attempt<30;attempt++)); do
    if docker exec "$APP_CONTAINER" curl -fsS 'http://localhost:6767/api/download?mode=version' >/dev/null 2>&1; then ready=1; break; fi
    sleep 1
  done
  [[ "$ready" == 1 ]]
  PINGUFUNK_MEDIA_QA_OWNER="$MEDIA_QA_ID" PINGUFUNK_MEDIA_QA_PG_CONTAINER="$([[ "$provider" == postgresql ]] && echo "$PG_CONTAINER" || true)" node scripts/media-container-contract.mjs "$APP_CONTAINER"
  docker stop "$APP_CONTAINER" >/dev/null
  docker rm "$APP_CONTAINER" >/dev/null
  APP_STARTED=0
  echo "Disposable $provider media consumer gate passed"
done
