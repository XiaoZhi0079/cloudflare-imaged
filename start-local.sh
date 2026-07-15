#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

export GALLERY_ADMIN_KEY="${GALLERY_ADMIN_KEY:-gallery-secret}"
export GALLERY_PUBLIC_BASE_URL="${GALLERY_PUBLIC_BASE_URL:-http://127.0.0.1:8788/file}"
export GALLERY_UPLOAD_NAME_TYPE="${GALLERY_UPLOAD_NAME_TYPE:-origin}"
export GALLERY_UPLOAD_FOLDER="${GALLERY_UPLOAD_FOLDER:-gallery}"
export R2_BUCKET_NAME="${R2_BUCKET_NAME:-gallery}"
# Keep local direct-upload credentials in .dev.vars so Wrangler loads them as secrets.
export HTTP_PROXY=
export HTTPS_PROXY=
export ALL_PROXY=
export NO_PROXY=127.0.0.1,localhost

npx wrangler d1 migrations apply GALLERY_DB --local --persist-to ./.wrangler/state

exec npx wrangler pages dev ./public \
  --r2 GALLERY_BUCKET \
  --binding "GALLERY_ADMIN_KEY=${GALLERY_ADMIN_KEY}" \
  --binding "GALLERY_PUBLIC_BASE_URL=${GALLERY_PUBLIC_BASE_URL}" \
  --binding "GALLERY_UPLOAD_NAME_TYPE=${GALLERY_UPLOAD_NAME_TYPE}" \
  --binding "GALLERY_UPLOAD_FOLDER=${GALLERY_UPLOAD_FOLDER}" \
  --binding "R2_BUCKET_NAME=${R2_BUCKET_NAME}" \
  --compatibility-date 2026-03-02 \
  --ip 127.0.0.1 \
  --port 8788 \
  --persist-to ./.wrangler/state
