const { getFirestore } = require('firebase-admin/firestore');
const aiSession = require('../ai/aiSession');
const geminiOrchestrator = require('../ai/geminiOrchestrator');

// Fixed sender identity for AI-generated messages. `senderUid: null` never
// equals a real Firebase uid, so every client's `isMine` check (which
// compares against `FirebaseAuth.currentUser?.uid`) correctly renders it
// as not-mine for everyone — see the 2026-07-06 LESSONS.md chat entry on
// why `isMine` compares uid, not the ephemeral `senderId`.
const AI_SENDER_ID = 'ai-assistant';
const AI_SENDER_NAME = 'AI Assistant';

// Gemini only replies when explicitly mentioned — not on every chat message
// while some toggle happens to be on. Case-insensitive, no word-boundary
// requirement (matches "@callMetaAi", "@callmetaai", "hey @CallMetaAI can you...").
const AI_MENTION_REGEX = /@callmetaai/i;

/**
 * In-call text chat — piggybacks on the Socket.IO room a client already
 * joined via `room:join` in signalingHandler.js (same connection, same
 * room, no separate join handshake). Chat is therefore only available
 * while a call is active, matching the "in-call text chat" scope in
 * PROJECT.md.
 *
 *   client -> server  "chat:message"  { text }
 *   server -> room     "chat:message"  { id, senderId, senderName, text, sentAt }
 *
 * Broadcast goes to the whole room including the sender (`io.to`, not
 * `socket.to`) — the server is the single source of truth for the
 * message list, the client doesn't locally echo its own sends.
 *
 * Also persisted to Firestore at `meetings/{roomId}/messages/{id}` so chat
 * history survives past the live socket session (e.g. a late joiner, or a
 * future meeting-history screen). The realtime path (Socket.IO) and the
 * durable path (Firestore) are independent — a Firestore write failure
 * logs but never blocks/breaks the live broadcast.
 *
 * **Revised**: Gemini replies only when a chat message mentions
 * "@callMetaAi" (`AI_MENTION_REGEX`), regardless of whether "Add AI
 * Assistant" was ever toggled on — the mention alone is enough. The
 * response is grounded in the rolling transcript context
 * (`ai/contextManager.js`, reads `aiSession.getTranscript`, which now
 * accumulates from the moment the meeting started, not from the AI
 * toggle) — broadcast back into the same chat as a second message from a
 * fixed "AI Assistant" sender, and also appended into that same transcript
 * (`aiSession.addSegment` + a `transcript:segment` broadcast) so the
 * AI's own replies show up in the live transcript/captions and feed the
 * post-call summary, not just human speech. Runs after the human message
 * is already broadcast/persisted, and never blocks it — a slow or failed
 * Gemini call only delays/drops the AI's own reply, not the person's
 * original message.
 */
function attachChat(io) {
  io.on('connection', (socket) => {
    socket.on('chat:message', ({ text }) => {
      const roomId = socket.data.roomId;
      if (!roomId || !text || !text.trim()) return;

      const trimmedText = text.trim();
      const message = {
        id: `${socket.id}-${Date.now()}`,
        senderId: socket.id,
        // Firebase uid — stable across reconnects/sessions, unlike
        // senderId (socket.id). Used client-side to decide "is this my
        // own message" for historical messages loaded before the current
        // socket has (re)connected.
        senderUid: socket.data.uid,
        senderName: socket.data.displayName || 'Guest',
        text: trimmedText,
        sentAt: new Date().toISOString(),
      };

      broadcastAndPersist(io, roomId, message);

      // Folds every human chat message into the same rolling transcript the
      // AI reads for context — previously only the AI's own replies were
      // added here (see respondAsAi below), so a follow-up like "what did
      // I just ask you?" had no way to see the original *question*, only
      // the AI's prior answer. Chat text has no STT path of its own (unlike
      // spoken audio), so this can't double-count. Deliberately not also
      // broadcasting `transcript:segment` for this — Transcript/Captions
      // are meant to reflect spoken content (plus the AI's own replies,
      // which already broadcast below), not every typed chat message.
      aiSession.addSegment(roomId, { peerId: message.senderId, displayName: message.senderName, text: trimmedText });

      if (AI_MENTION_REGEX.test(trimmedText)) {
        respondAsAi(io, roomId, trimmedText);
      }
    });
  });
}

function broadcastAndPersist(io, roomId, message) {
  io.to(roomId).emit('chat:message', message);

  getFirestore()
    .collection('meetings')
    .doc(roomId)
    .collection('messages')
    .doc(message.id)
    .set(message)
    .catch((error) => console.error(`Failed to persist chat message ${message.id}:`, error));
}

async function respondAsAi(io, roomId, message) {
  let text;
  try {
    text = await geminiOrchestrator.generateResponse(roomId, message);
  } catch (error) {
    console.error(`[AI][${roomId}] Gemini orchestration failed:`, error.message);
    text = "Sorry, I couldn't come up with a response just now.";
  }

  // The room may have ended while the Gemini call was in flight (it's the
  // only genuinely slow step in this whole path) — broadcasting into a
  // room nobody's in anymore is harmless (Socket.IO no-ops), but skip the
  // Firestore write since there's nothing meaningful to attach it to.
  if (!aiSession.hasSession(roomId)) return;

  broadcastAndPersist(io, roomId, {
    id: `${AI_SENDER_ID}-${Date.now()}`,
    senderId: AI_SENDER_ID,
    senderUid: null,
    senderName: AI_SENDER_NAME,
    text,
    sentAt: new Date().toISOString(),
  });

  // Fold the AI's own reply into the same transcript timeline as human
  // speech — so it's grounded in later Gemini calls' context, shows up
  // live in TranscriptPanel/captions, and feeds the post-call summary.
  aiSession.addSegment(roomId, { peerId: AI_SENDER_ID, displayName: AI_SENDER_NAME, text });
  io.to(roomId).emit('transcript:segment', { peerId: AI_SENDER_ID, displayName: AI_SENDER_NAME, text, at: Date.now() });
}

module.exports = { attachChat };
