/**
 * Day 17: rolling transcript context window, built on top of Day 16's
 * `aiSession` (which keeps the *full* accumulated transcript for the
 * meeting). "Rolling" here means bounded to the most recent segments, not
 * the whole call — keeps prompts from growing unbounded as a call runs long
 * (PROJECT.md risk #6, cost monitoring), while still covering "what did we
 * discuss earlier" recall for realistically-long meetings.
 *
 * Raised from 40 -> 400 (2026-07-20, user-requested "better retrieval"):
 * 40 was only a few minutes of conversation — a question like "what did we
 * decide about the venue earlier?" easily fell outside that window on any
 * call longer than a short check-in. 400 covers several hours of typical
 * meeting speech + chat (both spoken segments and chat messages are now
 * folded into the same list, see chatHandler.js) while staying well short
 * of an unbounded/full-transcript send (that's what summaryGenerator.js
 * intentionally does instead, but only once, at end-of-call — a live
 * per-question call happens far more often, so it stays bounded here).
 *
 * Segment-count bounded rather than time-bounded — simpler, and a fixed
 * number of recent utterances is a good enough proxy for "recent" without
 * needing to reason about silence gaps.
 */
const aiSession = require('./aiSession');

const MAX_SEGMENTS = 400;

function getWindow(roomId) {
  return aiSession.getTranscript(roomId).slice(-MAX_SEGMENTS);
}

/** Formatted as `Speaker: text` lines, the shape Gemini gets in the prompt. */
function formatWindow(roomId) {
  const window = getWindow(roomId);
  if (window.length === 0) return '(no conversation captured yet)';
  return window.map((segment) => `${segment.displayName}: ${segment.text}`).join('\n');
}

module.exports = { getWindow, formatWindow, MAX_SEGMENTS };
