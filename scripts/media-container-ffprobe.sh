#!/bin/sh
set -eu

# These overrides belong only to the disposable media harness and its unit test.
control_dir="${PINGUFUNK_MEDIA_QA_CONTROL_DIR:-/tmp}"
probe="${PINGUFUNK_MEDIA_QA_FFPROBE:-/usr/bin/ffprobe}"
if [ -f "$control_dir/pause-next-probe" ]; then
    mv "$control_dir/pause-next-probe" "$control_dir/media-probe-ready"
    # An elapsed sleep cannot prove the observer has paused its database.
    # Bound the fixture independently; only explicit release may run the probe.
    attempt=0
    while [ ! -f "$control_dir/media-probe-release" ]; do
        [ "$attempt" -lt 300 ] || exit 72
        attempt=$((attempt + 1))
        sleep 0.1
    done
fi
exec "$probe" "$@"
