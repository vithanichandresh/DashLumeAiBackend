const sttSession = require('../stt/sttSession');
const aiSession = require('../ai/aiSession');

/**
 * AI Assistant and Closed Captions are independent toggles on one shared,
 * refcounted STT pipeline (sttSession.wantStt/unwantStt) — event/payload reference: BACKEND_ARCHITECTURE.md §8.
 */
function attachStt(io) {
  sttSession.setIo(io);

  io.on('connection', (socket) => {
    socket.on('stt:start', async (_data, callback) => {
      try {
        const roomId = socket.data.roomId;
        if (!roomId) return callback?.({ error: 'Not in a room' });

        // Flip the toggle only after capture confirms started, so a failed
        // wantStt() can't strand it "on" with no rollback.
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
