# DashLume AI Backend

Node.js backend for **DashLume AI** — Express REST API + Socket.IO signaling +
a [mediasoup](https://mediasoup.org/) WebRTC SFU for group video calls, with a
built-in AI meeting assistant (live transcription via Deepgram, summaries and
Q&A via Gemini).

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Features

- **WebRTC video calls** — mediasoup SFU (`src/sfu/`) handles multi-party
  audio/video routing; Socket.IO (`src/rooms/`) handles signaling.
- **Live transcription** — audio is forwarded from mediasoup to ffmpeg over
  RTP and streamed to Deepgram (`src/stt/`).
- **AI meeting assistant** — Gemini-powered summaries and in-call Q&A grounded
  in the live transcript (`src/ai/`).
- **In-call chat** (`src/sockets/chatHandler.js`).
- **Firebase Auth** — REST routes and the Socket.IO handshake are protected by
  Firebase ID token verification (`src/middleware/authMiddleware.js`).

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:
- **Firebase service account** — Firebase console → Project Settings →
  Service Accounts → **Generate new private key**.
  Save the JSON as `firebase-service-account.json` in the repo root (already
  gitignored — never commit it).
- **TURN** — get free credentials from [ExpressTurn](https://www.expressturn.com/).
- **Gemini** — get a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
- **Deepgram** — get a key at [console.deepgram.com](https://console.deepgram.com/).
- **`MEDIASOUP_ANNOUNCED_IP`** — the address clients dial to reach the media
  server. Use your machine's real LAN IP for physical devices (`127.0.0.1`
  only works for the iOS Simulator), or the server's public IP in production.

Requires **Node.js ≥22** and `ffmpeg` on `PATH` (`brew install ffmpeg`) for
the STT audio pipeline.

```bash
npm run dev   # nodemon, restarts on file change
# or
npm start
```

Server listens on `PORT` from `.env` (default `4000`).

## What's here

- `src/server.js` — entry point, wires Express + Socket.IO together
- `src/config/` — env loading, Firebase Admin init
- `src/middleware/authMiddleware.js` — Firebase ID token verification, shared
  by REST routes and the Socket.IO handshake
- `src/routes/` — `GET /health` (public), `GET /api/ice-servers` (protected,
  returns STUN/TURN config for the client's `RTCPeerConnection`)
- `src/rooms/` — signaling protocol (join/leave, room state) and in-memory
  room registry
- `src/sfu/` — mediasoup worker/router setup and the SFU's Socket.IO handlers
  (transports, producers, consumers)
- `src/stt/` — RTP capture from mediasoup → ffmpeg → Deepgram live
  transcription
- `src/ai/` — Gemini session orchestration, context management, and summary
  generation
- `src/sockets/` — chat and STT-related Socket.IO handlers

## Deployment

`.github/workflows/deploy.yml` auto-deploys to a remote server on every push
to `main`: SSHes in via `appleboy/ssh-action`, resets to the latest `main`,
reinstalls dependencies with `npm ci`, and restarts the app under `pm2`.

The server runs the app persistently via `pm2` + a `systemd` unit
(`pm2 startup`), so it survives crashes and reboots.

## Known limitations

- **In-memory room/signaling state** — not persisted; a server restart drops
  active rooms and calls.
- **No meeting-metadata REST endpoints** — meeting metadata (title, host,
  etc.) is written directly to Firestore by the Flutter client; this backend
  only tracks *active* signaling/SFU connections.
- **Some npm audit findings**, mostly transitive through `firebase-admin`'s
  Google Cloud client deps — run `npm audit` for current status before
  upgrading.

## License

[MIT](LICENSE)
