const express = require('express');
const { getFirestore } = require('firebase-admin/firestore');
const env = require('../config/env');
const roomManager = require('../rooms/roomManager');

const router = express.Router();

/**
 * Public, unauthenticated meeting lookup for the web preview page — a
 * non-app user with just the shareable meeting code gets enough to render
 * "who/what this is" and watch the live stream read-only. Firestore's own
 * `status` field is never flipped to "active" by the client, so liveness
 * comes from roomManager's real-time signaling presence instead.
 */
router.get('/:code', async (req, res) => {
  const meetingId = req.params.code.trim().toUpperCase();

  const snapshot = await getFirestore().collection('meetings').doc(meetingId).get();
  if (!snapshot.exists) {
    return res.status(404).json({ error: 'Meeting not found' });
  }

  const data = snapshot.data();
  res.json({
    meetingId,
    title: data.title || 'Quick Meeting',
    host: { name: data.hostName || 'Host' },
    status: data.status || 'created',
    isLive: roomManager.hasActivePeers(meetingId),
    iceServers: env.iceServers(),
  });
});

module.exports = router;
