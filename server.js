'use strict';

/**
 * @module server
 * @description Main application server entry point for the Data Logger system.
 * Configures Express middleware, REST API routes, static SPA serving, WebSockets,
 * and scheduled automated S3 data archival sweeps.
 */

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
const archivesRouter = require('./routes/archives');
const adminDataRouter = require('./routes/admin-data');
const { router: authRouter, requireAuth, requireAdmin } = require('./routes/auth');

const app = express();

// Trust fronting reverse proxy (Nginx / ALB)
app.set('trust proxy', 1);
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// --- Public Endpoints ---
app.use('/api', ingestRouter);
app.use('/api', authRouter);
app.get('/api/health', (req, res) => res.json({ ok: true, time: nowIso(), auth: config.AUTH_ENABLED }));

// --- Protected Endpoints ---
app.use('/api', requireAuth, usersRouter);
app.use('/api/devices', requireAuth, devicesRouter);
app.use('/api/devices', requireAuth, reportsRouter);
app.use('/api/devices/:id/channels', requireAuth, channelsRouter);
app.use('/api/devices/:id/channels', requireAuth, logsRouter);
app.use('/api/devices', requireAuth, requireAdmin, archivesRouter);
app.use('/api/admin', requireAuth, requireAdmin, adminDataRouter);

// --- Static Frontend Delivery ---
const distDir = path.join(__dirname, 'frontend', 'dist');
if (fs.existsSync(distDir)) {
  app.use('/assets', express.static(path.join(distDir, 'assets'), {
    maxAge: '365d',
    immutable: true,
  }));
  app.use(express.static(distDir, { maxAge: 0 }));
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.status(200).send(
      '<h1>Data Logger server is running</h1>' +
      '<p>Frontend not built yet. Run <code>npm run build:frontend</code> then reload.</p>'
    );
  });
}

// --- HTTP Server & Socket.IO Initialization ---
const server = http.createServer(app);
realtime.init(server);

// --- Scheduled Daily 12:00 AM Midnight S3 Data Archival Sweep ---
const { runAutoArchiveSweep } = require('./archive-service');
if (config.S3_AUTO_ARCHIVE) {
  const scheduleDailyMidnight = () => {
    const tz = process.env.TIMEZONE || process.env.TZ || 'Asia/Kolkata';
    const now = new Date();

    const nowTzString = now.toLocaleString('en-US', { timeZone: tz });
    const nowTz = new Date(nowTzString);

    const nextMidnightTz = new Date(nowTz);
    nextMidnightTz.setDate(nextMidnightTz.getDate() + 1);
    nextMidnightTz.setHours(0, 0, 0, 0);

    const msUntilMidnight = Math.max(nextMidnightTz.getTime() - nowTz.getTime(), 1000);
    const hours = (msUntilMidnight / (1000 * 60 * 60)).toFixed(2);

    console.log(`[auto-archive] Scheduled daily S3 archival sweep for 12:00 AM midnight (${tz}) (in ${hours} hrs / ${Math.round(msUntilMidnight / 60000)} mins).`);

    setTimeout(async () => {
      console.log('[auto-archive] Executing scheduled daily 12:00 AM S3 archival sweep...');
      try {
        await runAutoArchiveSweep(1);
      } catch (err) {
        console.error('[auto-archive] Error during daily S3 archival sweep:', err);
      }
      scheduleDailyMidnight();
    }, msUntilMidnight).unref?.();
  };

  scheduleDailyMidnight();
}

server.listen(config.PORT, config.HOST, () => {
  console.log(`Data Logger server listening on http://${config.HOST}:${config.PORT}`);
  console.log(`LAN devices can reach it at http://<server-ip>:${config.PORT}`);
  if (config.API_KEY) console.log('Ingest protected by X-Device-Key');
  console.log(config.AUTH_ENABLED ? 'Dashboard auth: ENABLED' : 'Dashboard auth: disabled');
});

process.on('SIGINT', () => {
  console.log('\nShutting down server gracefully...');
  try { db.close(); } catch (_) {}
  process.exit(0);
});
