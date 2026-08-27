'use strict';

// Shared CSV / export helpers.

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function fmt(v) {
  return v == null ? '' : Number(v).toFixed(3);
}

// Display timestamp for a reading row: prefer device (NTP) time, else server ts.
function rowTimestamp(r) {
  if (r.rtc_date && r.rtc_time) return `${r.rtc_date} ${r.rtc_time}`;
  return r.ts;
}

// Parse a from/to query value (datetime-local "YYYY-MM-DDTHH:MM", a date
// "YYYY-MM-DD", or full ISO) into a UTC ISO string for comparison against the
// stored `ts` column. Returns null if absent/invalid. The server laptop's
// timezone is assumed to match the intended wall-clock (same region as the
// device), so local->UTC conversion via Date() lines up with the stored ts.
function toIso(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Build a WHERE fragment + bound args for an optional ts range.
function tsRange(fromRaw, toRaw) {
  const from = toIso(fromRaw);
  const to = toIso(toRaw);
  const clauses = [];
  const args = [];
  if (from) { clauses.push('ts >= ?'); args.push(from); }
  if (to) { clauses.push('ts <= ?'); args.push(to); }
  return { sql: clauses.length ? ' AND ' + clauses.join(' AND ') : '', args, from, to };
}

module.exports = { csvCell, fmt, rowTimestamp, toIso, tsRange };
