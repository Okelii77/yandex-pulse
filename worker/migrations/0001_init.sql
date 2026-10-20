-- Cloudflare D1 persistence. No OAuth credentials are stored here.
CREATE TABLE IF NOT EXISTS latest (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  generated_at TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS samples (
  check_id TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  status TEXT NOT NULL,
  latency_ms INTEGER,
  PRIMARY KEY (check_id, checked_at)
);
CREATE INDEX IF NOT EXISTS idx_samples_checked_at ON samples(checked_at);
CREATE TABLE IF NOT EXISTS trigger_gate (
  key TEXT PRIMARY KEY,
  last_started INTEGER NOT NULL
);
