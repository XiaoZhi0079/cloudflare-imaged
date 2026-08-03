ALTER TABLE upload_sessions
ADD COLUMN phase TEXT NOT NULL DEFAULT 'reserved'
CHECK (phase IN ('reserved', 'object_uploaded', 'database_commit', 'completed', 'failed'));

ALTER TABLE upload_sessions ADD COLUMN error_code TEXT;
ALTER TABLE upload_sessions ADD COLUMN error_message TEXT;
ALTER TABLE upload_sessions ADD COLUMN duration_ms INTEGER;
ALTER TABLE upload_sessions ADD COLUMN completed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_upload_sessions_operation_updated
ON upload_sessions(operation_id, updated_at DESC);
