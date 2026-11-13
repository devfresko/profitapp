const store = require('./_store');

const READS = new Set(['getAllData', 'checkLastUpdate', 'login']);

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
        action, data: data || {}, token: token || '',
        secret: process.env.GAS_SECRET || process.env.API_SECRET
      })
    });
    return await r.json();
  } catch (e) {
    return { success: false, error: 'GAS failed' };
  } finally { clearTimeout(t); }
}

async function handle(action, data, token) {
  // ── READS from snapshot ──
  if (READS.has(action)) {
    const snap = await store.loadSnapshot();
    if (snap) {
      if (action === 'getAllData' || action === 'checkLastUpdate') {
        return { success: true, ...snap };
      }
      if (action === 'login') {
        // Login still needs GAS for auth, but we can cache user later
        return callGas(action, data, token);
      }
    }
  }

  // ── WRITES go to GAS ──
  const result = await callGas(action, data, token);

  // After successful write, refresh snapshot in background
  if (result && result.success && !READS.has(action)) {
    setTimeout(async () => {
      try {
        const fresh = await callGas('getSnapshot', {}, '');
        if (fresh && fresh.success) await store.saveSnapshot(fresh);
      } catch (e) {}
    }, 500);
  }

  return result;
}

module.exports = { handle, callGas, store };
