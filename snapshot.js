'use strict';

/**
 * @module snapshot
 * @description Device telemetry snapshot builder. Merges live memory cache values with stored database readings,
 * channel metadata, alarms, recording state, and hardware diagnostics into unified JSON payloads for frontend consumption.
 */

const config = require('./config');
const { stmts, defaultChannelName } = require('./db/db');
const live = require('./live');
const alarms = require('./alarms');
const { getRecordingState } = require('./recording');

/**
 * Checks whether an ISO timestamp is within the active stale threshold window.
 * 
 * @param {string} lastSeenIso - ISO date-time string
 * @returns {boolean} True if active
 */
function isActive(lastSeenIso) {
  return Date.now() - new Date(lastSeenIso).getTime() < config.STALE_MS;
}

/**
 * Constructs channel telemetry entry object, blending live memory cache with fallback DB readings.
 * 
 * @param {string} type - Channel type ('pt100' or 'tc')
 * @param {number} num - Channel index
 * @param {string} deviceId - Target device identifier
 * @param {Object|null} dbReading - Database reading record
 * @param {Object|null} cfg - Channel configuration record
 * @returns {Object} Complete channel state entry
 */
function channelEntry(type, num, deviceId, dbReading, cfg) {
  const liveVal = live.getChannel(deviceId, type, num);
  const src = liveVal || (dbReading ? dbReadingToEntry(type, num, dbReading, cfg) : null);
  const stale = src ? !isActive(src.ts) : true;

  const displayName =
    (cfg && cfg.display_name) || defaultChannelName(type, num);

  return {
    channel_type: type,
    channel_num: num,
    display_name: displayName,
    unit: (cfg && cfg.unit) || '°C',
    enabled: cfg ? cfg.enabled !== 0 : true,
    raw_value: src ? src.raw_value : null,
    hw_available: src ? src.hw_available : null,
    fault: src ? src.fault : null,
    calculated_temp_c: src ? src.calculated_temp_c : null,
    master_temp_c: src ? src.master_temp_c : null,
    error_factor: cfg && cfg.master_enabled ? cfg.master_error_factor : null,
    master_enabled: cfg ? !!cfg.master_enabled : false,
    alarm_enabled: cfg ? !!cfg.alarm_enabled : false,
    alarm_low: cfg ? cfg.alarm_low : null,
    alarm_high: cfg ? cfg.alarm_high : null,
    alarm_status: alarms.currentStatus(deviceId, type, num),
    ts: src ? src.ts : null,
    rtc_time: src ? src.rtc_time : null,
    rtc_date: src ? src.rtc_date : null,
    stale,
  };
}

/**
 * Converts raw database reading row to internal channel entry format.
 * 
 * @param {string} type - Channel type
 * @param {number} num - Channel index
 * @param {Object} r - Database reading record
 * @param {Object|null} cfg - Channel configuration record
 * @returns {Object} Internal entry object
 */
function dbReadingToEntry(type, num, r, cfg) {
  return {
    channel_type: type,
    channel_num: num,
    raw_value: r.raw_value,
    hw_available: r.hw_available == null ? null : !!r.hw_available,
    fault: r.fault == null ? null : !!r.fault,
    calculated_temp_c: r.calculated_temp_c,
    master_temp_c: r.master_temp_c,
    error_factor: cfg && cfg.master_enabled ? cfg.master_error_factor : null,
    ts: r.ts,
    rtc_time: r.rtc_time,
    rtc_date: r.rtc_date,
  };
}

/**
 * Assembles full telemetry snapshot for a device including PT100 and Thermocouple channels.
 * 
 * @param {string} deviceId - Target device identifier
 * @returns {Object|null} Complete device snapshot object or null if device not found
 */
function buildDeviceSnapshot(deviceId) {
  const device = stmts.getDevice.get(deviceId);
  if (!device) return null;

  const rows = stmts.latestReadingsForDevice.all(deviceId);
  const byKey = new Map();
  for (const r of rows) byKey.set(`${r.channel_type}:${r.channel_num}`, r);

  const pt100 = [];
  for (let n = 1; n <= config.PT100_CHANNELS; n++) {
    const cfg = stmts.getChannelConfig.get(deviceId, 'pt100', n);
    pt100.push(channelEntry('pt100', n, deviceId, byKey.get(`pt100:${n}`) || null, cfg));
  }
  const tc = [];
  for (let n = 1; n <= config.TC_CHANNELS; n++) {
    const cfg = stmts.getChannelConfig.get(deviceId, 'tc', n);
    tc.push(channelEntry('tc', n, deviceId, byKey.get(`tc:${n}`) || null, cfg));
  }

  const rec = getRecordingState(device);
  const diag = live.getDiagnostics(deviceId);

  return {
    device_id: device.device_id,
    display_name: device.display_name,
    active: isActive(device.last_seen),
    last_seen: device.last_seen,
    last_atmega_online: !!device.last_atmega_online,
    recording: rec.recording,
    session: rec.session,
    sample_interval_ms: device.sample_interval_ms,
    diagnostics: {
      wifi_rssi: diag.wifi_rssi ?? device.wifi_rssi ?? null,
      free_heap: diag.free_heap ?? device.free_heap ?? null,
      fw_version: diag.fw_version ?? device.fw_version ?? null,
      esp_uptime_ms: diag.esp_uptime_ms ?? device.esp_uptime_ms ?? null,
      i2c_consec_fails: diag.i2c_consec_fails ?? device.i2c_consec_fails ?? null,
      atmega_online: diag.atmega_online ?? !!device.last_atmega_online,
      atmega_status: diag.atmega_status ?? null,
    },
    pt100,
    tc,
  };
}

module.exports = { buildDeviceSnapshot, isActive, channelEntry };
