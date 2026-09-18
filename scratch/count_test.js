'use strict';
const { db } = require('../db/db');
const row = db.prepare('SELECT COUNT(*) AS total, MIN(ts) AS min_ts, MAX(ts) AS max_ts FROM readings').get();
console.log('[db-check]', JSON.stringify(row, null, 2));
const cutoff = new Date(Date.now() - 86400000).toISOString();
const countOld = db.prepare('SELECT COUNT(*) AS n FROM readings WHERE ts < ?').get(cutoff);
console.log('[db-check] cutoff:', cutoff, 'old_rows:', countOld.n);
