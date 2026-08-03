require('dotenv').config();

function iceServers() {
  const servers = [{ urls: process.env.STUN_URLS || 'stun:stun.l.google.com:19302' }];

  if (process.env.TURN_URL) {
    servers.push({
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
  }

  return servers;
}

module.exports = {
  port: parseInt(process.env.PORT, 10) || 4000,
  firebaseServiceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './firebase-service-account.json',
  iceServers,
  mediasoup: {
    minPort: parseInt(process.env.MEDIASOUP_MIN_PORT, 10) || 40000,
    maxPort: parseInt(process.env.MEDIASOUP_MAX_PORT, 10) || 40100,
    // Same LAN-IP-vs-localhost lesson as the rest of this backend (see
    // LESSONS.md) — a physical device can't reach 127.0.0.1 on the host,
    // it needs the host's real LAN/public address here.
    announcedAddress: process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1',
  },
  stt: {
    deepgramApiKey: process.env.DEEPGRAM_API_KEY,
    // Port range ffmpeg listens on for RTP forwarded from mediasoup's
    // PlainTransport — distinct from MEDIASOUP_MIN_PORT/MAX_PORT above
    // (that range is mediasoup's own WebRTC transport ports, this is ours).
    rtpMinPort: parseInt(process.env.STT_RTP_MIN_PORT, 10) || 30000,
    rtpMaxPort: parseInt(process.env.STT_RTP_MAX_PORT, 10) || 30100,
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
  },
};
