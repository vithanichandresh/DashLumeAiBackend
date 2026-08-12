const roomManager = require('./roomManager');
const sfuRoomState = require('../sfu/sfuRoomState');
const sttSession = require('../stt/sttSession');
const aiSession = require('../ai/aiSession');
// No circular-dependency risk — signalingHandler.js doesn't require this file.
const { finalizeMeetingSummary } = require('./signalingHandler');

const SWEEP_INTERVAL_MS = 30 * 60 * 1000; // 30 min
const IDLE_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4 hours

/**
 * Defensive safety net only — normal leave/disconnect/end-meeting cleanup
 * already closes rooms reactively via signalingHandler.js. This just catches rooms that never got that signal (e.g. a crash mid-call).
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
    // Same ordering as signalingHandler.js's teardown paths — reads the
    // transcript before aiSession.clearRoom() so the summary is never lost.
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
