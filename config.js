'use strict';

// Central configuration. Everything overridable via environment variables so
// the same build runs on any laptop / LAN without code edits.
module.exports = {
  PORT: parseInt(process.env.PORT || '8080', 10),
  HOST: process.env.HOST || '0.0.0.0', // bind all interfaces so LAN devices can reach it (R8)
  API_KEY: process.env.API_KEY || null, // optional X-Device-Key gate on /api/ingest
  DB_PATH: process.env.DB_PATH || require('path').join(__dirname, 'data', 'data_logger.db'),

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

  // Default formula params (from the README constants).
  DEFAULT_PT100_PARAMS: { R0: 100, RA: 4700, RC: 4700, R1: 10000, RF: 100000, VDC: 5.0, ALPHA: 0.39 },
  DEFAULT_TC_PARAMS: { slope: 0.25 },
};
