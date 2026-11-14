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
  // Reads
  if (READS.has(action)) {
    try {
      const meta = await store.getMeta();
      if (meta) {
        const snap = await store.loadSnapshot(meta);
        if (snap) return { success: true, ...snap };
      }
    } catch (e) {}
  }

  // Writes
  const result = await callGas(action, data, token);

  // Important: success ke baad turant snapshot refresh
  if (result && result.success && !READS.has(action)) {
    try {
      const fresh = await callGas('getSnapshot', {}, '');
      if (fresh && fresh.success) {
        await store.saveSnapshot(fresh);
      }
    } catch (e) {
      console.error('snapshot refresh failed', e.message);
    }
  }

  return result;
}

module.exports = { handle, callGas, store };
