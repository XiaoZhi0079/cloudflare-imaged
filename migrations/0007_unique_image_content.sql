DROP INDEX IF EXISTS idx_images_content_sha256;

CREATE UNIQUE INDEX IF NOT EXISTS idx_images_content_sha256
ON images(content_sha256)
WHERE content_sha256 IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_upload_sessions_pending_content_sha256
ON upload_sessions(content_sha256)
WHERE content_sha256 IS NOT NULL
  AND status = 'pending';
