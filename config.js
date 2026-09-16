'use strict';

// Central configuration. Everything overridable via environment variables so
// the same build runs on any laptop / LAN without code edits.
const path = require('path');

module.exports = {
  PORT: parseInt(process.env.PORT || '8080', 10),
  HOST: process.env.HOST || '0.0.0.0', // bind all interfaces so LAN devices can reach it (R8)
  API_KEY: process.env.API_KEY || null, // optional X-Device-Key gate on /api/ingest
  DB_PATH: process.env.DB_PATH || path.join(__dirname, 'data', 'data_logger.db'),

  // A device is "active" if we've heard from it within this window.
  STALE_MS: parseInt(process.env.STALE_MS || '10000', 10),

  // How often to sweep active devices and push offline/online transitions.
  STALE_SWEEP_MS: parseInt(process.env.STALE_SWEEP_MS || '2000', 10),

  // Retention: prune readings older than this many days (0 = keep forever).
  RETENTION_DAYS: parseInt(process.env.RETENTION_DAYS || '30', 10),
  RETENTION_SWEEP_MS: parseInt(process.env.RETENTION_SWEEP_MS || '3600000', 10), // hourly

  // Channel counts per the firmware layout.
  PT100_CHANNELS: 10,
  TC_CHANNELS: 2,

  // Default storage-rate (ms between persisted samples per channel).
  SAMPLE_INTERVAL_MS: parseInt(process.env.SAMPLE_INTERVAL_MS || '1000', 10),

  // --- Authentication (always on) ---
  // Login is required for the dashboard. Users live in the `users` table with
  // roles 'admin' | 'engineer'. The first admin is seeded on first boot from
  // ADMIN_USER / ADMIN_PASSWORD (only when no users exist yet).
  ADMIN_USER: process.env.ADMIN_USER || process.env.DASHBOARD_USER || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || process.env.DASHBOARD_PASSWORD || 'admin',
  JWT_SECRET: process.env.JWT_SECRET || 'change-me-data-logger-secret',
  AUTH_TOKEN_TTL: process.env.AUTH_TOKEN_TTL || '7d',
  AUTH_ENABLED: true,

  // --- S3 Archival & Cloud Storage ---
  S3_BUCKET: process.env.S3_BUCKET || null,
  AWS_REGION: process.env.AWS_REGION || 'ap-south-1',
  S3_AUTO_ARCHIVE: process.env.S3_AUTO_ARCHIVE !== 'false',

  // Default formula params (from the README constants).
  DEFAULT_PT100_PARAMS: { R0: 100, RA: 4700, RC: 4700, R1: 10000, RF: 100000, VDC: 5.0, ALPHA: 0.39 },
  DEFAULT_TC_PARAMS: { slope: 0.25 },
};
