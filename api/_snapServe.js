function fromSnapshot(snap, action) {
  if (!snap) return null;
  switch (action) {
    case 'getAllData':
    case 'checkLastUpdate':
      return { success: true, ...snap };
    default:
      return null;
  }
}
module.exports = { fromSnapshot };
