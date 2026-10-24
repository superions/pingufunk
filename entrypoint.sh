#!/bin/sh
set -e

fail() {
    echo "ERROR: $*" >&2
    exit 1
}

PUID=${PUID:-1001}
PGID=${PGID:-1001}

echo "Starting with UID: $PUID, GID: $PGID"

# Get or create group with desired GID
GROUP_NAME=$(getent group "$PGID" | cut -d: -f1)
if [ -z "$GROUP_NAME" ]; then
    echo "Creating group 'appgroup' with GID $PGID"
    addgroup -g "$PGID" appgroup
    GROUP_NAME="appgroup"
else
    echo "Using existing group '$GROUP_NAME' for GID $PGID"
fi

# Get or create user with desired UID
USER_NAME=$(getent passwd "$PUID" | cut -d: -f1)
if [ -z "$USER_NAME" ]; then
    echo "Creating user 'appuser' with UID $PUID in group $GROUP_NAME"
    adduser -u "$PUID" -G "$GROUP_NAME" -s /bin/sh -D appuser
    USER_NAME="appuser"
else
    echo "Using existing user '$USER_NAME' for UID $PUID"
fi

echo "Running as user: $USER_NAME ($(id "$USER_NAME"))"

# The database URL is resolved before dropping privileges so Docker secrets
# need not be world-readable. Never echo the resolved value.
DATABASE_PROVIDER=$(node /app/scripts/resolve-database-url.mjs --provider) || fail "Database configuration unavailable"
export DATABASE_PROVIDER
DATABASE_URL=$(node /app/scripts/resolve-database-url.mjs) || fail "Database configuration unavailable"
export DATABASE_URL
unset DATABASE_URL_FILE

if [ "$DATABASE_PROVIDER" = sqlite ]; then DEFAULT_WRITES=1; else DEFAULT_WRITES=0; fi
case "${PINGUFUNK_WRITES_ENABLED:-$DEFAULT_WRITES}" in
    0) export PINGUFUNK_WRITES_ENABLED=0; unset PINGUFUNK_BOOT_QUEUE ;;
    1) export PINGUFUNK_WRITES_ENABLED=1; export PINGUFUNK_BOOT_QUEUE=1 ;;
    *) fail "Invalid write gate configuration" ;;
esac

echo "Checking selected database schema without applying migrations..."
su-exec "$USER_NAME" node /app/scripts/check-database-schema.mjs || fail "Database schema check failed"

if [ "$PINGUFUNK_WRITES_ENABLED" = 1 ]; then
    # Only newly created required directories acquire the execution user's owner.
    # Existing media, adjacent paths and volume permissions remain untouched.
    node /app/scripts/download-directories.mjs prepare "$PUID" "$PGID" || fail "Download directory initialization failed"
    su-exec "$USER_NAME" node /app/scripts/download-directories.mjs check || fail "Download directories are not writable by the configured execution user"
fi

exec su-exec "$USER_NAME" "$@"
