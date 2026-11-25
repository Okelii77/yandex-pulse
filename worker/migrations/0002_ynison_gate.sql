-- Independent diagnostic gate; never stores OAuth, player data or device IDs.
CREATE TABLE IF NOT EXISTS ynison_gate (
  id INTEGER PRIMARY KEY CHECK(id=1),
  lease_id TEXT NOT NULL,
  blocked_until INTEGER NOT NULL,
  client TEXT,
  last_client TEXT,
  last_outcome TEXT,
  last_finished INTEGER
);
