'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const config = require('../config');

// Ensure data dir exists.
fs.mkdirSync(path.dirname(config.DB_PATH), { recursive: true });

const db = new Database(config.DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Apply schema.
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

function nowIso() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Prepared statements
// ---------------------------------------------------------------------------
const stmts = {
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

  getChannelConfig: db.prepare(
    `SELECT * FROM channel_config
     WHERE device_id = ? AND channel_type = ? AND channel_num = ?`
  ),
  insertChannelConfig: db.prepare(
    `INSERT INTO channel_config
       (device_id, channel_type, channel_num, formula_params, master_enabled)
     VALUES (@device_id, @channel_type, @channel_num, @formula_params, 0)`
  ),
  updateFormula: db.prepare(
    `UPDATE channel_config SET formula_params = @formula_params
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

  insertReading: db.prepare(
    `INSERT INTO readings
       (device_id, channel_type, channel_num, ts, rtc_time, rtc_date, raw_value,
        hw_available, fault, calculated_temp_c, master_temp_c, error_factor_at_time)
     VALUES
       (@device_id, @channel_type, @channel_num, @ts, @rtc_time, @rtc_date, @raw_value,
        @hw_available, @fault, @calculated_temp_c, @master_temp_c, @error_factor_at_time)`
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
    `SELECT * FROM readings WHERE device_id = ? ORDER BY ts ASC, id ASC`
  ),
  clearChannelLog: db.prepare(
    `DELETE FROM readings WHERE device_id = ? AND channel_type = ? AND channel_num = ?`
  ),
  clearDeviceLog: db.prepare('DELETE FROM readings WHERE device_id = ?'),
  pruneOld: db.prepare('DELETE FROM readings WHERE ts < ?'),
};

// ---------------------------------------------------------------------------
// Higher-level helpers
// ---------------------------------------------------------------------------

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

// Lazily create a channel_config row with defaults if absent (§4.2).
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
    });
    row = stmts.getChannelConfig.get(deviceId, type, num);
  }
  return row;
}

module.exports = {
  db,
  stmts,
  nowIso,
  upsertDevice,
  getOrCreateChannelConfig,
};
