'use strict';

const { Server } = require('socket.io');
const config = require('./config');
const { stmts } = require('./db/db');

let io = null;

function roomFor(deviceId) {
  return `device:${deviceId}`;
}

function init(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: '*' }, // trusted LAN; dashboard is unauthenticated by design
  });

  io.on('connection', (socket) => {
    // Client asks to follow a specific device's live stream.
    socket.on('subscribe', (deviceId) => {
      if (typeof deviceId === 'string' && deviceId) {
        socket.join(roomFor(deviceId));
      }
    });
    socket.on('unsubscribe', (deviceId) => {
      if (typeof deviceId === 'string' && deviceId) {
        socket.leave(roomFor(deviceId));
      }
    });
  });

  startStaleSweep();
  return io;
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

// Periodically emit online/offline transitions so the UI can flag "offline"
// even when no new ingest is arriving (§9).
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
  roomFor,
};
