'use strict';

/**
 * @module csvutil
 * @description Utility helpers for CSV generation, timestamp formatting, and date range parsing.
 */

/**
 * Escapes values for safe CSV formatting.
 * 
 * @param {any} v - Raw cell value
 * @returns {string} Escaped CSV string
 */
function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Formats a numeric value to 3 decimal places.
 * 
 * @param {number|null} v - Numeric measurement
 * @returns {string} Formatted number string or empty string
 */
function fmt(v) {
  return v == null ? '' : Number(v).toFixed(3);
}

/**
 * Selects best display timestamp for a reading record (preferring device RTC over server timestamp).
 * 
 * @param {Object} r - Reading database record
 * @returns {string} Best display timestamp
 */
function rowTimestamp(r) {
  if (r.rtc_date && r.rtc_time) return `${r.rtc_date} ${r.rtc_time}`;
  return r.ts;
}

/**
 * Parses user input date-time strings into ISO UTC strings.
 * 
 * @param {string|null} v - Date-time input string
 * @returns {string|null} Parsed ISO string or null
 */
function toIso(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Constructs SQL WHERE clause fragment and parameter values for date range filtering.
 * 
 * @param {string} fromRaw - Range start date-time
 * @param {string} toRaw - Range end date-time
 * @returns {{sql: string, args: Array, from: string|null, to: string|null}} Prepared SQL fragment and parameters
 */
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
