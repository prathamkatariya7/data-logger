'use strict';

// Authentication (always on). Login validates against the `users` table.
// Stateless JWT (carrying id/username/role) stored in an httpOnly cookie.
// Guards all /api and the SPA data EXCEPT /api/ingest (device-key gated),
// /api/login, and /api/health.

const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { stmts } = require('../db/db');
const { signToken, verifyToken } = require('../auth-util');

const router = express.Router();

const COOKIE = 'dl_token';
function cookieOpts() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 86400000,
    // secure omitted so it works over plain-HTTP LAN; behind TLS the proxy handles it.
  };
}

// ---------------------------------------------------------------------------
// User cache — avoids a DB query on every single API request.
// The JWT is cryptographically signed so we trust its payload; we only need to
// periodically confirm the user wasn't deleted or role-changed.  30-second TTL
// means at most a 30s window before a deletion/role-change takes effect for
// in-flight sessions.
// ---------------------------------------------------------------------------
const USER_CACHE_TTL = 30_000; // 30 seconds
const userCache = new Map(); // userId → { user: {id,username,role}, expires: timestamp }

function getCachedUser(userId) {
  const entry = userCache.get(userId);
  if (entry && Date.now() < entry.expires) return entry.user;
  if (entry) userCache.delete(userId); // expired
  return null;
}

function setCachedUser(user) {
  userCache.set(user.id, { user: { id: user.id, username: user.username, role: user.role }, expires: Date.now() + USER_CACHE_TTL });
}

function invalidateUser(userId) {
  userCache.delete(userId);
}

function invalidateAll() {
  userCache.clear();
}

// POST /api/login { username, password } — async bcrypt so we don't block the event loop.
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    const user = stmts.getUserByUsername.get(String(username));
    if (!user) return res.status(401).json({ error: 'invalid credentials' });
    const match = await bcrypt.compare(String(password), user.password_hash);
    if (!match) return res.status(401).json({ error: 'invalid credentials' });
    const token = signToken({ sub: user.id, username: user.username, role: user.role });
    res.cookie(COOKIE, token, cookieOpts());
    setCachedUser(user);
    res.json({ ok: true, user: { username: user.username, role: user.role } });
  } catch (e) {
    console.error('[auth] login error', e.message);
    res.status(500).json({ error: 'internal error' });
  }
});

// POST /api/logout
router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

// GET /api/auth/status — always hits DB (called once on page load, not per-request).
router.get('/auth/status', (req, res) => {
  const token = req.cookies && req.cookies[COOKIE];
  const payload = token ? verifyToken(token) : null;
  if (!payload) return res.json({ auth_enabled: true, authenticated: false, user: null });
  // Confirm the user still exists (e.g. wasn't deleted since the token issued).
  const user = stmts.getUserById.get(payload.sub);
  if (!user) return res.json({ auth_enabled: true, authenticated: false, user: null });
  setCachedUser(user); // warm the cache
  res.json({ auth_enabled: true, authenticated: true, user: { username: user.username, role: user.role } });
});

// Middleware: require a valid session; attaches req.user = {id, username, role}.
// Uses the 30-second user cache to avoid a DB query on every request.
function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE];
  const payload = token ? verifyToken(token) : null;
  if (!payload) return res.status(401).json({ error: 'authentication required' });

  // Try cache first (fast path — no DB hit)
  const cached = getCachedUser(payload.sub);
  if (cached) {
    req.user = cached;
    return next();
  }

  // Cache miss — go to DB, then cache the result
  const user = stmts.getUserById.get(payload.sub);
  if (!user) return res.status(401).json({ error: 'authentication required' });
  setCachedUser(user);
  req.user = { id: user.id, username: user.username, role: user.role };
  next();
}

// Middleware: require the admin role (assumes requireAuth ran first).
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'admin access required' });
  }
  next();
}

module.exports = { router, requireAuth, requireAdmin, COOKIE, invalidateUser, invalidateAll };

