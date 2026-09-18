'use strict';

/**
 * @module recording
 * @description Recording session lifecycle manager and sample decimation gate.
 * Manages start/stop session states and sample storage throttling (sample_interval_ms).
 */

const { stmts, nowIso } = require('./db/db');
const config = require('./config');

// In-memory throttling map: deviceId -> "type:num" -> last stored timestamp (epoch ms)
const lastStored = new Map();

/**
 * Validates and clamps storage interval bounds.
 * 
 * @param {number|string} v - Target sample interval in milliseconds
 * @returns {number} Clamped interval value
 */
function clampInterval(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < 100) return config.SAMPLE_INTERVAL_MS;
  return Math.min(n, 3600000);
}

/**
 * Opens a new recording session for a device and enables database logging.
 * 
 * @param {string} deviceId - Target device identifier
 * @param {Object} [options] - Session parameters (name, operator, notes, sample_interval_ms)
 * @returns {Object|null} Created session record or null if device not found
 */
function startSession(deviceId, { name, operator, notes, sample_interval_ms } = {}) {
  const device = stmts.getDevice.get(deviceId);
  if (!device) return null;

  if (device.active_session_id) {
    stmts.endSession.run(nowIso(), device.active_session_id);
  }

  const interval = clampInterval(sample_interval_ms ?? device.sample_interval_ms);
  const info = stmts.insertSession.run({
    device_id: deviceId,
    name: (name && String(name).trim()) || `Session ${nowIso()}`,
    operator: operator ? String(operator).trim() : null,
    notes: notes ? String(notes).trim() : null,
    started_at: nowIso(),
    sample_interval_ms: interval,
  });
  const sessionId = info.lastInsertRowid;

  stmts.setDeviceRecording.run({
    device_id: deviceId,
    recording_enabled: 1,
    active_session_id: sessionId,
    sample_interval_ms: interval,
  });
  lastStored.delete(deviceId);
  return stmts.getSession.get(sessionId);
}

/**
 * Ends active recording session for a device and disables database logging.
 * 
 * @param {string} deviceId - Target device identifier
 * @returns {Object|null} Closed session record or null
 */
function stopSession(deviceId) {
  const device = stmts.getDevice.get(deviceId);
  if (!device) return null;
  const sessionId = device.active_session_id;
  if (sessionId) stmts.endSession.run(nowIso(), sessionId);
  stmts.setDeviceRecording.run({
    device_id: deviceId,
    recording_enabled: 0,
    active_session_id: null,
    sample_interval_ms: device.sample_interval_ms,
  });
  lastStored.delete(deviceId);
  return sessionId ? stmts.getSession.get(sessionId) : null;
}

/**
 * Retrieves current recording session status for a device.
 * 
 * @param {Object|string} deviceOrId - Device record or device identifier string
 * @returns {{recording: boolean, session: Object|null, sample_interval_ms: number}} Recording state object
 */
function getRecordingState(deviceOrId) {
  const device =
    typeof deviceOrId === 'string' ? stmts.getDevice.get(deviceOrId) : deviceOrId;
  if (!device) return { recording: false, session: null, sample_interval_ms: config.SAMPLE_INTERVAL_MS };
  const session = device.active_session_id
    ? stmts.getSession.get(device.active_session_id)
    : null;
  return {
    recording: !!device.recording_enabled,
    session,
    sample_interval_ms: device.sample_interval_ms,
  };
}

/**
 * Decimation gate helper: returns true if sample is due to be persisted to DB.
 * 
 * @param {string} deviceId - Target device identifier
 * @param {string} type - Channel type ('pt100' or 'tc')
 * @param {number} num - Channel index
 * @param {number} intervalMs - Configured sample interval
 * @returns {boolean} True if measurement should be saved to database
 */
function shouldStore(deviceId, type, num, intervalMs) {
  const now = Date.now();
  let byChannel = lastStored.get(deviceId);
  if (!byChannel) {
    byChannel = new Map();
    lastStored.set(deviceId, byChannel);
  }
  const key = `${type}:${num}`;
  const last = byChannel.get(key) || 0;
  if (now - last >= (intervalMs || config.SAMPLE_INTERVAL_MS)) {
    byChannel.set(key, now);
    return true;
  }
  return false;
}

module.exports = {
  startSession,
  stopSession,
  getRecordingState,
  shouldStore,
  clampInterval,
};
