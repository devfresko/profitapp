async function callGas(action, data, token) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 50000);

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
    return { success: false, error: 'GAS call failed: ' + e.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { callGas };
