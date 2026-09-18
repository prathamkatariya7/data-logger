'use strict';

/**
 * @module realtime
 * @description Socket.IO WebSocket server manager for live telemetry streaming, device status tracking,
 * alarm event broadcasting, and subscription room management.
 */

const { Server } = require('socket.io');
const config = require('./config');
const { stmts } = require('./db/db');
const { verifyToken } = require('./auth-util');

let io = null;

/**
 * Generates Socket.IO room identifier string for a device.
 * 
 * @param {string} deviceId - Target device identifier
 * @returns {string} Room name
 */
function roomFor(deviceId) {
  return `device:${deviceId}`;
}

/**
 * Parses HTTP cookie header string into key-value map.
 * 
 * @param {string} str - Raw cookie string
 * @returns {Object<string, string>} Key-value cookie dictionary
 */
function parseCookie(str) {
  const out = {};
  str.split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

/**
 * Initializes Socket.IO server on top of HTTP server, attaches auth middleware, and binds event handlers.
 * 
 * @param {Object} httpServer - Node.js HTTP server instance
 * @returns {Object} Socket.IO Server instance
 */
function init(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: '*' },
  });

  // Verify JWT authentication on connection handshake
  io.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        parseCookie(socket.handshake.headers.cookie || '').dl_token;
      if (token && verifyToken(token)) return next();
    } catch (_) { /* authentication error fallback */ }
    return next(new Error('unauthorized'));
  });

  io.on('connection', (socket) => {
    socket.on('subscribe', (deviceId) => {
      if (typeof deviceId === 'string' && deviceId) socket.join(roomFor(deviceId));
    });
    socket.on('unsubscribe', (deviceId) => {
      if (typeof deviceId === 'string' && deviceId) socket.leave(roomFor(deviceId));
    });
  });

  startStaleSweep();
  return io;
}

/**
 * Broadcasts converted telemetry snapshot to subscribers of a device room.
 * 
 * @param {string} deviceId - Target device identifier
 * @param {Object} snapshot - Telemetry snapshot object
 */
function broadcastSnapshot(deviceId, snapshot) {
  if (!io) return;
  io.to(roomFor(deviceId)).emit('device:update', snapshot);
}

/**
 * Broadcasts device list modification event to all connected clients.
 */
function broadcastDeviceList() {
  if (!io) return;
  io.emit('devices:changed');
}

/**
 * Broadcasts threshold alarm transition event to device room subscribers.
 * 
 * @param {string} deviceId - Target device identifier
 * @param {Object} event - Alarm transition event payload
 */
function broadcastAlarm(deviceId, event) {
  if (!io) return;
  io.to(roomFor(deviceId)).emit('alarm:event', event);
}

/**
 * Broadcasts recording state changes (start/stop) to device room subscribers.
 * 
 * @param {string} deviceId - Target device identifier
 * @param {Object} state - Recording session state
 */
function broadcastRecording(deviceId, state) {
  if (!io) return;
  io.to(roomFor(deviceId)).emit('device:recording', { device_id: deviceId, ...state });
}

let staleTimer = null;

/**
 * Periodically broadcasts device active/inactive status based on stale threshold.
 */
function startStaleSweep() {
  if (staleTimer) clearInterval(staleTimer);
  staleTimer = setInterval(() => {
    if (!io) return;
    const now = Date.now();
    const devices = stmts.listDevices.all();
    for (const d of devices) {
      const lastSeen = new Date(d.last_seen).getTime();
      const active = now - lastSeen < config.STALE_MS;
      io.to(roomFor(d.device_id)).emit('device:status', {
        device_id: d.device_id,
        active,
        last_seen: d.last_seen,
      });
    }
  }, config.STALE_SWEEP_MS);
  staleTimer.unref?.();
}

module.exports = {
  init,
  broadcastSnapshot,
  broadcastDeviceList,
  broadcastAlarm,
  broadcastRecording,
  roomFor,
};
