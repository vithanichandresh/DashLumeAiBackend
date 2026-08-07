const sttSession = require('../stt/sttSession');
const aiSession = require('../ai/aiSession');

/**
 * Wired to the "Add AI Assistant" button in `CallScreen`. **Revised**:
 * transcription/STT capture now starts automatically at `room:join`
 * (see `signalingHandler.js`) for the whole meeting — this toggle no
 * longer gates whether capture runs at all, only the AI Assistant tile's
 * own on/off UI state (`aiSession.setToggle`/`isToggleActive`). Whether
 * Gemini actually replies to a chat message is gated separately, on an
 * "@dashLumeAI" mention (`chatHandler.js`), independent of this toggle.
 *
 * Closed Captioning is a second, independent toggle on the same underlying
 * capture pipeline — `sttSession.wantStt`/`unwantStt` refcount by source
 * ('meeting' | 'ai' | 'cc'), so no single toggle turning off ever kills
 * capture another still wants (in practice 'meeting' alone now keeps
 * capture alive for the whole call; 'ai'/'cc' wanting it too is harmless
 * redundancy, kept for symmetry).
 *
 *   client -> server  "stt:start"  ()  -> { started: true }
 *   client -> server  "stt:stop"   ()  -> { stopped: true }
 *   client -> server  "ai:status:query" ()  -> { active: boolean }  (for a peer
 *                                               joining mid-call, to sync the
 *                                               AI Assistant toggle/tile without
 *                                               waiting for the next broadcast)
 *   server -> room      "ai:status"  { active: boolean }  (whole room, including
 *                                      the peer who toggled it — "Add AI
 *                                      Assistant" is a meeting-wide switch, not
 *                                      a per-device one, so everyone's UI must
 *                                      reflect the same state)
 *   client -> server  "cc:start"        ()  -> { started: true }
 *   client -> server  "cc:stop"         ()  -> { stopped: true }
 *   client -> server  "cc:status:query" ()  -> { active: boolean }
 *   server -> room      "cc:status"       { active: boolean }  (mirrors ai:status)
 *   server -> room     "transcript:segment"  { peerId, displayName, text, at }
 *                       — unconditional broadcast, fires whenever capture is
 *                       running at all (AI, CC, or both), no gating here.
 */
function attachStt(io) {
  sttSession.setIo(io);

  io.on('connection', (socket) => {
    socket.on('stt:start', async (_data, callback) => {
      try {
        const roomId = socket.data.roomId;
        if (!roomId) return callback?.({ error: 'Not in a room' });

        // Toggle only flips once capture actually confirmed started — doing
        // this before the await meant a failed wantStt() left the toggle
        // stuck "on" with no rollback, so ai:status:query disagreed with
        // every other client (which never got an ai:status broadcast).
        await sttSession.wantStt(roomId, 'ai');
        aiSession.setToggle(roomId, true);
        io.to(roomId).emit('ai:status', { active: true });
        callback?.({ started: true });
      } catch (error) {
        callback?.({ error: error.message });
      }
    });

    socket.on('stt:stop', (_data, callback) => {
      const roomId = socket.data.roomId;
      if (!roomId) return callback?.({ error: 'Not in a room' });

      sttSession.unwantStt(roomId, 'ai');
      aiSession.setToggle(roomId, false);
      io.to(roomId).emit('ai:status', { active: false });
      callback?.({ stopped: true });
    });

    socket.on('ai:status:query', (_data, callback) => {
      const roomId = socket.data.roomId;
      callback?.({ active: roomId ? aiSession.isToggleActive(roomId) : false });
    });

    socket.on('cc:start', async (_data, callback) => {
      try {
        const roomId = socket.data.roomId;
        if (!roomId) return callback?.({ error: 'Not in a room' });

        await sttSession.wantStt(roomId, 'cc');
        io.to(roomId).emit('cc:status', { active: true });
        callback?.({ started: true });
      } catch (error) {
        callback?.({ error: error.message });
      }
    });

    socket.on('cc:stop', (_data, callback) => {
      const roomId = socket.data.roomId;
      if (!roomId) return callback?.({ error: 'Not in a room' });

      sttSession.unwantStt(roomId, 'cc');
      io.to(roomId).emit('cc:status', { active: false });
      callback?.({ stopped: true });
    });

    socket.on('cc:status:query', (_data, callback) => {
      const roomId = socket.data.roomId;
      callback?.({ active: roomId ? sttSession.isWantedBy(roomId, 'cc') : false });
    });
  });
}

module.exports = { attachStt };
