const express = require('express');
const { requireAuth } = require('../middleware/authMiddleware');
const env = require('../config/env');

const router = express.Router();

/**
 * Returns the STUN/TURN list for the client's RTCPeerConnection config.
 * Protected so TURN credentials aren't handed to unauthenticated callers.
 */
router.get('/', requireAuth, (req, res) => {
  res.json({ iceServers: env.iceServers() });
});

module.exports = router;
