/**
 * Per-meeting transcript accumulator: started idempotently at room:join,
 * cleared only at room end — independent of the "Add AI Assistant" toggle tracked below. In-memory only, same posture as roomManager/sfuRoomState.
 */

/** @type {Map<string, { startedAt: number, segments: Array<{peerId: string, displayName: string, text: string, at: number}> }>} */
const sessions = new Map();

/** @type {Map<string, boolean>} roomId -> whether "Add AI Assistant" is currently toggled on (tile visibility only) */
const aiToggleActive = new Map();

function start(roomId) {
  if (sessions.has(roomId)) return;
  sessions.set(roomId, { startedAt: Date.now(), segments: [] });
}

function addSegment(roomId, { peerId, displayName, text }) {
  const session = sessions.get(roomId);
  if (!session) return; // room:join never fired for this room (shouldn't happen) — nothing to accumulate into
  session.segments.push({ peerId, displayName, text, at: Date.now() });
}

function getTranscript(roomId) {
  return sessions.get(roomId)?.segments ?? [];
}

function hasSession(roomId) {
  return sessions.has(roomId);
}

/** "Add AI Assistant" toggle state — tile visibility only, not a gate on transcript or Gemini replies. */
function setToggle(roomId, active) {
  if (active) aiToggleActive.set(roomId, true);
  else aiToggleActive.delete(roomId);
}

function isToggleActive(roomId) {
  return aiToggleActive.get(roomId) ?? false;
}

function clearRoom(roomId) {
  sessions.delete(roomId);
  aiToggleActive.delete(roomId);
}

module.exports = { start, addSegment, getTranscript, hasSession, setToggle, isToggleActive, clearRoom };
