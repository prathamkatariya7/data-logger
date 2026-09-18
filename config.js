'use strict';

/**
 * @module config
 * @description Central system configuration module. All values are overridable via environment
 * variables to support deployment across multiple host environments without source changes.
 */

require('dotenv').config();
const path = require('path');

module.exports = {
  /** @type {number} Server HTTP listening port */
  PORT: parseInt(process.env.PORT || '8080', 10),

  /** @type {string} Server binding host interface */
  HOST: process.env.HOST || '0.0.0.0',

  /** @type {string|null} Optional API authentication key for ingest requests */
  API_KEY: process.env.API_KEY || null,

  /** @type {string} Absolute path to SQLite database file */
  DB_PATH: process.env.DB_PATH || path.join(__dirname, 'data', 'data_logger.db'),

  /** @type {number} Device offline threshold in milliseconds */
  STALE_MS: parseInt(process.env.STALE_MS || '10000', 10),

  /** @type {number} Stale device checking sweep interval in milliseconds */
  STALE_SWEEP_MS: parseInt(process.env.STALE_SWEEP_MS || '2000', 10),

  /** @type {number} Retention window in days (0 disables automatic local purging) */
  RETENTION_DAYS: parseInt(process.env.RETENTION_DAYS || '30', 10),

  /** @type {number} Retention sweep execution frequency in milliseconds */
  RETENTION_SWEEP_MS: parseInt(process.env.RETENTION_SWEEP_MS || '3600000', 10),

  /** @type {number} Number of PT100 temperature sensor channels */
  PT100_CHANNELS: 10,

  /** @type {number} Number of Thermocouple sensor channels */
  TC_CHANNELS: 2,

  /** @type {number} Default data storage interval per channel in milliseconds */
  SAMPLE_INTERVAL_MS: parseInt(process.env.SAMPLE_INTERVAL_MS || '1000', 10),

  /** @type {string} Seed administrator username */
  ADMIN_USER: process.env.ADMIN_USER || process.env.DASHBOARD_USER || 'admin',

  /** @type {string} Seed administrator password */
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || process.env.DASHBOARD_PASSWORD || 'admin',

  /** @type {string} Secret key used for signing JWT tokens */
  JWT_SECRET: process.env.JWT_SECRET || 'change-me-data-logger-secret',

  /** @type {string} JWT token lifespan */
  AUTH_TOKEN_TTL: process.env.AUTH_TOKEN_TTL || '7d',

  /** @type {boolean} Status flag for dashboard authentication enforcement */
  AUTH_ENABLED: true,

  /** @type {string|null} Target AWS S3 bucket name for data archival */
  S3_BUCKET: process.env.S3_BUCKET || null,

  /** @type {string} AWS region for S3 client initialization */
  AWS_REGION: process.env.AWS_REGION || 'ap-south-1',

  /** @type {boolean} Enable or disable daily automated S3 data archival */
  S3_AUTO_ARCHIVE: process.env.S3_AUTO_ARCHIVE !== 'false',

  /** @type {Object} Default hardware calibration constants for PT100 sensors */
  DEFAULT_PT100_PARAMS: { R0: 100, RA: 4700, RC: 4700, R1: 10000, RF: 100000, VDC: 5.0, ALPHA: 0.39 },

  /** @type {Object} Default hardware calibration constants for Thermocouples */
  DEFAULT_TC_PARAMS: { slope: 0.25 },
};
