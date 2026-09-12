'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const compression = require('compression');
const cookieParser = require('cookie-parser');

const config = require('./config');
const { stmts, nowIso, db } = require('./db/db');
const realtime = require('./realtime');

const ingestRouter = require('./routes/ingest');
const devicesRouter = require('./routes/devices');
const channelsRouter = require('./routes/channels');
const logsRouter = require('./routes/logs');
const reportsRouter = require('./routes/reports');
const usersRouter = require('./routes/users');
const { router: authRouter, requireAuth } = require('./routes/auth');

const app = express();
// Behind a cloud load balancer / reverse proxy (Render, Fly, Railway, Nginx).
app.set('trust proxy', 1);
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// --- Public API (no dashboard auth) ---
app.use('/api', ingestRouter); // POST /api/ingest — device-key gated only
app.use('/api', authRouter); // /api/login, /api/logout, /api/auth/status
app.get('/api/health', (req, res) => res.json({ ok: true, time: nowIso(), auth: config.AUTH_ENABLED }));

// --- Protected API (dashboard auth) ---
app.use('/api', requireAuth, usersRouter); // /api/me, /api/me/password, /api/users*
app.use('/api/devices', requireAuth, devicesRouter); // list, rename, recording, sessions, exports
app.use('/api/devices', requireAuth, reportsRouter); // /:id/report
app.use('/api/devices/:id/channels', requireAuth, channelsRouter); // config, meta, alarm, stats
app.use('/api/devices/:id/channels', requireAuth, logsRouter); // per-channel csv/json/xlsx

// --- Static frontend (built React app) ---
const distDir = path.join(__dirname, 'frontend', 'dist');
if (fs.existsSync(distDir)) {
  // Vite fingerprints asset filenames (e.g. index-CwkkB3bS.js), so they can be
  // cached aggressively.  HTML is always served fresh.
  app.use('/assets', express.static(path.join(distDir, 'assets'), {
    maxAge: '365d',
    immutable: true,
  }));
  app.use(express.static(distDir, { maxAge: 0 }));
  // SPA fallback: the shell is always served; the client checks /api/auth/status
  // and renders the login screen when auth is required.
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
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

// --- Retention prune ---
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
  console.log(config.AUTH_ENABLED ? 'Dashboard auth: ENABLED (login required)' : 'Dashboard auth: disabled (open LAN)');
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  try { db.close(); } catch (_) {}
  process.exit(0);
});
