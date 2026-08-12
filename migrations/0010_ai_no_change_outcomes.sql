ALTER TABLE ai_analysis_items
ADD COLUMN outcome TEXT CHECK (outcome IN ('proposal', 'no_change'));

CREATE INDEX IF NOT EXISTS idx_ai_analysis_items_outcome
ON ai_analysis_items(batch_id, outcome, image_id);
