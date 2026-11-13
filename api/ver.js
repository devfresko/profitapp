const store = require('./_store');
module.exports = async (req, res) => {
  try {
    const meta = await store.getMeta();
    res.status(200).json({ success: true, version: meta ? meta.version : null });
  } catch (e) {
    res.status(200).json({ success: false, error: e.message });
  }
};
