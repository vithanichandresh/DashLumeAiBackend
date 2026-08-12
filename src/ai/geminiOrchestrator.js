const { GoogleGenerativeAI } = require('@google/generative-ai');
const env = require('../config/env');
const contextManager = require('./contextManager');

/**
 * One chat message in, one Gemini Flash-Lite response out, grounded in the
 * meeting's rolling transcript. Stateless beyond that window — no separate chat-with-AI memory, no intent-classification step.
 */

let genAI = null;
function client() {
  if (!genAI) {
    if (!env.gemini.apiKey) throw new Error('GEMINI_API_KEY not configured');
    genAI = new GoogleGenerativeAI(env.gemini.apiKey);
  }
  return genAI;
}

function buildPrompt(roomId, message) {
  return [
    'You are an AI assistant participating in a live video call as a virtual participant.',
    'Participants may address you for any of these:',
    '- Answering questions about the ongoing conversation',
    '- Explaining a technical concept someone mentioned',
    '- Translating something into another language',
    '- Brainstorming/generating ideas on a topic raised in the call',
    "Infer which of these (or a plain follow-up) the message below is asking for — there's no special syntax, just respond to it naturally.",
    "Use the conversation history below for context — it may cover a lot of ground earlier in a long call, so check it carefully before answering, don't assume something wasn't discussed just because it isn't near the end.",
    "You have access to real-time web search. Use it for anything time-sensitive or fact-checkable — current software/SDK versions, prices, tax/legal rates, news, or any other detail that may have changed since your training data — instead of answering from memorized knowledge that could be stale. This is the whole point of you: the caller shouldn't have to leave the call/app to look something up themselves.",
    "If neither the conversation history nor a search turns up enough to answer confidently, say so plainly (e.g. \"I don't see that covered in this call\") instead of guessing or inventing specific facts, names, or numbers.",
    "Keep your response concise — it's shown directly in the call's shared text chat, visible to everyone.",
    '',
    'Conversation history (spoken audio transcribed live, may contain STT errors, plus typed chat messages):',
    contextManager.formatWindow(roomId),
    '',
    `Message: ${message}`,
  ].join('\n');
}

async function generateResponse(roomId, message) {
  const model = client().getGenerativeModel({
    model: 'gemini-flash-lite-latest',
    // Lower than the API default — this is transcript-grounded Q&A, not creative writing.
    generationConfig: { temperature: 0.3 },
    // Google Search grounding — verified via spikes/groundingSpike.js that
    // this SDK forwards `tools` untouched and returns current (non-stale) data.
    tools: [{ googleSearch: {} }],
  });
  const result = await model.generateContent(buildPrompt(roomId, message));
  return result.response.text();
}

module.exports = { generateResponse };
