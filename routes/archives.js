'use strict';

// Archives API: list, download, and manually trigger S3 archival.
// All endpoints require dashboard auth (requireAuth applied in server.js).

const express = require('express');
const zlib = require('zlib');
const { PassThrough } = require('stream');
const { stmts, nowIso, db } = require('../db/db');
const s3 = require('../s3');

const router = express.Router();

// GET /api/devices/:id/archives — list all S3 archives for a device.
router.get('/:id/archives', (req, res) => {
  try {
    const archives = stmts.listArchivesForDevice.all(req.params.id);
    res.json({ archives, s3_configured: s3.isS3Configured() });
  } catch (e) {
    console.error('[archives] list error', e.message);
    res.status(500).json({ error: 'failed to list archives' });
  }
});

// GET /api/devices/:id/archives/:archiveId/download — get pre-signed S3 URL.
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

// POST /api/devices/:id/archives/export-now — manually archive old data for a device.
router.post('/:id/archives/export-now', async (req, res) => {
  try {
    const deviceId = req.params.id;
    const device = stmts.getDevice.get(deviceId);
    if (!device) return res.status(404).json({ error: 'device not found' });

    if (!s3.isS3Configured()) {
      return res.status(400).json({ error: 'S3 is not configured. Set S3_BUCKET in .env' });
    }

    // Archive all readings for this device using streaming gzip.
    const cutoffDays = Number(req.body.keep_days) || 7;
    const cutoff = new Date(Date.now() - cutoffDays * 86400000).toISOString();

    // Count rows to archive
    const countRow = db.prepare(
      'SELECT COUNT(*) AS n FROM readings WHERE device_id = ? AND ts < ?'
    ).get(deviceId, cutoff);
    const rowCount = countRow ? countRow.n : 0;

    if (rowCount === 0) {
      return res.json({ ok: true, message: 'No old data to archive', rows: 0 });
    }

    // Get date bounds
    const bounds = db.prepare(
      'SELECT MIN(ts) AS start_ts, MAX(ts) AS end_ts FROM readings WHERE device_id = ? AND ts < ?'
    ).get(deviceId, cutoff);

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `${deviceId}_${dateStr}_archive.csv.gz`;
    const archiveKey = `archives/${deviceId}/${filename}`;

    // Stream rows → CSV → Gzip → Buffer (zero-memory streaming)
    const iter = db.prepare(
      'SELECT * FROM readings WHERE device_id = ? AND ts < ? ORDER BY ts ASC'
    ).iterate(deviceId, cutoff);

    const gzip = zlib.createGzip({ level: 6 });
    const chunks = [];
    let totalSize = 0;

    gzip.on('data', (chunk) => {
      chunks.push(chunk);
      totalSize += chunk.length;
    });

    await new Promise((resolve, reject) => {
      gzip.on('finish', resolve);
      gzip.on('error', reject);

      // Write CSV header
      gzip.write('id,device_id,channel_type,channel_num,ts,rtc_time,rtc_date,raw_value,hw_available,fault,calculated_temp_c,master_temp_c,error_factor_at_time,session_id\n');

      for (const row of iter) {
        const line = [
          row.id, row.device_id, row.channel_type, row.channel_num,
          row.ts, row.rtc_time || '', row.rtc_date || '', row.raw_value ?? '',
          row.hw_available ?? '', row.fault ?? '', row.calculated_temp_c ?? '',
          row.master_temp_c ?? '', row.error_factor_at_time ?? '', row.session_id ?? '',
        ].join(',') + '\n';
        gzip.write(line);
      }
      gzip.end();
    });

    const buffer = Buffer.concat(chunks);

    // Upload to S3
    await s3.uploadArchive(archiveKey, buffer);

    // Track in local DB
    stmts.insertArchive.run({
      device_id: deviceId,
      session_id: null,
      archive_key: archiveKey,
      filename,
      file_size_bytes: totalSize,
      row_count: rowCount,
      start_ts: bounds.start_ts,
      end_ts: bounds.end_ts,
      created_at: nowIso(),
    });

    // Delete archived rows from local DB
    db.prepare('DELETE FROM readings WHERE device_id = ? AND ts < ?').run(deviceId, cutoff);

    console.log(`[archives] archived ${rowCount} rows for ${deviceId} → s3://${archiveKey} (${(totalSize / 1024).toFixed(1)} KB)`);
    res.json({ ok: true, rows: rowCount, file: filename, size_kb: +(totalSize / 1024).toFixed(1) });
  } catch (e) {
    console.error('[archives] export error', e.message);
    res.status(500).json({ error: 'archival failed: ' + e.message });
  }
});

// DELETE /api/devices/:id/archives/:archiveId — delete a single archive from S3 + DB.
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
