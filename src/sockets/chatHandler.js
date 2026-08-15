const { getFirestore } = require('firebase-admin/firestore');
const aiSession = require('../ai/aiSession');
const geminiOrchestrator = require('../ai/geminiOrchestrator');

// Fixed sender identity for AI messages — senderUid: null never matches a
// real Firebase uid, so every client's isMine check renders it correctly.
const AI_SENDER_ID = 'ai-assistant';
const AI_SENDER_NAME = 'AI Assistant';

// Gemini replies only when explicitly @-mentioned, case-insensitive, no word boundary required.
const AI_MENTION_REGEX = /@dashlumeai/i;

/**
 * In-call chat, piggybacked on the room joined via room:join
 * (rooms/signalingHandler.js). Broadcast + persisted immediately; Gemini replies only on an "@dashLumeAI" mention — see BACKEND_ARCHITECTURE.md §7.
 */
function attachChat(io) {
  io.on('connection', (socket) => {
    socket.on('chat:message', ({ text }) => {
      if (socket.data.role === 'viewer') return;
      const roomId = socket.data.roomId;
      if (!roomId || !text || !text.trim()) return;

      const trimmedText = text.trim();
      const message = {
        id: `${socket.id}-${Date.now()}`,
        senderId: socket.id,
        // Firebase uid, stable across reconnects — used client-side for
        // "is this my own message" on history loaded before reconnecting.
        senderUid: socket.data.uid,
        senderName: socket.data.displayName || 'Guest',
        text: trimmedText,
        sentAt: new Date().toISOString(),
      };

      broadcastAndPersist(io, roomId, message);

      // Folds every human chat message into the same rolling transcript the AI
      // reads for context, without a transcript:segment broadcast (chat isn't captions).
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

  // The room may have ended while Gemini was in flight — broadcasting into an
  // empty room is a harmless no-op, but skip the Firestore write.
  if (!aiSession.hasSession(roomId)) return;

  broadcastAndPersist(io, roomId, {
    id: `${AI_SENDER_ID}-${Date.now()}`,
    senderId: AI_SENDER_ID,
    senderUid: null,
    senderName: AI_SENDER_NAME,
    text,
    sentAt: new Date().toISOString(),
  });

  // Fold the AI's own reply into the same transcript timeline as human speech.
  aiSession.addSegment(roomId, { peerId: AI_SENDER_ID, displayName: AI_SENDER_NAME, text });
  io.to(roomId).emit('transcript:segment', { peerId: AI_SENDER_ID, displayName: AI_SENDER_NAME, text, at: Date.now() });
}

module.exports = { attachChat };
