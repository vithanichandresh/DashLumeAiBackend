const mediasoup = require('mediasoup');
const env = require('../config/env');

/**
 * One mediasoup Worker (native child process) for the whole app process —
 * enough for MVP traffic; multiple workers per CPU core is a future scaling step.
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
