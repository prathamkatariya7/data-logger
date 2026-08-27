'use strict';

const express = require('express');
const config = require('../config');
const { stmts, db } = require('../db/db');
const realtime = require('../realtime');
const { buildDeviceSnapshot } = require('../snapshot');
const { csvCell, fmt, rowTimestamp, tsRange } = require('../csvutil');

const router = express.Router({ mergeParams: true });

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

// GET .../log.csv?with_master=true|false&from=..&to=.. — per-channel CSV (R7).
// from/to are optional datetime-local / ISO strings that bound the export.
router.get('/:type/:num/log.csv', (req, res) => {
  if (!stmts.getDevice.get(req.params.id)) return res.status(404).send('device not found');
  const ch = parseChannel(req, res);
  if (!ch) return;

  const withMaster = req.query.with_master === 'true';
  const range = tsRange(req.query.from, req.query.to);

  const sql =
    `SELECT * FROM readings
     WHERE device_id = ? AND channel_type = ? AND channel_num = ?` +
    range.sql +
    ` ORDER BY ts ASC, id ASC`;
  const rows = db.prepare(sql).all(req.params.id, ch.type, ch.num, ...range.args);

  const header = withMaster
    ? ['timestamp', 'calculated_temp_c', 'master_temp_c', 'error_factor']
    : ['timestamp', 'calculated_temp_c'];

  const filename = `${req.params.id}_${ch.type}${ch.num}_${withMaster ? 'with_master' : 'calculated'}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.write(header.join(',') + '\n');

  for (const r of rows) {
    const line = withMaster
      ? [csvCell(rowTimestamp(r)), fmt(r.calculated_temp_c), fmt(r.master_temp_c), fmt(r.error_factor_at_time)]
      : [csvCell(rowTimestamp(r)), fmt(r.calculated_temp_c)];
    res.write(line.join(',') + '\n');
  }
  res.end();
});

// POST .../clear-log — delete a channel's readings.
router.post('/:type/:num/clear-log', (req, res) => {
  if (!stmts.getDevice.get(req.params.id)) return res.status(404).json({ error: 'device not found' });
  const ch = parseChannel(req, res);
  if (!ch) return;
  const info = stmts.clearChannelLog.run(req.params.id, ch.type, ch.num);
  realtime.broadcastSnapshot(req.params.id, buildDeviceSnapshot(req.params.id));
  res.json({ deleted: info.changes });
});

module.exports = router;
