'use strict';

/**
 * @module alarms
 * @description In-memory state machine for per-channel threshold alarm evaluation.
 * Tracks state transitions ('normal' -> 'low' | 'high' -> 'clear') to emit alarm events
 * only when status changes, preventing redundant notifications.
 */

// In-memory state map: deviceId -> "type:num" -> 'normal' | 'low' | 'high'
const state = new Map();

/**
 * Gets or initializes the alarm state sub-map for a device.
 * 
 * @param {string} deviceId - Target device identifier
 * @returns {Map<string, string>} Channel status map
 */
function keyState(deviceId) {
  let m = state.get(deviceId);
  if (!m) {
    m = new Map();
    state.set(deviceId, m);
  }
  return m;
}

/**
 * Evaluates a value against alarm threshold configuration.
 * 
 * @param {number|null} value - Sensor measurement
 * @param {Object} cfg - Channel configuration object
 * @returns {'normal'|'low'|'high'|null} Evaluated alarm status
 */
function classify(value, cfg) {
  if (!cfg || !cfg.alarm_enabled || value == null || Number.isNaN(value)) return null;
  if (cfg.alarm_high != null && value > cfg.alarm_high) return 'high';
  if (cfg.alarm_low != null && value < cfg.alarm_low) return 'low';
  return 'normal';
}

/**
 * Evaluates channel reading and returns a state transition event if status changed.
 * 
 * @param {string} deviceId - Device identifier
 * @param {string} type - Channel type ('pt100' or 'tc')
 * @param {number} num - Channel index
 * @param {number} value - Temperature reading
 * @param {Object} cfg - Channel configuration
 * @returns {Object|null} Transition event object if state changed, else null
 */
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
    kind: status,
    value,
    threshold: status === 'high' ? cfg.alarm_high : cfg.alarm_low,
  };
}

/**
 * Returns current alarm status for a specific channel.
 * 
 * @param {string} deviceId - Device identifier
 * @param {string} type - Channel type
 * @param {number} num - Channel index
 * @returns {'normal'|'low'|'high'} Current alarm state
 */
function currentStatus(deviceId, type, num) {
  const m = state.get(deviceId);
  if (!m) return 'normal';
  return m.get(`${type}:${num}`) || 'normal';
}

module.exports = { classify, evaluate, currentStatus };
