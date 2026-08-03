const { GoogleGenerativeAI } = require('@google/generative-ai');
const env = require('../config/env');
const contextManager = require('./contextManager');

/**
 * Day 17/18: prompt orchestration — one chat message in, one Gemini
 * Flash-Lite response out, grounded in the meeting's rolling transcript
 * context. Same model already proven reachable in the Day 1 spike
 * (`spikes/geminiSpike.js`, ~1.8s latency).
 *
 * Deliberately stateless beyond the transcript window — no separate
 * chat-with-AI conversation memory. No intent-classification step either:
 * per the Day 17 decision ("any chat message while AI active" triggers a
 * response, no @-mention/special syntax), a single general-purpose prompt
 * covers all of PROJECT.md's AI capabilities (answer questions, explain
 * concepts, translate, brainstorm) — Gemini itself infers which mode a
 * given message calls for from its wording, the same way a human assistant
 * would. This keeps the plumbing identical to Day 17; Day 18 only widens
 * the system prompt so the model doesn't stay narrowly framed as "answer
 * factual questions only."
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
    // Lower than the API default (which skews toward more varied/creative
    // output) — this is Q&A grounded in a real transcript, not creative
    // writing, so favor consistent/factual answers over variety.
    generationConfig: { temperature: 0.3 },
    // Google Search grounding — verified via spikes/groundingSpike.js that
    // this SDK/model forwards `tools` untouched to the REST API and it
    // actually returns current data (e.g. real Flutter SDK version, current
    // GST rate) instead of stale training-data answers.
    tools: [{ googleSearch: {} }],
  });
  const result = await model.generateContent(buildPrompt(roomId, message));
  return result.response.text();
}

module.exports = { generateResponse };
