'use strict';
const { runAutoArchiveSweep } = require('../archive-service');

async function main() {
  console.log('[manual-sweep] Triggering S3 archival sweep now...');
  await runAutoArchiveSweep(1);
  console.log('[manual-sweep] Sweep finished successfully.');
}

main().catch((err) => {
  console.error('[manual-sweep] Error:', err);
  process.exit(1);
});
