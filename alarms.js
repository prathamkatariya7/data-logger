'use strict';

// Threshold alarms. Pure evaluation + a small in-memory per-channel state
// machine so we only log/broadcast on transitions (normal -> alarm -> clear),
// not on every reading while a channel stays out of range.

// device_id -> "type:num" -> 'normal' | 'low' | 'high'
const state = new Map();

function keyState(deviceId) {
  let m = state.get(deviceId);
  if (!m) {
    m = new Map();
    state.set(deviceId, m);
  }
  return m;
}

// Given the latest calculated value and the channel's alarm config, decide the
// new alarm status. Returns 'normal' | 'low' | 'high' | null (null = no alarm
// configured / no value).
function classify(value, cfg) {
  if (!cfg || !cfg.alarm_enabled || value == null || Number.isNaN(value)) return null;
  if (cfg.alarm_high != null && value > cfg.alarm_high) return 'high';
  if (cfg.alarm_low != null && value < cfg.alarm_low) return 'low';
  return 'normal';
}

// Evaluate a channel and, if the alarm status changed, return a transition
// event describing it (else null). `cfg` is a channel_config row.
function evaluate(deviceId, type, num, value, cfg) {
  const status = classify(value, cfg);
  if (status == null) return null;

  const m = keyState(deviceId);
  const key = `${type}:${num}`;
  const prev = m.get(key) || 'normal';
  if (status === prev) return null;

  m.set(key, status);

  if (status === 'normal') {
    return {
      device_id: deviceId,
      channel_type: type,
      channel_num: num,
      kind: 'clear',
      value,
      threshold: null,
    };
  }
  return {
    device_id: deviceId,
    channel_type: type,
    channel_num: num,
    kind: status, // 'low' | 'high'
    value,
    threshold: status === 'high' ? cfg.alarm_high : cfg.alarm_low,
  };
}

// Current live alarm status for a channel (for snapshot rendering).
function currentStatus(deviceId, type, num) {
  const m = state.get(deviceId);
  if (!m) return 'normal';
  return m.get(`${type}:${num}`) || 'normal';
}

module.exports = { classify, evaluate, currentStatus };
