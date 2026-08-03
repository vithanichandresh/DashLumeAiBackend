// One-off verification, not part of the running server.
// Run: node src/spikes/groundingOrchestratorCheck.js
// Confirms geminiOrchestrator.generateResponse (the real live chat-response
// path, transcript-context prompt + googleSearch grounding together) returns
// current data, not stale training-data answers — same two questions the
// user reported getting wrong answers to in the live app.

require('dotenv').config();
const orchestrator = require('../ai/geminiOrchestrator');

const ROOM = 'grounding-check-room';
const QUESTIONS = [
  'Can you tell me latest flutter sdk version?',
  'what is latest tax cost of 350 cc engine bike in India?',
];

async function main() {
  for (const q of QUESTIONS) {
    console.log(`\n=== ${q} ===`);
    const answer = await orchestrator.generateResponse(ROOM, q);
    console.log(answer);
  }
}

main().catch((err) => {
  console.error('Check failed:', err);
  process.exit(1);
});
