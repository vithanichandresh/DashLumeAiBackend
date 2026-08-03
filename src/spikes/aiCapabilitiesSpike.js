// Day 18 spike — one-off script, not part of the running server.
// Run: node src/spikes/aiCapabilitiesSpike.js
//
// Exercises the widened geminiOrchestrator prompt (no intent-classification
// code — a single general prompt is expected to handle all 4 modes) against
// one sample message per PROJECT.md AI capability, using a fake in-memory
// transcript so no live call/STT is needed. Prints each response for manual
// read-through — there's no automated pass/fail for output *quality*, only
// that each call succeeds and returns a non-empty, mode-appropriate answer.

require('dotenv').config();
const aiSession = require('../ai/aiSession');
const geminiOrchestrator = require('../ai/geminiOrchestrator');

const ROOM_ID = 'spike-capabilities';

const SAMPLE_TRANSCRIPT = [
  { peerId: 'p1', displayName: 'Alex', text: "Let's talk about how ICE negotiation works for our WebRTC calls." },
  { peerId: 'p2', displayName: 'Priya', text: 'I still find STUN vs TURN confusing.' },
  { peerId: 'p1', displayName: 'Alex', text: "We're also thinking about launching in Spain next quarter." },
];

const CASES = [
  { label: 'Answer a question about the conversation', message: 'What are we planning to launch and where?' },
  { label: 'Explain a technical concept', message: 'Can you explain what STUN and TURN actually do?' },
  { label: 'Translate a message', message: "Translate 'Let's reconvene Thursday' into Spanish." },
  { label: 'Brainstorm ideas', message: 'Brainstorm 3 ideas for how we could market the Spain launch.' },
];

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY not set in backend/.env — aborting.');
    process.exit(1);
  }

  aiSession.start(ROOM_ID);
  for (const segment of SAMPLE_TRANSCRIPT) aiSession.addSegment(ROOM_ID, segment);

  for (const { label, message } of CASES) {
    const start = Date.now();
    const text = await geminiOrchestrator.generateResponse(ROOM_ID, message);
    const elapsedMs = Date.now() - start;
    console.log(`\n--- ${label} (${elapsedMs}ms) ---`);
    console.log(`> ${message}`);
    console.log(text);
  }
}

main().catch((err) => {
  console.error('AI capabilities spike failed:', err);
  process.exit(1);
});
