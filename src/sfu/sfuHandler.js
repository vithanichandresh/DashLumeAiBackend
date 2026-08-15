const env = require('../config/env');
const sfuRoomState = require('./sfuRoomState');
const sttSession = require('../stt/sttSession');

/**
 * mediasoup SFU signaling RPCs (ack-style request/response) — presence stays
 * in rooms/signalingHandler.js. Event/payload reference: BACKEND_ARCHITECTURE.md §8.
 */
function attachSfu(io) {
  io.on('connection', (socket) => {
    socket.on('sfu:getRtpCapabilities', async (_data, callback) => {
      try {
        const roomId = socket.data.roomId;
        if (!roomId) return callback({ error: 'Not in a room' });

        const room = await sfuRoomState.getOrCreateRoom(roomId);
        callback({ rtpCapabilities: room.router.rtpCapabilities });
      } catch (error) {
        callback({ error: error.message });
      }
    });

    socket.on('sfu:createTransport', async ({ direction }, callback) => {
      try {
        if (direction === 'send' && socket.data.role === 'viewer') {
          return callback({ error: 'Viewers cannot publish media' });
        }

        const roomId = socket.data.roomId;
        const room = sfuRoomState.getRoom(roomId);
        if (!room) return callback({ error: 'Room not found — call sfu:getRtpCapabilities first' });

        const transport = await room.router.createWebRtcTransport({
          listenInfos: [
            { protocol: 'udp', ip: '0.0.0.0', announcedAddress: env.mediasoup.announcedAddress },
            { protocol: 'tcp', ip: '0.0.0.0', announcedAddress: env.mediasoup.announcedAddress },
          ],
          enableUdp: true,
          enableTcp: true,
          preferUdp: true,
        });

        const peer = sfuRoomState.getOrCreatePeerState(roomId, socket.id);
        if (direction === 'send') peer.sendTransport = transport;
        else peer.recvTransport = transport;

        callback({
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        });
      } catch (error) {
        callback({ error: error.message });
      }
    });

    socket.on('sfu:connectTransport', async ({ transportId, dtlsParameters }, callback) => {
      try {
        const roomId = socket.data.roomId;
        const peer = sfuRoomState.getOrCreatePeerState(roomId, socket.id);
        const transport = [peer.sendTransport, peer.recvTransport].find((t) => t?.id === transportId);
        if (!transport) return callback({ error: 'Transport not found' });

        await transport.connect({ dtlsParameters });
        callback({ connected: true });
      } catch (error) {
        callback({ error: error.message });
      }
    });

    socket.on('sfu:produce', async ({ transportId, kind, rtpParameters }, callback) => {
      try {
        if (socket.data.role === 'viewer') {
          return callback({ error: 'Viewers cannot publish media' });
        }

        const roomId = socket.data.roomId;
        const peer = sfuRoomState.getOrCreatePeerState(roomId, socket.id);
        if (!peer.sendTransport || peer.sendTransport.id !== transportId) {
          return callback({ error: 'Send transport not found' });
        }

        const producer = await peer.sendTransport.produce({ kind, rtpParameters });
        peer.producers.set(kind, producer);

        socket.to(roomId).emit('sfu:newProducer', { peerId: socket.id, producerId: producer.id, kind });
        sttSession.handleNewProducer(roomId, socket.id, producer.id, kind).catch((error) => {
          console.error(`[STT][${roomId}][${socket.id}] handleNewProducer failed:`, error.message);
        });

        callback({ id: producer.id });
      } catch (error) {
        callback({ error: error.message });
      }
    });

    socket.on('sfu:consume', async ({ producerId, rtpCapabilities }, callback) => {
      try {
        const roomId = socket.data.roomId;
        const room = sfuRoomState.getRoom(roomId);
        if (!room) return callback({ error: 'Room not found' });

        if (!room.router.canConsume({ producerId, rtpCapabilities })) {
          return callback({ error: 'Cannot consume this producer with the given rtpCapabilities' });
        }

        const peer = sfuRoomState.getOrCreatePeerState(roomId, socket.id);
        if (!peer.recvTransport) return callback({ error: 'Recv transport not found' });

        // Created paused — client resumes once it's ready to render, so the
        // server doesn't request a keyframe before the client can draw it.
        const consumer = await peer.recvTransport.consume({ producerId, rtpCapabilities, paused: true });
        peer.consumers.set(producerId, consumer);

        callback({
          id: consumer.id,
          producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        });
      } catch (error) {
        callback({ error: error.message });
      }
    });

    socket.on('sfu:resumeConsumer', async ({ producerId }, callback) => {
      try {
        const roomId = socket.data.roomId;
        const peer = sfuRoomState.getOrCreatePeerState(roomId, socket.id);
        const consumer = peer.consumers.get(producerId);
        if (!consumer) return callback?.({ error: 'Consumer not found' });

        await consumer.resume();
        callback?.({ resumed: true });
      } catch (error) {
        callback?.({ error: error.message });
      }
    });

    socket.on('sfu:getExistingProducers', (_data, callback) => {
      const roomId = socket.data.roomId;
      callback(sfuRoomState.getOtherProducers(roomId, socket.id));
    });
  });
}

module.exports = { attachSfu };
