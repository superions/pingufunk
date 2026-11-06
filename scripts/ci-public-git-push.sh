#!/usr/bin/env bash
set -euo pipefail

remote="${1:?A public Git remote is required}"
commit="${2:?A full source commit is required}"
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo 'A full commit ID is required' >&2; exit 1; }
[[ "$(git rev-parse --verify "${commit}^{commit}")" == "$commit" ]] || exit 1

remote_ref="$(git ls-remote --heads "$remote" refs/heads/main)"
remote_commit="${remote_ref%%$'\t'*}"
[[ "$remote_commit" =~ ^[0-9a-f]{40}$ ]] || { echo 'Public main is missing or ambiguous' >&2; exit 1; }
if [[ "$remote_commit" == "$commit" ]]; then
  echo 'Public main already matches the tested commit'
  exit 0
fi

# A normal push also rejects a race if public main moves after this check.
git merge-base --is-ancestor "$remote_commit" "$commit" || {
  echo 'Public main is not an ancestor of the tested commit' >&2; exit 1;
}
git push "$remote" "$commit:refs/heads/main"
