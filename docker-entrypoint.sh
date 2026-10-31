#!/bin/sh
# A freshly mounted volume is owned by root, so fix ownership once and then
# drop privileges before starting Node.
set -e
mkdir -p "${UPLOAD_DIR:-/data/uploads}" "$(dirname "${STUDIO_STORAGE_DIR:-/data}/producer.db")"
chown -R node:node "${STUDIO_STORAGE_DIR:-/data}"
exec su-exec node "$@"
