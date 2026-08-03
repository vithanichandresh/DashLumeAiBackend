const mediasoup = require('mediasoup');
const env = require('../config/env');

/**
 * One mediasoup Worker for the whole process (a native child process that
 * does the actual media routing). One worker is enough for MVP traffic —
 * scaling to multiple workers (one per CPU core, routers distributed across
 * them) is a real future step, not needed yet.
 */
let worker;

async function initMediasoupWorker() {
  worker = await mediasoup.createWorker({
    logLevel: 'warn',
    rtcMinPort: env.mediasoup.minPort,
    rtcMaxPort: env.mediasoup.maxPort,
  });

  worker.on('died', (error) => {
    console.error('mediasoup worker died, exiting:', error);
    process.exit(1);
  });

  return worker;
}

function getWorker() {
  if (!worker) throw new Error('mediasoup worker not initialized — call initMediasoupWorker() first');
  return worker;
}

module.exports = { initMediasoupWorker, getWorker };
