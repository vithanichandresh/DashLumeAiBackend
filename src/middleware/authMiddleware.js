const { getAuth } = require('firebase-admin/auth');

/**
 * Verifies a Firebase ID token. Shared by the REST middleware below and the
 * Socket.IO handshake in rooms/signalingHandler.js — one verification path for both transports.
 */
async function verifyIdToken(idToken) {
  return getAuth().verifyIdToken(idToken);
}

/** Express middleware — expects `Authorization: Bearer <idToken>`, attaches the decoded token as req.user. */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  try {
    req.user = await verifyIdToken(token);
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { verifyIdToken, requireAuth };
