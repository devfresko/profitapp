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

const COL = 'profit_meta';

function metaRef(doc = 'snapshot') {
  return db().collection(COL).doc(doc);
}

async function saveSnapshot(data) {
  const ref = metaRef('snapshot');
  const payload = {
    builtAt: Date.now(),
    lastUpdate: String(data.lastUpdate || Date.now()),
    version: String(Date.now()),
    purchase: data.purchase || [],
    sales: data.sales || [],
    expenses: data.expenses || [],
    summary: data.summary || [],
    stats: data.stats || {}
  };
  await ref.set(payload);
  return payload;
}

async function loadSnapshot() {
  const s = await metaRef('snapshot').get();
  return s.exists ? s.data() : null;
}

module.exports = { db, metaRef, saveSnapshot, loadSnapshot, COL };
