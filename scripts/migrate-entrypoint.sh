#!/bin/sh
set -eu

DATABASE_URL=$(node /app/scripts/resolve-database-url.mjs) || exit 1
export DATABASE_URL
unset DATABASE_URL_FILE

exec su-exec node "$@"
