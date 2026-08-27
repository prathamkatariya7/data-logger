-- Data Logger schema (SQLite / better-sqlite3)
-- See architecture doc §4.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- §4.1 devices: every device that has ever POSTed, regardless of online state.
CREATE TABLE IF NOT EXISTS devices (
  device_id            TEXT PRIMARY KEY,
  display_name         TEXT NOT NULL,
  first_seen           TEXT NOT NULL,           -- ISO8601 server time
  last_seen            TEXT NOT NULL,           -- ISO8601 server time, updated each ingest
  last_atmega_online   INTEGER NOT NULL DEFAULT 0
);

-- §4.2 channel_config: one row per (device, type, num). Holds formula params
-- AND master-calibration state.
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
  UNIQUE (device_id, channel_type, channel_num),
  FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);

-- §4.3 readings: time-series log backing CSV export, live view, last-value cache.
CREATE TABLE IF NOT EXISTS readings (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id             TEXT NOT NULL,
  channel_type          TEXT NOT NULL,
  channel_num           INTEGER NOT NULL,
  ts                    TEXT NOT NULL,          -- server receipt time ISO8601
  rtc_time              TEXT,                   -- device RTC time string (nullable)
  rtc_date              TEXT,                   -- device RTC date string (nullable)
  raw_value             REAL,
  hw_available          INTEGER,                -- pt100 only
  fault                 INTEGER,                -- tc open-circuit only
  calculated_temp_c     REAL,
  master_temp_c         REAL,                   -- calculated + error_factor, only if master_enabled
  error_factor_at_time  REAL,                   -- snapshot so historical rows stay correct
  FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_readings_lookup
  ON readings (device_id, channel_type, channel_num, ts);

CREATE INDEX IF NOT EXISTS idx_readings_device_ts
  ON readings (device_id, ts);
