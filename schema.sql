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

-- Device-scoped watch state (weekend 1.5). device_id is the pre-accounts stand-in.
CREATE TABLE IF NOT EXISTS watchmarks (
  device_id  TEXT NOT NULL,
  episode_id INTEGER NOT NULL,
  show_id    INTEGER NOT NULL REFERENCES shows(id),
  watched_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, episode_id)
);
CREATE INDEX IF NOT EXISTS idx_watch_show_dev ON watchmarks (show_id, device_id);

-- Movies (weekend 2): TMDB-backed film watch list. Same ownership rules as shows:
-- cache in `movies`, device-scoped state in `movie_marks` ('want' or 'watched').
CREATE TABLE IF NOT EXISTS movies (
  id           INTEGER PRIMARY KEY,       -- TMDB movie id
  title        TEXT NOT NULL,
  year         INTEGER,                   -- release_date year
  release_date TEXT,
  runtime      INTEGER,
  poster       TEXT,
  overview     TEXT,
  status       TEXT,                      -- Released / Post Production / ...
  synced_at    INTEGER
);

CREATE TABLE IF NOT EXISTS movie_marks (
  device_id  TEXT NOT NULL,
  movie_id   INTEGER NOT NULL REFERENCES movies(id),
  state      TEXT NOT NULL,               -- 'want' or 'watched'
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, movie_id)
);
CREATE INDEX IF NOT EXISTS idx_movie_state ON movie_marks (state, device_id);

-- Announcements ledger (weekend 2): the FCM announce engine's dedupe memory —
-- one push per episode per kind ('air' now; later 'premiere' / 'digest' can join).
CREATE TABLE IF NOT EXISTS announcements (
  episode_id   INTEGER NOT NULL,
  kind         TEXT NOT NULL,
  air_utc      TEXT,
  announced_at INTEGER NOT NULL,
  PRIMARY KEY (episode_id, kind)
);
