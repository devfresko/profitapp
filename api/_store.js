const zlib = require('zlib');
const crypto = require('crypto');

const CHUNK_BYTES = 900 * 1024;
let _db = null;
let _mem = { version: null, data: null };

function db() {
  if (_db) return _db;
  const { initializeApp, cert, getApps } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  let raw = process.env.FIREBASE_SERVICE_ACCOUNT || '';
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT missing');
  if (raw[0] !== '{') raw = Buffer.from(raw, 'base64').toString();
  const sa = JSON.parse(raw);
  if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  if (!getApps().length) initializeApp({ credential: cert(sa) });
  return (_db = getFirestore());
}

const metaRef = (id) => db().collection('profitappmeta').doc(id);
const chunkRef = (version, i) => db().collection('profitappsnap').doc(version + '_' + i);

async function getMeta() {
  const s = await metaRef('snapshot').get();
  return s.exists ? s.data() : null;
}

async function saveSnapshot(obj) {
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(obj), 'utf8'), { level: 6 });
  const version = Date.now() + '-' + crypto.randomBytes(2).toString('hex');
  const n = Math.max(1, Math.ceil(gz.length / CHUNK_BYTES));

  await Promise.all(Array.from({ length: n }, (_, i) =>
    chunkRef(version, i).set({ v: version, i, data: gz.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES) })
  ));

  const meta = {
    version,
    chunks: n,
    lastUpdate: String(obj.lastUpdate || Date.now()),
    builtAt: Date.now(),
    bytes: gz.length
  };
  await metaRef('snapshot').set(meta);
  _mem = { version, data: obj };
  return meta;
}

async function loadSnapshot(meta) {
  if (_mem.version === meta.version && _mem.data) return _mem.data;
  const refs = Array.from({ length: meta.chunks }, (_, i) => chunkRef(meta.version, i));
  const docs = await db().getAll(...refs);
  if (docs.some(d => !d.exists)) throw new Error('Snapshot chunk missing');
  const parts = docs.map(d => Buffer.from(d.data().data));
  const obj = JSON.parse(zlib.gunzipSync(Buffer.concat(parts)).toString('utf8'));
  _mem = { version: meta.version, data: obj };
  return obj;
}

module.exports = { db, metaRef, getMeta, saveSnapshot, loadSnapshot };
