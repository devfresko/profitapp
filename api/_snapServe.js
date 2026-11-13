// api/_snapServe.js
// Snapshot se read karne ke helpers (taskapp jaisa)

function fromSnapshot(snap, action, args) {
  if (!snap || !snap.data) return null;
  const d = snap.data;

  switch (action) {
    case 'getAllData':
      return {
        success: true,
        purchase: d.purchase || [],
        sales: d.sales || [],
        expenses: d.expenses || [],
        summary: d.summary || [],
        lastUpdate: d.lastUpdate || snap.lastUpdate || '',
        stats: d.stats || {}
      };

    case 'checkLastUpdate':
      return {
        success: true,
        lastUpdate: d.lastUpdate || snap.lastUpdate || ''
      };

    default:
      return null; // baaki actions GAS pe jayenge
  }
}

function normDate(s) {
  if (!s) return '';
  const str = String(s).trim();
  // DD/MM/YYYY → YYYY-MM-DD
  const m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  // already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  return str;
}

module.exports = { fromSnapshot, normDate };
