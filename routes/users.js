'use strict';

// User management (admin) + self-service profile (any authenticated user).
// Mounted behind requireAuth; admin-only routes additionally use requireAdmin.
// No password length limit anywhere — only non-empty is required.

const express = require('express');
const bcrypt = require('bcryptjs');
const { stmts, nowIso } = require('../db/db');
const { requireAdmin, invalidateUser } = require('./auth');

const router = express.Router();

const ROLES = ['admin', 'engineer'];

function publicUser(u) {
  return { id: u.id, username: u.username, role: u.role, created_at: u.created_at, created_by: u.created_by };
}

// GET /api/me — current user.
router.get('/me', (req, res) => {
  res.json({ username: req.user.username, role: req.user.role });
});

// POST /api/me/password — change own password. Body: { current_password, new_password }.
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

// --- Admin-only user management ---

// GET /api/users — list all users.
router.get('/users', requireAdmin, (req, res) => {
  res.json(stmts.listUsers.all().map(publicUser));
});

// POST /api/users — create a user. Body: { username, password, role }.
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

// DELETE /api/users/:id — remove a user (guards: not self, not the last admin).
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

// POST /api/users/:id/reset-password — admin resets a user's password. Body: { new_password }.
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

// PATCH /api/users/:id/role — change a user's role (guard: keep at least one admin).
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
