function fromSnapshot(snap, action) {
  if (!snap) return null;
  if (action === 'getAllData' || action === 'checkLastUpdate') {
    return { success: true, ...snap };
  }
  return null;
}
module.exports = { fromSnapshot };
