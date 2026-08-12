const { getWorker } = require('./mediasoupWorker');

/**
 * Per-room mediasoup state (Router + per-peer transports/producers/consumers)
 * — separate from roomManager.js, which only tracks who's connected. Codecs: VP8 + Opus only, the simplest interoperable set for MVP.
 */
const mediaCodecs = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: { 'x-google-start-bitrate': 1000 },
  },
];

/** @type {Map<string, { router: import('mediasoup').types.Router, peers: Map<string, PeerSfuState> }>} */
const rooms = new Map();

/**
 * @typedef {Object} PeerSfuState
 * @property {import('mediasoup').types.WebRtcTransport} [sendTransport]
 * @property {import('mediasoup').types.WebRtcTransport} [recvTransport]
 * @property {Map<string, import('mediasoup').types.Producer>} producers - keyed by kind ('audio'|'video')
 * @property {Map<string, import('mediasoup').types.Consumer>} consumers - keyed by producerId
 */

async function getOrCreateRoom(roomId) {
  let room = rooms.get(roomId);
  if (room) return room;

  const router = await getWorker().createRouter({ mediaCodecs });
  room = { router, peers: new Map() };
  rooms.set(roomId, room);
  return room;
}

function getRoom(roomId) {
  return rooms.get(roomId);
}

function getOrCreatePeerState(roomId, peerId) {
  const room = rooms.get(roomId);
  if (!room) throw new Error(`No SFU room state for ${roomId} — call getOrCreateRoom first`);

  let peer = room.peers.get(peerId);
  if (!peer) {
    peer = { sendTransport: null, recvTransport: null, producers: new Map(), consumers: new Map() };
    room.peers.set(peerId, peer);
  }
  return peer;
}

/** Closes every transport (which cascades to close that peer's own producers/consumers) and removes the peer. Returns the producer ids that were closed, so callers can notify the rest of the room. */
async function removePeer(roomId, peerId) {
  const room = rooms.get(roomId);
  if (!room) return [];

  const peer = room.peers.get(peerId);
  if (!peer) return [];

  const closedProducerIds = Array.from(peer.producers.values()).map((p) => p.id);

  peer.sendTransport?.close();
  peer.recvTransport?.close();
  room.peers.delete(peerId);

  if (room.peers.size === 0) {
    room.router.close();
    rooms.delete(roomId);
  }

  return closedProducerIds;
}

/** Force-closes the room's router (cascades to close every peer's transports/producers/consumers) regardless of how many peers remain — used when the host ends the meeting for everyone. */
function closeRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  room.router.close();
  rooms.delete(roomId);
}

/** All producers in the room except the given peer's own — used when a peer joins to hand them everyone else's existing streams. */
function getOtherProducers(roomId, excludePeerId) {
  const room = rooms.get(roomId);
  if (!room) return [];

  const result = [];
  for (const [peerId, peer] of room.peers.entries()) {
    if (peerId === excludePeerId) continue;
    for (const producer of peer.producers.values()) {
      result.push({ peerId, producerId: producer.id, kind: producer.kind });
    }
  }
  return result;
}

/** All audio producers currently in the room, across every peer — used by STT capture to enumerate who to transcribe. */
function getAudioProducers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];

  const result = [];
  for (const [peerId, peer] of room.peers.entries()) {
    const producer = peer.producers.get('audio');
    if (producer) result.push({ peerId, producerId: producer.id });
  }
  return result;
}

module.exports = {
  getOrCreateRoom,
  getRoom,
  getOrCreatePeerState,
  removePeer,
  closeRoom,
  getOtherProducers,
  getAudioProducers,
};
