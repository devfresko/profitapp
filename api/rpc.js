// POST /api/rpc  { action, data }   Authorization: Bearer <token>
const { handle } = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST only' });

  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
    const out = await handle(String(b.action || ''), b.data || {}, token);
    res.status(200).json(out === undefined ? { success: true } : out);
  } catch (e) {
    res.status(200).json({ success: false, error: e.message });
  }
};
