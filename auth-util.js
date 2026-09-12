'use strict';

// Small JWT helpers shared by the auth route and the Socket.IO handshake.
// Auth is opt-in: enabled only when config.AUTH_ENABLED (DASHBOARD_PASSWORD set).

const jwt = require('jsonwebtoken');
const config = require('./config');

function signToken(payload) {
  return jwt.sign(payload, config.JWT_SECRET, { expiresIn: config.AUTH_TOKEN_TTL });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, config.JWT_SECRET);
  } catch (_) {
    return null;
  }
}

module.exports = { signToken, verifyToken };
