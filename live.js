'use strict';

// In-memory "live" cache. Updated on EVERY ingest regardless of recording
// state, so the dashboard/charts keep updating even when recording is stopped
// (and therefore nothing is being written to the readings table). This is the
// core of "minimize storage without a blank UI".
//
// Shape per device:
//   {
//     channels: Map<"type:num", { channel_type, channel_num, raw_value,
//                                 hw_available, fault, calculated_temp_c,
//                                 master_temp_c, error_factor, ts,
//                                 rtc_time, rtc_date }>,
//     diagnostics: { wifi_rssi, free_heap, fw_version, esp_uptime_ms,
//                    i2c_consec_fails, atmega_online, atmega_status },
//     updatedAt: epoch ms
//   }

const cache = new Map();

function ensure(deviceId) {
  let d = cache.get(deviceId);
  if (!d) {
    d = { channels: new Map(), diagnostics: {}, updatedAt: 0 };
    cache.set(deviceId, d);
  }
  return d;
}

function updateChannel(deviceId, entry) {
  const d = ensure(deviceId);
  d.channels.set(`${entry.channel_type}:${entry.channel_num}`, entry);
  d.updatedAt = Date.now();
}

function updateDiagnostics(deviceId, diag) {
  const d = ensure(deviceId);
  d.diagnostics = { ...d.diagnostics, ...diag };
  d.updatedAt = Date.now();
}

function getChannel(deviceId, type, num) {
  const d = cache.get(deviceId);
  if (!d) return null;
  return d.channels.get(`${type}:${num}`) || null;
}

function getDiagnostics(deviceId) {
  const d = cache.get(deviceId);
  return d ? d.diagnostics : {};
}

module.exports = { updateChannel, updateDiagnostics, getChannel, getDiagnostics };
