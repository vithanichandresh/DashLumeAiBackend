const { verifyIdToken } = require('../middleware/authMiddleware');
const roomManager = require('../rooms/roomManager');
const sfuRoomState = require('../sfu/sfuRoomState');
const sttSession = require('../stt/sttSession');
const aiSession = require('../ai/aiSession');
const summaryGenerator = require('../ai/summaryGenerator');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

/**
 * Room presence protocol. Peer identity = Socket.IO socket.id, no separate
 * peerId concept. Event names match `lib/core/network/socket_service.dart`'s
 * existing `joinRoom`/`leaveRoom` helpers (`room:join`/`room:leave` with a
 * `roomId` field) — that file was scaffolded before this protocol was
 * designed, so this aligns to it rather than introducing a second
 * "join a room" convention. `roomId` is the meeting's shareable code.
 *
 * As of the mediasoup SFU migration, the actual media (offer/answer/ICE)
 * signaling lives in `sfuHandler.js` — this file only handles presence.
 * Leaving/disconnecting here also tears down that peer's SFU resources
 * (transports/producers/consumers), since this is the single chokepoint
 * both explicit leave and disconnect funnel through.
 *
 *   client -> server  "room:join"   { roomId, displayName, profileImageUrl }
 *   server -> joiner   "room:joined" { peers: [{peerId, displayName, profileImageUrl, uid, isAudioMuted, isVideoMuted}] }
 *   server -> others   "peer:joined" { peerId, displayName, profileImageUrl, uid }
 *
 *   client -> server  "room:leave"  {}
 *   server -> others   "peer:left"   { peerId }
 *   server -> others   "sfu:producerClosed" { producerId }  (once per closed producer)
 *   (same broadcasts happen automatically on disconnect)
 *
 *   client -> server  "peer:muteState"        { isAudioMuted, isVideoMuted }
 *   server -> others   "peer:muteStateChanged" { peerId, isAudioMuted, isVideoMuted }
 *   (mic/camera toggle broadcast — stored in roomManager too, so a peer
 *   joining later sees current state via "room:joined" instead of only
 *   finding out on the next toggle)
 *
 *   client -> server  "room:end"    {}  (host ends the meeting for everyone —
 *                                        client-side-only convention, no
 *                                        server-side host check, same trust
 *                                        model as the "Host" badge display)
 *   server -> others   "room:ended"  {}
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
      // Stored on the socket (not just roomManager) so chatHandler.js can
      // stamp outgoing chat messages with a sender name without a second
      // lookup.
      socket.data.displayName = peerInfo.displayName;
      roomManager.joinRoom(roomId, socket.id, peerInfo);

      // Transcription now runs for the whole meeting from the moment it
      // starts, independent of "Add AI Assistant"/Captions toggles — both
      // calls are idempotent (harmless on every subsequent join/rejoin).
      // Fire-and-forget: starting capture for a brand-new room with zero
      // producers yet is a no-op (see sttSession.startForRoom), so this
      // never delays the room:joined/peer:joined response below.
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
 * Day 19: post-call summary + action items. Fire-and-forget, called right
 * before `aiSession.clearRoom(roomId)` in both places a meeting can end
 * below — `getTranscript()` is read synchronously as the first thing this
 * does (before any `await`), so it always captures the transcript before
 * the caller clears it on the very next line, regardless of how long the
 * Gemini call/Firestore write that follows takes. No-op if there's no
 * transcript (nobody spoke — transcription itself now runs for every
 * meeting from `room:join`, regardless of "Add AI Assistant"/Captions).
 */
async function finalizeMeetingSummary(roomId) {
  const segments = aiSession.getTranscript(roomId);
  if (!segments.length) return;

  try {
    const result = await summaryGenerator.generateSummary(segments);
    if (!result) return;

    await getFirestore().collection('meetings').doc(roomId).update({
      summary: result.summary,
      actionItems: result.actionItems,
      summaryGeneratedAt: FieldValue.serverTimestamp(),
    });
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
  // Only clear if this socket hasn't already moved on to a different room
  // while the async teardown above was in flight — a fast leave
  // immediately followed by a join on the same persistent client socket
  // can otherwise wipe out the newer room association, silently breaking
  // every room-scoped event (chat/mute/sfu/stt) for the rest of that session.
  if (socket.data.roomId === roomId) {
    socket.data.roomId = null;
  }

  // Last peer leaving naturally ends the meeting too, same as the explicit
  // host "end meeting" path below — just no one left to broadcast
  // `room:ended` to. Without this, a room that empties out via ordinary
  // leaves (not `room:end`) would leak its `aiSession` transcript forever.
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
