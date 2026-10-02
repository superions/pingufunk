#!/bin/sh
set -eu

DATABASE_PROVIDER=$(node /app/scripts/resolve-database-url.mjs --provider) || exit 1
export DATABASE_PROVIDER
DATABASE_URL=$(node /app/scripts/resolve-database-url.mjs) || exit 1
export DATABASE_URL
unset DATABASE_URL_FILE

exec su-exec node "$@"
