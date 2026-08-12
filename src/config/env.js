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
    // A physical device can't reach 127.0.0.1 on the host — needs its real LAN/public address.
    announcedAddress: process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1',
  },
  stt: {
    deepgramApiKey: process.env.DEEPGRAM_API_KEY,
    // ffmpeg's RTP-from-mediasoup port range — distinct from MEDIASOUP_MIN/MAX_PORT above (that's mediasoup's own WebRTC ports).
    rtpMinPort: parseInt(process.env.STT_RTP_MIN_PORT, 10) || 30000,
    rtpMaxPort: parseInt(process.env.STT_RTP_MAX_PORT, 10) || 30100,
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
  },
};
