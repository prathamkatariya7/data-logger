/**
 * @module scripts/manual-sweep
 * @description Manually trigger an S3 archival sweep from the command line.
 *   Archives all readings older than 24 hours to AWS S3 and purges local rows.
 *
 * Usage:
 *   node scripts/manual-sweep.js
 */

'use strict';

const { runAutoArchiveSweep } = require('../archive-service');

async function main() {
  console.log('[manual-sweep] Triggering S3 archival sweep...');
  await runAutoArchiveSweep(1);
  console.log('[manual-sweep] Sweep completed.');
}

main().catch((err) => {
  console.error('[manual-sweep] Error:', err);
  process.exit(1);
});
