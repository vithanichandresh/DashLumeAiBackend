const { verifyIdToken } = require('../middleware/authMiddleware');
const roomManager = require('./roomManager');
const sfuRoomState = require('../sfu/sfuRoomState');
const sttSession = require('../stt/sttSession');
const aiSession = require('../ai/aiSession');
const summaryGenerator = require('../ai/summaryGenerator');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

/**
 * Room presence protocol (join/leave/end/mute) — event/payload reference in
 * BACKEND_ARCHITECTURE.md §8. Peer identity is the socket.id; leaving here also tears down that peer's SFU resources, the one chokepoint both explicit leave and disconnect funnel through.
 */
function attachSignaling(io) {
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Missing auth token'));
    }

    try {
      const decoded = await verifyIdToken(token);
      socket.data.uid = decoded.uid;
      next();
    } catch (error) {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('room:join', ({ roomId, displayName, profileImageUrl }) => {
      if (!roomId) return;

      const peerInfo = {
        displayName: displayName || 'Guest',
        profileImageUrl: profileImageUrl || '',
        uid: socket.data.uid,
        isAudioMuted: false,
        isVideoMuted: false,
      };
      const existingPeers = roomManager.getPeers(roomId, socket.id);

      socket.join(roomId);
      socket.data.roomId = roomId;
      // Stored on the socket too so chatHandler.js can stamp chat messages
      // with a sender name without a second roomManager lookup.
      socket.data.displayName = peerInfo.displayName;
      roomManager.joinRoom(roomId, socket.id, peerInfo);

      // Transcription runs for the whole meeting from join, independent of
      // AI/Captions toggles — both calls below are idempotent on rejoin.
      sttSession
        .wantStt(roomId, 'meeting')
        .catch((error) => console.error(`[STT][${roomId}] wantStt('meeting') failed:`, error.message));
      aiSession.start(roomId);

      socket.emit('room:joined', { peers: existingPeers });
      socket.to(roomId).emit('peer:joined', { peerId: socket.id, ...peerInfo });
    });

    socket.on('peer:muteState', ({ isAudioMuted, isVideoMuted }) => {
      const roomId = socket.data.roomId;
      if (!roomId) return;

      roomManager.setMuteState(roomId, socket.id, { isAudioMuted, isVideoMuted });
      socket.to(roomId).emit('peer:muteStateChanged', {
        peerId: socket.id,
        isAudioMuted,
        isVideoMuted,
      });
    });

    socket.on('room:leave', () => {
      leaveCurrentRoom(io, socket);
    });

    socket.on('room:end', () => {
      endCurrentRoom(io, socket);
    });

    socket.on('disconnect', () => {
      leaveCurrentRoom(io, socket);
    });
  });
}

/**
 * Post-call summary + action items, fire-and-forget. Called right before
 * aiSession.clearRoom() — getTranscript() runs first, so the transcript is always captured before the clear. No-op if nobody spoke.
 */
async function finalizeMeetingSummary(roomId) {
  const segments = aiSession.getTranscript(roomId);
  if (!segments.length) return;

  try {
    const result = await summaryGenerator.generateSummary(segments);
    if (!result) return;

    const meetingRef = getFirestore().collection('meetings').doc(roomId);
    const updateData = {
      summary: result.summary,
      actionItems: result.actionItems,
      summaryGeneratedAt: FieldValue.serverTimestamp(),
    };

    // Only rename a still-default "Quick Meeting" — never overwrite a title
    // the host actually chose. Needs a read first; Firestore has no "update only if field still equals X" without a transaction.
    if (result.title) {
      const snapshot = await meetingRef.get();
      if (snapshot.exists && snapshot.data().title === 'Quick Meeting') {
        updateData.title = result.title;
      }
    }

    await meetingRef.update(updateData);
  } catch (error) {
    console.error(`[AI][${roomId}] Summary generation failed:`, error.message);
  }
}

async function leaveCurrentRoom(io, socket) {
  const roomId = socket.data.roomId;
  if (!roomId) return;

  roomManager.leaveRoom(roomId, socket.id);

  const closedProducerIds = await sfuRoomState.removePeer(roomId, socket.id);
  for (const producerId of closedProducerIds) {
    socket.to(roomId).emit('sfu:producerClosed', { producerId });
    sttSession.stopForPeer(roomId, producerId);
  }

  socket.to(roomId).emit('peer:left', { peerId: socket.id });
  socket.leave(roomId);
  // Only clear if this socket hasn't already switched rooms while this async
  // teardown was in flight — a fast leave+rejoin could otherwise wipe the newer room association.
  if (socket.data.roomId === roomId) {
    socket.data.roomId = null;
  }

  // An empty room ends the meeting too, same as explicit "end meeting" below
  // — otherwise a room emptied via ordinary leaves leaks its aiSession forever.
  if (roomManager.getPeers(roomId).length === 0) {
    sttSession.stopForRoom(roomId);
    finalizeMeetingSummary(roomId);
    aiSession.clearRoom(roomId);
  }
}

async function endCurrentRoom(io, socket) {
  const roomId = socket.data.roomId;
  if (!roomId) return;

  const socketsInRoom = await io.in(roomId).fetchSockets();

  sfuRoomState.closeRoom(roomId);
  roomManager.closeRoom(roomId);
  sttSession.stopForRoom(roomId);
  finalizeMeetingSummary(roomId);
  aiSession.clearRoom(roomId);

  // Excludes the caller — the ending host's own client already transitions
  // itself locally, it doesn't need to hear its own broadcast back.
  socket.to(roomId).emit('room:ended');

  for (const s of socketsInRoom) {
    s.leave(roomId);
    // Same race guard as leaveCurrentRoom above.
    if (s.data.roomId === roomId) {
      s.data.roomId = null;
    }
  }
}

module.exports = { attachSignaling, finalizeMeetingSummary };
