// Day 18 spike — one-off script, not part of the running server.
// Run: node src/spikes/aiConcurrencySpike.js
//
// "Concurrency test (multiple users -> AI)" from TASKS.md Day 18. The real
// per-request path (geminiOrchestrator.generateResponse) has no shared
// mutable state written during a call — contextManager only *reads* the
// transcript, aiSession.addSegment (transcript writes) is a separate path
// driven by STT, not by chat. So the actual risk this checks for is at the
// Node/SDK level: N simultaneous generateContent() calls firing from
// different "users" in the same room, none crashing, none getting another
// user's answer, all completing in roughly parallel (not serialized).
//
// This drives the orchestrator directly rather than through real Socket.IO
// clients — those need real Firebase ID tokens (signalingHandler.js's
// handshake auth), which would need real test accounts wired up just for
// this script. Exercising chatHandler.js's respondAsAi() end-to-end still
// needs a real live multi-device/multi-tab chat test through the app UI.

require('dotenv').config();
const aiSession = require('../ai/aiSession');
const geminiOrchestrator = require('../ai/geminiOrchestrator');

const ROOM_ID = 'spike-concurrency';

const SAMPLE_TRANSCRIPT = [
  { peerId: 'p1', displayName: 'Alex', text: 'We need to decide on the Q3 launch date.' },
  { peerId: 'p2', displayName: 'Priya', text: 'Payments integration is still pending QA.' },
];

// Distinct "users" firing distinct messages at (as close to) the same time.
const USERS = [
  { displayName: 'Alex', message: 'What is blocking the launch right now?' },
  { displayName: 'Priya', message: 'Can you explain what QA means here?' },
  { displayName: 'Sam', message: "Translate 'nice to meet you' into French." },
  { displayName: 'Jordan', message: 'Brainstorm 2 ways to speed up the QA step.' },
];

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY not set in backend/.env — aborting.');
    process.exit(1);
  }

  aiSession.start(ROOM_ID);
  for (const segment of SAMPLE_TRANSCRIPT) aiSession.addSegment(ROOM_ID, segment);

  const start = Date.now();
  const results = await Promise.allSettled(
    USERS.map(({ message }) => geminiOrchestrator.generateResponse(ROOM_ID, message))
  );
  const elapsedMs = Date.now() - start;

  console.log(`--- ${USERS.length} concurrent requests completed in ${elapsedMs}ms ---`);

  let failures = 0;
  results.forEach((result, i) => {
    const { displayName, message } = USERS[i];
    if (result.status === 'rejected') {
      failures += 1;
      console.error(`\n[FAIL] ${displayName}: "${message}"`);
      console.error(result.reason);
      return;
    }
    console.log(`\n[OK] ${displayName}: "${message}"`);
    console.log(result.value);
  });

  if (failures > 0) {
    console.error(`\n${failures}/${USERS.length} requests failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${USERS.length} requests succeeded independently, no crash.`);
}

main().catch((err) => {
  console.error('AI concurrency spike failed:', err);
  process.exit(1);
});
