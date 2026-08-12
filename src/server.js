const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const env = require('./config/env');
const { initFirebaseAdmin } = require('./config/firebaseAdmin');
const { initMediasoupWorker } = require('./sfu/mediasoupWorker');
const healthRoutes = require('./routes/health');
const iceServersRoutes = require('./routes/iceServers');
const { attachSignaling } = require('./rooms/signalingHandler');
const { attachChat } = require('./sockets/chatHandler');
const { attachSfu } = require('./sfu/sfuHandler');
const { attachStt } = require('./sockets/sttHandler');
const roomReaper = require('./rooms/roomReaper');

async function start() {
  try {
    initFirebaseAdmin();
    await initMediasoupWorker();
  } catch (error) {
    console.error(`\n${error.message}\n`);
    process.exit(1);
  }

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.use('/health', healthRoutes);
  app.use('/api/ice-servers', iceServersRoutes);

  const httpServer = http.createServer(app);
  const io = new Server(httpServer, { cors: { origin: '*' } });
  attachSignaling(io);
  attachChat(io);
  attachSfu(io);
  attachStt(io);
  roomReaper.start(io);

  httpServer.listen(env.port, () => {
    console.log(`CallMate AI backend listening on :${env.port}`);
  });
}

start();
