#!/usr/bin/env bash
set -euo pipefail

# Only newly allocated internal QA networks and unmonitored synthetic fixtures.
# The Arr harness verifies owner/image/mount identity before every operation.
export PINGUFUNK_ARR_QA_SOURCE_AUDIO=1
QA_DIRECTORY=""
cleanup() {
  if [[ -n "$QA_DIRECTORY" ]]; then node scripts/arr-test-instances.mjs stop "$QA_DIRECTORY"; fi
}
trap cleanup EXIT
for quality in 720p unknown conflicting; do
  export PINGUFUNK_ARR_QA_RENDITION_QUALITY="$quality"
  output="$(node scripts/arr-test-instances.mjs up)"
  QA_DIRECTORY="$(sed -n 's/^QA_DIRECTORY=//p' <<< "$output")"
  [[ -n "$QA_DIRECTORY" && "$QA_DIRECTORY" == "$(pwd)/downloads/arr-qa."* ]]
  echo "$output"
  node scripts/arr-test-instances.mjs bootstrap "$QA_DIRECTORY"
  node scripts/arr-test-instances.mjs movie-fixture "$QA_DIRECTORY"
  node scripts/arr-test-instances.mjs movie-search "$QA_DIRECTORY"
  node scripts/arr-test-instances.mjs boundaries "$QA_DIRECTORY"
  node scripts/arr-test-instances.mjs stop "$QA_DIRECTORY"
  QA_DIRECTORY=""
  echo "Disposable native rendition gate passed: $quality"
done
