'use strict';

const express = require('express');
const config = require('../config');
const { stmts, upsertDevice, getOrCreateChannelConfig, nowIso } = require('../db/db');
const { calculateTemp } = require('../temperature');
const { applyCalibration } = require('../calibration');
const { buildDeviceSnapshot } = require('../snapshot');
const realtime = require('../realtime');

const router = express.Router();

// Optional API key gate (X-Device-Key). Only guards ingest, never the dashboard.
function checkApiKey(req, res, next) {
  if (!config.API_KEY) return next();
  if (req.get('X-Device-Key') === config.API_KEY) return next();
  return res.status(401).json({ error: 'invalid or missing X-Device-Key' });
}

// POST /api/ingest — contract unchanged from the original firmware.
// Body: { device_id, atmega_online, atmega_status, atmega_uptime_ms,
//         esp_uptime_ms, rtc:{time,date,valid}, pt100:[...], tc:[...] }
router.post('/ingest', checkApiKey, (req, res) => {
  const body = req.body || {};
  const deviceId = body.device_id;
  if (!deviceId || typeof deviceId !== 'string') {
    return res.status(400).json({ error: 'device_id required' });
  }

  const ts = nowIso();
  // Device timestamp: v7 firmware sends NTP time at the top level (time/date).
  // Fall back to the legacy nested `rtc` object for older firmware.
  const rtc = body.rtc || {};
  const timeValid =
    body.time_valid !== undefined ? body.time_valid !== false : rtc.valid !== false;
  const devTime = timeValid ? body.time || rtc.time || null : null;
  const devDate = timeValid ? body.date || rtc.date || null : null;

  const isFirstSighting = !stmts.getDevice.get(deviceId);
  upsertDevice(deviceId, !!body.atmega_online);

  const insertChannel = (type, num, entry) => {
    const cfg = getOrCreateChannelConfig(deviceId, type, num);
    const params = JSON.parse(cfg.formula_params);
    const rawValue =
      type === 'pt100'
        ? numeric(entry.raw_mV)
        : numeric(entry.raw12);
    const hwAvailable = type === 'pt100' ? entry.hw_available : null;
    const fault = type === 'tc' ? entry.fault : null;

    // Don't compute a temp for unavailable / faulted channels.
    const usable =
      (type === 'pt100' ? hwAvailable !== false : fault !== true) && rawValue != null;
    const calculated = usable ? calculateTemp(type, rawValue, params) : null;
    const { masterTempC, errorFactorAtTime } = applyCalibration(calculated, cfg);

    stmts.insertReading.run({
      device_id: deviceId,
      channel_type: type,
      channel_num: num,
      ts,
      rtc_time: devTime,
      rtc_date: devDate,
      raw_value: rawValue,
      hw_available: hwAvailable == null ? null : hwAvailable ? 1 : 0,
      fault: fault == null ? null : fault ? 1 : 0,
      calculated_temp_c: calculated,
      master_temp_c: masterTempC,
      error_factor_at_time: errorFactorAtTime,
    });
  };

  const tx = require('../db/db').db.transaction(() => {
    const pt100 = Array.isArray(body.pt100) ? body.pt100 : [];
    pt100.forEach((entry, i) => {
      const num = entry.ch != null ? entry.ch : entry.channel != null ? entry.channel : i + 1;
      if (num >= 1 && num <= config.PT100_CHANNELS) insertChannel('pt100', num, entry);
    });
    const tc = Array.isArray(body.tc) ? body.tc : [];
    tc.forEach((entry, i) => {
      const num = entry.ch != null ? entry.ch : entry.channel != null ? entry.channel : i + 1;
      if (num >= 1 && num <= config.TC_CHANNELS) insertChannel('tc', num, entry);
    });
  });
  tx();

  // Push live snapshot to subscribers (§7 step 5).
  const snapshot = buildDeviceSnapshot(deviceId);
  realtime.broadcastSnapshot(deviceId, snapshot);
  if (isFirstSighting) realtime.broadcastDeviceList();

  res.json({ ok: true });
});

function numeric(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

module.exports = router;
