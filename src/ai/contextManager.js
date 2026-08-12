/**
 * Rolling window over aiSession's full transcript, capped at MAX_SEGMENTS so
 * prompts don't grow unbounded on long calls — summaryGenerator.js is the one place that intentionally sends the full transcript.
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
