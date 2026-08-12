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
 * STT capture pipeline: consumes one mediasoup audio Producer via a
 * PlainTransport, decodes Opus->PCM through ffmpeg, and streams it to one Deepgram live-transcription session per producer.
 */

const deepgram = new DeepgramClient({ apiKey: env.stt.deepgramApiKey });

/** @type {Map<string, Map<string, { stop: () => void }>>} roomId -> (producerId -> session handle) */
const activeRooms = new Map();

// Set once from sttHandler.js's attachStt(io), so finalized segments can be
// broadcast live instead of only accumulated silently in aiSession.
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

/**
 * Starts capturing one audio producer; returns null on any failure (Deepgram
 * outage, port exhaustion, mediasoup error) so callers never see an uncaught throw. Any transport already created is explicitly closed on failure.
 */
async function startCapture(roomId, peerId, producerId) {
  const room = sfuRoomState.getRoom(roomId);
  if (!room) return null;

  const rtpPort = allocatePort();
  let transport;
  let sdpPath;

  try {
    transport = await room.router.createPlainTransport({
      listenIp: '127.0.0.1',
      rtcpMux: true,
      comedia: false,
    });

    const consumer = await transport.consume({
      producerId,
      rtpCapabilities: room.router.rtpCapabilities,
      paused: true,
    });

    await transport.connect({ ip: '127.0.0.1', port: rtpPort });

    const displayName = roomManager.getPeer(roomId, peerId)?.displayName ?? 'Guest';

    const codec = consumer.rtpParameters.codecs[0];
    sdpPath = path.join(os.tmpdir(), `stt-${roomId}-${peerId}-${Date.now()}.sdp`);
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

      // Durable log, fire-and-forget — same posture as chatHandler.js's message persistence.
      getFirestore()
        .collection('meetings')
        .doc(roomId)
        .collection('transcript')
        .add({ peerId, displayName, text: transcript, at: FieldValue.serverTimestamp() })
        .catch((error) => console.error(`[STT][${roomId}][${peerId}] Failed to persist transcript segment:`, error));
    });

    connection.connect();
    await connection.waitForOpen();

    // ffmpeg's stdout can emit an already-buffered chunk after kill() — this
    // guard stops it from hitting a closed Deepgram socket and crashing the process.
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
  } catch (error) {
    console.error(`[STT][${roomId}][${peerId}] startCapture failed:`, error.message);
    transport?.close();
    if (sdpPath) fs.unlink(sdpPath, () => {});
    return null;
  }
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
 * Stops every active session for the room, unconditionally. Always clears
 * roomWanters too, so a direct room-end teardown can't leave stale wanter state for a later rejoin.
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
 * A feature declares it wants STT capture running. Only the first wanter
 * actually starts capture — gating on the wanters set here is what makes unwantStt's refcounting correct.
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
 * A feature declares it no longer wants capture. Only tears the pipeline
 * down once nobody wants it anymore — e.g. AI Assistant turning off must not kill captions.
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
 * Called right after a new producer is announced to the room — only acts if
 * STT capture is already active for that room (mid-call joiners get transcribed too).
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
