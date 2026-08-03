const express = require('express');
const { requireAuth } = require('../middleware/authMiddleware');
const env = require('../config/env');

const router = express.Router();

/**
 * Returns the STUN/TURN server list for the client's flutter_webrtc
 * RTCPeerConnection config. Protected so the (currently empty) TURN
 * credentials aren't handed out to unauthenticated callers once a TURN
 * vendor is chosen.
 */
router.get('/', requireAuth, (req, res) => {
  res.json({ iceServers: env.iceServers() });
});

module.exports = router;
