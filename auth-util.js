'use strict';

/**
 * @module auth-util
 * @description JWT token signing and verification utilities used across REST authentication middleware
 * and WebSocket handshake verification.
 */

const jwt = require('jsonwebtoken');
const config = require('./config');

/**
 * Signs a payload into a JWT authentication token.
 * 
 * @param {Object} payload - Token payload object
 * @returns {string} Signed JWT token string
 */
function signToken(payload) {
  return jwt.sign(payload, config.JWT_SECRET, { expiresIn: config.AUTH_TOKEN_TTL });
}

/**
 * Verifies and decodes a JWT token string.
 * 
 * @param {string} token - Signed JWT token
 * @returns {Object|null} Decoded token payload or null if invalid/expired
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, config.JWT_SECRET);
  } catch (_) {
    return null;
  }
}

module.exports = { signToken, verifyToken };
