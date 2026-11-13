const { callGas } = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const given = String((req.query && req.query.secret) || req.headers['x-sync-secret'] || '');
  const want = String(process.env.SYNC_SECRET || '');
  if (!want || given !== want) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  try {
    const snap = await callGas('getAllData', {}, '');
    res.status(200).json({ success: true, data: snap });
  } catch (e) {
    res.status(200).json({ success: false, error: e.message });
  }
};
