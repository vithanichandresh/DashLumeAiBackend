// Day 1 risk spike — one-off script, not part of the running server.
// Run: node src/spikes/geminiSpike.js
// Confirms Gemini Flash-Lite reachability, latency, and output quality
// against a sample meeting transcript before building the real AI pipeline.

require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const SAMPLE_TRANSCRIPT = `
Alex: Hey team, let's sync on the Q3 launch timeline.
Priya: I think we're on track for the 15th, but the payments integration is still pending QA.
Alex: What's blocking QA?
Priya: We need staging credentials from the payments vendor, requested them yesterday.
Alex: Ok, I'll follow up with them today. Priya, can you draft the release notes in the meantime?
Priya: Sure, I'll have a draft by tomorrow EOD.
Alex: Great, let's reconvene Thursday.
`.trim();

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY not set in backend/.env — aborting.');
    process.exit(1);
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-flash-lite-latest' });

  const prompt = `Summarize this meeting transcript in 2-3 sentences, then list action items as a bullet list.\n\nTranscript:\n${SAMPLE_TRANSCRIPT}`;

  const start = Date.now();
  const result = await model.generateContent(prompt);
  const elapsedMs = Date.now() - start;

  console.log(`--- Gemini Flash-Lite response (${elapsedMs}ms) ---`);
  console.log(result.response.text());
}

main().catch((err) => {
  console.error('Gemini spike failed:', err);
  process.exit(1);
});
