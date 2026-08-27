'use strict';

const express = require('express');
const config = require('../config');
const { stmts, db } = require('../db/db');
const { buildDeviceSnapshot, isActive } = require('../snapshot');
const realtime = require('../realtime');
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

// GET /api/devices/:id/data — latest converted snapshot (R2, R3 first paint).
router.get('/:id/data', (req, res) => {
  const snapshot = buildDeviceSnapshot(req.params.id);
  if (!snapshot) return res.status(404).json({ error: 'device not found' });
  res.json(snapshot);
});

// GET /api/devices/:id/download/all.csv?with_master=true|false&from=..&to=..
// WIDE format: one row per timestamp, each channel as its own column(s) (R7).
//   without master: timestamp, PT100_1 .. PT100_10, TC_1, TC_2   (calculated °C)
//   with master:    timestamp, PT100_1_calc, PT100_1_master, ... per channel
// Rows of one ingest share the same `ts`, so we pivot by streaming the
// ts-ordered rows and emitting a line each time `ts` changes (memory-safe).
router.get('/:id/download/all.csv', (req, res) => {
  if (!stmts.getDevice.get(req.params.id)) return res.status(404).send('device not found');

  const withMaster = req.query.with_master === 'true';
  const range = tsRange(req.query.from, req.query.to);

  // Fixed channel column order.
  const cols = [];
  for (let n = 1; n <= config.PT100_CHANNELS; n++) cols.push({ key: `pt100_${n}`, label: `PT100_${n}` });
  for (let n = 1; n <= config.TC_CHANNELS; n++) cols.push({ key: `tc_${n}`, label: `TC_${n}` });

  const header = ['timestamp'];
  for (const c of cols) {
    if (withMaster) { header.push(`${c.label}_calc`, `${c.label}_master`); }
    else header.push(c.label);
  }

  const tag = withMaster ? 'with_master' : 'calculated';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}_all_${tag}.csv"`);
  res.write(header.join(',') + '\n');

  const sql =
    `SELECT ts, rtc_date, rtc_time, channel_type, channel_num, calculated_temp_c, master_temp_c
     FROM readings WHERE device_id = ?` +
    range.sql +
    ` ORDER BY ts ASC, id ASC`;

  let curTs = null;
  let curDisplay = null;
  let bucket = null; // Map channelKey -> { calc, master }

  const flush = () => {
    if (!bucket) return;
    const line = [csvCell(curDisplay)];
    for (const c of cols) {
      const v = bucket.get(c.key);
      if (withMaster) {
        line.push(fmt(v ? v.calc : null), fmt(v ? v.master : null));
      } else {
        line.push(fmt(v ? v.calc : null));
      }
    }
    res.write(line.join(',') + '\n');
  };

  for (const r of db.prepare(sql).iterate(req.params.id, ...range.args)) {
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

// POST /api/devices/:id/clear-log — delete all readings for the device.
router.post('/:id/clear-log', (req, res) => {
  if (!stmts.getDevice.get(req.params.id)) return res.status(404).json({ error: 'device not found' });
  const info = stmts.clearDeviceLog.run(req.params.id);
  realtime.broadcastSnapshot(req.params.id, buildDeviceSnapshot(req.params.id));
  res.json({ deleted: info.changes });
});

module.exports = router;
