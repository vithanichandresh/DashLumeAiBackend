const fs = require('fs');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const env = require('./env');

function loadServiceAccount() {
  const resolvedPath = path.resolve(process.cwd(), env.firebaseServiceAccountPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      `Firebase service account file not found at ${resolvedPath}.\n` +
        'Generate one in the Firebase console: Project Settings > Service Accounts > ' +
        'Generate new private key (project "callmetaai"), save it at that path, and ' +
        'set FIREBASE_SERVICE_ACCOUNT_PATH in backend/.env if you used a different path.'
    );
  }

  return JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
}

let initialized = false;

// v14's modular API (getAuth()/getFirestore(), used by every other file that
// needs Admin SDK access) resolves against the implicit default app once one
// exists — callers never need this function's return value, just to have
// called it first.
function initFirebaseAdmin() {
  if (initialized) return;

  const serviceAccount = loadServiceAccount();
  initializeApp({ credential: cert(serviceAccount) });
  initialized = true;
}

module.exports = { initFirebaseAdmin };
