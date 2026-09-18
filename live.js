'use strict';

/**
 * @module live
 * @description In-memory live readings and diagnostics cache.
 * Preserves active measurement state per channel regardless of recording session status,
 * ensuring real-time dashboard responsiveness while minimizing database write frequency.
 */

// In-memory cache structure: deviceId -> { channels: Map, diagnostics: Object, updatedAt: number }
const cache = new Map();

/**
 * Ensures cache entry existence for a given device.
 * 
 * @param {string} deviceId - Target device identifier
 * @returns {Object} Cache entry object
 */
function ensure(deviceId) {
  let d = cache.get(deviceId);
  if (!d) {
    d = { channels: new Map(), diagnostics: {}, updatedAt: 0 };
    cache.set(deviceId, d);
  }
  return d;
}

/**
 * Updates channel live telemetry cache record.
 * 
 * @param {string} deviceId - Device identifier
 * @param {Object} entry - Live channel reading entry
 */
function updateChannel(deviceId, entry) {
  const d = ensure(deviceId);
  d.channels.set(`${entry.channel_type}:${entry.channel_num}`, entry);
  d.updatedAt = Date.now();
}

/**
 * Updates device system diagnostics cache.
 * 
 * @param {string} deviceId - Device identifier
 * @param {Object} diag - Diagnostics object
 */
function updateDiagnostics(deviceId, diag) {
  const d = ensure(deviceId);
  d.diagnostics = { ...d.diagnostics, ...diag };
  d.updatedAt = Date.now();
}

/**
 * Retrieves latest cached live reading for a channel.
 * 
 * @param {string} deviceId - Device identifier
 * @param {string} type - Channel type ('pt100' or 'tc')
 * @param {number} num - Channel index
 * @returns {Object|null} Cached channel measurement or null
 */
function getChannel(deviceId, type, num) {
  const d = cache.get(deviceId);
  if (!d) return null;
  return d.channels.get(`${type}:${num}`) || null;
}

/**
 * Retrieves cached diagnostics for a device.
 * 
 * @param {string} deviceId - Device identifier
 * @returns {Object} Cached diagnostics object
 */
function getDiagnostics(deviceId) {
  const d = cache.get(deviceId);
  return d ? d.diagnostics : {};
}

module.exports = { updateChannel, updateDiagnostics, getChannel, getDiagnostics };
