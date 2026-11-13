module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const secret = String(req.query.secret || '');
  if (secret !== process.env.SYNC_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  res.status(200).json({ success: true, message: 'Sync endpoint ready' });
};
