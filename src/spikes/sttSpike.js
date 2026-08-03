// Day 1 risk spike — one-off script, not part of the running server.
// Run: node src/spikes/sttSpike.js
// Confirms Deepgram is reachable with DEEPGRAM_API_KEY and returns a
// transcript for a short sample audio clip (Deepgram's own public test file,
// no local audio needed).
// SDK is v5 (Fern-generated) — quite different from the older createClient()
// API most tutorials still reference. See node_modules/@deepgram/sdk/README.md
// "Migrating v4 to v5" if this breaks again on an upgrade.

require('dotenv').config();
const { DeepgramClient } = require('@deepgram/sdk');

const SAMPLE_AUDIO_URL = 'https://dpgr.am/spacewalk.wav';

async function main() {
  if (!process.env.DEEPGRAM_API_KEY) {
    console.error('DEEPGRAM_API_KEY not set in backend/.env — aborting.');
    process.exit(1);
  }

  const client = new DeepgramClient();

  const start = Date.now();
  const response = await client.listen.v1.media.transcribeUrl({
    url: SAMPLE_AUDIO_URL,
    model: 'nova-2',
    smart_format: true,
  });
  const elapsedMs = Date.now() - start;

  console.log(`--- Deepgram transcript (${elapsedMs}ms) ---`);
  console.log(response.results.channels[0].alternatives[0].transcript);
}

main().catch((err) => {
  console.error('Deepgram spike failed:', err.message || err);
  process.exit(1);
});
