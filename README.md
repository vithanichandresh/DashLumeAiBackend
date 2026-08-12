# CallMate AI Backend

Express REST API + Socket.IO WebRTC signaling server. See `../PROJECT.md` and `../app_plan/CallMate_AI_Development_Plan.md` for the full architecture context (Days 2, 3, 6-8, 11, 15-19 of the plan all depend on this).

## Setup

```bash
cd backend
npm install
cp .env.example .env
```

Then get a Firebase service account key: Firebase console → Project Settings → Service Accounts → **Generate new private key** (project `callmetaai`). Save the downloaded JSON as `backend/firebase-service-account.json` (already gitignored — never commit it).

```bash
npm run dev   # nodemon, restarts on file change
# or
npm start
```

Server listens on `PORT` from `.env` (default 4000) — matches the Flutter app's `env/.env.dev` (`API_BASE_URL=http://localhost:4000/api`, `SOCKET_URL=http://localhost:4000`).

## What's here

- `src/server.js` — entry point, wires Express + Socket.IO together
- `src/config/` — env loading, Firebase Admin init
- `src/middleware/authMiddleware.js` — Firebase ID token verification, shared by REST routes and the Socket.IO handshake
- `src/routes/health.js` — `GET /health`, public
- `src/routes/iceServers.js` — `GET /api/ice-servers`, protected, returns STUN/TURN config for the client's `RTCPeerConnection`
- `src/rooms/signalingHandler.js` — WebRTC signaling protocol (room join/leave, offer/answer/ICE relay). Event names documented at the top of that file, aligned with `lib/core/network/socket_service.dart`'s existing `joinRoom`/`leaveRoom` helpers.
- `src/rooms/roomManager.js` — in-memory registry of who's connected to each meeting's signaling room. Not persisted — a restart drops active rooms.

## Not done yet

- **TURN vendor not chosen** — `.env.example`'s `TURN_URL`/`TURN_USERNAME`/`TURN_CREDENTIAL` are blank. Only Google's public STUN works right now; calls behind restrictive NATs will fail until a TURN provider is set up (self-hosted coturn or managed).
- **No meeting-room REST endpoints** — meeting metadata (title, host, etc.) is written directly to Firestore by the Flutter client (see `lib/features/meeting`); this backend only tracks *active signaling connections*, keyed by the same meeting ID/code. Intentional — avoids duplicating Firestore as a second source of truth.
- **Days 6-8 (actual WebRTC peer connection code) not built** — this is signaling only. The Flutter side doesn't send/receive `signal` events yet; `features/calling` still targets the old 100ms SDK (see root `TODO.md`/`LESSONS.md`).
- **`socket_service.dart`'s `joinRoom(roomId)` doesn't send `displayName` yet** — the signaling handler defaults it to `'Guest'` if omitted. Small gap for whoever picks up Day 6.
- **8 moderate npm audit findings**, all transitive through `firebase-admin`'s Google Cloud client deps (uuid buffer-bounds issue). Fix requires bumping `firebase-admin` to a new major version (12→14) — not done without checking for breaking API changes first.
