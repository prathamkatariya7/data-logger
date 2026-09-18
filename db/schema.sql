-- Data Logger Database Schema (SQLite / better-sqlite3)
-- Defines core relational tables for users, devices, channel configs,
-- recording sessions, alarm events, sensor readings, and S3 archives.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Users & Role-Based Access Control (RBAC)
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  username       TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'engineer',  -- 'admin' | 'engineer'
  created_at     TEXT NOT NULL,
  created_by     TEXT
);

-- Registered devices and connectivity metadata
CREATE TABLE IF NOT EXISTS devices (
  device_id            TEXT PRIMARY KEY,
  display_name         TEXT NOT NULL,
  first_seen           TEXT NOT NULL,           -- ISO8601 server timestamp
  last_seen            TEXT NOT NULL,           -- ISO8601 server timestamp
  last_atmega_online   INTEGER NOT NULL DEFAULT 0,
  recording_enabled    INTEGER NOT NULL DEFAULT 0,
  active_session_id    INTEGER,                 -- FK -> sessions.id
  sample_interval_ms   INTEGER NOT NULL DEFAULT 1000,
  wifi_rssi            INTEGER,
  free_heap            INTEGER,
  fw_version           TEXT,
  esp_uptime_ms        INTEGER,
  i2c_consec_fails     INTEGER
);

-- Channel configuration and calibration settings
CREATE TABLE IF NOT EXISTS channel_config (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id             TEXT NOT NULL,
  channel_type          TEXT NOT NULL,          -- 'pt100' | 'tc'
  channel_num           INTEGER NOT NULL,
  formula_params        TEXT NOT NULL,          -- JSON serialized formula parameters
  master_reference_c    REAL,
  master_error_factor   REAL,
  master_set_at         TEXT,                   -- ISO8601 timestamp
  master_enabled        INTEGER NOT NULL DEFAULT 0,
  display_name          TEXT,
  unit                  TEXT NOT NULL DEFAULT '°C',
  enabled               INTEGER NOT NULL DEFAULT 1,
  alarm_enabled         INTEGER NOT NULL DEFAULT 0,
  alarm_low             REAL,
  alarm_high            REAL,
  UNIQUE (device_id, channel_type, channel_num),
  FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);

-- Recording sessions
CREATE TABLE IF NOT EXISTS sessions (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id             TEXT NOT NULL,
  name                  TEXT NOT NULL,
  operator              TEXT,
  notes                 TEXT,
  started_at            TEXT NOT NULL,          -- ISO8601 timestamp
  ended_at              TEXT,                   -- ISO8601 timestamp
  sample_interval_ms    INTEGER NOT NULL DEFAULT 1000,
  FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_device ON sessions (device_id, started_at);

-- Alarm events log
CREATE TABLE IF NOT EXISTS alarm_events (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id             TEXT NOT NULL,
  channel_type          TEXT NOT NULL,
  channel_num           INTEGER NOT NULL,
  ts                    TEXT NOT NULL,          -- ISO8601 timestamp
  kind                  TEXT NOT NULL,          -- 'low' | 'high' | 'clear'
  value                 REAL,
  threshold             REAL,
  FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_alarm_events ON alarm_events (device_id, ts);

-- Historical sensor telemetry readings
CREATE TABLE IF NOT EXISTS readings (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id             TEXT NOT NULL,
  channel_type          TEXT NOT NULL,
  channel_num           INTEGER NOT NULL,
  ts                    TEXT NOT NULL,          -- ISO8601 server timestamp
  rtc_time              TEXT,
  rtc_date              TEXT,
  raw_value             REAL,
  hw_available          INTEGER,
  fault                 INTEGER,
  calculated_temp_c     REAL,
  master_temp_c         REAL,
  error_factor_at_time  REAL,
  session_id            INTEGER,
  FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_readings_lookup
  ON readings (device_id, channel_type, channel_num, ts);

CREATE INDEX IF NOT EXISTS idx_readings_device_ts
  ON readings (device_id, ts);

CREATE INDEX IF NOT EXISTS idx_readings_ts
  ON readings (ts);

-- AWS S3 historical archive registry
CREATE TABLE IF NOT EXISTS s3_archives (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id           TEXT NOT NULL,
  session_id          INTEGER,
  archive_key         TEXT NOT NULL UNIQUE,
  filename            TEXT NOT NULL,
  file_size_bytes     INTEGER NOT NULL DEFAULT 0,
  row_count           INTEGER NOT NULL DEFAULT 0,
  start_ts            TEXT,
  end_ts              TEXT,
  created_at          TEXT NOT NULL,
  FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_archives_device ON s3_archives (device_id, created_at);
