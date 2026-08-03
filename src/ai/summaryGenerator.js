const { GoogleGenerativeAI } = require('@google/generative-ai');
const env = require('../config/env');

/**
 * Day 19: post-call summary + action-item extraction. Runs once, over the
 * *full* accumulated transcript (`aiSession.getTranscript(roomId)`) at the
 * moment a meeting ends — unlike `geminiOrchestrator.js`'s rolling window,
 * this isn't bounded to the last `MAX_SEGMENTS`, since it only ever runs
 * once per meeting, not per chat message.
 */

let genAI = null;
function client() {
  if (!genAI) {
    if (!env.gemini.apiKey) throw new Error('GEMINI_API_KEY not configured');
    genAI = new GoogleGenerativeAI(env.gemini.apiKey);
  }
  return genAI;
}

function formatTranscript(segments) {
  return segments.map((s) => `${s.displayName}: ${s.text}`).join('\n');
}

function buildPrompt(segments) {
  return [
    'You are summarizing a video call transcript for the meeting record.',
    'Read the full transcript below (spoken, transcribed live via STT — may contain transcription errors) and respond with ONLY a JSON object, no markdown code fences, no commentary, in exactly this shape:',
    '{"summary": "2-4 sentence summary of what was discussed and decided", "actionItems": ["short action item", "..."]}',
    'If no clear action items were discussed, return an empty array for actionItems.',
    '',
    'Transcript:',
    formatTranscript(segments),
  ].join('\n');
}

/** Tolerates Gemini wrapping the JSON in markdown fences despite being asked not to. */
function parseResponse(text) {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/```$/, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      actionItems: Array.isArray(parsed.actionItems)
        ? parsed.actionItems.filter((item) => typeof item === 'string')
        : [],
    };
  } catch (error) {
    // Didn't come back as clean JSON — fall back to the raw text as the
    // summary rather than losing the response entirely.
    return { summary: cleaned, actionItems: [] };
  }
}

/** Returns null (no-op) if there's no transcript to summarize — e.g. AI was never added to the meeting. */
async function generateSummary(segments) {
  if (!segments.length) return null;

  const model = client().getGenerativeModel({ model: 'gemini-flash-lite-latest' });
  const result = await model.generateContent(buildPrompt(segments));
  return parseResponse(result.response.text());
}

module.exports = { generateSummary };
