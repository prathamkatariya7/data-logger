'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const compression = require('compression');

const config = require('./config');
const { stmts, nowIso, db } = require('./db/db');
const realtime = require('./realtime');

const ingestRouter = require('./routes/ingest');
const devicesRouter = require('./routes/devices');
const channelsRouter = require('./routes/channels');
const logsRouter = require('./routes/logs');

const app = express();
// Behind a cloud load balancer / reverse proxy (Render, Fly, Railway, Nginx).
app.set('trust proxy', 1);
// gzip responses (HTML/JS/CSS/JSON/CSV) so many simultaneous dashboard clients
// use less bandwidth and load faster.
app.use(compression());
app.use(express.json({ limit: '1mb' }));

// --- API routes ---
app.use('/api', ingestRouter); // POST /api/ingest
app.use('/api/devices', devicesRouter); // list, rename, data, all.csv, clear-log
// Channel config + per-channel logs both hang off /api/devices/:id/channels.
app.use('/api/devices/:id/channels', channelsRouter);
app.use('/api/devices/:id/channels', logsRouter);

app.get('/api/health', (req, res) => res.json({ ok: true, time: nowIso() }));

// --- Static frontend (built React app) ---
const distDir = path.join(__dirname, 'frontend', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  // SPA fallback: send index.html for any non-API GET so React Router works
  // on deep links (e.g. /devices/:id/pt100/3 bookmarked on a phone).
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res
      .status(200)
      .send(
        '<h1>Data Logger server is running</h1>' +
          '<p>Frontend not built yet. Run <code>npm run build:frontend</code> then reload.</p>'
      );
  });
}

// --- HTTP + Socket.IO ---
const server = http.createServer(app);
realtime.init(server);

// --- Retention prune (§4.4) ---
if (config.RETENTION_DAYS > 0) {
  const prune = () => {
    const cutoff = new Date(Date.now() - config.RETENTION_DAYS * 86400000).toISOString();
    try {
      const info = stmts.pruneOld.run(cutoff);
      if (info.changes > 0) console.log(`[retention] pruned ${info.changes} old readings`);
    } catch (e) {
      console.error('[retention] prune failed', e.message);
    }
  };
  prune();
  const t = setInterval(prune, config.RETENTION_SWEEP_MS);
  t.unref?.();
}

server.listen(config.PORT, config.HOST, () => {
  console.log(`Data Logger server listening on http://${config.HOST}:${config.PORT}`);
  console.log(`LAN devices can reach it at http://<this-laptop-LAN-IP>:${config.PORT}`);
  if (config.API_KEY) console.log('Ingest protected by X-Device-Key');
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  try { db.close(); } catch (_) {}
  process.exit(0);
});
