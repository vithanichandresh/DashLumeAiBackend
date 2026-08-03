/**
 * Transcript accumulation, per meeting. **Revised**: a session now starts
 * automatically the moment the first peer joins the room
 * (`signalingHandler.js`'s `room:join`), not when "Add AI Assistant" is
 * toggled — transcription runs for the whole meeting regardless of any
 * toggle. Finalized Deepgram segments (see `stt/sttSession.js`) are
 * appended here as they arrive, with speaker attribution; the AI's own
 * chat replies are appended too (see `chatHandler.js`'s `respondAsAi`), so
 * the transcript/context window/post-call summary all reflect the full
 * conversation, not just human speech.
 *
 * `start()` is idempotent (repeat calls, e.g. on rejoin, keep the existing
 * transcript instead of wiping it), and the session is only cleared when
 * the room itself ends (`signalingHandler.js`'s `endCurrentRoom`/
 * `leaveCurrentRoom`).
 *
 * `hasSession()` no longer means "AI Assistant is toggled on" (it's true
 * for the whole meeting now) — that's tracked separately by
 * `setToggle`/`isToggleActive` below, used only for the "Add AI Assistant"
 * tile's own on/off UI state (`sttHandler.js`'s `ai:status`/`ai:status:query`).
 * Whether Gemini actually replies to a chat message is gated on an
 * "@callMetaAi" mention (`chatHandler.js`), independent of both of these.
 *
 * In-memory only, same posture as `roomManager`/`sfuRoomState` — no
 * persistence yet. `contextManager.js` reads `getTranscript()` for its
 * rolling context window; `summaryGenerator.js` is where a final transcript
 * gets stored (Firestore).
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
