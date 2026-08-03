CREATE TABLE IF NOT EXISTS ai_analysis_batches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'completed', 'cancelled')),
  source TEXT NOT NULL DEFAULT 'mcp',
  snapshot_max_image_id INTEGER,
  operation_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_analysis_items (
  batch_id TEXT NOT NULL,
  image_id INTEGER NOT NULL,
  content_sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'proposed', 'reviewed', 'applied', 'failed')),
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (batch_id, image_id),
  FOREIGN KEY (batch_id) REFERENCES ai_analysis_batches(id) ON DELETE CASCADE,
  FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_tag_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  normalized_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  suggested_group_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  created_tag_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (normalized_name, suggested_group_id),
  FOREIGN KEY (suggested_group_id) REFERENCES tag_groups(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_tag_id) REFERENCES tags(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ai_image_proposals (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  image_id INTEGER NOT NULL,
  proposed_file_name TEXT NOT NULL,
  proposed_category_id INTEGER NOT NULL,
  proposed_tag_ids TEXT NOT NULL DEFAULT '[]',
  candidate_tag_ids TEXT NOT NULL DEFAULT '[]',
  rationale TEXT NOT NULL DEFAULT '',
  confidence REAL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'applied', 'failed')),
  review_note TEXT,
  reviewed_at TEXT,
  applied_at TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (batch_id, image_id),
  FOREIGN KEY (batch_id) REFERENCES ai_analysis_batches(id) ON DELETE CASCADE,
  FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE,
  FOREIGN KEY (proposed_category_id) REFERENCES categories(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS ai_proposal_candidate_tags (
  proposal_id TEXT NOT NULL,
  candidate_id INTEGER NOT NULL,
  PRIMARY KEY (proposal_id, candidate_id),
  FOREIGN KEY (proposal_id) REFERENCES ai_image_proposals(id) ON DELETE CASCADE,
  FOREIGN KEY (candidate_id) REFERENCES ai_tag_candidates(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_analysis_items_status ON ai_analysis_items(batch_id, status, image_id);
CREATE INDEX IF NOT EXISTS idx_ai_proposals_status_created ON ai_image_proposals(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_proposals_batch_status ON ai_image_proposals(batch_id, status, image_id);
CREATE INDEX IF NOT EXISTS idx_ai_candidates_status_count ON ai_tag_candidates(status, occurrence_count DESC, id DESC);
