'use strict';

/**
 * @module routes/logs
 * @description REST API routes for single-channel telemetry data downloads in CSV, JSON, and XLSX formats,
 * as well as channel-specific log clearing endpoints.
 */

const express = require('express');
const config = require('../config');
const { stmts, db } = require('../db/db');
const realtime = require('../realtime');
const { buildDeviceSnapshot } = require('../snapshot');
const { csvCell, fmt, rowTimestamp, tsRange } = require('../csvutil');

const router = express.Router({ mergeParams: true });

/**
 * Validates channel type and channel number path parameters.
 * 
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @returns {{type: string, num: number}|null} Parsed channel parameters or null
 */
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

/**
 * Resolves user display name and unit for channel.
 * 
 * @param {string} deviceId - Target device identifier
 * @param {string} type - Channel type
 * @param {number} num - Channel index
 * @returns {{name: string, unit: string}} Channel label metadata
 */
function channelLabel(deviceId, type, num) {
  const cfg = stmts.getChannelConfig.get(deviceId, type, num);
  const name = (cfg && cfg.display_name) || (type === 'pt100' ? `PT100_${num}` : `TC_${num}`);
  const unit = (cfg && cfg.unit) || '°C';
  return { name, unit };
}

/**
 * Queries database reading records for a specific channel using optional date range and session filters.
 * 
 * @param {Object} req - Express request
 * @returns {Array<Object>} Database reading records
 */
function fetchChannelRows(req) {
  const range = tsRange(req.query.from, req.query.to);
  const sessionId = req.query.session_id ? parseInt(req.query.session_id, 10) : null;
  const extra = sessionId ? ' AND session_id = ?' : '';
  const sql =
    `SELECT * FROM readings
     WHERE device_id = ? AND channel_type = ? AND channel_num = ?` + range.sql + extra +
    ` ORDER BY ts ASC, id ASC`;
  const args = [req.params.id, req.params.type, parseInt(req.params.num, 10), ...range.args];
  if (sessionId) args.push(sessionId);
  return db.prepare(sql).all(...args);
}

/**
 * GET /api/devices/:id/channels/:type/:num/log.csv
 * Exports single channel readings as CSV file.
 */
router.get('/:type/:num/log.csv', (req, res) => {
  if (!stmts.getDevice.get(req.params.id)) return res.status(404).send('device not found');
  const ch = parseChannel(req, res);
  if (!ch) return;

  const withMaster = req.query.with_master === 'true';
  const { name, unit } = channelLabel(req.params.id, ch.type, ch.num);
  const rows = fetchChannelRows(req);

  const valCol = `${name} (${unit})`;
  const header = withMaster
    ? ['timestamp', valCol, `${name}_master (${unit})`, 'error_factor']
    : ['timestamp', valCol];

  const safe = name.replace(/[^\w.-]+/g, '_');
  const filename = `${req.params.id}_${safe}_${withMaster ? 'with_master' : 'calculated'}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.write(header.map(csvCell).join(',') + '\n');

  for (const r of rows) {
    const line = withMaster
      ? [csvCell(rowTimestamp(r)), fmt(r.calculated_temp_c), fmt(r.master_temp_c), fmt(r.error_factor_at_time)]
      : [csvCell(rowTimestamp(r)), fmt(r.calculated_temp_c)];
    res.write(line.join(',') + '\n');
  }
  res.end();
});

/**
 * GET /api/devices/:id/channels/:type/:num/log.json
 * Exports single channel readings as JSON object array.
 */
router.get('/:type/:num/log.json', (req, res) => {
  if (!stmts.getDevice.get(req.params.id)) return res.status(404).json({ error: 'device not found' });
  const ch = parseChannel(req, res);
  if (!ch) return;
  const { name, unit } = channelLabel(req.params.id, ch.type, ch.num);
  const rows = fetchChannelRows(req).map((r) => ({
    timestamp: rowTimestamp(r),
    ts: r.ts,
    calculated_temp_c: r.calculated_temp_c,
    master_temp_c: r.master_temp_c,
    error_factor: r.error_factor_at_time,
    raw_value: r.raw_value,
    session_id: r.session_id,
  }));
  const safe = name.replace(/[^\w.-]+/g, '_');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}_${safe}.json"`);
  res.json({ device_id: req.params.id, channel: name, unit, count: rows.length, readings: rows });
});

/**
 * GET /api/devices/:id/channels/:type/:num/log.xlsx
 * Exports single channel readings as Excel spreadsheet file.
 */
router.get('/:type/:num/log.xlsx', async (req, res) => {
  if (!stmts.getDevice.get(req.params.id)) return res.status(404).send('device not found');
  const ch = parseChannel(req, res);
  if (!ch) return;

  const withMaster = req.query.with_master === 'true';
  const { name, unit } = channelLabel(req.params.id, ch.type, ch.num);
  const rows = fetchChannelRows(req);

  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Data Logger';
  const ws = wb.addWorksheet(name.slice(0, 31) || 'channel');

  const columns = [
    { header: 'Timestamp', key: 'timestamp', width: 22 },
    { header: `${name} (${unit})`, key: 'calc', width: 16 },
  ];
  if (withMaster) {
    columns.push({ header: `Master (${unit})`, key: 'master', width: 16 });
    columns.push({ header: 'Error factor', key: 'ef', width: 14 });
  }
  ws.columns = columns;
  ws.getRow(1).font = { bold: true };

  for (const r of rows) {
    const row = { timestamp: rowTimestamp(r), calc: r.calculated_temp_c };
    if (withMaster) { row.master = r.master_temp_c; row.ef = r.error_factor_at_time; }
    ws.addRow(row);
  }

  const safe = name.replace(/[^\w.-]+/g, '_');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}_${safe}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

/**
 * POST /api/devices/:id/channels/:type/:num/clear-log
 * Deletes all reading records for a single specified channel.
 */
router.post('/:type/:num/clear-log', (req, res) => {
  if (!stmts.getDevice.get(req.params.id)) return res.status(404).json({ error: 'device not found' });
  const ch = parseChannel(req, res);
  if (!ch) return;
  const info = stmts.clearChannelLog.run(req.params.id, ch.type, ch.num);
  realtime.broadcastSnapshot(req.params.id, buildDeviceSnapshot(req.params.id));
  res.json({ deleted: info.changes });
});

module.exports = router;
