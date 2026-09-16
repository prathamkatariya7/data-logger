'use strict';

// Archive Service: handles streaming gzip export to S3, DB tracking, and DB cleanup.

const zlib = require('zlib');
const { stmts, nowIso, db, vacuumDatabase } = require('./db/db');
const s3 = require('./s3');

async function performDeviceArchival(deviceId, cutoffDays = 1) {
  if (!s3.isS3Configured()) {
    throw new Error('S3_BUCKET is not configured in environment');
  }

  const cutoff = new Date(Date.now() - cutoffDays * 86400000).toISOString();

  // Count rows to archive
  const countRow = db.prepare(
    'SELECT COUNT(*) AS n FROM readings WHERE device_id = ? AND ts < ?'
  ).get(deviceId, cutoff);
  const rowCount = countRow ? countRow.n : 0;

  if (rowCount === 0) {
    return { ok: true, rows: 0, message: 'No data older than cutoff' };
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

  // Upload to AWS S3
  await s3.uploadArchive(archiveKey, buffer);

  // Track archive record in local DB
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

  // Delete archived rows from local SQLite DB to free RAM and disk
  db.prepare('DELETE FROM readings WHERE device_id = ? AND ts < ?').run(deviceId, cutoff);

  console.log(`[archive-service] Archived ${rowCount} rows for ${deviceId} → s3://${archiveKey} (${(totalSize / 1024).toFixed(1)} KB)`);
  return { ok: true, rows: rowCount, file: filename, size_kb: +(totalSize / 1024).toFixed(1) };
}

async function runAutoArchiveSweep(cutoffDays = 1) {
  if (!s3.isS3Configured()) {
    return;
  }
  console.log(`[auto-archive] Starting daily 24-hour S3 data archival sweep (keeping last ${cutoffDays} day local)...`);
  try {
    const devices = stmts.listDevices.all();
    let totalArchivedRows = 0;

    for (const d of devices) {
      const res = await performDeviceArchival(d.device_id, cutoffDays);
      totalArchivedRows += res.rows || 0;
    }

    if (totalArchivedRows > 0) {
      vacuumDatabase();
      console.log(`[auto-archive] Auto-archived ${totalArchivedRows} total rows to AWS S3 and vacuumed SQLite DB.`);
    } else {
      console.log('[auto-archive] Auto-archive sweep completed. No old data needed archiving.');
    }
  } catch (e) {
    console.error('[auto-archive] Auto-archive sweep failed:', e.message);
  }
}

module.exports = { performDeviceArchival, runAutoArchiveSweep };
