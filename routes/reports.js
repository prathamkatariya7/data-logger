'use strict';

// Printable HTML summary report for a device (optionally a session). Opens in a
// new tab styled for print; the user prints to PDF. No headless-browser dep.

const express = require('express');
const config = require('../config');
const { stmts, db } = require('../db/db');
const { rowTimestamp } = require('../csvutil');

const router = express.Router();

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
  );
}
function num(v, d = 2) {
  return v == null ? '—' : Number(v).toFixed(d);
}

// Per-channel stats within an optional session/time window.
function channelStats(deviceId, type, n, whereExtra, args) {
  const row = db
    .prepare(
      `SELECT COUNT(calculated_temp_c) AS n, MIN(calculated_temp_c) AS mn,
              MAX(calculated_temp_c) AS mx, AVG(calculated_temp_c) AS av
       FROM readings WHERE device_id = ? AND channel_type = ? AND channel_num = ?` + whereExtra,
      ...[]
    )
    .get(deviceId, type, n, ...args);
  return row;
}

// GET /api/devices/:id/report?session_id=..&from=..&to=..
router.get('/:id/report', (req, res) => {
  const device = stmts.getDevice.get(req.params.id);
  if (!device) return res.status(404).send('device not found');

  const sessionId = req.query.session_id ? parseInt(req.query.session_id, 10) : null;
  const session = sessionId ? stmts.getSession.get(sessionId) : null;

  let whereExtra = '';
  const args = [];
  if (sessionId) { whereExtra += ' AND session_id = ?'; args.push(sessionId); }
  if (req.query.from) { whereExtra += ' AND ts >= ?'; args.push(new Date(req.query.from).toISOString()); }
  if (req.query.to) { whereExtra += ' AND ts <= ?'; args.push(new Date(req.query.to).toISOString()); }

  const chConfigs = stmts.listChannelConfig.all(req.params.id);
  const cfgByKey = new Map(chConfigs.map((c) => [`${c.channel_type}:${c.channel_num}`, c]));

  const rowsHtml = [];
  const emit = (type, count) => {
    for (let n = 1; n <= count; n++) {
      const cfg = cfgByKey.get(`${type}:${n}`);
      if (cfg && cfg.enabled === 0) continue;
      const name = (cfg && cfg.display_name) || (type === 'pt100' ? `PT100_${n}` : `TC_${n}`);
      const unit = (cfg && cfg.unit) || '°C';
      const st = channelStats(req.params.id, type, n, whereExtra, args);
      rowsHtml.push(
        `<tr><td>${esc(name)}</td><td>${esc(unit)}</td><td>${st.n || 0}</td>` +
          `<td>${num(st.mn)}</td><td>${num(st.av)}</td><td>${num(st.mx)}</td>` +
          `<td>${cfg && cfg.alarm_enabled ? `${num(cfg.alarm_low)} / ${num(cfg.alarm_high)}` : '—'}</td></tr>`
      );
    }
  };
  emit('pt100', config.PT100_CHANNELS);
  emit('tc', config.TC_CHANNELS);

  const alarms = stmts.recentAlarmEvents.all(req.params.id, 50);
  const alarmHtml = alarms.length
    ? alarms
        .map(
          (a) =>
            `<tr><td>${esc(a.ts)}</td><td>${esc(a.channel_type)}_${a.channel_num}</td>` +
            `<td>${esc(a.kind)}</td><td>${num(a.value)}</td><td>${num(a.threshold)}</td></tr>`
        )
        .join('')
    : '<tr><td colspan="5">No alarm events.</td></tr>';

  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>Report — ${esc(device.display_name)}</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #111; margin: 32px; }
  h1 { margin: 0 0 4px; } h2 { margin: 28px 0 8px; font-size: 1.05rem; }
  .meta { color: #555; font-size: 0.9rem; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; font-size: 0.85rem; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
  th { background: #f3f4f6; }
  .toolbar { margin: 16px 0; }
  button { padding: 8px 16px; cursor: pointer; }
  @media print { .toolbar { display: none; } body { margin: 0; } }
</style></head><body>
  <div class="toolbar"><button onclick="window.print()">Print / Save as PDF</button></div>
  <h1>${esc(device.display_name)}</h1>
  <div class="meta">Device ID: ${esc(device.device_id)} · Generated ${esc(new Date().toLocaleString())}</div>
  ${
    session
      ? `<div class="meta">Session: <b>${esc(session.name)}</b>${
          session.operator ? ` · Operator: ${esc(session.operator)}` : ''
        } · ${esc(session.started_at)} → ${esc(session.ended_at || 'active')}${
          session.notes ? `<br>Notes: ${esc(session.notes)}` : ''
        }</div>`
      : '<div class="meta">Scope: all data</div>'
  }
  <h2>Channel summary</h2>
  <table><thead><tr><th>Channel</th><th>Unit</th><th>Samples</th><th>Min</th><th>Avg</th><th>Max</th><th>Alarm low/high</th></tr></thead>
  <tbody>${rowsHtml.join('') || '<tr><td colspan="7">No enabled channels.</td></tr>'}</tbody></table>
  <h2>Recent alarm events</h2>
  <table><thead><tr><th>Time</th><th>Channel</th><th>Kind</th><th>Value</th><th>Threshold</th></tr></thead>
  <tbody>${alarmHtml}</tbody></table>
</body></html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

module.exports = router;
