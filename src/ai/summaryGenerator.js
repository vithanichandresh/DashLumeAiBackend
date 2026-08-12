const { GoogleGenerativeAI } = require('@google/generative-ai');
const env = require('../config/env');

/**
 * Post-call summary + action-item (and suggested title) extraction. Runs
 * once, over the full accumulated transcript, when a meeting ends.
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
    '{"title": "3-6 word title naming the actual topic discussed", "summary": "2-4 sentence summary of what was discussed and decided", "actionItems": ["short action item", "..."]}',
    'The title must be specific to what was actually discussed (e.g. "Q3 Launch Timeline Sync"), plain text, no quotes or trailing punctuation — never a generic label like "Team Meeting" or "Call Summary".',
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
      // Stripped of any stray wrapping quotes Gemini sometimes adds despite
      // the prompt's "no quotes" instruction.
      title: typeof parsed.title === 'string' ? parsed.title.trim().replace(/^["']+|["']+$/g, '') : '',
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      actionItems: Array.isArray(parsed.actionItems)
        ? parsed.actionItems.filter((item) => typeof item === 'string')
        : [],
    };
  } catch (error) {
    // Didn't come back as clean JSON — fall back to the raw text as the
    // summary rather than losing the response entirely.
    return { title: '', summary: cleaned, actionItems: [] };
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
