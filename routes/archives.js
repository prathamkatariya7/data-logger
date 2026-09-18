'use strict';

/**
 * @module routes/archives
 * @description REST API routes for listing S3 historical archives, generating pre-signed download URLs,
 * triggering manual on-demand S3 export sweeps, and deleting archive records (Admin only).
 */

const express = require('express');
const { stmts } = require('../db/db');
const s3 = require('../s3');
const { performDeviceArchival } = require('../archive-service');

const router = express.Router();

/**
 * GET /api/devices/:id/archives
 * Lists all S3 historical archives recorded for a device.
 */
router.get('/:id/archives', (req, res) => {
  try {
    const archives = stmts.listArchivesForDevice.all(req.params.id);
    res.json({ archives, s3_configured: s3.isS3Configured() });
  } catch (e) {
    console.error('[archives] list error', e.message);
    res.status(500).json({ error: 'failed to list archives' });
  }
});

/**
 * GET /api/devices/:id/archives/:archiveId/download
 * Generates pre-signed S3 download URL for an archived dataset file.
 */
router.get('/:id/archives/:archiveId/download', async (req, res) => {
  try {
    const archive = stmts.getArchiveById.get(Number(req.params.archiveId));
    if (!archive || archive.device_id !== req.params.id) {
      return res.status(404).json({ error: 'archive not found' });
    }
    if (!s3.isS3Configured()) {
      return res.status(400).json({ error: 'S3 is not configured' });
    }
    const url = await s3.getPresignedDownloadUrl(archive.archive_key, 3600);
    res.json({ url, filename: archive.filename });
  } catch (e) {
    console.error('[archives] download error', e.message);
    res.status(500).json({ error: 'failed to generate download URL' });
  }
});

/**
 * POST /api/devices/:id/archives/export-now
 * Manually triggers S3 archival sweep for a device.
 */
router.post('/:id/archives/export-now', async (req, res) => {
  try {
    const deviceId = req.params.id;
    const device = stmts.getDevice.get(deviceId);
    if (!device) return res.status(404).json({ error: 'device not found' });

    if (!s3.isS3Configured()) {
      return res.status(400).json({ error: 'S3 is not configured. Set S3_BUCKET in .env' });
    }

    const cutoffDays = Number(req.body.keep_days) || 1;
    const result = await performDeviceArchival(deviceId, cutoffDays);
    res.json(result);
  } catch (e) {
    console.error('[archives] export error', e.message);
    res.status(500).json({ error: 'archival failed: ' + e.message });
  }
});

/**
 * DELETE /api/devices/:id/archives/:archiveId
 * Deletes target archive file from AWS S3 storage and removes database tracking entry.
 */
router.delete('/:id/archives/:archiveId', async (req, res) => {
  try {
    const archive = stmts.getArchiveById.get(Number(req.params.archiveId));
    if (!archive || archive.device_id !== req.params.id) {
      return res.status(404).json({ error: 'archive not found' });
    }
    if (s3.isS3Configured()) {
      await s3.deleteObject(archive.archive_key);
    }
    stmts.deleteArchiveById.run(archive.id);
    res.json({ ok: true });
  } catch (e) {
    console.error('[archives] delete error', e.message);
    res.status(500).json({ error: 'failed to delete archive' });
  }
});

module.exports = router;
