'use strict';

const express = require('express');
const config = require('../config');
const { stmts, getOrCreateChannelConfig, nowIso, db } = require('../db/db');
const { calculateTemp } = require('../temperature');
const { computeErrorFactor } = require('../calibration');
const { buildDeviceSnapshot } = require('../snapshot');
const realtime = require('../realtime');

const router = express.Router({ mergeParams: true });

const PT100_KEYS = ['R0', 'RA', 'RC', 'R1', 'RF', 'VDC', 'ALPHA'];

// Validate :type and :num, return { type, num } or send 400.
function parseChannel(req, res) {
  const type = req.params.type;
  const num = parseInt(req.params.num, 10);
  if (type !== 'pt100' && type !== 'tc') {
    res.status(400).json({ error: 'type must be pt100 or tc' });
    return null;
  }
  const max = type === 'pt100' ? config.PT100_CHANNELS : config.TC_CHANNELS;
  if (!Number.isInteger(num) || num < 1 || num > max) {
    res.status(400).json({ error: `channel_num for ${type} must be 1..${max}` });
    return null;
  }
  return { type, num };
}

function ensureDevice(req, res) {
  const device = stmts.getDevice.get(req.params.id);
  if (!device) {
    res.status(404).json({ error: 'device not found' });
    return null;
  }
  return device;
}

// GET /api/devices/:id/channels/:type/:num — config + master state + latest reading (R4/R5 initial load).
router.get('/:type/:num', (req, res) => {
  if (!ensureDevice(req, res)) return;
  const ch = parseChannel(req, res);
  if (!ch) return;

  const cfg = getOrCreateChannelConfig(req.params.id, ch.type, ch.num);
  const latest = stmts.latestReading.get(req.params.id, ch.type, ch.num) || null;

  res.json({
    device_id: req.params.id,
    channel_type: ch.type,
    channel_num: ch.num,
    display_name: cfg.display_name || (ch.type === 'pt100' ? `PT100_${ch.num}` : `TC_${ch.num}`),
    unit: cfg.unit || '°C',
    enabled: cfg.enabled !== 0,
    alarm: {
      enabled: !!cfg.alarm_enabled,
      low: cfg.alarm_low,
      high: cfg.alarm_high,
    },
    formula_params: JSON.parse(cfg.formula_params),
    master: {
      enabled: !!cfg.master_enabled,
      reference_c: cfg.master_reference_c,
      error_factor: cfg.master_error_factor,
      set_at: cfg.master_set_at,
    },
    latest: latest
      ? {
          raw_value: latest.raw_value,
          calculated_temp_c: latest.calculated_temp_c,
          master_temp_c: latest.master_temp_c,
          hw_available: latest.hw_available == null ? null : !!latest.hw_available,
          fault: latest.fault == null ? null : !!latest.fault,
          ts: latest.ts,
        }
      : null,
  });
});

// PUT .../formula — update formula params (R4).
router.put('/:type/:num/formula', (req, res) => {
  if (!ensureDevice(req, res)) return;
  const ch = parseChannel(req, res);
  if (!ch) return;

  const cfg = getOrCreateChannelConfig(req.params.id, ch.type, ch.num);
  const current = JSON.parse(cfg.formula_params);
  const body = req.body || {};

  let next;
  if (ch.type === 'pt100') {
    next = { ...current };
    for (const k of PT100_KEYS) {
      if (body[k] !== undefined) {
        const v = Number(body[k]);
        if (!Number.isFinite(v)) return res.status(400).json({ error: `${k} must be numeric` });
        next[k] = v;
      }
    }
  } else {
    next = { ...current };
    if (body.slope !== undefined) {
      const v = Number(body.slope);
      if (!Number.isFinite(v)) return res.status(400).json({ error: 'slope must be numeric' });
      next.slope = v;
    }
  }

  stmts.updateFormula.run({
    device_id: req.params.id,
    channel_type: ch.type,
    channel_num: ch.num,
    formula_params: JSON.stringify(next),
  });

  // Note: error_factor is intentionally NOT recomputed here (§6). Master stays
  // anchored as calculated + fixed offset; recalibration is explicit.
  realtime.broadcastSnapshot(req.params.id, buildDeviceSnapshot(req.params.id));
  res.json({ formula_params: next, master_recalibration_recommended: !!cfg.master_enabled });
});

// PUT .../master — set master calibration (R5).
// Body: { reference_c }. Server computes error_factor from the latest calculated value.
router.put('/:type/:num/master', (req, res) => {
  if (!ensureDevice(req, res)) return;
  const ch = parseChannel(req, res);
  if (!ch) return;

  const referenceC = Number(req.body && req.body.reference_c);
  if (!Number.isFinite(referenceC)) {
    return res.status(400).json({ error: 'reference_c must be numeric' });
  }

  const cfg = getOrCreateChannelConfig(req.params.id, ch.type, ch.num);
  const latest = stmts.latestReading.get(req.params.id, ch.type, ch.num);

  // Prefer the latest stored calculated value; recompute from raw as fallback.
  let calculatedNow = latest ? latest.calculated_temp_c : null;
  if (calculatedNow == null && latest && latest.raw_value != null) {
    calculatedNow = calculateTemp(ch.type, latest.raw_value, JSON.parse(cfg.formula_params));
  }
  if (calculatedNow == null) {
    return res
      .status(409)
      .json({ error: 'no live calculated value yet — wait for a reading before calibrating' });
  }

  const errorFactor = computeErrorFactor(referenceC, calculatedNow);
  stmts.setMaster.run({
    device_id: req.params.id,
    channel_type: ch.type,
    channel_num: ch.num,
    master_reference_c: referenceC,
    master_error_factor: errorFactor,
    master_set_at: nowIso(),
  });

  realtime.broadcastSnapshot(req.params.id, buildDeviceSnapshot(req.params.id));
  res.json({
    enabled: true,
    reference_c: referenceC,
    calculated_at_calibration: calculatedNow,
    error_factor: errorFactor,
  });
});

// DELETE .../master — clear master calibration (R6).
router.delete('/:type/:num/master', (req, res) => {
  if (!ensureDevice(req, res)) return;
  const ch = parseChannel(req, res);
  if (!ch) return;

  getOrCreateChannelConfig(req.params.id, ch.type, ch.num);
  stmts.clearMaster.run({
    device_id: req.params.id,
    channel_type: ch.type,
    channel_num: ch.num,
  });
  realtime.broadcastSnapshot(req.params.id, buildDeviceSnapshot(req.params.id));
  res.json({ enabled: false });
});

// GET .../readings?limit=N — recent readings for the live table (newest first).
router.get('/:type/:num/readings', (req, res) => {
  if (!ensureDevice(req, res)) return;
  const ch = parseChannel(req, res);
  if (!ch) return;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 1000);
  const rows = stmts.recentReadings.all(req.params.id, ch.type, ch.num, limit);
  res.json(
    rows.map((r) => ({
      ts: r.ts,
      rtc_time: r.rtc_time,
      rtc_date: r.rtc_date,
      raw_value: r.raw_value,
      calculated_temp_c: r.calculated_temp_c,
      master_temp_c: r.master_temp_c,
      error_factor: r.error_factor_at_time,
    }))
  );
});

// PATCH /:type/:num — channel metadata: display_name, unit, enabled.
router.patch('/:type/:num', (req, res) => {
  if (!ensureDevice(req, res)) return;
  const ch = parseChannel(req, res);
  if (!ch) return;

  const cfg = getOrCreateChannelConfig(req.params.id, ch.type, ch.num);
  const body = req.body || {};

  let name = cfg.display_name || (ch.type === 'pt100' ? `PT100_${ch.num}` : `TC_${ch.num}`);
  if (body.display_name !== undefined) {
    const trimmed = String(body.display_name).trim();
    if (!trimmed) return res.status(400).json({ error: 'display_name cannot be empty' });
    if (trimmed.length > 64) return res.status(400).json({ error: 'display_name too long (max 64)' });
    name = trimmed;
  }
  const unit = body.unit !== undefined ? String(body.unit).trim().slice(0, 16) || '°C' : cfg.unit || '°C';
  const enabled = body.enabled !== undefined ? (body.enabled ? 1 : 0) : cfg.enabled;

  stmts.updateChannelMeta.run({
    device_id: req.params.id,
    channel_type: ch.type,
    channel_num: ch.num,
    display_name: name,
    unit,
    enabled,
  });

  realtime.broadcastSnapshot(req.params.id, buildDeviceSnapshot(req.params.id));
  res.json({ display_name: name, unit, enabled: enabled !== 0 });
});

// PUT /:type/:num/alarm — set alarm thresholds. Body: { low, high, enabled }.
router.put('/:type/:num/alarm', (req, res) => {
  if (!ensureDevice(req, res)) return;
  const ch = parseChannel(req, res);
  if (!ch) return;

  getOrCreateChannelConfig(req.params.id, ch.type, ch.num);
  const body = req.body || {};
  const low = body.low === '' || body.low == null ? null : Number(body.low);
  const high = body.high === '' || body.high == null ? null : Number(body.high);
  if (low != null && !Number.isFinite(low)) return res.status(400).json({ error: 'low must be numeric' });
  if (high != null && !Number.isFinite(high)) return res.status(400).json({ error: 'high must be numeric' });
  if (low != null && high != null && low >= high) {
    return res.status(400).json({ error: 'low must be less than high' });
  }
  const enabled = body.enabled === false ? 0 : 1;

  stmts.setChannelAlarm.run({
    device_id: req.params.id,
    channel_type: ch.type,
    channel_num: ch.num,
    alarm_enabled: enabled,
    alarm_low: low,
    alarm_high: high,
  });

  realtime.broadcastSnapshot(req.params.id, buildDeviceSnapshot(req.params.id));
  res.json({ enabled: !!enabled, low, high });
});

// DELETE /:type/:num/alarm — disable + clear thresholds.
router.delete('/:type/:num/alarm', (req, res) => {
  if (!ensureDevice(req, res)) return;
  const ch = parseChannel(req, res);
  if (!ch) return;
  getOrCreateChannelConfig(req.params.id, ch.type, ch.num);
  stmts.setChannelAlarm.run({
    device_id: req.params.id,
    channel_type: ch.type,
    channel_num: ch.num,
    alarm_enabled: 0,
    alarm_low: null,
    alarm_high: null,
  });
  realtime.broadcastSnapshot(req.params.id, buildDeviceSnapshot(req.params.id));
  res.json({ enabled: false });
});

// GET /:type/:num/stats?window_ms=.. — live statistics over a trailing window.
router.get('/:type/:num/stats', (req, res) => {
  if (!ensureDevice(req, res)) return;
  const ch = parseChannel(req, res);
  if (!ch) return;

  const windowMs = Math.min(Math.max(parseInt(req.query.window_ms, 10) || 300000, 1000), 30 * 86400000);
  const since = new Date(Date.now() - windowMs).toISOString();

  const agg = stmts.channelStats.get(req.params.id, ch.type, ch.num, since);
  // Standard deviation (population) — compute from the values in the window.
  let stddev = null;
  if (agg && agg.n > 0 && agg.avg_c != null) {
    const rows = stmts.channelValuesSince.all(req.params.id, ch.type, ch.num, since);
    const mean = agg.avg_c;
    const variance = rows.reduce((s, r) => s + (r.calculated_temp_c - mean) ** 2, 0) / rows.length;
    stddev = Math.sqrt(variance);
  }

  res.json({
    window_ms: windowMs,
    count: agg ? agg.n : 0,
    min: agg ? agg.min_c : null,
    max: agg ? agg.max_c : null,
    avg: agg ? agg.avg_c : null,
    stddev,
  });
});

module.exports = router;