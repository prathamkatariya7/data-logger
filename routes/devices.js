'use strict';

const express = require('express');
const config = require('../config');
const { stmts, db } = require('../db/db');
const { buildDeviceSnapshot, isActive } = require('../snapshot');
const realtime = require('../realtime');
const { startSession, stopSession, getRecordingState, clampInterval } = require('../recording');
const { csvCell, fmt, rowTimestamp, tsRange } = require('../csvutil');

const router = express.Router();

// GET /api/devices — dashboard list (R1).
router.get('/', (req, res) => {
  const devices = stmts.listDevices.all().map((d) => ({
    device_id: d.device_id,
    display_name: d.display_name,
    active: isActive(d.last_seen),
    last_seen: d.last_seen,
    first_seen: d.first_seen,
    last_atmega_online: !!d.last_atmega_online,
    recording: !!d.recording_enabled,
  }));
  res.json(devices);
});

// PATCH /api/devices/:id — rename (R1).
router.patch('/:id', (req, res) => {
  const device = stmts.getDevice.get(req.params.id);
  if (!device) return res.status(404).json({ error: 'device not found' });
  const name = (req.body && req.body.display_name || '').trim();
  if (!name) return res.status(400).json({ error: 'display_name required' });
  stmts.renameDevice.run(name, req.params.id);
  realtime.broadcastDeviceList();
  res.json({ device_id: req.params.id, display_name: name });
});

// PATCH /api/devices/:id/settings — device-level settings (sample interval).
router.patch('/:id/settings', (req, res) => {
  const device = stmts.getDevice.get(req.params.id);
  if (!device) return res.status(404).json({ error: 'device not found' });
  const body = req.body || {};
  if (body.sample_interval_ms !== undefined) {
    const interval = clampInterval(body.sample_interval_ms);
    stmts.updateDeviceSampleInterval.run(interval, req.params.id);
  }
  const d = stmts.getDevice.get(req.params.id);
  res.json({ device_id: d.device_id, sample_interval_ms: d.sample_interval_ms });
});

// GET /api/devices/:id/data — latest converted snapshot (R2, R3 first paint).
router.get('/:id/data', (req, res) => {
  const snapshot = buildDeviceSnapshot(req.params.id);
  if (!snapshot) return res.status(404).json({ error: 'device not found' });
  res.json(snapshot);
});

// --- Recording control ---------------------------------------------------

// POST /api/devices/:id/recording/start — open a session, start recording.
router.post('/:id/recording/start', (req, res) => {
  const device = stmts.getDevice.get(req.params.id);
  if (!device) return res.status(404).json({ error: 'device not found' });
  const body = req.body || {};
  const session = startSession(req.params.id, {
    name: body.name,
    operator: body.operator,
    notes: body.notes,
    sample_interval_ms: body.sample_interval_ms,
  });
  const state = getRecordingState(req.params.id);
  realtime.broadcastRecording(req.params.id, { recording: true, session });
  realtime.broadcastSnapshot(req.params.id, buildDeviceSnapshot(req.params.id));
  res.json({ recording: true, session, sample_interval_ms: state.sample_interval_ms });
});

// POST /api/devices/:id/recording/stop — close the active session.
router.post('/:id/recording/stop', (req, res) => {
  const device = stmts.getDevice.get(req.params.id);
  if (!device) return res.status(404).json({ error: 'device not found' });
  const session = stopSession(req.params.id);
  realtime.broadcastRecording(req.params.id, { recording: false, session });
  realtime.broadcastSnapshot(req.params.id, buildDeviceSnapshot(req.params.id));
  res.json({ recording: false, session });
});

// GET /api/devices/:id/recording — current recording state.
router.get('/:id/recording', (req, res) => {
  const device = stmts.getDevice.get(req.params.id);
  if (!device) return res.status(404).json({ error: 'device not found' });
  res.json(getRecordingState(device));
});

// GET /api/devices/:id/sessions?limit=N — recent sessions with reading counts.
router.get('/:id/sessions', (req, res) => {
  if (!stmts.getDevice.get(req.params.id)) return res.status(404).json({ error: 'device not found' });
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
  const rows = stmts.listSessions.all(req.params.id, limit).map((s) => ({
    ...s,
    reading_count: stmts.countSessionReadings.get(s.id).n,
  }));
  res.json(rows);
});

// GET /api/devices/:id/diagnostics — device health snapshot.
router.get('/:id/diagnostics', (req, res) => {
  const d = stmts.getDevice.get(req.params.id);
  if (!d) return res.status(404).json({ error: 'device not found' });
  res.json({
    device_id: d.device_id,
    active: isActive(d.last_seen),
    last_seen: d.last_seen,
    last_atmega_online: !!d.last_atmega_online,
    wifi_rssi: d.wifi_rssi,
    free_heap: d.free_heap,
    fw_version: d.fw_version,
    esp_uptime_ms: d.esp_uptime_ms,
    i2c_consec_fails: d.i2c_consec_fails,
  });
});

// GET /api/devices/:id/alarms?limit=N — recent alarm events.
router.get('/:id/alarms', (req, res) => {
  if (!stmts.getDevice.get(req.params.id)) return res.status(404).json({ error: 'device not found' });
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 1000);
  res.json(stmts.recentAlarmEvents.all(req.params.id, limit));
});

// POST /api/devices/:id/alarms/clear — wipe the alarm event log.
router.post('/:id/alarms/clear', (req, res) => {
  if (!stmts.getDevice.get(req.params.id)) return res.status(404).json({ error: 'device not found' });
  const info = stmts.clearAlarmEvents.run(req.params.id);
  res.json({ deleted: info.changes });
});

// GET /api/devices/:id/download/all.csv?with_master=..&from=..&to=..&session_id=..
// WIDE format: one row per timestamp, each ENABLED channel as its own column,
// headers driven by the user's channel display names + units.
router.get('/:id/download/all.csv', (req, res) => {
  if (!stmts.getDevice.get(req.params.id)) return res.status(404).send('device not found');

  const withMaster = req.query.with_master === 'true';
  const range = tsRange(req.query.from, req.query.to);
  const sessionId = req.query.session_id ? parseInt(req.query.session_id, 10) : null;

  const cols = buildDeviceColumns(req.params.id);

  const header = ['timestamp'];
  for (const c of cols) {
    if (withMaster) header.push(`${c.label}_calc`, `${c.label}_master`);
    else header.push(c.label);
  }

  const tag = withMaster ? 'with_master' : 'calculated';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}_all_${tag}.csv"`);
  res.write(header.join(',') + '\n');

  const extra = sessionId ? ' AND session_id = ?' : '';
  const sql =
    `SELECT ts, rtc_date, rtc_time, channel_type, channel_num, calculated_temp_c, master_temp_c
     FROM readings WHERE device_id = ?` + range.sql + extra + ` ORDER BY ts ASC, id ASC`;
  const args = [req.params.id, ...range.args];
  if (sessionId) args.push(sessionId);

  let curTs = null, curDisplay = null, bucket = null;
  const flush = () => {
    if (!bucket) return;
    const line = [csvCell(curDisplay)];
    for (const c of cols) {
      const v = bucket.get(c.key);
      if (withMaster) line.push(fmt(v ? v.calc : null), fmt(v ? v.master : null));
      else line.push(fmt(v ? v.calc : null));
    }
    res.write(line.join(',') + '\n');
  };

  for (const r of db.prepare(sql).iterate(...args)) {
    if (r.ts !== curTs) {
      flush();
      curTs = r.ts;
      curDisplay = rowTimestamp(r);
      bucket = new Map();
    }
    bucket.set(`${r.channel_type}_${r.channel_num}`, {
      calc: r.calculated_temp_c,
      master: r.master_temp_c,
    });
  }
  flush();
  res.end();
});

// GET /api/devices/:id/download/all.json — whole-device wide JSON export.
router.get('/:id/download/all.json', (req, res) => {
  if (!stmts.getDevice.get(req.params.id)) return res.status(404).json({ error: 'device not found' });
  const range = tsRange(req.query.from, req.query.to);
  const sessionId = req.query.session_id ? parseInt(req.query.session_id, 10) : null;
  const cols = buildDeviceColumns(req.params.id);
  const extra = sessionId ? ' AND session_id = ?' : '';
  const sql =
    `SELECT ts, rtc_date, rtc_time, channel_type, channel_num, calculated_temp_c, master_temp_c
     FROM readings WHERE device_id = ?` + range.sql + extra + ` ORDER BY ts ASC, id ASC`;
  const args = [req.params.id, ...range.args];
  if (sessionId) args.push(sessionId);

  const out = [];
  let cur = null, bucket = null;
  const flush = () => {
    if (!bucket) return;
    const row = { timestamp: cur };
    for (const c of cols) row[c.label] = bucket.get(c.key) ?? null;
    out.push(row);
  };
  for (const r of db.prepare(sql).iterate(...args)) {
    if (r.ts !== cur) { flush(); cur = rowTimestamp(r); bucket = new Map(); }
    bucket.set(`${r.channel_type}_${r.channel_num}`, r.calculated_temp_c);
  }
  flush();
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}_all.json"`);
  res.json({ device_id: req.params.id, count: out.length, rows: out });
});

// GET /api/devices/:id/download/all.xlsx — whole-device wide Excel export.
router.get('/:id/download/all.xlsx', async (req, res) => {
  if (!stmts.getDevice.get(req.params.id)) return res.status(404).send('device not found');
  const withMaster = req.query.with_master === 'true';
  const range = tsRange(req.query.from, req.query.to);
  const sessionId = req.query.session_id ? parseInt(req.query.session_id, 10) : null;
  const cols = buildDeviceColumns(req.params.id);

  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Data Logger';
  const ws = wb.addWorksheet('readings');
  const columns = [{ header: 'Timestamp', key: 'timestamp', width: 22 }];
  for (const c of cols) {
    if (withMaster) {
      columns.push({ header: `${c.label}_calc`, key: `${c.key}_calc`, width: 14 });
      columns.push({ header: `${c.label}_master`, key: `${c.key}_master`, width: 14 });
    } else {
      columns.push({ header: c.label, key: c.key, width: 14 });
    }
  }
  ws.columns = columns;
  ws.getRow(1).font = { bold: true };

  const extra = sessionId ? ' AND session_id = ?' : '';
  const sql =
    `SELECT ts, rtc_date, rtc_time, channel_type, channel_num, calculated_temp_c, master_temp_c
     FROM readings WHERE device_id = ?` + range.sql + extra + ` ORDER BY ts ASC, id ASC`;
  const args = [req.params.id, ...range.args];
  if (sessionId) args.push(sessionId);

  let cur = null, bucket = null;
  const flush = () => {
    if (!bucket) return;
    const row = { timestamp: cur };
    for (const c of cols) {
      const v = bucket.get(c.key);
      if (withMaster) { row[`${c.key}_calc`] = v ? v.calc : null; row[`${c.key}_master`] = v ? v.master : null; }
      else row[c.key] = v ? v.calc : null;
    }
    ws.addRow(row);
  };
  for (const r of db.prepare(sql).iterate(...args)) {
    if (r.ts !== cur) { flush(); cur = rowTimestamp(r); bucket = new Map(); }
    bucket.set(`${r.channel_type}_${r.channel_num}`, { calc: r.calculated_temp_c, master: r.master_temp_c });
  }
  flush();

  const tag = withMaster ? 'with_master' : 'calculated';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}_all_${tag}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

// POST /api/devices/:id/clear-log — delete all readings for the device.
router.post('/:id/clear-log', (req, res) => {
  if (!stmts.getDevice.get(req.params.id)) return res.status(404).json({ error: 'device not found' });
  const info = stmts.clearDeviceLog.run(req.params.id);
  realtime.broadcastSnapshot(req.params.id, buildDeviceSnapshot(req.params.id));
  res.json({ deleted: info.changes });
});

// Build ordered, enabled channel column defs with user display names.
function buildDeviceColumns(deviceId) {
  const cols = [];
  for (let n = 1; n <= config.PT100_CHANNELS; n++) {
    const cfg = stmts.getChannelConfig.get(deviceId, 'pt100', n);
    if (cfg && cfg.enabled === 0) continue;
    cols.push({ key: `pt100_${n}`, label: (cfg && cfg.display_name) || `PT100_${n}` });
  }
  for (let n = 1; n <= config.TC_CHANNELS; n++) {
    const cfg = stmts.getChannelConfig.get(deviceId, 'tc', n);
    if (cfg && cfg.enabled === 0) continue;
    cols.push({ key: `tc_${n}`, label: (cfg && cfg.display_name) || `TC_${n}` });
  }
  return cols;
}

router.buildDeviceColumns = buildDeviceColumns;
module.exports = router;
