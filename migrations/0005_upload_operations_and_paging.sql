ALTER TABLE upload_sessions
ADD COLUMN operation_id TEXT;

ALTER TABLE upload_sessions
ADD COLUMN client_item_id TEXT;

CREATE INDEX IF NOT EXISTS idx_images_created_id
ON images(created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_upload_sessions_operation
ON upload_sessions(operation_id, client_item_id);
