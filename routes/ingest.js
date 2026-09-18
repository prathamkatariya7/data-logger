'use strict';

/**
 * @module routes/ingest
 * @description Ingestion API route for raw hardware telemetry POST payloads.
 * Performs temperature conversions, calibration calculations, alarm state evaluation,
 * decimation-gated storage, and WebSocket snapshot broadcasting.
 */

const express = require('express');
const config = require('../config');
const { stmts, upsertDevice, getOrCreateChannelConfig, nowIso, db } = require('../db/db');
const { calculateTemp } = require('../temperature');
const { applyCalibration } = require('../calibration');
const { buildDeviceSnapshot } = require('../snapshot');
const live = require('../live');
const alarms = require('../alarms');
const { getRecordingState, shouldStore } = require('../recording');
const realtime = require('../realtime');

const router = express.Router();

/**
 * Middleware validating optional X-Device-Key API header.
 * 
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware callback
 */
function checkApiKey(req, res, next) {
  if (!config.API_KEY) return next();
  if (req.get('X-Device-Key') === config.API_KEY) return next();
  return res.status(401).json({ error: 'invalid or missing X-Device-Key' });
}

/**
 * Normalizes input value to finite number or null.
 * 
 * @param {any} v - Input value
 * @returns {number|null} Parsed number or null
 */
function numeric(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * POST /api/ingest
 * Primary hardware ingestion endpoint receiving raw PT100 and TC sensor arrays.
 */
router.post('/ingest', checkApiKey, (req, res) => {
  const body = req.body || {};
  const deviceId = body.device_id;
  if (!deviceId || typeof deviceId !== 'string') {
    return res.status(400).json({ error: 'device_id required' });
  }

  const ts = nowIso();
  const rtc = body.rtc || {};
  const timeValid =
    body.time_valid !== undefined ? body.time_valid !== false : rtc.valid !== false;
  const devTime = timeValid ? body.time || rtc.time || null : null;
  const devDate = timeValid ? body.date || rtc.date || null : null;

  const isFirstSighting = !stmts.getDevice.get(deviceId);
  const device = upsertDevice(deviceId, !!body.atmega_online);

  // Update diagnostic metadata
  stmts.updateDeviceDiagnostics.run({
    device_id: deviceId,
    wifi_rssi: numeric(body.wifi_rssi),
    free_heap: numeric(body.free_heap),
    fw_version: body.fw_version != null ? String(body.fw_version) : null,
    esp_uptime_ms: numeric(body.esp_uptime_ms),
    i2c_consec_fails: numeric(body.i2c_consec_fails),
  });
  live.updateDiagnostics(deviceId, {
    wifi_rssi: numeric(body.wifi_rssi),
    free_heap: numeric(body.free_heap),
    fw_version: body.fw_version != null ? String(body.fw_version) : null,
    esp_uptime_ms: numeric(body.esp_uptime_ms),
    i2c_consec_fails: numeric(body.i2c_consec_fails),
    atmega_online: !!body.atmega_online,
    atmega_status: numeric(body.atmega_status),
  });

  const rec = getRecordingState(device);
  const recording = rec.recording;
  const sessionId = rec.session ? rec.session.id : null;
  const interval = rec.sample_interval_ms || config.SAMPLE_INTERVAL_MS;

  const alarmEvents = [];

  const processChannel = (type, num, entry) => {
    const cfg = getOrCreateChannelConfig(deviceId, type, num);
    const params = JSON.parse(cfg.formula_params);
    const rawValue = type === 'pt100' ? numeric(entry.raw_mV) : numeric(entry.raw12);
    const hwAvailable = type === 'pt100' ? entry.hw_available : null;
    const fault = type === 'tc' ? entry.fault : null;

    const usable =
      (type === 'pt100' ? hwAvailable !== false : fault !== true) && rawValue != null;
    const calculated = usable ? calculateTemp(type, rawValue, params) : null;
    const { masterTempC, errorFactorAtTime } = applyCalibration(calculated, cfg);

    // Update in-memory live channel cache
    live.updateChannel(deviceId, {
      channel_type: type,
      channel_num: num,
      raw_value: rawValue,
      hw_available: hwAvailable == null ? null : !!hwAvailable,
      fault: fault == null ? null : !!fault,
      calculated_temp_c: calculated,
      master_temp_c: masterTempC,
      error_factor: errorFactorAtTime,
      ts,
      rtc_time: devTime,
      rtc_date: devDate,
    });

    // Evaluate threshold alarms
    const ev = alarms.evaluate(deviceId, type, num, calculated, cfg);
    if (ev) alarmEvents.push({ ...ev, ts });

    // Persist reading if active recording session and interval decimation match
    if (recording && shouldStore(deviceId, type, num, interval)) {
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
        session_id: sessionId,
      });
    }
  };

  const tx = db.transaction(() => {
    const pt100 = Array.isArray(body.pt100) ? body.pt100 : [];
    pt100.forEach((entry, i) => {
      const num = entry.ch != null ? entry.ch : entry.channel != null ? entry.channel : i + 1;
      if (num >= 1 && num <= config.PT100_CHANNELS) processChannel('pt100', num, entry);
    });
    const tc = Array.isArray(body.tc) ? body.tc : [];
    tc.forEach((entry, i) => {
      const num = entry.ch != null ? entry.ch : entry.channel != null ? entry.channel : i + 1;
      if (num >= 1 && num <= config.TC_CHANNELS) processChannel('tc', num, entry);
    });

    // Save alarm events
    for (const ev of alarmEvents) {
      stmts.insertAlarmEvent.run({
        device_id: ev.device_id,
        channel_type: ev.channel_type,
        channel_num: ev.channel_num,
        ts: ev.ts,
        kind: ev.kind,
        value: ev.value,
        threshold: ev.threshold,
      });
    }
  });
  tx();

  // Broadcast real-time updates over WebSocket
  const snapshot = buildDeviceSnapshot(deviceId);
  realtime.broadcastSnapshot(deviceId, snapshot);
  for (const ev of alarmEvents) realtime.broadcastAlarm(deviceId, ev);
  if (isFirstSighting) realtime.broadcastDeviceList();

  res.json({ ok: true, recording, session_id: sessionId });
});

module.exports = router;
