'use strict';

// Recording sessions + storage-rate (decimation) gate.
//
// A device only persists readings to the DB while recording_enabled = 1. Each
// Start opens a `sessions` row; each Stop closes it. The storage-rate gate
// throttles how often a given channel is written (sample_interval_ms), so a
// 1 Hz firmware can be logged at, say, 1 sample / 10 s to save space.

const { stmts, nowIso } = require('./db/db');
const config = require('./config');

// device_id -> "type:num" -> last stored epoch ms (in-memory; reset on restart)
const lastStored = new Map();

function startSession(deviceId, { name, operator, notes, sample_interval_ms } = {}) {
  const device = stmts.getDevice.get(deviceId);
  if (!device) return null;

  // Close any dangling active session first (defensive).
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
  lastStored.delete(deviceId); // fresh throttle window for the new session
  return stmts.getSession.get(sessionId);
}

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

function getRecordingState(deviceOrId) {
  const device =
    typeof deviceOrId === 'string' ? stmts.getDevice.get(deviceOrId) : deviceOrId;
  if (!device) return { recording: false, session: null };
  const session = device.active_session_id
    ? stmts.getSession.get(device.active_session_id)
    : null;
  return {
    recording: !!device.recording_enabled,
    session,
    sample_interval_ms: device.sample_interval_ms,
  };
}

// Storage-rate gate: returns true if this channel is due to be written now.
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

function clampInterval(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < 100) return config.SAMPLE_INTERVAL_MS;
  return Math.min(n, 3600000); // cap at 1 hour
}

module.exports = {
  startSession,
  stopSession,
  getRecordingState,
  shouldStore,
  clampInterval,
};
