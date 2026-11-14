const store = require('./_store');
const { fromSnapshot } = require('./_snapServe');

const READS = new Set(['getAllData', 'checkLastUpdate']);

async function callGas(action, data, token) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 50000);
  try {
    const r = await fetch(process.env.GAS_URL, {
      method: 'POST',
      redirect: 'follow',
      signal: ctl.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action,
        data: data || {},
        token: token || '',
        secret: process.env.GAS_SECRET || process.env.API_SECRET
      })
    });
    return await r.json();
  } catch (e) {
    return { success: false, error: 'GAS failed: ' + e.message };
  } finally {
    clearTimeout(t);
  }
}

async function handle(action, data, token) {
  if (READS.has(action)) {
    try {
      const meta = await store.getMeta();
      if (meta) {
        const snap = await store.loadSnapshot(meta);
        const out = fromSnapshot(snap, action);
        if (out) return out;
      }
    } catch (e) {}
  }
  return callGas(action, data, token);
}

module.exports = { handle, callGas, store };
