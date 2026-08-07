const roomManager = require('./roomManager');
const sfuRoomState = require('../sfu/sfuRoomState');
const sttSession = require('../stt/sttSession');
const aiSession = require('../ai/aiSession');
// No circular-dependency risk — signalingHandler.js doesn't require this file.
const { finalizeMeetingSummary } = require('../sockets/signalingHandler');

const SWEEP_INTERVAL_MS = 30 * 60 * 1000; // 30 min
const IDLE_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4 hours

/**
 * Day 10: defensive safety net, not the primary cleanup path — normal
 * leave/disconnect/end-meeting cleanup already reactively closes rooms via
 * `signalingHandler.js` the moment the last peer leaves. This only catches
 * rooms that somehow never got that signal (process crash mid-call, a
 * stuck edge case), so they don't leak SFU/STT/AI-session resources
 * forever. `roomManager.js`'s own doc comment used to flag this exact gap
 * ("a room that empties out via ordinary leaves would leak its aiSession
 * transcript forever") before the reactive fix landed (2026-07-09) — this
 * is the remaining defense-in-depth layer for cases the reactive path
 * can't reach at all.
 */
function sweep(io) {
  const now = Date.now();
  for (const meetingId of roomManager.getAllRoomIds()) {
    const idleForMs = now - roomManager.getLastActivity(meetingId);
    if (idleForMs < IDLE_THRESHOLD_MS) continue;

    console.warn(`[roomReaper] Force-closing idle room ${meetingId} (idle ${Math.round(idleForMs / 60000)}m)`);
    sfuRoomState.closeRoom(meetingId);
    roomManager.closeRoom(meetingId);
    sttSession.stopForRoom(meetingId);
    // Same ordering as signalingHandler.js's two other teardown paths —
    // reads the transcript synchronously before its first `await`, so it
    // always captures it before aiSession.clearRoom() on the next line,
    // regardless of how long the Gemini call/Firestore write takes. Without
    // this, a room reaped by this defensive idle sweep (the only path that
    // previously skipped it) silently lost its summary/action-items forever.
    finalizeMeetingSummary(meetingId);
    aiSession.clearRoom(meetingId);
    io.to(meetingId).emit('room:ended');
  }
}

/** Returns the interval handle so callers could clearInterval in tests if ever needed. */
function start(io) {
  return setInterval(() => sweep(io), SWEEP_INTERVAL_MS);
}

module.exports = { start, sweep };
