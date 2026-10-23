-- Seasonbook weekend-1 schema (episode/airtime data by TVmaze; no video, ever)
CREATE TABLE IF NOT EXISTS shows (
  id        INTEGER PRIMARY KEY,          -- TVmaze show id
  name      TEXT NOT NULL,
  status    TEXT,
  network   TEXT,
  timezone  TEXT,
  schedule  TEXT,
  runtime   INTEGER,
  image     TEXT,
  synced_at INTEGER
);

CREATE TABLE IF NOT EXISTS episodes (
  id        INTEGER PRIMARY KEY,          -- TVmaze episode id
  show_id   INTEGER NOT NULL REFERENCES shows(id),
  season    INTEGER NOT NULL,
  number    INTEGER,
  name      TEXT,
  airdate   TEXT,
  air_utc   TEXT,                         -- TVmaze airstamp normalized to UTC ISO-8601
  runtime   INTEGER,
  synced_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_epair  ON episodes (air_utc);
CREATE INDEX IF NOT EXISTS idx_epshow ON episodes (show_id);

CREATE TABLE IF NOT EXISTS follows (
  device_id  TEXT NOT NULL,
  show_id    INTEGER NOT NULL REFERENCES shows(id),
  created_at INTEGER,
  PRIMARY KEY (device_id, show_id)
);
