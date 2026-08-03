const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { DeepgramClient } = require('@deepgram/sdk');
const env = require('../config/env');
const sfuRoomState = require('../sfu/sfuRoomState');
const roomManager = require('../rooms/roomManager');
const aiSession = require('../ai/aiSession');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

/**
 * Day 15 spike-sized STT capture pipeline, now feeding Day 16's transcript
 * accumulation (`ai/aiSession.js`). For a given mediasoup audio Producer,
 * this:
 *   1. Creates a `PlainTransport` on the room's Router and consumes the
 *      producer onto it — mediasoup's own documented "recording" pattern
 *      (same one mediasoup-demo uses), just forwarding raw RTP to a local
 *      port instead of to another WebRTC peer.
 *   2. Writes a minimal SDP file describing that RTP stream (payload type /
 *      clock rate read from the actual negotiated `consumer.rtpParameters`,
 *      not assumed statically — the Router doesn't pin a static payload
 *      type, see sfuRoomState.js's `mediaCodecs`).
 *   3. Spawns `ffmpeg` pointed at that SDP, decoding Opus -> raw PCM
 *      (16kHz mono s16le) on stdout.
 *   4. Streams that PCM into one Deepgram live-transcription WebSocket per
 *      producer. Finalized segments are appended to `aiSession` with
 *      speaker attribution (looked up once per capture, not per segment —
 *      display names don't change mid-call).
 *
 * Still no persistence, no context-window/Gemini wiring — that's Day 17+.
 */

const deepgram = new DeepgramClient({ apiKey: env.stt.deepgramApiKey });

/** @type {Map<string, Map<string, { stop: () => void }>>} roomId -> (producerId -> session handle) */
const activeRooms = new Map();

// Set once from sttHandler.js's attachStt(io) — needed here to broadcast
// finalized transcript segments live, not just accumulate them silently
// in aiSession. Module-level rather than threaded through every function
// call, matching this file's existing pattern of requiring sibling
// modules directly instead of full dependency injection.
let io = null;
function setIo(socketIoInstance) {
  io = socketIoInstance;
}

let nextPort = env.stt.rtpMinPort;
function allocatePort() {
  const port = nextPort;
  nextPort += 2; // leaves a slot in case rtcp-mux is ever turned off
  if (nextPort > env.stt.rtpMaxPort) nextPort = env.stt.rtpMinPort;
  return port;
}

function buildSdp({ port, payloadType, clockRate, channels }) {
  return [
    'v=0',
    'o=- 0 0 IN IP4 127.0.0.1',
    's=CallMateAI STT capture',
    'c=IN IP4 127.0.0.1',
    't=0 0',
    `m=audio ${port} RTP/AVP ${payloadType}`,
    `a=rtpmap:${payloadType} opus/${clockRate}/${channels}`,
    'a=rtcp-mux',
    '',
  ].join('\n');
}

/** Starts capturing one audio producer. No-op (returns null) if the room/producer no longer exists. */
async function startCapture(roomId, peerId, producerId) {
  const room = sfuRoomState.getRoom(roomId);
  if (!room) return null;

  const rtpPort = allocatePort();

  const transport = await room.router.createPlainTransport({
    listenIp: '127.0.0.1',
    rtcpMux: true,
    comedia: false,
  });

  let consumer;
  try {
    consumer = await transport.consume({
      producerId,
      rtpCapabilities: room.router.rtpCapabilities,
      paused: true,
    });
  } catch (error) {
    console.error(`[STT][${roomId}][${peerId}] consume failed:`, error.message);
    transport.close();
    return null;
  }

  await transport.connect({ ip: '127.0.0.1', port: rtpPort });

  const displayName = roomManager.getPeer(roomId, peerId)?.displayName ?? 'Guest';

  const codec = consumer.rtpParameters.codecs[0];
  const sdpPath = path.join(os.tmpdir(), `stt-${roomId}-${peerId}-${Date.now()}.sdp`);
  fs.writeFileSync(
    sdpPath,
    buildSdp({
      port: rtpPort,
      payloadType: codec.payloadType,
      clockRate: codec.clockRate,
      channels: codec.channels || 2,
    })
  );

  const ffmpeg = spawn('ffmpeg', [
    '-protocol_whitelist', 'file,udp,rtp',
    '-fflags', 'nobuffer',
    '-flags', 'low_delay',
    '-i', sdpPath,
    '-f', 's16le',
    '-ar', '16000',
    '-ac', '1',
    'pipe:1',
  ]);
  ffmpeg.on('error', (error) => {
    console.error(`[STT][${roomId}][${peerId}] ffmpeg spawn error:`, error.message);
  });
  ffmpeg.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[STT][${roomId}][${peerId}] ffmpeg exited with code ${code}`);
    }
  });

  const connection = await deepgram.listen.v1.connect({
    model: 'nova-2',
    encoding: 'linear16',
    sample_rate: 16000,
    channels: 1,
    punctuate: true,
    interim_results: true,
  });

  connection.on('error', (error) => {
    console.error(`[STT][${roomId}][${peerId}] Deepgram error:`, error.message || error);
  });
  connection.on('message', (data) => {
    if (data.type !== 'Results' || !data.is_final) return;
    const transcript = data.channel?.alternatives?.[0]?.transcript;
    if (!transcript) return;

    console.log(`[STT][${roomId}][${peerId}]`, transcript);
    aiSession.addSegment(roomId, { peerId, displayName, text: transcript });
    io?.to(roomId).emit('transcript:segment', { peerId, displayName, text: transcript, at: Date.now() });

    // Durable log, independent of the realtime broadcast above — same
    // posture as chatHandler.js's message persistence: fire-and-forget,
    // a write failure only logs and never blocks/breaks the live path.
    getFirestore()
      .collection('meetings')
      .doc(roomId)
      .collection('transcript')
      .add({ peerId, displayName, text: transcript, at: FieldValue.serverTimestamp() })
      .catch((error) => console.error(`[STT][${roomId}][${peerId}] Failed to persist transcript segment:`, error));
  });

  connection.connect();
  await connection.waitForOpen();

  // ffmpeg's stdout can still emit an already-buffered chunk asynchronously
  // right after kill() — without this guard that chunk hits a closed
  // Deepgram socket, throws inside the stream's 'data' handler, and (being
  // uncaught) takes down the *entire* Node process, not just this session.
  let stopped = false;
  ffmpeg.stdout.on('data', (chunk) => {
    if (stopped) return;
    try {
      connection.sendMedia(chunk);
    } catch (error) {
      console.error(`[STT][${roomId}][${peerId}] sendMedia failed:`, error.message);
    }
  });

  await consumer.resume();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      ffmpeg.kill('SIGKILL');
      connection.close();
      transport.close(); // cascades to close the consumer too
      fs.unlink(sdpPath, () => {});
    },
  };
}

/** `stt:start` — captures every audio producer currently in the room. */
async function startForRoom(roomId) {
  if (activeRooms.has(roomId)) return;

  const sessions = new Map();
  activeRooms.set(roomId, sessions);

  for (const { peerId, producerId } of sfuRoomState.getAudioProducers(roomId)) {
    const session = await startCapture(roomId, peerId, producerId);
    if (session) sessions.set(producerId, session);
  }
}

/**
 * `stt:stop` (and room/peer teardown) — stops every active session for the
 * room, unconditionally. Always clears `roomWanters` too (even though normal
 * `unwantStt` calls already leave it empty by construction) so a room-end
 * teardown called directly (see signalingHandler.js) can't leave stale
 * wanter state behind for a later rejoin reusing the same roomId.
 */
function stopForRoom(roomId) {
  const sessions = activeRooms.get(roomId);
  if (sessions) {
    for (const session of sessions.values()) session.stop();
    activeRooms.delete(roomId);
  }
  roomWanters.delete(roomId);
}

/** Whether STT capture is currently on for a room, for *any* reason (AI, CC, or both). */
function isActiveForRoom(roomId) {
  return activeRooms.has(roomId);
}

/** @type {Map<string, Set<string>>} roomId -> set of feature names ('ai' | 'cc') currently wanting capture running */
const roomWanters = new Map();

/**
 * A feature ('ai' or 'cc') declares it wants STT capture running for a
 * room. Actually starts capture only for the first wanter — a second
 * concurrent wanter just joins the existing capture (startForRoom is
 * itself idempotent via activeRooms.has(), but gating on the wanters set
 * here is what makes unwantStt's refcounting correct).
 */
async function wantStt(roomId, source) {
  let wanters = roomWanters.get(roomId);
  if (!wanters) {
    wanters = new Set();
    roomWanters.set(roomId, wanters);
  }
  const wasEmpty = wanters.size === 0;
  wanters.add(source);
  if (wasEmpty) await startForRoom(roomId);
}

/**
 * A feature declares it no longer wants STT capture. Only actually tears
 * down the pipeline once no feature wants it anymore — e.g. AI Assistant
 * turning off must not kill captions still relying on the same capture.
 */
function unwantStt(roomId, source) {
  const wanters = roomWanters.get(roomId);
  if (!wanters) return;
  wanters.delete(source);
  if (wanters.size === 0) stopForRoom(roomId);
}

/** Whether `source` is currently among the wanters for a room (used for per-feature status queries, e.g. cc:status:query). */
function isWantedBy(roomId, source) {
  return roomWanters.get(roomId)?.has(source) ?? false;
}

/** Stops just one peer's session (used when a single peer leaves, not the whole room). */
function stopForPeer(roomId, producerId) {
  const sessions = activeRooms.get(roomId);
  if (!sessions) return;

  const session = sessions.get(producerId);
  if (!session) return;

  session.stop();
  sessions.delete(producerId);
}

/**
 * Called from sfuHandler.js right after a new producer is announced to the
 * room — only acts if STT capture is already active for that room (someone
 * joining mid-session should also get transcribed).
 */
async function handleNewProducer(roomId, peerId, producerId, kind) {
  if (kind !== 'audio') return;

  const sessions = activeRooms.get(roomId);
  if (!sessions) return; // STT not active for this room

  const session = await startCapture(roomId, peerId, producerId);
  if (session) sessions.set(producerId, session);
}

module.exports = {
  setIo,
  startForRoom,
  stopForRoom,
  stopForPeer,
  handleNewProducer,
  isActiveForRoom,
  wantStt,
  unwantStt,
  isWantedBy,
};
