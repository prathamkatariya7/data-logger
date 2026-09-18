'use strict';

/**
 * @module db/db
 * @description SQLite database connection initializer, schema migration runner, prepared statement registry,
 * and data access helper functions for the Data Logger system.
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const config = require('../config');

// Ensure database directory exists
fs.mkdirSync(path.dirname(config.DB_PATH), { recursive: true });

const db = new Database(config.DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 10000');

// Initialize base table schema
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

/**
 * Checks if a column exists on a database table.
 * 
 * @param {string} table - Table name
 * @param {string} column - Column name
 * @returns {boolean} True if column exists
 */
function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

/**
 * Safely adds a missing column to a database table.
 * 
 * @param {string} table - Table name
 * @param {string} column - Column name
 * @param {string} ddl - Column definition DDL statement
 */
function addColumn(table, column, ddl) {
  if (!columnExists(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    console.log(`[migrate] ${table}.${column} added`);
  }
}

/**
 * Runs idempotent migrations for existing databases to ensure schema parity.
 */
function runMigrations() {
  // devices table additions
  addColumn('devices', 'recording_enabled', 'recording_enabled INTEGER NOT NULL DEFAULT 0');
  addColumn('devices', 'active_session_id', 'active_session_id INTEGER');
  addColumn('devices', 'sample_interval_ms', 'sample_interval_ms INTEGER NOT NULL DEFAULT 1000');
  addColumn('devices', 'wifi_rssi', 'wifi_rssi INTEGER');
  addColumn('devices', 'free_heap', 'free_heap INTEGER');
  addColumn('devices', 'fw_version', 'fw_version TEXT');
  addColumn('devices', 'esp_uptime_ms', 'esp_uptime_ms INTEGER');
  addColumn('devices', 'i2c_consec_fails', 'i2c_consec_fails INTEGER');

  // channel_config table additions
  addColumn('channel_config', 'display_name', 'display_name TEXT');
  addColumn('channel_config', 'unit', "unit TEXT NOT NULL DEFAULT '°C'");
  addColumn('channel_config', 'enabled', 'enabled INTEGER NOT NULL DEFAULT 1');
  addColumn('channel_config', 'alarm_enabled', 'alarm_enabled INTEGER NOT NULL DEFAULT 0');
  addColumn('channel_config', 'alarm_low', 'alarm_low REAL');
  addColumn('channel_config', 'alarm_high', 'alarm_high REAL');

  // readings table additions
  addColumn('readings', 'session_id', 'session_id INTEGER');

  // Performance indices
  db.exec('CREATE INDEX IF NOT EXISTS idx_readings_session ON readings (session_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_readings_ts ON readings (ts)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_readings_device ON readings (device_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_readings_device_ts ON readings (device_id, ts)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_readings_lookup ON readings (device_id, channel_type, channel_num, ts)');
}
runMigrations();

/**
 * Utility helper returning ISO timestamp string.
 * @returns {string} ISO date-time string
 */
function nowIso() {
  return new Date().toISOString();
}

/**
 * Generates default fallback display name for channels.
 * 
 * @param {string} type - Channel type ('pt100' or 'tc')
 * @param {number} num - Channel index number
 * @returns {string} Formatted default channel name
 */
function defaultChannelName(type, num) {
  return type === 'pt100' ? `PT100_${num}` : `TC_${num}`;
}

// Pre-compiled prepared statements for optimal query performance
const stmts = {
  // --- Users & RBAC ---
  getUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  getUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
  listUsers: db.prepare('SELECT id, username, role, created_at, created_by FROM users ORDER BY role, username COLLATE NOCASE'),
  insertUser: db.prepare(
    `INSERT INTO users (username, password_hash, role, created_at, created_by)
     VALUES (@username, @password_hash, @role, @created_at, @created_by)`
  ),
  deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
  updateUserPassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
  updateUserRole: db.prepare('UPDATE users SET role = ? WHERE id = ?'),
  countUsers: db.prepare('SELECT COUNT(*) AS n FROM users'),
  countAdmins: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'"),

  // --- Devices ---
  getDevice: db.prepare('SELECT * FROM devices WHERE device_id = ?'),
  listDevices: db.prepare('SELECT * FROM devices ORDER BY display_name COLLATE NOCASE'),
  insertDevice: db.prepare(
    `INSERT INTO devices (device_id, display_name, first_seen, last_seen, last_atmega_online)
     VALUES (@device_id, @display_name, @first_seen, @last_seen, @last_atmega_online)`
  ),
  touchDevice: db.prepare(
    `UPDATE devices SET last_seen = @last_seen, last_atmega_online = @last_atmega_online
     WHERE device_id = @device_id`
  ),
  renameDevice: db.prepare('UPDATE devices SET display_name = ? WHERE device_id = ?'),
  updateDeviceDiagnostics: db.prepare(
    `UPDATE devices SET wifi_rssi = @wifi_rssi, free_heap = @free_heap,
        fw_version = @fw_version, esp_uptime_ms = @esp_uptime_ms,
        i2c_consec_fails = @i2c_consec_fails
     WHERE device_id = @device_id`
  ),
  setDeviceRecording: db.prepare(
    `UPDATE devices SET recording_enabled = @recording_enabled,
        active_session_id = @active_session_id, sample_interval_ms = @sample_interval_ms
     WHERE device_id = @device_id`
  ),
  updateDeviceSampleInterval: db.prepare(
    'UPDATE devices SET sample_interval_ms = ? WHERE device_id = ?'
  ),

  // --- Sessions ---
  insertSession: db.prepare(
    `INSERT INTO sessions (device_id, name, operator, notes, started_at, sample_interval_ms)
     VALUES (@device_id, @name, @operator, @notes, @started_at, @sample_interval_ms)`
  ),
  endSession: db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?'),
  getSession: db.prepare('SELECT * FROM sessions WHERE id = ?'),
  listSessions: db.prepare(
    'SELECT * FROM sessions WHERE device_id = ? ORDER BY started_at DESC LIMIT ?'
  ),
  countSessionReadings: db.prepare('SELECT COUNT(*) AS n FROM readings WHERE session_id = ?'),

  // --- Channel Configuration ---
  getChannelConfig: db.prepare(
    `SELECT * FROM channel_config
     WHERE device_id = ? AND channel_type = ? AND channel_num = ?`
  ),
  listChannelConfig: db.prepare('SELECT * FROM channel_config WHERE device_id = ?'),
  insertChannelConfig: db.prepare(
    `INSERT INTO channel_config
       (device_id, channel_type, channel_num, formula_params, master_enabled, display_name, unit)
     VALUES (@device_id, @channel_type, @channel_num, @formula_params, 0, @display_name, @unit)`
  ),
  updateFormula: db.prepare(
    `UPDATE channel_config SET formula_params = @formula_params
     WHERE device_id = @device_id AND channel_type = @channel_type AND channel_num = @channel_num`
  ),
  updateChannelMeta: db.prepare(
    `UPDATE channel_config
       SET display_name = @display_name, unit = @unit, enabled = @enabled
     WHERE device_id = @device_id AND channel_type = @channel_type AND channel_num = @channel_num`
  ),
  setChannelAlarm: db.prepare(
    `UPDATE channel_config
       SET alarm_enabled = @alarm_enabled, alarm_low = @alarm_low, alarm_high = @alarm_high
     WHERE device_id = @device_id AND channel_type = @channel_type AND channel_num = @channel_num`
  ),
  setMaster: db.prepare(
    `UPDATE channel_config
       SET master_reference_c = @master_reference_c,
           master_error_factor = @master_error_factor,
           master_set_at = @master_set_at,
           master_enabled = 1
     WHERE device_id = @device_id AND channel_type = @channel_type AND channel_num = @channel_num`
  ),
  clearMaster: db.prepare(
    `UPDATE channel_config
       SET master_reference_c = NULL,
           master_error_factor = NULL,
           master_set_at = NULL,
           master_enabled = 0
     WHERE device_id = @device_id AND channel_type = @channel_type AND channel_num = @channel_num`
  ),

  // --- Alarm Events ---
  insertAlarmEvent: db.prepare(
    `INSERT INTO alarm_events (device_id, channel_type, channel_num, ts, kind, value, threshold)
     VALUES (@device_id, @channel_type, @channel_num, @ts, @kind, @value, @threshold)`
  ),
  recentAlarmEvents: db.prepare(
    'SELECT * FROM alarm_events WHERE device_id = ? ORDER BY ts DESC, id DESC LIMIT ?'
  ),
  clearAlarmEvents: db.prepare('DELETE FROM alarm_events WHERE device_id = ?'),

  // --- Readings ---
  insertReading: db.prepare(
    `INSERT INTO readings
       (device_id, channel_type, channel_num, ts, rtc_time, rtc_date, raw_value,
        hw_available, fault, calculated_temp_c, master_temp_c, error_factor_at_time, session_id)
     VALUES
       (@device_id, @channel_type, @channel_num, @ts, @rtc_time, @rtc_date, @raw_value,
        @hw_available, @fault, @calculated_temp_c, @master_temp_c, @error_factor_at_time, @session_id)`
  ),
  latestReading: db.prepare(
    `SELECT * FROM readings
     WHERE device_id = ? AND channel_type = ? AND channel_num = ?
     ORDER BY ts DESC, id DESC LIMIT 1`
  ),
  latestReadingsForDevice: db.prepare(
    `SELECT r.* FROM readings r
     JOIN (
       SELECT channel_type, channel_num, MAX(id) AS max_id
       FROM readings WHERE device_id = ?
       GROUP BY channel_type, channel_num
     ) m ON r.id = m.max_id`
  ),
  recentReadings: db.prepare(
    `SELECT * FROM readings
     WHERE device_id = ? AND channel_type = ? AND channel_num = ?
     ORDER BY ts DESC, id DESC LIMIT ?`
  ),
  readingsForCsv: db.prepare(
    `SELECT * FROM readings
     WHERE device_id = ? AND channel_type = ? AND channel_num = ?
     ORDER BY ts ASC, id ASC`
  ),
  allReadingsForDevice: db.prepare(
    'SELECT * FROM readings WHERE device_id = ? ORDER BY ts ASC, id ASC'
  ),
  channelStats: db.prepare(
    `SELECT COUNT(calculated_temp_c) AS n,
            MIN(calculated_temp_c) AS min_c,
            MAX(calculated_temp_c) AS max_c,
            AVG(calculated_temp_c) AS avg_c
     FROM readings
     WHERE device_id = ? AND channel_type = ? AND channel_num = ? AND ts >= ?`
  ),
  channelValuesSince: db.prepare(
    `SELECT calculated_temp_c FROM readings
     WHERE device_id = ? AND channel_type = ? AND channel_num = ? AND ts >= ?
       AND calculated_temp_c IS NOT NULL`
  ),
  clearChannelLog: db.prepare(
    'DELETE FROM readings WHERE device_id = ? AND channel_type = ? AND channel_num = ?'
  ),
  clearDeviceLog: db.prepare('DELETE FROM readings WHERE device_id = ?'),
  clearAllReadings: db.prepare('DELETE FROM readings'),
  pruneOld: db.prepare('DELETE FROM readings WHERE ts < ?'),

  // --- S3 Archives ---
  insertArchive: db.prepare(
    `INSERT OR REPLACE INTO s3_archives
       (device_id, session_id, archive_key, filename, file_size_bytes, row_count, start_ts, end_ts, created_at)
     VALUES
       (@device_id, @session_id, @archive_key, @filename, @file_size_bytes, @row_count, @start_ts, @end_ts, @created_at)`
  ),
  listArchivesForDevice: db.prepare(
    'SELECT * FROM s3_archives WHERE device_id = ? ORDER BY created_at DESC'
  ),
  listAllArchives: db.prepare('SELECT * FROM s3_archives ORDER BY created_at DESC'),
  getArchiveById: db.prepare('SELECT * FROM s3_archives WHERE id = ?'),
  getArchiveByKey: db.prepare('SELECT * FROM s3_archives WHERE archive_key = ?'),
  deleteArchiveById: db.prepare('DELETE FROM s3_archives WHERE id = ?'),
  deleteArchivesForDevice: db.prepare('DELETE FROM s3_archives WHERE device_id = ?'),
  deleteAllArchives: db.prepare('DELETE FROM s3_archives'),
};

/**
 * Builds SQL WHERE clause and parameter array for reading deletion filters.
 * 
 * @param {Object} filters - Search parameters (device_id, channel_type, channel_num, start_date, end_date)
 * @returns {{whereSql: string, params: Array}} Formatted WHERE SQL string and values array
 */
function buildReadingFilterWhere(filters = {}) {
  const clauses = [];
  const params = [];

  if (filters.device_id && filters.device_id !== 'all') {
    clauses.push('device_id = ?');
    params.push(filters.device_id);
  }
  if (filters.channel_type && filters.channel_type !== 'all') {
    clauses.push('channel_type = ?');
    params.push(filters.channel_type);
  }
  if (filters.channel_num !== undefined && filters.channel_num !== null && filters.channel_num !== 'all') {
    clauses.push('channel_num = ?');
    params.push(Number(filters.channel_num));
  }
  if (filters.start_date) {
    clauses.push('ts >= ?');
    params.push(new Date(filters.start_date).toISOString());
  }
  if (filters.end_date) {
    clauses.push('ts <= ?');
    params.push(new Date(filters.end_date).toISOString());
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return { whereSql, params };
}

/**
 * Counts total readings matching target filter parameters.
 * 
 * @param {Object} filters - Filter criteria
 * @returns {number} Row count
 */
function countFilteredReadings(filters = {}) {
  const { whereSql, params } = buildReadingFilterWhere(filters);
  const row = db.prepare(`SELECT COUNT(*) AS n FROM readings ${whereSql}`).get(...params);
  return row ? row.n : 0;
}

/**
 * Deletes readings matching specified filter criteria.
 * 
 * @param {Object} filters - Filter criteria
 * @returns {number} Number of deleted rows
 */
function deleteFilteredReadings(filters = {}) {
  const { whereSql, params } = buildReadingFilterWhere(filters);
  const info = db.prepare(`DELETE FROM readings ${whereSql}`).run(...params);
  return info.changes;
}

/**
 * Truncates WAL and runs SQLite VACUUM to reclaim allocated disk storage space.
 */
function vacuumDatabase() {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.exec('VACUUM');
  } catch (e) {
    console.warn('[db] vacuum warning:', e.message);
  }
}

/**
 * Registers device if unknown or touches last_seen timestamp if existing.
 * 
 * @param {string} deviceId - Unique device identifier
 * @param {boolean} atmegaOnline - Hardware status flag
 * @returns {Object} Updated device database record
 */
function upsertDevice(deviceId, atmegaOnline) {
  const existing = stmts.getDevice.get(deviceId);
  const ts = nowIso();
  if (!existing) {
    stmts.insertDevice.run({
      device_id: deviceId,
      display_name: deviceId,
      first_seen: ts,
      last_seen: ts,
      last_atmega_online: atmegaOnline ? 1 : 0,
    });
    return stmts.getDevice.get(deviceId);
  }
  stmts.touchDevice.run({
    device_id: deviceId,
    last_seen: ts,
    last_atmega_online: atmegaOnline ? 1 : 0,
  });
  return stmts.getDevice.get(deviceId);
}

/**
 * Fetches existing channel configuration or initializes default settings if absent.
 * 
 * @param {string} deviceId - Target device identifier
 * @param {string} type - Channel type ('pt100' or 'tc')
 * @param {number} num - Channel index number
 * @returns {Object} Channel configuration database record
 */
function getOrCreateChannelConfig(deviceId, type, num) {
  let row = stmts.getChannelConfig.get(deviceId, type, num);
  if (!row) {
    const defaults =
      type === 'pt100' ? config.DEFAULT_PT100_PARAMS : config.DEFAULT_TC_PARAMS;
    stmts.insertChannelConfig.run({
      device_id: deviceId,
      channel_type: type,
      channel_num: num,
      formula_params: JSON.stringify(defaults),
      display_name: defaultChannelName(type, num),
      unit: '°C',
    });
    row = stmts.getChannelConfig.get(deviceId, type, num);
  }
  return row;
}

/**
 * Seeds initial administrator account from environment variables if no user accounts exist.
 */
function seedFirstAdmin() {
  if (stmts.countUsers.get().n > 0) return;
  const bcrypt = require('bcryptjs');
  const username = config.ADMIN_USER;
  const password = config.ADMIN_PASSWORD;
  stmts.insertUser.run({
    username,
    password_hash: bcrypt.hashSync(String(password), 10),
    role: 'admin',
    created_at: nowIso(),
    created_by: 'system',
  });
  console.log(`[auth] Seeded default administrator account: "${username}"`);
  if (password === 'admin') {
    console.warn('[auth] WARNING: Default admin password "admin" is active.');
  }
}
seedFirstAdmin();

module.exports = {
  db,
  stmts,
  nowIso,
  defaultChannelName,
  upsertDevice,
  getOrCreateChannelConfig,
  countFilteredReadings,
  deleteFilteredReadings,
  vacuumDatabase,
};