// Day 15 STT capture manual trigger — connects as a silent Socket.IO peer to
// a real, already-in-progress meeting and emits stt:start/stt:stop. No app
// UI change (that's Day 16's "Add AI Assistant" button) — this fills the gap
// until then. Requires a running backend and a real meeting created/joined
// from the app first (get its ID from the Lobby screen).
//
// Usage: node src/spikes/sttLiveSpike.js <roomId> [durationSeconds=60]
//
// Joins the room under a synthetic test uid ("stt-debug-script") — this
// creates a real (harmless) Firebase Auth user the first time it runs, and
// the other participants' `peer:joined` event will briefly show it as a
// generic-named participant (not visible today since the app's participant
// list doesn't live-update — see TODO.md — but worth knowing).

require('dotenv').config();
const https = require('https');
const { io } = require('socket.io-client');
const env = require('../config/env');
const { initFirebaseAdmin } = require('../config/firebaseAdmin');
const { getAuth } = require('firebase-admin/auth');

const FIREBASE_WEB_API_KEY = 'REDACTED'; // lib/firebase_options.dart, project-level key
const TEST_UID = 'stt-debug-script';

function signInWithCustomToken(customToken) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ token: customToken, returnSecureToken: true });
    const req = https.request(
      {
        hostname: 'identitytoolkit.googleapis.com',
        path: `/v1/accounts:signInWithCustomToken?key=${FIREBASE_WEB_API_KEY}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          const parsed = JSON.parse(data);
          if (parsed.idToken) resolve(parsed.idToken);
          else reject(new Error(`signInWithCustomToken failed: ${data}`));
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const roomId = process.argv[2];
  const durationSeconds = parseInt(process.argv[3], 10) || 60;
  if (!roomId) {
    console.error('Usage: node src/spikes/sttLiveSpike.js <roomId> [durationSeconds]');
    process.exit(1);
  }

  initFirebaseAdmin();
  const customToken = await getAuth().createCustomToken(TEST_UID);
  const idToken = await signInWithCustomToken(customToken);

  const socket = io(`http://localhost:${env.port}`, { auth: { token: idToken } });

  socket.on('connect_error', (error) => {
    console.error('Connection failed:', error.message);
    process.exit(1);
  });

  socket.on('connect', () => {
    console.log(`Connected as ${socket.id}, joining room ${roomId}...`);
    socket.emit('room:join', { roomId, displayName: 'STT Debug Listener' });
  });

  socket.on('room:joined', () => {
    console.log('Joined. Starting STT capture...');
    socket.emit('stt:start', {}, (ack) => {
      if (ack?.error) {
        console.error('stt:start failed:', ack.error);
        process.exit(1);
      }
      console.log(`STT capture started — watch the backend console for [STT][${roomId}][...] lines.`);
      console.log(`Stopping automatically in ${durationSeconds}s (Ctrl+C to stop sooner).`);
    });
  });

  const stopAndExit = () => {
    console.log('Stopping STT capture...');
    socket.emit('stt:stop', {}, () => {
      socket.emit('room:leave');
      socket.disconnect();
      process.exit(0);
    });
  };

  process.on('SIGINT', stopAndExit);
  setTimeout(stopAndExit, durationSeconds * 1000);
}

main().catch((error) => {
  console.error('sttLiveSpike failed:', error.message);
  process.exit(1);
});
