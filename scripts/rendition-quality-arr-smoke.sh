#!/usr/bin/env bash
set -euo pipefail

# Only newly allocated internal QA networks and unmonitored synthetic fixtures.
# The Arr harness verifies owner/image/mount identity before every operation.
export PINGUFUNK_ARR_QA_SOURCE_AUDIO=1
# Native ID searches need verified metadata; use only the owned synthetic
# Radarr library, never an external metadata account or invented source year.
export PINGUFUNK_ARR_QA_MOVIE_CORRELATION=1
QA_DIRECTORY=""
cleanup() {
  if [[ -n "$QA_DIRECTORY" ]]; then node scripts/arr-test-instances.mjs stop "$QA_DIRECTORY"; fi
}
trap cleanup EXIT
for quality in 720p unknown conflicting ard-1080p; do
  if [[ "$quality" == 720p ]]; then export PINGUFUNK_ARR_QA_TBA=1; else unset PINGUFUNK_ARR_QA_TBA; fi
  export PINGUFUNK_ARR_QA_RENDITION_QUALITY="$quality"
  output="$(node scripts/arr-test-instances.mjs up)"
  QA_DIRECTORY="$(sed -n 's/^QA_DIRECTORY=//p' <<< "$output")"
  [[ -n "$QA_DIRECTORY" && "$QA_DIRECTORY" == "$(pwd)/downloads/arr-qa."* ]]
  echo "$output"
  node scripts/arr-test-instances.mjs bootstrap "$QA_DIRECTORY"
  node scripts/arr-test-instances.mjs movie-fixture "$QA_DIRECTORY"
  node scripts/arr-test-instances.mjs movie-search "$QA_DIRECTORY"
  if [[ "$quality" == 720p ]]; then
    node scripts/arr-test-instances.mjs series-fixture "$QA_DIRECTORY"
    node scripts/arr-test-instances.mjs episode-search "$QA_DIRECTORY"
  fi
  node scripts/arr-test-instances.mjs boundaries "$QA_DIRECTORY"
  node scripts/arr-test-instances.mjs stop "$QA_DIRECTORY"
  QA_DIRECTORY=""
  echo "Disposable native rendition gate passed: $quality"
done
