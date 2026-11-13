const { handle } = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
    const out = await handle(String(b.action || ''), b.data || {}, token);
    res.status(200).json(out || { success: true });
  } catch (e) {
    res.status(200).json({ success: false, error: e.message });
  }
};
