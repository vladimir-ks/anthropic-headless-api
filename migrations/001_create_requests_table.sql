-- Create requests table for logging all AI gateway requests
-- Tracks backend usage, cost, performance, and degraded mode

CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  backend TEXT NOT NULL,
  backend_type TEXT NOT NULL,
  instance TEXT,
  working_directory TEXT,
  model TEXT,
  session_id TEXT,
  prompt TEXT NOT NULL,
  response TEXT,
  error TEXT,
  duration_ms INTEGER,
  tokens_input INTEGER,
  tokens_output INTEGER,
  cost_usd REAL,
  queue_wait_ms INTEGER,
  degraded BOOLEAN DEFAULT 0,
  metadata TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_timestamp ON requests(timestamp);
CREATE INDEX IF NOT EXISTS idx_backend ON requests(backend);
CREATE INDEX IF NOT EXISTS idx_backend_type ON requests(backend_type);
CREATE INDEX IF NOT EXISTS idx_session ON requests(session_id);
CREATE INDEX IF NOT EXISTS idx_degraded ON requests(degraded);
CREATE INDEX IF NOT EXISTS idx_created_at ON requests(created_at);
