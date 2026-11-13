const admin = require('firebase-admin');

let _db = null;
function db() {
  if (_db) return _db;
  if (!admin.apps.length) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  }
  _db = admin.firestore();
  return _db;
}

const META_COL = 'profit_meta';   // ← alag naam

function metaRef(doc = 'snapshot') {
  return db().collection(META_COL).doc(doc);
}

async function saveSnapshot(snap, expectedVersion) {
  const ref = metaRef('snapshot');
  const payload = {
    builtAt: Date.now(),
    lastUpdate: String(snap.lastUpdate || Date.now()),
    version: String(Date.now()),
    bytes: JSON.stringify(snap).length,
    chunks: 1,
    data: snap
  };
  await ref.set(payload);
  return payload;
}

async function loadSnapshot() {
  const snap = await metaRef('snapshot').get();
  return snap.exists ? snap.data() : null;
}

async function getMeta() {
  const s = await metaRef('sync').get();
  return s.exists ? s.data() : {};
}

module.exports = { db, metaRef, saveSnapshot, loadSnapshot, getMeta, META_COL };
