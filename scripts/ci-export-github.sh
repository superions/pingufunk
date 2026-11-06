#!/usr/bin/env bash
set -euo pipefail

[[ "${GITHUB_REF:-}" == refs/heads/main ]] || { echo 'Only main can be exported' >&2; exit 1; }
[[ "${GITHUB_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo 'A full source commit is required' >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$GITHUB_SHA" ]] || { echo 'Checkout differs from the tested commit' >&2; exit 1; }
: "${PUBLIC_GIT_DEPLOY_KEY:?The repository-scoped GitHub deploy key is required}"
: "${FORGEJO_TOKEN:?The Forgejo job token is required}"

# Refuse stale queued runs: only the currently selected Forgejo main can leave.
node scripts/ci-verify-forgejo-main.mjs

umask 077
key_dir="$(mktemp -d "${RUNNER_TEMP:?}/pingufunk-export.XXXXXXXX")"
trap 'rm -rf -- "$key_dir"' EXIT
printf '%s\n' "$PUBLIC_GIT_DEPLOY_KEY" > "$key_dir/key"
unset PUBLIC_GIT_DEPLOY_KEY

# GitHub publishes the authoritative SSH keys over its HTTPS API.
PINGUFUNK_KNOWN_HOSTS="$key_dir/known_hosts" node --input-type=module <<'NODE'
import { writeFileSync } from "node:fs";
const response = await fetch("https://api.github.com/meta", { signal: AbortSignal.timeout(15000) });
if (!response.ok) throw Error(`Cannot fetch GitHub SSH keys: HTTP ${response.status}`);
const keys = (await response.json()).ssh_keys?.filter((key) => /^ssh-ed25519 [A-Za-z0-9+/=]+$/.test(key));
if (!keys?.length) throw Error("GitHub did not provide an Ed25519 SSH key");
writeFileSync(process.env.PINGUFUNK_KNOWN_HOSTS, keys.map((key) => `github.com ${key}\n`).join(""));
NODE
export GIT_SSH_COMMAND="ssh -i $key_dir/key -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$key_dir/known_hosts"
bash scripts/ci-public-git-push.sh git@github.com:superions/pingufunk.git "$GITHUB_SHA"
