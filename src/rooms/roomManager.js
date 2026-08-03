/**
 * In-memory signaling room registry — one entry per active meeting call,
 * separate from the Firestore `meetings` collection (which the Flutter
 * client writes to directly for meeting metadata/history). This only
 * tracks who is currently connected to a meeting's signaling room, keyed
 * by Socket.IO room name = meetingId.
 *
 * Not persisted — a server restart drops all active rooms. Fine for MVP;
 * revisit if that becomes a real problem (Day 10 reconnection work).
 */
const rooms = new Map();

// Day 10: last-touched timestamp per room, used only by `roomReaper.js`'s
// defensive idle sweep — not part of the normal reactive join/leave/end
// cleanup path, which already handles the common case.
const lastActivityAt = new Map();

function touch(meetingId) {
  lastActivityAt.set(meetingId, Date.now());
}

function joinRoom(meetingId, peerId, peerInfo) {
  if (!rooms.has(meetingId)) {
    rooms.set(meetingId, new Map());
  }
  rooms.get(meetingId).set(peerId, peerInfo);
  touch(meetingId);
}

function leaveRoom(meetingId, peerId) {
  const room = rooms.get(meetingId);
  if (!room) return;

  room.delete(peerId);
  if (room.size === 0) {
    rooms.delete(meetingId);
    lastActivityAt.delete(meetingId);
  } else {
    touch(meetingId);
  }
}

/** Removes the whole room regardless of remaining peers — used when the host ends the meeting for everyone. */
function closeRoom(meetingId) {
  rooms.delete(meetingId);
  lastActivityAt.delete(meetingId);
}

function getAllRoomIds() {
  return Array.from(rooms.keys());
}

/** Ms since epoch this room last had a join/leave — used by `roomReaper.js`. */
function getLastActivity(meetingId) {
  return lastActivityAt.get(meetingId) ?? 0;
}

function getPeers(meetingId, excludePeerId) {
  const room = rooms.get(meetingId);
  if (!room) return [];

  return Array.from(room.entries())
    .filter(([peerId]) => peerId !== excludePeerId)
    .map(([peerId, info]) => ({ peerId, ...info }));
}

function findRoomForPeer(peerId) {
  for (const [meetingId, room] of rooms.entries()) {
    if (room.has(peerId)) return meetingId;
  }
  return null;
}

/** Single-peer lookup — used for speaker attribution (see `ai/aiSession.js`). */
function getPeer(meetingId, peerId) {
  const room = rooms.get(meetingId);
  if (!room || !room.has(peerId)) return null;

  return { peerId, ...room.get(peerId) };
}

/**
 * Merges a peer's mic/camera mute state into their stored peerInfo, so a
 * peer joining later sees the current state via `getPeers()` instead of
 * only finding out on the next toggle (see `signalingHandler.js`'s
 * `peer:muteState` handler).
 */
function setMuteState(meetingId, peerId, { isAudioMuted, isVideoMuted }) {
  const room = rooms.get(meetingId);
  if (!room || !room.has(peerId)) return;

  room.set(peerId, { ...room.get(peerId), isAudioMuted, isVideoMuted });
}

module.exports = {
  joinRoom,
  leaveRoom,
  closeRoom,
  getPeers,
  getPeer,
  setMuteState,
  findRoomForPeer,
  getAllRoomIds,
  getLastActivity,
};
