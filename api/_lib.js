const READS = new Set(['getAllData', 'checkLastUpdate']);

async function handle(action, data, token) {
  if (READS.has(action)) {
    try {
      const meta = await store.getMeta();
      if (meta) {
        const snap = await store.loadSnapshot(meta);
        if (snap) return { success: true, ...snap };
      }
    } catch (e) {}
  }
  return callGas(action, data, token);
}
