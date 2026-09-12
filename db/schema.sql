-- Data Logger schema (SQLite / better-sqlite3)
-- See architecture doc §4. Extended for the production-grade upgrade:
-- recording sessions, renamable channels, per-channel alarms, diagnostics.
--
-- NOTE: columns added after v1 are created here for fresh databases AND
-- back-filled on existing databases by the guarded migration runner in db.js
-- (CREATE TABLE IF NOT EXISTS won't add columns to a table that already
-- exists, so the ALTER TABLE migrations there are what upgrade older files).

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Users / RBAC: dashboard login accounts. Roles: 'admin' | 'engineer'.
-- Admins manage users; engineers have full app access but no user management.
-- The first admin is seeded from ADMIN_USER/ADMIN_PASSWORD on first boot.
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  username       TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'engineer',  -- 'admin' | 'engineer'
  created_at     TEXT NOT NULL,
  created_by     TEXT
);

-- §4.1 devices: every device that has ever POSTed, regardless of online state.
CREATE TABLE IF NOT EXISTS devices (
  device_id            TEXT PRIMARY KEY,
  display_name         TEXT NOT NULL,
  first_seen           TEXT NOT NULL,           -- ISO8601 server time
  last_seen            TEXT NOT NULL,           -- ISO8601 server time, updated each ingest
  last_atmega_online   INTEGER NOT NULL DEFAULT 0,
  -- Recording control (upgrade)
  recording_enabled    INTEGER NOT NULL DEFAULT 0,
  active_session_id    INTEGER,                 -- FK -> sessions.id when recording
  sample_interval_ms   INTEGER NOT NULL DEFAULT 1000, -- storage-rate (decimation)
  -- Diagnostics (upgrade)
  wifi_rssi            INTEGER,
  free_heap            INTEGER,
  fw_version           TEXT,
  esp_uptime_ms        INTEGER,
  i2c_consec_fails     INTEGER
);

-- §4.2 channel_config: one row per (device, type, num). Holds formula params,
-- master-calibration state, plus display name / unit / enable / alarm config.
CREATE TABLE IF NOT EXISTS channel_config (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id             TEXT NOT NULL,
  channel_type          TEXT NOT NULL,          -- 'pt100' | 'tc'
  channel_num           INTEGER NOT NULL,
  formula_params        TEXT NOT NULL,          -- JSON
  master_reference_c    REAL,                   -- nullable: value user typed in
  master_error_factor   REAL,                   -- nullable: computed at calibration time
  master_set_at         TEXT,                   -- nullable ISO8601
  master_enabled        INTEGER NOT NULL DEFAULT 0,
  -- Upgrade columns
  display_name          TEXT,                   -- user-chosen name; null => default label
  unit                  TEXT NOT NULL DEFAULT '°C',
  enabled               INTEGER NOT NULL DEFAULT 1,
  alarm_enabled         INTEGER NOT NULL DEFAULT 0,
  alarm_low             REAL,
  alarm_high            REAL,
  UNIQUE (device_id, channel_type, channel_num),
  FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);

-- Recording sessions: one row per Start/Stop cycle (upgrade).
CREATE TABLE IF NOT EXISTS sessions (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id             TEXT NOT NULL,
  name                  TEXT NOT NULL,
  operator              TEXT,
  notes                 TEXT,
  started_at            TEXT NOT NULL,          -- ISO8601
  ended_at              TEXT,                   -- ISO8601, null while active
  sample_interval_ms    INTEGER NOT NULL DEFAULT 1000,
  FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_device ON sessions (device_id, started_at);

-- Alarm event log: threshold breach / clear transitions (upgrade).
CREATE TABLE IF NOT EXISTS alarm_events (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id             TEXT NOT NULL,
  channel_type          TEXT NOT NULL,
  channel_num           INTEGER NOT NULL,
  ts                    TEXT NOT NULL,          -- ISO8601 server time
  kind                  TEXT NOT NULL,          -- 'low' | 'high' | 'clear'
  value                 REAL,
  threshold             REAL,
  FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_alarm_events ON alarm_events (device_id, ts);

-- §4.3 readings: time-series log backing CSV export, live view, last-value cache.
CREATE TABLE IF NOT EXISTS readings (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id             TEXT NOT NULL,
  channel_type          TEXT NOT NULL,
  channel_num           INTEGER NOT NULL,
  ts                    TEXT NOT NULL,          -- server receipt time ISO8601
  rtc_time              TEXT,                   -- device NTP time string (nullable)
  rtc_date              TEXT,                   -- device NTP date string (nullable)
  raw_value             REAL,
  hw_available          INTEGER,                -- pt100 only
  fault                 INTEGER,                -- tc open-circuit only
  calculated_temp_c     REAL,
  master_temp_c         REAL,                   -- calculated + error_factor, only if master_enabled
  error_factor_at_time  REAL,                   -- snapshot so historical rows stay correct
  session_id            INTEGER,                -- FK -> sessions.id (upgrade); null for legacy rows
  FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_readings_lookup
  ON readings (device_id, channel_type, channel_num, ts);

CREATE INDEX IF NOT EXISTS idx_readings_device_ts
  ON readings (device_id, ts);
