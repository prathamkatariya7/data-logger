'use strict';

/**
 * @module routes/users
 * @description REST API routes for self-service password modification and administrator RBAC user management
 * (user creation, deletion, role updates, and password resets).
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const { stmts, nowIso } = require('../db/db');
const { requireAdmin, invalidateUser } = require('./auth');

const router = express.Router();

const ROLES = ['admin', 'engineer'];

/**
 * Sanitizes user database object for public JSON response.
 * 
 * @param {Object} u - Database user record
 * @returns {Object} Public user object
 */
function publicUser(u) {
  return { id: u.id, username: u.username, role: u.role, created_at: u.created_at, created_by: u.created_by };
}

/**
 * GET /api/me
 * Returns profile details for currently authenticated user.
 */
router.get('/me', (req, res) => {
  res.json({ username: req.user.username, role: req.user.role });
});

/**
 * POST /api/me/password
 * Self-service password change for currently authenticated user.
 */
router.post('/me/password', (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!new_password) return res.status(400).json({ error: 'new_password required' });
  const user = stmts.getUserById.get(req.user.id);
  if (!user || !bcrypt.compareSync(String(current_password || ''), user.password_hash)) {
    return res.status(401).json({ error: 'current password is incorrect' });
  }
  stmts.updateUserPassword.run(bcrypt.hashSync(String(new_password), 10), user.id);
  res.json({ ok: true });
});

/**
 * GET /api/users
 * Lists all registered user accounts (Admin only).
 */
router.get('/users', requireAdmin, (req, res) => {
  res.json(stmts.listUsers.all().map(publicUser));
});

/**
 * POST /api/users
 * Creates a new user account (Admin only).
 */
router.post('/users', requireAdmin, (req, res) => {
  const { username, password, role } = req.body || {};
  const uname = (username || '').trim();
  if (!uname) return res.status(400).json({ error: 'username required' });
  if (!password) return res.status(400).json({ error: 'password required' });
  const r = ROLES.includes(role) ? role : 'engineer';
  if (stmts.getUserByUsername.get(uname)) {
    return res.status(409).json({ error: 'username already exists' });
  }
  const info = stmts.insertUser.run({
    username: uname,
    password_hash: bcrypt.hashSync(String(password), 10),
    role: r,
    created_at: nowIso(),
    created_by: req.user.username,
  });
  res.json(publicUser(stmts.getUserById.get(info.lastInsertRowid)));
});

/**
 * DELETE /api/users/:id
 * Deletes a user account (Admin only; guards against self-deletion or last admin deletion).
 */
router.delete('/users/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const target = stmts.getUserById.get(id);
  if (!target) return res.status(404).json({ error: 'user not found' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'you cannot delete your own account' });
  if (target.role === 'admin' && stmts.countAdmins.get().n <= 1) {
    return res.status(400).json({ error: 'cannot delete the last admin' });
  }
  stmts.deleteUser.run(id);
  invalidateUser(id);
  res.json({ ok: true, deleted: id });
});

/**
 * POST /api/users/:id/reset-password
 * Resets target user password (Admin only).
 */
router.post('/users/:id/reset-password', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const target = stmts.getUserById.get(id);
  if (!target) return res.status(404).json({ error: 'user not found' });
  const { new_password } = req.body || {};
  if (!new_password) return res.status(400).json({ error: 'new_password required' });
  stmts.updateUserPassword.run(bcrypt.hashSync(String(new_password), 10), id);
  invalidateUser(id);
  res.json({ ok: true });
});

/**
 * PATCH /api/users/:id/role
 * Updates target user RBAC role (Admin only; guards against demoting last admin).
 */
router.patch('/users/:id/role', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const target = stmts.getUserById.get(id);
  if (!target) return res.status(404).json({ error: 'user not found' });
  const { role } = req.body || {};
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'role must be admin or engineer' });
  if (target.role === 'admin' && role !== 'admin' && stmts.countAdmins.get().n <= 1) {
    return res.status(400).json({ error: 'cannot demote the last admin' });
  }
  stmts.updateUserRole.run(role, id);
  invalidateUser(id);
  res.json(publicUser(stmts.getUserById.get(id)));
});

module.exports = router;
