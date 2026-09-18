'use strict';

/**
 * @module routes/admin-data
 * @description REST API routes for administrative data management, including filtered row counting,
 * selective database/S3 purge operations, manual database VACUUM compaction, and storage statistics.
 */

const express = require('express');
const { stmts, countFilteredReadings, deleteFilteredReadings, vacuumDatabase } = require('../db/db');
const s3 = require('../s3');

const router = express.Router();

/**
 * POST /api/admin/data/count
 * Previews total reading row count matching specified filter parameters (Admin only).
 */
router.post('/data/count', (req, res) => {
  try {
    const filters = req.body || {};
    const count = countFilteredReadings(filters);
    res.json({ count });
  } catch (e) {
    console.error('[admin-data] count error', e.message);
    res.status(500).json({ error: 'count failed' });
  }
});

/**
 * POST /api/admin/data/delete
 * Deletes reading records from database and/or S3 archive storage matching filter criteria (Admin only).
 */
router.post('/data/delete', async (req, res) => {
  try {
    const { device_id, channel_type, channel_num, start_date, end_date, target, vacuum } = req.body || {};
    const scope = target || 'db';
    let dbDeleted = 0;
    let s3Deleted = 0;

    if (scope === 'db' || scope === 'both') {
      dbDeleted = deleteFilteredReadings({
        device_id: device_id || 'all',
        channel_type: channel_type || 'all',
        channel_num: channel_num !== undefined ? channel_num : 'all',
        start_date: start_date || null,
        end_date: end_date || null,
      });
      console.log(`[admin-data] deleted ${dbDeleted} readings from DB (user: ${req.user.username})`);
    }

    if ((scope === 's3' || scope === 'both') && s3.isS3Configured()) {
      let archives = [];
      if (!device_id || device_id === 'all') {
        archives = stmts.listAllArchives.all();
      } else {
        archives = stmts.listArchivesForDevice.all(device_id);
      }

      if (archives.length > 0) {
        const keysToDelete = archives.map((a) => a.archive_key);
        await s3.deleteObjects(keysToDelete);

        if (!device_id || device_id === 'all') {
          stmts.deleteAllArchives.run();
        } else {
          stmts.deleteArchivesForDevice.run(device_id);
        }
        s3Deleted = archives.length;
        console.log(`[admin-data] deleted ${s3Deleted} S3 archives (user: ${req.user.username})`);
      }
    }

    if (vacuum) {
      vacuumDatabase();
      console.log(`[admin-data] vacuumed database (user: ${req.user.username})`);
    }

    res.json({ ok: true, db_deleted: dbDeleted, s3_deleted: s3Deleted });
  } catch (e) {
    console.error('[admin-data] delete error', e.message);
    res.status(500).json({ error: 'deletion failed: ' + e.message });
  }
});

/**
 * POST /api/admin/data/vacuum
 * Manually executes WAL checkpoint and SQLite database VACUUM compaction (Admin only).
 */
router.post('/data/vacuum', (req, res) => {
  try {
    vacuumDatabase();
    console.log(`[admin-data] manual vacuum (user: ${req.user.username})`);
    res.json({ ok: true });
  } catch (e) {
    console.error('[admin-data] vacuum error', e.message);
    res.status(500).json({ error: 'vacuum failed' });
  }
});

/**
 * GET /api/admin/data/stats
 * Returns overall data storage metrics across database readings and S3 archives per device (Admin only).
 */
router.get('/data/stats', (req, res) => {
  try {
    const { db: database } = require('../db/db');
    const totalReadings = database.prepare('SELECT COUNT(*) AS n FROM readings').get().n;
    const totalArchives = stmts.listAllArchives.all().length;
    const devices = stmts.listDevices.all();

    const perDevice = devices.map((d) => {
      const count = database.prepare('SELECT COUNT(*) AS n FROM readings WHERE device_id = ?').get(d.device_id).n;
      const archiveCount = stmts.listArchivesForDevice.all(d.device_id).length;
      return {
        device_id: d.device_id,
        display_name: d.display_name,
        reading_count: count,
        archive_count: archiveCount,
      };
    });

    res.json({
      total_readings: totalReadings,
      total_archives: totalArchives,
      s3_configured: s3.isS3Configured(),
      devices: perDevice,
    });
  } catch (e) {
    console.error('[admin-data] stats error', e.message);
    res.status(500).json({ error: 'failed to fetch stats' });
  }
});

module.exports = router;
