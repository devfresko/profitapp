const { callGas, store } = require('./_lib');

module.exports = async (req, res) => {
  if (String(req.query.secret || '') !== process.env.SYNC_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  try {
    const snap = await callGas('getSnapshot', {}, '');
    if (snap && snap.success) {
      await store.saveSnapshot(snap);
      // optional sync meta
      await store.metaRef('sync').set({
        lastSyncAt: Date.now(),
        dirty: false,
        syncing: false
      }, { merge: true });
      return res.status(200).json({ success: true, saved: true });
    }
    return res.status(200).json({ success: false, error: (snap && snap.error) || 'getSnapshot failed' });
  } catch (e) {
    return res.status(200).json({ success: false, error: e.message });
  }
};
