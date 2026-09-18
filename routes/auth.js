'use strict';

/**
 * @module routes/auth
 * @description Authentication and RBAC middleware routes. Provides JWT cookie sign-in/out endpoints,
 * user caching, and route protection middleware (`requireAuth`, `requireAdmin`).
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { stmts } = require('../db/db');
const { signToken, verifyToken } = require('../auth-util');

const router = express.Router();

const COOKIE = 'dl_token';

/**
 * Options helper for authentication cookie creation.
 * @returns {Object} Express cookie configuration options
 */
function cookieOpts() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 86400000,
  };
}

// In-memory user session cache to prevent excessive DB queries on hot endpoints
const USER_CACHE_TTL = 30_000;
const userCache = new Map();

/**
 * Fetches cached user record if valid.
 * @param {number} userId - User identifier
 * @returns {Object|null} Cached user or null
 */
function getCachedUser(userId) {
  const entry = userCache.get(userId);
  if (entry && Date.now() < entry.expires) return entry.user;
  if (entry) userCache.delete(userId);
  return null;
}

/**
 * Sets user entry in memory cache.
 * @param {Object} user - User record
 */
function setCachedUser(user) {
  userCache.set(user.id, {
    user: { id: user.id, username: user.username, role: user.role },
    expires: Date.now() + USER_CACHE_TTL,
  });
}

/**
 * Evicts user from memory cache.
 * @param {number} userId - User identifier
 */
function invalidateUser(userId) {
  userCache.delete(userId);
}

/**
 * Clears user cache entirely.
 */
function invalidateAll() {
  userCache.clear();
}

/**
 * POST /api/login
 * User sign-in endpoint. Authenticates against password hash and issues HTTP-only JWT cookie.
 */
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

/**
 * POST /api/logout
 * User sign-out endpoint. Clears authentication cookie.
 */
router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

/**
 * GET /api/auth/status
 * Returns current session authentication state and user role.
 */
router.get('/auth/status', (req, res) => {
  const token = req.cookies && req.cookies[COOKIE];
  const payload = token ? verifyToken(token) : null;
  if (!payload) return res.json({ auth_enabled: true, authenticated: false, user: null });
  const user = stmts.getUserById.get(payload.sub);
  if (!user) return res.json({ auth_enabled: true, authenticated: false, user: null });
  setCachedUser(user);
  res.json({ auth_enabled: true, authenticated: true, user: { username: user.username, role: user.role } });
});

/**
 * Middleware enforcing active authentication session.
 */
function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE];
  const payload = token ? verifyToken(token) : null;
  if (!payload) return res.status(401).json({ error: 'authentication required' });

  const cached = getCachedUser(payload.sub);
  if (cached) {
    req.user = cached;
    return next();
  }

  const user = stmts.getUserById.get(payload.sub);
  if (!user) return res.status(401).json({ error: 'authentication required' });
  setCachedUser(user);
  req.user = { id: user.id, username: user.username, role: user.role };
  next();
}

/**
 * Middleware enforcing administrator role.
 */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'admin access required' });
  }
  next();
}

module.exports = { router, requireAuth, requireAdmin, COOKIE, invalidateUser, invalidateAll };
