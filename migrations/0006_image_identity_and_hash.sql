ALTER TABLE images
ADD COLUMN public_id TEXT;

ALTER TABLE images
ADD COLUMN content_sha256 TEXT;

ALTER TABLE upload_sessions
ADD COLUMN public_id TEXT;

ALTER TABLE upload_sessions
ADD COLUMN content_sha256 TEXT;

UPDATE images
SET public_id = lower(
  hex(randomblob(4)) || '-' ||
  hex(randomblob(2)) || '-' ||
  '4' || substr(hex(randomblob(2)), 2) || '-' ||
  '8' || substr(hex(randomblob(2)), 2) || '-' ||
  hex(randomblob(6))
)
WHERE public_id IS NULL;

UPDATE upload_sessions
SET public_id = (
  SELECT images.public_id
  FROM images
  WHERE images.id = upload_sessions.image_id
)
WHERE public_id IS NULL
  AND image_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM images WHERE images.id = upload_sessions.image_id);

UPDATE upload_sessions
SET public_id = lower(
  hex(randomblob(4)) || '-' ||
  hex(randomblob(2)) || '-' ||
  '4' || substr(hex(randomblob(2)), 2) || '-' ||
  '8' || substr(hex(randomblob(2)), 2) || '-' ||
  hex(randomblob(6))
)
WHERE public_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_images_public_id
ON images(public_id)
WHERE public_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_images_content_sha256
ON images(content_sha256)
WHERE content_sha256 IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_upload_sessions_public_id
ON upload_sessions(public_id)
WHERE public_id IS NOT NULL;
