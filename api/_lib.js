const crypto = require('crypto');

const GAS_URL = process.env.GAS_URL;
const GAS_SECRET = process.env.GAS_SECRET || process.env.API_SECRET;

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
    return { success: false, error: 'GAS timeout or network error' };
  } finally {
    clearTimeout(t);
  }
}

async function handle(action, data, token) {
  // Direct proxy to GAS (profitapp is simpler than taskapp)
  return callGas(action, data, token);
}

module.exports = { handle, callGas };
