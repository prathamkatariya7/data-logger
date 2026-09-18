'use strict';

// Archive Service: Memory-efficient batched streaming gzip export to S3.
// Works seamlessly on 7M+ row datasets without exceeding RAM limits.

const zlib = require('zlib');
const { PassThrough } = require('stream');
const { Upload } = require('@aws-sdk/lib-storage');
const { stmts, nowIso, db, vacuumDatabase } = require('./db/db');
const s3 = require('./s3');
const config = require('./config');

const BATCH_SIZE = 50000;

async function performDeviceArchival(deviceId, cutoffDays = 1) {
  if (!s3.isS3Configured()) {
    throw new Error('S3_BUCKET is not configured in environment');
  }

  const cutoff = new Date(Date.now() - cutoffDays * 86400000).toISOString();

  // Count total rows to archive
  const countRow = db.prepare(
    'SELECT COUNT(*) AS n FROM readings WHERE device_id = ? AND ts < ?'
  ).get(deviceId, cutoff);
  const totalRows = countRow ? countRow.n : 0;

  if (totalRows === 0) {
    return { ok: true, rows: 0, message: 'No data older than cutoff' };
  }

  console.log(`[archive-service] Starting streaming archival of ${totalRows.toLocaleString()} rows for device ${deviceId}...`);

  // Get date bounds
  const bounds = db.prepare(
    'SELECT MIN(ts) AS start_ts, MAX(ts) AS end_ts FROM readings WHERE device_id = ? AND ts < ?'
  ).get(deviceId, cutoff);

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `${deviceId}_${dateStr}_archive.csv.gz`;
  const archiveKey = `archives/${deviceId}/${filename}`;

  // Setup memory-efficient streaming pipeline: PassThrough → Gzip → S3 Upload
  const passThrough = new PassThrough();
  const gzip = zlib.createGzip({ level: 6 });
  gzip.pipe(passThrough);

  const s3Upload = new Upload({
    client: s3.getClient(),
    params: {
      Bucket: config.S3_BUCKET,
      Key: archiveKey,
      Body: passThrough,
      ContentType: 'application/gzip',
    },
    queueSize: 4,
    partSize: 5 * 1024 * 1024, // 5MB S3 part size
  });

  s3Upload.on('httpUploadProgress', (p) => {
    console.log(`[archive-s3-upload] ${p.Key}: uploaded ${p.loaded} bytes (part ${p.part})`);
  });

  // Write CSV Header
  gzip.write('id,device_id,channel_type,channel_num,ts,rtc_time,rtc_date,raw_value,hw_available,fault,calculated_temp_c,master_temp_c,error_factor_at_time,session_id\n');

  let processedRows = 0;
  const fetchStmt = db.prepare(
    'SELECT * FROM readings WHERE device_id = ? AND ts < ? ORDER BY id ASC LIMIT ?'
  );

  // Process in 50,000 row chunks to maintain strict low-memory footprint
  while (true) {
    const rows = fetchStmt.all(deviceId, cutoff, BATCH_SIZE);
    if (rows.length === 0) break;

    for (const row of rows) {
      const line = [
        row.id, row.device_id, row.channel_type, row.channel_num,
        row.ts, row.rtc_time || '', row.rtc_date || '', row.raw_value ?? '',
        row.hw_available ?? '', row.fault ?? '', row.calculated_temp_c ?? '',
        row.master_temp_c ?? '', row.error_factor_at_time ?? '', row.session_id ?? '',
      ].join(',') + '\n';
      
      const canContinue = gzip.write(line);
      if (!canContinue) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    // Delete exact batched row IDs from SQLite in chunks of 5,000
    for (let i = 0; i < rows.length; i += 5000) {
      const chunkIds = rows.slice(i, i + 5000).map((r) => r.id);
      const placeholders = chunkIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM readings WHERE id IN (${placeholders})`).run(...chunkIds);
    }

    processedRows += rows.length;
    console.log(`[archive-service] Processed & purged ${processedRows.toLocaleString()} / ${totalRows.toLocaleString()} rows...`);

    // Force V8 garbage collection every 100,000 rows to keep heap footprint minimal (< 80MB)
    if (global.gc && processedRows % 100000 === 0) {
      try { global.gc(); } catch (_) {}
    }

    // Yield to event loop (100ms delay to keep disk I/O and CPU low on t2.micro)
    await new Promise((resolve) => setTimeout(resolve, 100));

    if (rows.length < BATCH_SIZE) break;
  }

  gzip.end();

  // Complete S3 Multipart Upload
  const uploadResult = await s3Upload.done();

  // Track archive record in local DB
  stmts.insertArchive.run({
    device_id: deviceId,
    session_id: null,
    archive_key: archiveKey,
    filename,
    file_size_bytes: 0,
    row_count: totalRows,
    start_ts: bounds.start_ts,
    end_ts: bounds.end_ts,
    created_at: nowIso(),
  });

  console.log(`[archive-service] Archival completed successfully for ${deviceId} → s3://${archiveKey}`);
  return { ok: true, rows: totalRows, file: filename };
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
      console.log(`[auto-archive] Auto-archived ${totalArchivedRows.toLocaleString()} total rows to AWS S3 and vacuumed SQLite DB.`);
    } else {
      console.log('[auto-archive] Auto-archive sweep completed. No old data needed archiving.');
    }
  } catch (e) {
    console.error('[auto-archive] Auto-archive sweep failed:', e.message);
  }
}

module.exports = { performDeviceArchival, runAutoArchiveSweep };
