/**
 * Standalone sanity check for `ai/aiSession.js` — pure in-memory logic,
 * no live Deepgram/audio needed to verify it. Same verification pattern
 * as the original `roomManager` join/leave check from Day 3 scaffolding.
 * Run: node src/spikes/aiSessionSanityCheck.js
 */
const assert = require('assert');
const aiSession = require('../ai/aiSession');

// No session yet — addSegment before start() must be a silent no-op, not a crash.
aiSession.addSegment('room-1', { peerId: 'p1', displayName: 'Alex', text: 'ignored' });
assert.deepStrictEqual(aiSession.getTranscript('room-1'), []);
assert.strictEqual(aiSession.hasSession('room-1'), false);

aiSession.start('room-1');
assert.strictEqual(aiSession.hasSession('room-1'), true);

aiSession.addSegment('room-1', { peerId: 'p1', displayName: 'Alex', text: 'Hello there' });
aiSession.addSegment('room-1', { peerId: 'p2', displayName: 'Priya', text: 'Hi Alex' });

const transcript = aiSession.getTranscript('room-1');
assert.strictEqual(transcript.length, 2);
assert.strictEqual(transcript[0].displayName, 'Alex');
assert.strictEqual(transcript[0].text, 'Hello there');
assert.strictEqual(transcript[1].displayName, 'Priya');
assert.ok(typeof transcript[0].at === 'number');

// start() is idempotent — a second call (e.g. re-toggling "Add AI
// Assistant" mid-meeting) must not wipe what's already accumulated.
aiSession.start('room-1');
assert.strictEqual(aiSession.getTranscript('room-1').length, 2);

// A second room's session is fully independent.
aiSession.start('room-2');
aiSession.addSegment('room-2', { peerId: 'p3', displayName: 'Sam', text: 'unrelated' });
assert.strictEqual(aiSession.getTranscript('room-1').length, 2);
assert.strictEqual(aiSession.getTranscript('room-2').length, 1);

aiSession.clearRoom('room-1');
assert.strictEqual(aiSession.hasSession('room-1'), false);
assert.deepStrictEqual(aiSession.getTranscript('room-1'), []);
// Clearing one room must not touch another.
assert.strictEqual(aiSession.hasSession('room-2'), true);

console.log('aiSession sanity check passed');
