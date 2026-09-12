'use strict';

const { Server } = require('socket.io');
const config = require('./config');
const { stmts } = require('./db/db');
const { verifyToken } = require('./auth-util');

let io = null;

function roomFor(deviceId) {
  return `device:${deviceId}`;
}

function init(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: '*' }, // trusted LAN; dashboard auth (if enabled) gates HTTP + WS
  });

  // Auth is always on: require a valid token on the socket handshake.
  io.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        parseCookie(socket.handshake.headers.cookie || '').dl_token;
      if (token && verifyToken(token)) return next();
    } catch (_) { /* fall through */ }
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

function parseCookie(str) {
  const out = {};
  str.split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

// Push a fresh converted snapshot to everyone watching this device.
function broadcastSnapshot(deviceId, snapshot) {
  if (!io) return;
  io.to(roomFor(deviceId)).emit('device:update', snapshot);
}

// Notify all clients that the device list changed (new device, rename).
function broadcastDeviceList() {
  if (!io) return;
  io.emit('devices:changed');
}

// Push an alarm transition event.
function broadcastAlarm(deviceId, event) {
  if (!io) return;
  io.to(roomFor(deviceId)).emit('alarm:event', event);
}

// Push a recording state change (start/stop).
function broadcastRecording(deviceId, state) {
  if (!io) return;
  io.to(roomFor(deviceId)).emit('device:recording', { device_id: deviceId, ...state });
}

// Periodically emit online/offline transitions so the UI can flag "offline"
// even when no new ingest is arriving.
let staleTimer = null;
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
