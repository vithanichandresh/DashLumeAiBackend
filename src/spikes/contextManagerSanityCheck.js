/**
 * Standalone sanity check for `ai/contextManager.js` — pure in-memory
 * logic (rolling window bounding + formatting), no live Deepgram/Gemini
 * needed. Run: node src/spikes/contextManagerSanityCheck.js
 */
const assert = require('assert');
const aiSession = require('../ai/aiSession');
const contextManager = require('../ai/contextManager');

// Empty session — formatWindow must degrade gracefully, not throw/crash.
aiSession.start('ctx-room');
assert.strictEqual(contextManager.formatWindow('ctx-room'), '(no conversation captured yet)');
assert.deepStrictEqual(contextManager.getWindow('ctx-room'), []);

// Under the cap — window includes everything, in order.
aiSession.addSegment('ctx-room', { peerId: 'p1', displayName: 'Alex', text: 'Hello' });
aiSession.addSegment('ctx-room', { peerId: 'p2', displayName: 'Priya', text: 'Hi there' });
assert.strictEqual(contextManager.getWindow('ctx-room').length, 2);
assert.strictEqual(
  contextManager.formatWindow('ctx-room'),
  'Alex: Hello\nPriya: Hi there'
);

// Over the cap — window is bounded to the most recent MAX_SEGMENTS, oldest
// dropped first (this is the actual "rolling" behavior).
aiSession.clearRoom('ctx-room');
aiSession.start('ctx-room');
const total = contextManager.MAX_SEGMENTS + 10;
for (let i = 0; i < total; i++) {
  aiSession.addSegment('ctx-room', { peerId: 'p1', displayName: 'Alex', text: `utterance ${i}` });
}
const window = contextManager.getWindow('ctx-room');
assert.strictEqual(window.length, contextManager.MAX_SEGMENTS);
assert.strictEqual(window[0].text, `utterance ${total - contextManager.MAX_SEGMENTS}`); // oldest kept
assert.strictEqual(window[window.length - 1].text, `utterance ${total - 1}`); // most recent

aiSession.clearRoom('ctx-room');
console.log('contextManager sanity check passed');
