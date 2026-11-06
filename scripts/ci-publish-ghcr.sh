#!/usr/bin/env bash
set -euo pipefail

[[ "${GITHUB_REF:-}" == refs/heads/main ]] || { echo 'Only main can be published' >&2; exit 1; }
[[ "${GITHUB_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo 'A full source commit is required' >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$GITHUB_SHA" ]] || { echo 'Checkout differs from the tested commit' >&2; exit 1; }
: "${PUBLIC_GHCR_TOKEN:?A GitHub token with write:packages is required}"
node scripts/ci-verify-forgejo-main.mjs

sha256sum -c release-artifact/archive.sha256
image_id="$(node --input-type=module <<'NODE'
import { readFileSync } from "node:fs";
const identity = JSON.parse(readFileSync("release-artifact/image-identity.json", "utf8"));
if (identity.revision !== process.env.GITHUB_SHA || identity.os !== "linux" || identity.architecture !== "amd64" || !/^sha256:[0-9a-f]{64}$/.test(identity.id)) {
  throw Error("The retained image identity does not match this run");
}
console.log(identity.id);
NODE
)"

umask 077
docker_config="$(mktemp -d "${RUNNER_TEMP:?}/pingufunk-ghcr.XXXXXXXX")"
export DOCKER_CONFIG="$docker_config"
loaded_tag="pingufunk-ci-export:${GITHUB_SHA}-${GITHUB_RUN_ID}"
sha_ref="ghcr.io/superions/pingufunk:sha-${GITHUB_SHA}"
main_ref="ghcr.io/superions/pingufunk:main"
tagged_sha=0
tagged_main=0
cleanup() {
  rm -rf -- "$docker_config"
  local images=("$loaded_tag")
  [[ "$tagged_sha" != 1 ]] || images+=("$sha_ref")
  [[ "$tagged_main" != 1 ]] || images+=("$main_ref")
  for image in "${images[@]}"; do
    if [[ -n "$image" ]] && [[ "$(docker image inspect "$image" --format '{{.Id}}' 2>/dev/null || :)" == "$image_id" ]]; then
      docker image rm "$image"
    fi
  done
}
trap cleanup EXIT
printf '%s' "$PUBLIC_GHCR_TOKEN" | docker login ghcr.io --username superions --password-stdin >/dev/null
docker load --input release-artifact/runner-amd64.tar
[[ "$(docker image inspect "$loaded_tag" --format '{{.Id}}')" == "$image_id" ]] || {
  echo 'Loaded image differs from the tested image' >&2; exit 1;
}

# A source-SHA tag is immutable: reuse the same image or fail closed.
sha_tag="sha-${GITHUB_SHA}"
status=0
node scripts/ci-ghcr-manifest.mjs "$sha_tag" "$image_id" || status=$?
if [[ "$status" == 3 ]]; then
  docker tag "$image_id" "$sha_ref"
  tagged_sha=1
  docker push "$sha_ref"
  node scripts/ci-ghcr-manifest.mjs "$sha_tag" "$image_id"
elif [[ "$status" != 0 ]]; then
  exit "$status"
fi

# Update the floating branch tag only if both source repositories still match.
node scripts/ci-verify-forgejo-main.mjs
node --input-type=module <<'NODE'
const response = await fetch("https://api.github.com/repos/superions/pingufunk/commits/main", { signal: AbortSignal.timeout(15000) });
if (!response.ok || (await response.json()).sha !== process.env.GITHUB_SHA) throw Error("Public main moved since this run began");
NODE
docker tag "$image_id" "$main_ref"
tagged_main=1
docker push "$main_ref"
echo 'Verified GHCR manifest:'
node scripts/ci-ghcr-manifest.mjs main "$image_id"
