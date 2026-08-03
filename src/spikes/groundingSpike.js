// Risk spike, one-off — not part of the running server.
// Run: node src/spikes/groundingSpike.js
// Confirms gemini-flash-lite-latest actually returns current (not stale
// training-data) answers when given the googleSearch grounding tool, before
// wiring it into geminiOrchestrator.js's real chat-response path.

require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const QUESTIONS = [
  'What is the latest stable Flutter SDK version?',
  'What is the current GST rate on motorcycles above 350cc in India?',
];

async function ask(model, question, useGrounding) {
  const params = useGrounding ? { tools: [{ googleSearch: {} }] } : {};
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: question }] }],
    ...params,
  });
  const response = result.response;
  const grounded = !!response.candidates?.[0]?.groundingMetadata;
  return { text: response.text(), grounded };
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY not set in backend/.env — aborting.');
    process.exit(1);
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-flash-lite-latest' });

  for (const q of QUESTIONS) {
    console.log(`\n=== Question: ${q} ===`);
    try {
      const ungrounded = await ask(model, q, false);
      console.log(`--- WITHOUT grounding (grounded=${ungrounded.grounded}) ---`);
      console.log(ungrounded.text);
    } catch (err) {
      console.error('WITHOUT grounding failed:', err.message);
    }
    try {
      const grounded = await ask(model, q, true);
      console.log(`--- WITH googleSearch grounding (grounded=${grounded.grounded}) ---`);
      console.log(grounded.text);
    } catch (err) {
      console.error('WITH grounding failed:', err.message);
    }
  }
}

main().catch((err) => {
  console.error('Grounding spike failed:', err);
  process.exit(1);
});
