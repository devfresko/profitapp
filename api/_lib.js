const crypto = require('crypto');
const store = require('./_store');
const { fromSnapshot } = require('./_snapServe');

const GAS_URL = process.env.GAS_URL;
const GAS_SECRET = process.env.GAS_SECRET || process.env.API_SECRET;

const READ_ACTIONS = new Set(['getAllData', 'checkLastUpdate']);

async function callGas(action, data, token) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 55000);
  try {
    const r = await fetch(GAS_URL, {
      method: 'POST',
      redirect: 'follow',
      signal: ctl.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action,
        data: data || {},
        token: token || '',
        secret: GAS_SECRET
      })
    });
    return await r.json();
  } catch (e) {
    return { success: false, error: 'GAS timeout' };
  } finally {
    clearTimeout(t);
  }
}

async function handle(action, data, token) {
  // Pehle snapshot try karo (fast)
  if (READ_ACTIONS.has(action)) {
    try {
      const snap = await store.loadSnapshot();
      const fromSnap = fromSnapshot(snap, action, data);
      if (fromSnap) return fromSnap;
    } catch (e) {}
  }

  // Fallback to GAS
  return callGas(action, data, token);
}

module.exports = { handle, callGas, store };
