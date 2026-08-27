'use strict';

const config = require('./config');
const { stmts } = require('./db/db');

function isActive(lastSeenIso) {
  return Date.now() - new Date(lastSeenIso).getTime() < config.STALE_MS;
}

// Build one channel entry from a reading row + its config row.
function channelEntry(type, num, reading, cfg) {
  const stale = reading ? !isActive(reading.ts) : true;
  return {
    channel_type: type,
    channel_num: num,
    raw_value: reading ? reading.raw_value : null,
    hw_available: reading ? !!reading.hw_available : null,
    fault: reading ? !!reading.fault : null,
    calculated_temp_c: reading ? reading.calculated_temp_c : null,
    master_temp_c: reading ? reading.master_temp_c : null,
    error_factor: cfg && cfg.master_enabled ? cfg.master_error_factor : null,
    master_enabled: cfg ? !!cfg.master_enabled : false,
    ts: reading ? reading.ts : null,
    rtc_time: reading ? reading.rtc_time : null,
    rtc_date: reading ? reading.rtc_date : null,
    stale,
  };
}

// Full converted snapshot for a device: metadata + every channel's latest state.
// Used by GET /api/devices/:id/data and pushed over Socket.IO on each ingest.
function buildDeviceSnapshot(deviceId) {
  const device = stmts.getDevice.get(deviceId);
  if (!device) return null;

  const rows = stmts.latestReadingsForDevice.all(deviceId);
  const byKey = new Map();
  for (const r of rows) byKey.set(`${r.channel_type}:${r.channel_num}`, r);

  const pt100 = [];
  for (let n = 1; n <= config.PT100_CHANNELS; n++) {
    const cfg = stmts.getChannelConfig.get(deviceId, 'pt100', n);
    pt100.push(channelEntry('pt100', n, byKey.get(`pt100:${n}`) || null, cfg));
  }
  const tc = [];
  for (let n = 1; n <= config.TC_CHANNELS; n++) {
    const cfg = stmts.getChannelConfig.get(deviceId, 'tc', n);
    tc.push(channelEntry('tc', n, byKey.get(`tc:${n}`) || null, cfg));
  }

  return {
    device_id: device.device_id,
    display_name: device.display_name,
    active: isActive(device.last_seen),
    last_seen: device.last_seen,
    last_atmega_online: !!device.last_atmega_online,
    pt100,
    tc,
  };
}

module.exports = { buildDeviceSnapshot, isActive, channelEntry };
