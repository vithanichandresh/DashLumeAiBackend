// Day 19 verification spike — one-off script, not part of the running
// server. Run: node src/spikes/summaryGeneratorSpike.js
// Fake in-memory transcript (same shape aiSession.getTranscript() returns),
// no live call/STT needed — confirms summaryGenerator's real Gemini call +
// JSON parsing round-trip end-to-end.

require('dotenv').config();
const summaryGenerator = require('../ai/summaryGenerator');

const SAMPLE_SEGMENTS = [
  { peerId: 'a', displayName: 'Alex', text: 'Hey team, let\'s sync on the Q3 launch timeline.' },
  { peerId: 'p', displayName: 'Priya', text: 'I think we\'re on track for the 15th, but the payments integration is still pending QA.' },
  { peerId: 'a', displayName: 'Alex', text: 'What\'s blocking QA?' },
  { peerId: 'p', displayName: 'Priya', text: 'We need staging credentials from the payments vendor, requested them yesterday.' },
  { peerId: 'a', displayName: 'Alex', text: 'Ok, I\'ll follow up with them today. Priya, can you draft the release notes in the meantime?' },
  { peerId: 'p', displayName: 'Priya', text: 'Sure, I\'ll have a draft by tomorrow EOD.' },
  { peerId: 'a', displayName: 'Alex', text: 'Great, let\'s reconvene Thursday.' },
];

async function main() {
  // Empty-transcript case first — must no-op, not call Gemini at all.
  const emptyResult = await summaryGenerator.generateSummary([]);
  console.log('Empty transcript result (expect null):', emptyResult);
  if (emptyResult !== null) {
    console.error('FAIL: expected null for an empty transcript');
    process.exit(1);
  }

  const start = Date.now();
  const result = await summaryGenerator.generateSummary(SAMPLE_SEGMENTS);
  const elapsedMs = Date.now() - start;

  console.log(`--- summaryGenerator result (${elapsedMs}ms) ---`);
  console.log(JSON.stringify(result, null, 2));

  if (typeof result.summary !== 'string' || !result.summary.length) {
    console.error('FAIL: summary missing/empty');
    process.exit(1);
  }
  if (!Array.isArray(result.actionItems)) {
    console.error('FAIL: actionItems not an array');
    process.exit(1);
  }

  console.log('PASS');
}

main().catch((err) => {
  console.error('summaryGeneratorSpike failed:', err);
  process.exit(1);
});
