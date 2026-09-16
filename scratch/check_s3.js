'use strict';
require('./config');
const { runAutoArchiveSweep } = require('./archive-service');

async function main() {
  console.log('Running auto-archive sweep...');
  await runAutoArchiveSweep(1);
  console.log('Sweep finished!');
}

main();
