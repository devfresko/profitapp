// Fresko P&L Tracker — app.js
// PWA + GitHub Pages + GAS JSONP Architecture
// Version 2.0

'use strict';

/* ─────────────────────────────────────────────────────────
   STATE
───────────────────────────────────────────────────────── */
let USER   = null;
let _TOKEN = null;   // PWA: token stored from login response
let DB     = { stats:{}, purchases:[], sales:[], expenses:[], summary:[], chart:{}, partyMap:{} };
let UI     = { view:'dashboard', sbCollapsed:false, pollerTimer:null };
let _charts = {};
let _page   = { purchase:1, sales:1, expenses:1 };
const PER   = 20;

// Restore session from localStorage (PWA stays logged in)
(function _restoreSession() {
  try {
    const saved = localStorage.getItem('fresko_session');
    if (saved) {
      const s = JSON.parse(saved);
      USER   = s.user;
      _TOKEN = s.token;
    }
  } catch(e) {}
})();
const MONTHS = ['JANUARY 2026','FEBRUARY 2026','MARCH 2026','APRIL 2026','MAY 2026',
  'JUNE 2026','JULY 2026','AUGUST 2026','SEPTEMBER 2026','OCTOBER 2026',
  'NOVEMBER 2026','DECEMBER 2026','JANUARY 2027','FEBRUARY 2027','MARCH 2027'];
let _lastChange = '0';

/* ─────────────────────────────────────────────────────────
   PWA — JSONP API LAYER  (replaces google.script.run)
   Architecture: GitHub Pages → JSONP → GAS doGet
───────────────────────────────────────────────────────── */

// ⚠️  GAS deployment URL yahan daalo (Deploy → New → Web App → Anyone)
var API = 'https://script.google.com/macros/s/AKfycbzjFp3cNBSxVib6xtYyFyPiy2dRfhdtcHBJjE2pcxkH_DLOnSP8hKIKPxn5Tf9Ck_IA/exec';

var _cbIdx = 0;

function _api(action, data, ok, err) {
  const cbName = '_gcb' + (++_cbIdx);
  let timeout;

  window[cbName] = function(r) {
    clearTimeout(timeout);
    try { delete window[cbName]; } catch(e) {}
    const sc = document.getElementById('_s_' + cbName);
    if (sc) sc.remove();
    // Auto sign-out if not authenticated
    if (r && r.success === false && r.error === 'NOT_AUTHENTICATED') {
      toast('Session expired. Please login again.', 'warning');
      setTimeout(() => location.reload(), 1500);
      return;
    }
    if (ok) ok(r);
  };

  timeout = setTimeout(function() {
    try { delete window[cbName]; } catch(e) {}
    const sc = document.getElementById('_s_' + cbName);
    if (sc) sc.remove();
    if (err) err({ message: 'Request timed out. Network check karein.' });
  }, 25000);

  const payload = encodeURIComponent(JSON.stringify({
    action: action,
    data:   data   || {},
    token:  _TOKEN || ''
  }));

  const s    = document.createElement('script');
  s.id       = '_s_' + cbName;
  s.src      = API + '?callback=' + cbName + '&payload=' + payload;
  s.onerror  = function() {
    clearTimeout(timeout);
    try { delete window[cbName]; } catch(e) {}
    this.remove();
    if (err) err({ message: 'Network error. GAS URL check karein.' });
  };
  document.head.appendChild(s);
}

/* ═══════════════════════════════════════════════════════════
   WHATSAPP INTEGRATION — MessageAutoSender API
   Triggers: login success, purchase save, sale save, expense save
═══════════════════════════════════════════════════════════ */

var WA_API_KEY   = '01de01ec7d489783060e2fdc535a87ca5e963b7baba7e95ff3';
var WA_BASIC_AUTH = 'ZnJlc2tvOkFHUk9AQEAyMDI2';
var WA_API_URL   = 'https://app.messageautosender.com/api/v1/message/create';

// Admin WhatsApp numbers to notify (include country code, no +)
var WA_ADMIN_NUMBERS = [
  '919999999999'   // ← replace with actual Fresko admin number(s)
];

function _waSend(mobileNos, message) {
  try {
    var url = WA_API_URL
      + '?apiKey=' + WA_API_KEY
      + '&receiverMobileNo=' + encodeURIComponent(mobileNos.join(','))
      + '&message=' + encodeURIComponent(message);

    fetch(url, {
      method: 'GET',
      headers: { 'Authorization': 'Basic ' + WA_BASIC_AUTH }
    }).then(function(r) {
      console.log('[WA] Status:', r.status);
    }).catch(function(e) {
      console.warn('[WA] Error:', e.message);
    });
  } catch(e) {
    console.warn('[WA] Send failed:', e.message);
  }
}

function _waNotify(event, data) {
  if (!WA_ADMIN_NUMBERS || !WA_ADMIN_NUMBERS.length) return;
  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true,
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
  let msg = '';

  switch(event) {
    case 'login':
      msg = '🔐 *Fresko P&L — Login Alert*\n'
          + '━━━━━━━━━━━━━━━━━━\n'
          + '👤 *Name:* ' + (data.name || '—') + '\n'
          + '📧 *Email:* ' + (data.email || '—') + '\n'
          + '🏢 *Dept:* ' + (data.dept || '—') + '\n'
          + '⏰ *Time:* ' + now + '\n'
          + '━━━━━━━━━━━━━━━━━━\n'
          + '_Fresko P&L Tracker_';
      break;

    case 'purchase':
      msg = '🛒 *Fresko — Purchase Entry Added*\n'
          + '━━━━━━━━━━━━━━━━━━\n'
          + '📅 *Date:* ' + (data.date || '—') + '\n'
          + '📦 *Qty:* ' + _fmt0(data.qty) + '\n'
          + '💰 *Amount:* ₹' + _fmt(data.amount) + '\n'
          + '👤 *By:* ' + (USER ? USER.name : '—') + '\n'
          + '⏰ *Time:* ' + now + '\n'
          + '━━━━━━━━━━━━━━━━━━\n'
          + '_Fresko P&L Tracker_';
      break;

    case 'sale':
      msg = '🚚 *Fresko — Sale Entry Added*\n'
          + '━━━━━━━━━━━━━━━━━━\n'
          + '📅 *Date:* ' + (data.date || '—') + '\n'
          + '🏷️ *Party:* ' + (data.party || '—') + '\n'
          + '📦 *Qty:* ' + _fmt0(data.qty) + '\n'
          + '💰 *Amount:* ₹' + _fmt(data.amount) + '\n'
          + '👤 *By:* ' + (USER ? USER.name : '—') + '\n'
          + '⏰ *Time:* ' + now + '\n'
          + '━━━━━━━━━━━━━━━━━━\n'
          + '_Fresko P&L Tracker_';
      break;

    case 'expense':
      msg = '💸 *Fresko — Expense Entry Added*\n'
          + '━━━━━━━━━━━━━━━━━━\n'
          + '📅 *Month:* ' + (data.month || '—') + '\n'
          + '💰 *Amount:* ₹' + _fmt(data.amount) + '\n'
          + '👤 *By:* ' + (USER ? USER.name : '—') + '\n'
          + '⏰ *Time:* ' + now + '\n'
          + '━━━━━━━━━━━━━━━━━━\n'
          + '_Fresko P&L Tracker_';
      break;

    default: return;
  }

  _waSend(WA_ADMIN_NUMBERS, msg);
}

// Helper (safe: may be called before fmt is defined)
function _fmt(n)  { return Math.round(Math.abs(Number(n)||0)).toLocaleString('en-IN'); }
function _fmt0(n) { return Math.round(Number(n)||0).toLocaleString('en-IN'); }


/* ─────────────────────────────────────────────────────────
   LOGIN
───────────────────────────────────────────────────────── */
// lg-year is set in window.load handler safely

function toggleEye(btn) {
  const inp = document.getElementById('f-pass');
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  const ico = btn ? btn.querySelector('i') : null;
  if (ico) ico.className = show ? 'fas fa-eye-slash' : 'fas fa-eye';
}

function showLgErr(msg) {
  const el = document.getElementById('eb');
  document.getElementById('eb-txt').textContent = msg;
  el.classList.add('active');
}
function hideLgErr() { document.getElementById('eb').classList.remove('show'); }

function doLogin() {
  hideLgErr();
  const email = document.getElementById('f-email').value.trim().toLowerCase();
  const pass  = document.getElementById('f-pass').value.trim();
  if (!email) { showLgErr('Email address daalna zaroori hai.'); return; }
  if (!pass)  { showLgErr('Password daalna zaroori hai.'); return; }

  const btn = document.getElementById('login-btn');
  btn.classList.add('busy');

  _api('login', { email, password: pass },
    res => {
      btn.classList.remove('busy');
      if (res && res.success) {
        USER   = res.user;
        _TOKEN = res.token;
        // Save session to localStorage for PWA persistence
        try { localStorage.setItem('fresko_session', JSON.stringify({ user: res.user, token: res.token })); } catch(e) {}
        // WhatsApp login alert
        _waNotify('login', res.user);
        showWelcomeCard(res.user);
      } else {
        showLgErr(res ? res.error : 'Authentication failed.');
      }
    },
    e => {
      btn.classList.remove('busy');
      showLgErr('Connection error: ' + (e.message || 'Network error'));
    }
  );
}

function showWelcomeCard(u) {
  const parts = (u.name||'FR').trim().split(/\s+/);
  const ini = (parts.length >= 2 ? parts[0][0] + parts[parts.length-1][0] : parts[0].slice(0,2)).toUpperCase();
  document.getElementById('wav').textContent   = ini;
  document.getElementById('wn').textContent  = u.name;
  document.getElementById('wd-dept').textContent  = (u.dept||'DEPARTMENT').toUpperCase() + ' DEPARTMENT';
  document.getElementById('we').textContent = u.email;
  document.getElementById('form-area').style.display   = 'none';
  document.getElementById('wc').style.display   = 'block';
}

function enterApp() {
  const lw = document.getElementById('login-wrapper');
  const aw = document.getElementById('app-wrapper');
  if (lw) lw.style.display = 'none';
  if (aw) aw.style.display = 'block';
  _initApp();
}



/* ─────────────────────────────────────────────────────────
   APP INIT
───────────────────────────────────────────────────────── */
function _initApp() {
  const tdEl = document.getElementById('tb-date'); if(tdEl) tdEl.textContent = new Date().toLocaleDateString('en-IN', {
    weekday:'short', day:'numeric', month:'short', year:'numeric'
  });
  _setUserUI();
  _populateMonths();
  _loadData(true);
  goTo('dashboard');
}

function _setUserUI() {
  if (!USER) return;
  const name = USER.name || 'User';
  const parts = name.trim().split(/\s+/);
  const ini = (parts.length >= 2 ? parts[0][0] + parts[parts.length-1][0] : parts[0].slice(0,2)).toUpperCase();
  const av = document.getElementById('sb-avatar'); if(av) av.textContent = ini;
  const un = document.getElementById('sb-uname'); if(un) un.textContent = name;
  const rl = document.getElementById('sb-role'); if(rl) rl.textContent = (USER.role||'USER').toUpperCase();
}

function _populateMonths() {
  const sel = document.getElementById('exp-month');
  if (!sel) return;
  sel.innerHTML = MONTHS.map(m => `<option value="${m}">${m}</option>`).join('');
  const now = new Date();
  const cur = MONTHS[now.getMonth()] || MONTHS[0];
  for (let i = 0; i < sel.options.length; i++) {
    if (sel.options[i].value === cur) { sel.selectedIndex = i; break; }
  }
}

/* ─────────────────────────────────────────────────────────
   DATA LOADING
───────────────────────────────────────────────────────── */
function _loadData(firstLoad, cb) {
  _api('getAllData', {},
    data => {
      if (!data || !data.success) {
        _showLoadError(data ? data.error : 'Unknown error');
        return;
      }
      DB = data;
      _lastChange = data.lastUpdate || '0';
      const ls = document.getElementById('last-sync-lbl');
      if (ls) ls.textContent = 'Synced ' + new Date().toLocaleTimeString('en-IN', {hour:'2-digit', minute:'2-digit'});
      if (firstLoad) {
        UI.pollerTimer = setInterval(_silentPoll, 30000);
      }
      // Hide loader on first data load
      const ldr = document.getElementById('loader'); if(ldr) ldr.style.display = 'none';
      if (cb) cb();
      else _rerender();
    },
    e => { _showLoadError(e.message || 'Connection failed'); }
  );
}

function _silentPoll() {
  _api('checkLastUpdate', {},
    r => {
      if (r && r.ts && r.ts !== _lastChange) {
        _loadData(false);
      }
    },
    null  // silent — ignore poll errors
  );
}

function doRefresh() {
  const ico = document.getElementById('ref-ico');
  if (ico) ico.classList.add('spin-ico');
  _loadData(false, () => {
    if (ico) ico.classList.remove('spin-ico');
    toast('Data refreshed', 'success');
  });
}

function _rerender() { goTo(UI.view, true); }

function _showLoadError(msg) {
  const v = document.getElementById('v-' + UI.view);
  if (v) v.innerHTML = `<div style="text-align:center;padding:60px 20px">
    <i class="fas fa-exclamation-triangle" style="font-size:48px;color:var(--amber);margin-bottom:16px;display:block"></i>
    <div style="font-size:17px;font-weight:800;color:var(--text);margin-bottom:8px">Data Load Failed</div>
    <div style="font-size:13px;color:var(--muted);margin-bottom:20px">${msg}</div>
    <button class="btn btn-brand" onclick="doRefresh()"><i class="fas fa-redo"></i> Retry</button>
  </div>`;
}

/* ─────────────────────────────────────────────────────────
   NAVIGATION
───────────────────────────────────────────────────────── */
const VIEW_META = {
  dashboard: { title:'Dashboard',         crumb:'Overview',        addBtn:null },
  summary:   { title:'Annual Summary',    crumb:'Reports',         addBtn:null },
  purchase:  { title:'Purchase Entry',    crumb:'Entry',           addBtn:'Add Purchase', addIco:'fas fa-shopping-cart' },
  sales:     { title:'Sales Entry',       crumb:'Entry',           addBtn:'Add Sale',     addIco:'fas fa-truck' },
  expenses:  { title:'Expenses Entry',    crumb:'Entry',           addBtn:'Add Expense',  addIco:'fas fa-file-invoice-dollar' },
  monthly:   { title:'Monthly P&L',       crumb:'Reports',         addBtn:null },
  analysis:  { title:'Party Analysis',    crumb:'Reports',         addBtn:null },
  insights:  { title:'Insights',          crumb:'Reports',         addBtn:null },
};

function goTo(v, rerender) {
  // close mobile sidebar
  if (window.innerWidth <= 768) closeSidebar();

  // update active view
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  const vel = document.getElementById('v-' + v); if (vel) vel.classList.add('active');

  // update nav highlight
  document.querySelectorAll('.sb-nav-item').forEach(el => el.classList.remove('active'));
  const nel = document.getElementById('n-' + v); if (nel) nel.classList.add('active');

  // update topbar
  const meta = VIEW_META[v] || {};
  const tbTitle = document.getElementById('tb-title'); if(tbTitle) tbTitle.textContent = meta.title || v;
  const tbSub = document.getElementById('tb-sub'); if(tbSub) tbSub.textContent = meta.crumb || 'Fresko P&L Tracker';

  const addBtn = document.getElementById('tb-add-btn');
  const addLbl = document.getElementById('tb-add-lbl');
  if (meta.addBtn) {
    addBtn.style.display = 'flex';
    addLbl.textContent = meta.addBtn;
  } else {
    addBtn.style.display = 'none';
  }

  UI.view = v;

  // render view
  if (!rerender && !DB.stats) return; // data not loaded yet
  if (v === 'dashboard')  renderDashboard();
  else if (v === 'summary')  renderSummary();
  else if (v === 'purchase') renderPurchase();
  else if (v === 'sales')    renderSales();
  else if (v === 'expenses') renderExpenses();
  else if (v === 'monthly')  renderMonthly();
  else if (v === 'analysis') renderAnalysis();
  else if (v === 'insights') renderInsights();
}

function openAddModal() {
  const v = UI.view;
  if (v === 'purchase') openModal('m-pur');
  else if (v === 'sales') openModal('m-sal');
  else if (v === 'expenses') openModal('m-exp');
}

/* ─────────────────────────────────────────────────────────
   SIDEBAR TOGGLE
───────────────────────────────────────────────────────── */
function toggleSidebar() {
  if (window.innerWidth <= 768) { openSidebar(); return; }
  UI.sbCollapsed = !UI.sbCollapsed;
  const sb = document.getElementById('sb');
  sb.classList.toggle('collapsed', UI.sbCollapsed);
  const chev = document.getElementById('sb-chev');
  if (chev) chev.className = UI.sbCollapsed ? 'fas fa-chevron-right' : 'fas fa-chevron-left';
}
function openSidebar() {
  document.getElementById('sb').classList.add('mobile-open');
  document.getElementById('sb-backdrop').classList.add('active');
}
function closeSidebar() {
  document.getElementById('sb').classList.remove('mobile-open');
  document.getElementById('sb-backdrop').classList.remove('show');
}

/* ─────────────────────────────────────────────────────────
   SIGN OUT
───────────────────────────────────────────────────────── */
function signOutPrompt() { openModal('m-signout'); }
function signOutPrompt_old_swal() {
  Swal.fire({
    title: 'Sign Out?',
    text: 'Aap Fresko P&L Tracker se logout karna chahte hain?',
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'Sign Out',
    cancelButtonText: 'Cancel',
    confirmButtonColor: '#C0392B',
    reverseButtons: true
  }).then(r => { if (r.isConfirmed) location.reload(); });
}

/* ─────────────────────────────────────────────────────────
   DASHBOARD
───────────────────────────────────────────────────────── */
function renderDashboard() {
  const s   = DB.stats    || {};
  const pur = DB.purchases || [];
  const sal = DB.sales     || [];
  const v   = document.getElementById('v-dashboard');
  if (!v) return;

  const netPos   = (s.netPL   || 0) >= 0;
  const grossPos = (s.grossPL || 0) >= 0;

  v.innerHTML = `
  <div class="ph">
    <div class="ph-l"><h2>Dashboard</h2><p>FY 2025–26 · Real-time Profit & Loss Overview</p></div>
    <div class="ph-r">
      <button class="btn btn-ghost btn-sm" onclick="goTo('monthly')"><i class="fas fa-calendar-alt"></i> Monthly Report</button>
      <button class="btn btn-ghost btn-sm" onclick="goTo('summary')"><i class="fas fa-chart-bar"></i> Annual</button>
    </div>
  </div>

  <!-- KPI CARDS -->
  <div class="krow">
    <div class="kcard">
      <div class="k-ico"><i class="fas fa-shopping-cart"></i></div>
      <div class="k-val">${INR(s.totalPurchase)}</div>
      <div class="k-label">Total Purchase</div>
      <div class="k-sub"><i class="fas fa-hashtag"></i> ${s.purchaseCount||0} entries</div>
    </div>
    <div class="kcard green">
      <div class="k-ico"><i class="fas fa-truck"></i></div>
      <div class="k-val">${INR(s.totalSale)}</div>
      <div class="k-label">Total Sale</div>
      <div class="k-sub"><i class="fas fa-hashtag"></i> ${s.saleCount||0} entries</div>
    </div>
    <div class="kcard amber">
      <div class="k-ico"><i class="fas fa-file-invoice"></i></div>
      <div class="k-val">${INR(s.totalExpenses)}</div>
      <div class="k-label">Total Expenses</div>
      <div class="k-sub"><i class="fas fa-calendar"></i> FY 2025–26</div>
    </div>
    <div class="kcard ${netPos ? 'green' : ''}" style="--kc:${netPos?'var(--green)':'var(--red)'};--kb:${netPos?'var(--green-l)':'var(--red-l)'}">
      <div class="k-ico"><i class="fas fa-${netPos?'arrow-trend-up':'arrow-trend-down'}"></i></div>
      <div class="k-val" style="color:${netPos?'var(--green)':'var(--red)'}">${INR(Math.abs(s.netPL||0))}</div>
      <div class="k-label">Net P/L</div>
      <div class="k-sub ${netPos?'pos':'neg'}">${netPos?'▲ Profit':'▼ Loss'}</div>
    </div>
  </div>

  <!-- CHARTS + SNAPSHOT -->
  <div class="g-6-4" style="margin-bottom:16px">
    <div class="card">
      <div class="card-hd">
        <div class="card-title"><i class="fas fa-chart-line"></i> Purchase vs Sale Trend (Monthly)</div>
      </div>
      <div class="card-body">
        <div class="chart-box" style="height:230px"><canvas id="ch-trend"></canvas></div>
      </div>
    </div>
    <div>
      <!-- P/L Snapshot -->
      <div class="card" style="margin-bottom:16px">
        <div class="card-hd"><div class="card-title"><i class="fas fa-balance-scale"></i> P/L Snapshot</div></div>
        <div class="card-body no-top">
          <div class="stat-strip">
            <div class="ss-row">
              <span class="ss-lbl">Gross Margin</span>
              <span class="ss-val" style="color:${grossPos?'var(--green)':'var(--red)'}">${INR(Math.abs(s.grossPL||0))} ${grossPos?'P':'L'}</span>
            </div>
            <div class="ss-row">
              <span class="ss-lbl">Net P/L</span>
              <span class="ss-val" style="color:${netPos?'var(--green)':'var(--red)'}">${INR(Math.abs(s.netPL||0))} ${netPos?'P':'L'}</span>
            </div>
            <div class="ss-row">
              <span class="ss-lbl">Net Margin %</span>
              <span class="ss-val">${s.totalSale?((s.netPL/s.totalSale)*100).toFixed(1):0}%</span>
            </div>
            <div class="ss-row">
              <span class="ss-lbl">Expense Ratio</span>
              <span class="ss-val">${s.totalSale?((s.totalExpenses/s.totalSale)*100).toFixed(1):0}%</span>
            </div>
          </div>
        </div>
      </div>
      <!-- Party Doughnut -->
      <div class="card">
        <div class="card-hd"><div class="card-title"><i class="fas fa-chart-pie"></i> Sales Split</div></div>
        <div class="card-body">
          <div class="chart-box" style="height:130px"><canvas id="ch-party-dash"></canvas></div>
        </div>
      </div>
    </div>
  </div>

  <!-- RECENT ENTRIES -->
  <div class="g2">
    <div class="card">
      <div class="card-hd">
        <div class="card-title"><i class="fas fa-shopping-cart"></i> Recent Purchases</div>
        <button class="btn btn-ghost btn-xs" onclick="goTo('purchase')">View All →</button>
      </div>
      <div class="card-body no-top">
        ${_miniPurchaseTable(pur.slice(0,5))}
      </div>
    </div>
    <div class="card">
      <div class="card-hd">
        <div class="card-title"><i class="fas fa-truck"></i> Recent Sales</div>
        <button class="btn btn-ghost btn-xs" onclick="goTo('sales')">View All →</button>
      </div>
      <div class="card-body no-top">
        ${_miniSaleTable(sal.slice(0,5))}
      </div>
    </div>
  </div>`;

  // Draw charts
  requestAnimationFrame(() => {
    _drawTrend();
    _drawPartyDash();
  });
}

function _miniPurchaseTable(arr) {
  if (!arr.length) return `<div class="tbl-empty"><i class="fas fa-inbox"></i><p>Koi purchase entry nahi</p></div>`;
  let h = `<div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Qty</th><th>Amount</th></tr></thead><tbody>`;
  arr.forEach(r => {
    h += `<tr><td>${fmtD(r.date)}</td><td>${fmt0(r.qty)}</td><td class="mono">₹${fmt(r.amount)}</td></tr>`;
  });
  return h + `</tbody></table></div>`;
}

function _miniSaleTable(arr) {
  if (!arr.length) return `<div class="tbl-empty"><i class="fas fa-inbox"></i><p>Koi sale entry nahi</p></div>`;
  let h = `<div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Party</th><th>Amount</th></tr></thead><tbody>`;
  arr.forEach(r => {
    const cls = String(r.party||'').includes('LOCAL') ? 'b-red' : 'b-green';
    h += `<tr><td>${fmtD(r.date)}</td><td><span class="badge ${cls}">${r.party||'—'}</span></td><td class="mono">₹${fmt(r.amount)}</td></tr>`;
  });
  return h + `</tbody></table></div>`;
}

/* ─────────────────────────────────────────────────────────
   ANNUAL SUMMARY
───────────────────────────────────────────────────────── */
function renderSummary() {
  const s    = DB.stats   || {};
  const rows = DB.summary || [];
  const v    = document.getElementById('v-summary');
  if (!v) return;

  const netPos = (s.netPL||0) >= 0;
  const curMo  = _curMonthLabel();

  let tblRows = '';
  let totP=0, totS=0, totE=0;
  rows.forEach(r => {
    totP += r.purchase||0; totS += r.sale||0; totE += r.expenses||0;
    const empty = !r.purchase && !r.sale && !r.expenses;
    const gpos = (r.grossPL||0) >= 0;
    const npos = (r.netPL||0)   >= 0;
    const margin = r.sale ? ((r.netPL/r.sale)*100).toFixed(1) : 0;
    const isCur = (r.month||'') === curMo;
    tblRows += `<tr class="${isCur?'cur-month-row':''}">
      <td style="font-weight:700">${r.month||'—'}</td>
      <td class="mono">${r.purchase?'₹'+fmt(r.purchase):'—'}</td>
      <td class="mono">${r.sale?'₹'+fmt(r.sale):'—'}</td>
      <td class="mono">${r.expenses?'₹'+fmt(r.expenses):'—'}</td>
      <td class="mono ${gpos&&!empty?'profit':!empty?'loss':''}">${!empty?'₹'+fmt(Math.abs(r.grossPL))+(r.grossPL<0?' (L)':' (P)'):'—'}</td>
      <td class="mono ${npos&&!empty?'profit':!empty?'loss':''}">${!empty?'₹'+fmt(Math.abs(r.netPL))+(r.netPL<0?' (L)':' (P)'):'—'}</td>
      <td class="mono ${npos&&!empty?'profit':!empty?'loss':''}">${!empty?margin+'%':'—'}</td>
    </tr>`;
  });

  const totNet = totS - totP - totE;
  const totGross = totS - totP;
  tblRows += `<tr class="total-row">
    <td>TOTAL</td>
    <td class="mono">₹${fmt(totP)}</td>
    <td class="mono">₹${fmt(totS)}</td>
    <td class="mono">₹${fmt(totE)}</td>
    <td class="mono ${totGross>=0?'profit':'loss'}">₹${fmt(Math.abs(totGross))}${totGross<0?' (L)':' (P)'}</td>
    <td class="mono ${totNet>=0?'profit':'loss'}">₹${fmt(Math.abs(totNet))}${totNet<0?' (L)':' (P)'}</td>
    <td class="mono ${totNet>=0?'profit':'loss'}">${totS?((totNet/totS)*100).toFixed(1):0}%</td>
  </tr>`;

  v.innerHTML = `
  <div class="ph">
    <div class="ph-l"><h2>Annual Summary</h2><p>FY 2025–26 · Month-wise complete P&L statement</p></div>
  </div>

  <div class="krow">
    <div class="kcard">
      <div class="k-ico"><i class="fas fa-shopping-cart"></i></div>
      <div class="k-val">${INR(s.totalPurchase)}</div>
      <div class="k-label">YTD Purchase</div>
    </div>
    <div class="kcard green">
      <div class="k-ico"><i class="fas fa-truck"></i></div>
      <div class="k-val">${INR(s.totalSale)}</div>
      <div class="k-label">YTD Sale</div>
    </div>
    <div class="kcard amber">
      <div class="k-ico"><i class="fas fa-file-invoice"></i></div>
      <div class="k-val">${INR(s.totalExpenses)}</div>
      <div class="k-label">YTD Expenses</div>
    </div>
    <div class="kcard" style="--kc:${netPos?'var(--green)':'var(--red)'};--kb:${netPos?'var(--green-l)':'var(--red-l)'}">
      <div class="k-ico"><i class="fas fa-chart-line"></i></div>
      <div class="k-val" style="color:${netPos?'var(--green)':'var(--red)'}">${INR(Math.abs(s.netPL||0))}</div>
      <div class="k-label">Net ${netPos?'Profit':'Loss'}</div>
    </div>
  </div>

  <div class="g-6-4" style="margin-bottom:16px">
    <div class="card">
      <div class="card-hd"><div class="card-title"><i class="fas fa-chart-bar"></i> Monthly Net P/L</div></div>
      <div class="card-body">
        <div class="chart-box" style="height:240px"><canvas id="ch-net"></canvas></div>
      </div>
    </div>
    <div>
      <div class="card">
        <div class="card-hd"><div class="card-title"><i class="fas fa-info-circle"></i> FY Metrics</div></div>
        <div class="card-body no-top">
          <div class="stat-strip">
            ${_ssRow('Total Purchase', INR(s.totalPurchase),'var(--brand)')}
            ${_ssRow('Total Sale', INR(s.totalSale),'var(--green)')}
            ${_ssRow('Total Expenses', INR(s.totalExpenses),'var(--amber)')}
            ${_ssRow('Gross P/L', INR(Math.abs(totGross))+(totGross<0?' (L)':' (P)'),(totGross>=0?'var(--green)':'var(--red)'))}
            ${_ssRow('Net P/L', INR(Math.abs(s.netPL||0))+(netPos?'(P)':'(L)'),(netPos?'var(--green)':'var(--red)'))}
            ${_ssRow('Net Margin', (s.totalSale?((s.netPL/s.totalSale)*100).toFixed(1):0)+'%',(netPos?'var(--green)':'var(--red)'))}
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-hd">
      <div class="card-title"><i class="fas fa-table"></i> Month-wise Breakdown</div>
      <div style="display:flex;gap:6px;align-items:center">
        <span class="badge b-brand" style="font-size:10px">Current month highlighted</span>
        <span class="badge b-muted">${rows.length} months</span>
      </div>
    </div>
    <div class="card-body no-top">
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>Month</th><th>Purchase (₹)</th><th>Sale (₹)</th><th>Expenses (₹)</th><th>Gross P/L</th><th>Net P/L</th><th>Margin %</th></tr></thead>
          <tbody>${tblRows||'<tr><td colspan="7" class="tbl-empty"><i class="fas fa-inbox"></i><p>Summary data nahi hai</p></td></tr>'}</tbody>
        </table>
      </div>
    </div>
  </div>`;

  requestAnimationFrame(() => {
    const c = DB.chart || {};
    if (c.labels && c.labels.length) {
      _drawChart('ch-net', 'bar', c.labels, [{
        label: 'Net P/L',
        data: (c.net||[]),
        backgroundColor: (c.net||[]).map(v => v >= 0 ? 'rgba(39,174,96,.75)' : 'rgba(192,57,43,.75)'),
        borderRadius: 5, borderSkipped: false
      }], false, true);
    }
  });
}

function _ssRow(lbl, val, color) {
  return `<div class="ss-row"><span class="ss-lbl">${lbl}</span><span class="ss-val" style="color:${color}">${val}</span></div>`;
}

/* ─────────────────────────────────────────────────────────
   PURCHASE VIEW
───────────────────────────────────────────────────────── */
function renderPurchase() {
  const arr = DB.purchases || [];
  const v   = document.getElementById('v-purchase');
  if (!v) return;

  const q  = document.getElementById('pur-q') ? document.getElementById('pur-q').value.trim() : '';
  const filtered = q ? arr.filter(r => JSON.stringify(r).toLowerCase().includes(q.toLowerCase())) : arr;
  const page = _page.purchase;
  const total = filtered.length;
  const rows = filtered.slice((page-1)*PER, page*PER);

  let tblH = '';
  rows.forEach((r, i) => {
    tblH += `<tr>
      <td style="color:var(--sub);font-size:11px">${(page-1)*PER+i+1}</td>
      <td><strong>${fmtD(r.date)}</strong></td>
      <td>${fmt0(r.qty)}</td>
      <td class="mono">₹${fmt(r.amount)}</td>
      <td style="font-size:11.5px;color:var(--muted)">${r.by||'—'}</td>
      <td style="font-size:11px;color:var(--sub)">${r.ts||'—'}</td>
    </tr>`;
  });

  v.innerHTML = `
  <div class="ph">
    <div class="ph-l"><h2>Purchase Entry</h2><p>Daily purchase record karein</p></div>
    <div style="display:flex;gap:8px;align-items:center">
      <button class="btn btn-ghost btn-sm" onclick="exportCSV('purchase')"><i class="fas fa-download"></i> Export CSV</button>
      <button class="btn btn-brand" onclick="openModal('m-pur')"><i class="fas fa-plus"></i> New Entry</button>
    </div>
  </div>

  <!-- Quick Stats -->
  <div class="g3" style="margin-bottom:16px">
    <div class="card" style="margin:0">
      <div class="card-body" style="padding:14px 16px">
        <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">Total Entries</div>
        <div style="font-size:22px;font-weight:900;color:var(--text)">${arr.length}</div>
      </div>
    </div>
    <div class="card" style="margin:0">
      <div class="card-body" style="padding:14px 16px">
        <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">Total Purchase</div>
        <div style="font-size:22px;font-weight:900;color:var(--brand)">${INR(DB.stats.totalPurchase||0)}</div>
      </div>
    </div>
    <div class="card" style="margin:0">
      <div class="card-body" style="padding:14px 16px">
        <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">Avg. per Entry</div>
        <div style="font-size:22px;font-weight:900;color:var(--text)">${arr.length?INR(Math.round((DB.stats.totalPurchase||0)/arr.length)):'—'}</div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-hd">
      <div class="card-title"><i class="fas fa-list"></i> Purchase History</div>
    </div>
    <div class="card-body no-top">
      <div class="srch-row">
        <div class="srch-wrap"><i class="fas fa-search"></i><input class="srch-inp" id="pur-q" placeholder="Search date, amount, qty…" value="${q}" oninput="_page.purchase=1;renderPurchase()"></div>
        <span class="badge b-muted">${total} records</span>
      </div>
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>#</th><th>Date</th><th>Qty</th><th>Amount</th><th>Added By</th><th>Timestamp</th></tr></thead>
          <tbody>${tblH||'<tr><td colspan="6" class="tbl-empty"><i class="fas fa-inbox"></i><p>Koi purchase entry nahi</p></td></tr>'}</tbody>
        </table>
      </div>
      <div class="pager">
        <span>${total?`${(page-1)*PER+1}–${Math.min(page*PER,total)} of ${total} entries`:''}</span>
        <div class="pager-btns">
          <button class="pager-btn" ${page<=1?'disabled':''} onclick="_page.purchase--;renderPurchase()">← Prev</button>
          <button class="pager-btn" ${page>=Math.ceil(total/PER)?'disabled':''} onclick="_page.purchase++;renderPurchase()">Next →</button>
        </div>
      </div>
    </div>
  </div>`;
}

/* ─────────────────────────────────────────────────────────
   SALES VIEW
───────────────────────────────────────────────────────── */
function renderSales() {
  const arr = DB.sales || [];
  const v   = document.getElementById('v-sales');
  if (!v) return;

  const q    = document.getElementById('sal-q') ? document.getElementById('sal-q').value.trim() : '';
  const filt = document.getElementById('sal-f') ? document.getElementById('sal-f').value : 'all';
  let filtered = q ? arr.filter(r => JSON.stringify(r).toLowerCase().includes(q.toLowerCase())) : arr;
  if (filt !== 'all') filtered = filtered.filter(r => (r.party||'').toLowerCase().includes(filt.toLowerCase()));

  const page  = _page.sales;
  const total = filtered.length;
  const rows  = filtered.slice((page-1)*PER, page*PER);

  const locTotal = arr.filter(r=>(r.party||'').includes('LOCAL')).reduce((s,r)=>s+(r.amount||0),0);
  const supTotal = arr.filter(r=>(r.party||'').includes('SUPPLY')).reduce((s,r)=>s+(r.amount||0),0);

  let tblH = '';
  rows.forEach((r, i) => {
    const cls = String(r.party||'').includes('LOCAL') ? 'b-red' : 'b-green';
    tblH += `<tr>
      <td style="color:var(--sub);font-size:11px">${(page-1)*PER+i+1}</td>
      <td><strong>${fmtD(r.date)}</strong></td>
      <td><span class="badge ${cls}">${r.party||'—'}</span></td>
      <td>${fmt0(r.qty)}</td>
      <td class="mono">₹${fmt(r.amount)}</td>
      <td style="font-size:11.5px;color:var(--muted)">${r.by||'—'}</td>
    </tr>`;
  });

  v.innerHTML = `
  <div class="ph">
    <div class="ph-l"><h2>Sales Entry</h2><p>Party-wise daily sales record karein</p></div>
    <div style="display:flex;gap:8px;align-items:center">
      <button class="btn btn-ghost btn-sm" onclick="exportCSV('sales')"><i class="fas fa-download"></i> Export CSV</button>
      <button class="btn btn-green" onclick="openModal('m-sal')"><i class="fas fa-plus"></i> New Entry</button>
    </div>
  </div>

  <div class="g3" style="margin-bottom:16px">
    <div class="card" style="margin:0">
      <div class="card-body" style="padding:14px 16px">
        <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px"><span class="badge b-brand" style="font-size:10px">LOCAL SALE</span></div>
        <div style="font-size:22px;font-weight:900;color:var(--brand)">${INR(locTotal)}</div>
      </div>
    </div>
    <div class="card" style="margin:0">
      <div class="card-body" style="padding:14px 16px">
        <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px"><span class="badge b-green" style="font-size:10px">SUPPLY SALE</span></div>
        <div style="font-size:22px;font-weight:900;color:var(--green)">${INR(supTotal)}</div>
      </div>
    </div>
    <div class="card" style="margin:0">
      <div class="card-body" style="padding:14px 16px">
        <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">Total Sale</div>
        <div style="font-size:22px;font-weight:900;color:var(--text)">${INR(DB.stats.totalSale||0)}</div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-hd"><div class="card-title"><i class="fas fa-list"></i> Sales History</div></div>
    <div class="card-body no-top">
      <div class="srch-row">
        <div class="srch-wrap"><i class="fas fa-search"></i><input class="srch-inp" id="sal-q" placeholder="Search sales…" value="${q}" oninput="_page.sales=1;renderSales()"></div>
        <select class="srch-inp" id="sal-f" style="width:160px;flex:none" onchange="_page.sales=1;renderSales()">
          <option value="all">All Parties</option>
          <option value="LOCAL" ${filt==='LOCAL'?'selected':''}>LOCAL SALE</option>
          <option value="SUPPLY" ${filt==='SUPPLY'?'selected':''}>SUPPLY SALE</option>
        </select>
        <span class="badge b-muted">${total} records</span>
      </div>
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>#</th><th>Date</th><th>Party</th><th>Qty</th><th>Amount</th><th>Added By</th></tr></thead>
          <tbody>${tblH||'<tr><td colspan="6" class="tbl-empty"><i class="fas fa-inbox"></i><p>Koi sale entry nahi</p></td></tr>'}</tbody>
        </table>
      </div>
      <div class="pager">
        <span>${total?`${(page-1)*PER+1}–${Math.min(page*PER,total)} of ${total} entries`:''}</span>
        <div class="pager-btns">
          <button class="pager-btn" ${page<=1?'disabled':''} onclick="_page.sales--;renderSales()">← Prev</button>
          <button class="pager-btn" ${page>=Math.ceil(total/PER)?'disabled':''} onclick="_page.sales++;renderSales()">Next →</button>
        </div>
      </div>
    </div>
  </div>`;
}

/* ─────────────────────────────────────────────────────────
   EXPENSES VIEW
───────────────────────────────────────────────────────── */
function renderExpenses() {
  const arr = DB.expenses || [];
  const v   = document.getElementById('v-expenses');
  if (!v) return;

  let tblH = '';
  arr.forEach((r, i) => {
    tblH += `<tr>
      <td style="color:var(--sub);font-size:11px">${i+1}</td>
      <td style="font-weight:700">${r.month||'—'}</td>
      <td class="mono">₹${fmt(r.amount)}</td>
      <td style="font-size:11.5px;color:var(--muted)">${r.by||'—'}</td>
      <td style="font-size:11px;color:var(--sub)">${r.ts||'—'}</td>
    </tr>`;
  });

  v.innerHTML = `
  <div class="ph">
    <div class="ph-l"><h2>Expenses Entry</h2><p>Monthly operational expenses record karein</p></div>
    <div style="display:flex;gap:8px;align-items:center">
      <button class="btn btn-ghost btn-sm" onclick="exportCSV('expenses')"><i class="fas fa-download"></i> Export CSV</button>
      <button class="btn btn-amber" onclick="openModal('m-exp')"><i class="fas fa-plus"></i> New Entry</button>
    </div>
  </div>

  <div class="g2" style="margin-bottom:16px">
    <div class="card" style="margin:0">
      <div class="card-body" style="padding:14px 16px">
        <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:6px">Total Expenses (YTD)</div>
        <div style="font-size:24px;font-weight:900;color:var(--amber)">${INR(DB.stats.totalExpenses||0)}</div>
      </div>
    </div>
    <div class="card" style="margin:0">
      <div class="card-body" style="padding:14px 16px">
        <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:6px">Expense Ratio (vs Sale)</div>
        <div style="font-size:24px;font-weight:900;color:var(--text)">${DB.stats.totalSale?((DB.stats.totalExpenses/DB.stats.totalSale)*100).toFixed(1):0}%</div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-hd">
      <div class="card-title"><i class="fas fa-list"></i> Expenses History</div>
      <span class="badge b-amber">${arr.length} entries</span>
    </div>
    <div class="card-body no-top">
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>#</th><th>Month</th><th>Amount</th><th>Added By</th><th>Timestamp</th></tr></thead>
          <tbody>${tblH||'<tr><td colspan="5" class="tbl-empty"><i class="fas fa-inbox"></i><p>Koi expense entry nahi</p></td></tr>'}</tbody>
        </table>
      </div>
    </div>
  </div>`;
}

/* ─────────────────────────────────────────────────────────
   MONTHLY P&L VIEW
───────────────────────────────────────────────────────── */
function renderMonthly() {
  const rows  = DB.summary || [];
  const v     = document.getElementById('v-monthly');
  const curMo = _curMonthLabel();
  if (!v) return;

  let tblH = '';
  let totP=0, totS=0, totE=0;
  rows.forEach(r => {
    totP += r.purchase||0; totS += r.sale||0; totE += r.expenses||0;
    const empty = !r.purchase && !r.sale && !r.expenses;
    const gpos  = (r.grossPL||0) >= 0;
    const npos  = (r.netPL||0)   >= 0;
    const margin = r.sale ? ((r.netPL/r.sale)*100).toFixed(1) : 0;
    const isCur  = (r.month||'') === curMo;
    tblH += `<tr class="${isCur?'cur-month-row':''}">
      <td style="font-weight:700;white-space:nowrap">${r.month||'—'} ${isCur?'<span class="badge b-brand" style="font-size:9px;margin-left:4px">Current</span>':''}</td>
      <td class="mono">${r.purchase?'₹'+fmt(r.purchase):'—'}</td>
      <td class="mono">${r.sale?'₹'+fmt(r.sale):'—'}</td>
      <td class="mono">${r.expenses?'₹'+fmt(r.expenses):'—'}</td>
      <td class="mono ${gpos&&!empty?'profit':!empty?'loss':''}">${!empty?'₹'+fmt(Math.abs(r.grossPL))+(r.grossPL<0?' (L)':' (P)'):'—'}</td>
      <td class="mono ${npos&&!empty?'profit':!empty?'loss':''}">${!empty?'₹'+fmt(Math.abs(r.netPL))+(r.netPL<0?' (L)':' (P)'):'—'}</td>
      <td class="mono">${!empty?margin+'%':'—'}</td>
    </tr>`;
  });

  const totNet   = totS - totP - totE;
  const totGross = totS - totP;
  tblH += `<tr class="total-row">
    <td>TOTAL</td>
    <td class="mono">₹${fmt(totP)}</td>
    <td class="mono">₹${fmt(totS)}</td>
    <td class="mono">₹${fmt(totE)}</td>
    <td class="mono ${totGross>=0?'profit':'loss'}">₹${fmt(Math.abs(totGross))}${totGross<0?' (L)':' (P)'}</td>
    <td class="mono ${totNet>=0?'profit':'loss'}">₹${fmt(Math.abs(totNet))}${totNet<0?' (L)':' (P)'}</td>
    <td class="mono">${totS?((totNet/totS)*100).toFixed(1):0}%</td>
  </tr>`;

  v.innerHTML = `
  <div class="ph">
    <div class="ph-l"><h2>Monthly P&L</h2><p>Month-wise detailed profit & loss statement</p></div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-ghost btn-sm" onclick="exportCSV('summary')"><i class="fas fa-download"></i> Export CSV</button>
      <button class="btn btn-ghost btn-sm" onclick="window.print()"><i class="fas fa-print"></i> Print</button>
    </div>
  </div>

  <div class="card">
    <div class="card-hd">
      <div class="card-title"><i class="fas fa-table"></i> Month-wise P&L Statement</div>
      <div style="display:flex;gap:6px">
        <span class="badge b-brand" style="font-size:10px">★ Current month</span>
        <span class="badge b-muted">${rows.length} months</span>
      </div>
    </div>
    <div class="card-body no-top">
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>Month</th><th>Purchase</th><th>Sale</th><th>Expenses</th><th>Gross P/L</th><th>Net P/L</th><th>Margin %</th></tr></thead>
          <tbody>${tblH||'<tr><td colspan="7" class="tbl-empty"><i class="fas fa-inbox"></i><p>Data nahi hai</p></td></tr>'}</tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Monthly Bar Chart -->
  <div class="card">
    <div class="card-hd"><div class="card-title"><i class="fas fa-chart-bar"></i> Monthly P vs S vs Expenses</div></div>
    <div class="card-body">
      <div class="chart-box" style="height:260px"><canvas id="ch-monthly"></canvas></div>
    </div>
  </div>`;

  requestAnimationFrame(() => {
    const c = DB.chart || {};
    if (c.labels && c.labels.length) {
      _drawChart('ch-monthly', 'bar', c.labels, [
        { label:'Purchase', data:c.purchase||[], backgroundColor:'rgba(192,57,43,.7)', borderRadius:4 },
        { label:'Sale',     data:c.sale||[],     backgroundColor:'rgba(39,174,96,.7)',  borderRadius:4 },
      ], true, false);
    }
  });
}

/* ─────────────────────────────────────────────────────────
   PARTY ANALYSIS
───────────────────────────────────────────────────────── */
function renderAnalysis() {
  const pm    = DB.partyMap || {};
  const keys  = Object.keys(pm);
  const total = keys.reduce((s,k)=>s+(pm[k].total||0),0);
  const v     = document.getElementById('v-analysis');
  if (!v) return;

  const COLORS = ['var(--brand)','var(--green)','var(--amber)','var(--blue)','var(--purple)'];
  const BGS    = ['var(--brand-l)','var(--green-l)','var(--amber-l)','var(--blue-l)','var(--purple-l)'];
  const HEX    = ['#C0392B','#27AE60','#E67E22','#2980B9','#8E44AD'];

  let kCards = keys.map((k,i)=>{
    const pct = total>0?((pm[k].total/total)*100).toFixed(1):0;
    return `<div class="kcard" style="--kc:${COLORS[i%COLORS.length]};--kb:${BGS[i%BGS.length]}">
      <div class="k-ico"><i class="fas fa-store"></i></div>
      <div class="k-val">${INR(pm[k].total)}</div>
      <div class="k-label">${k}</div>
      <div class="k-sub">${pm[k].count} transactions · ${pct}%</div>
    </div>`;
  }).join('');

  let tblH = keys.map((k,i)=>{
    const pct = total>0?((pm[k].total/total)*100).toFixed(1):0;
    const avg  = pm[k].count ? Math.round(pm[k].total/pm[k].count) : 0;
    return `<tr>
      <td><span class="badge" style="background:${BGS[i%BGS.length]};color:${COLORS[i%COLORS.length]}">${k}</span></td>
      <td class="mono">₹${fmt(pm[k].total)}</td>
      <td>${pm[k].count}</td>
      <td class="mono">₹${fmt(avg)}</td>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;height:6px;background:var(--border);border-radius:6px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${HEX[i%HEX.length]};border-radius:6px;transition:width .6s"></div>
          </div>
          <span style="font-size:11px;font-weight:700;color:${COLORS[i%COLORS.length]};min-width:36px">${pct}%</span>
        </div>
      </td>
    </tr>`;
  }).join('');

  v.innerHTML = `
  <div class="ph">
    <div class="ph-l"><h2>Party Analysis</h2><p>Party-wise sales breakdown & insights</p></div>
  </div>

  <div class="krow">${kCards||'<div style="grid-column:1/-1;text-align:center;color:var(--sub);padding:20px">Data nahi hai</div>'}</div>

  <div class="g-6-4">
    <div class="card">
      <div class="card-hd"><div class="card-title"><i class="fas fa-table"></i> Party-wise Details</div></div>
      <div class="card-body no-top">
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>Party</th><th>Total (₹)</th><th>Transactions</th><th>Avg. (₹)</th><th>Share %</th></tr></thead>
            <tbody>${tblH||'<tr><td colspan="5" class="tbl-empty"><i class="fas fa-inbox"></i><p>Data nahi</p></td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>
    <div>
      <div class="card">
        <div class="card-hd"><div class="card-title"><i class="fas fa-chart-pie"></i> Sales Split</div></div>
        <div class="card-body">
          <div class="chart-box" style="height:200px"><canvas id="ch-party-a"></canvas></div>
        </div>
      </div>
      <div class="card" style="margin-top:16px">
        <div class="card-hd"><div class="card-title"><i class="fas fa-info-circle"></i> Summary</div></div>
        <div class="card-body no-top">
          <div class="stat-strip">
            ${_ssRow('Total Sale', INR(total), 'var(--green)')}
            ${_ssRow('Parties', keys.length + ' types', 'var(--text)')}
            ${_ssRow('Total Transactions', (DB.stats.saleCount||0) + ' entries', 'var(--text)')}
          </div>
        </div>
      </div>
    </div>
  </div>`;

  requestAnimationFrame(() => {
    if (keys.length) {
      _drawDoughnut('ch-party-a', keys, keys.map(k=>pm[k].total), HEX);
    }
  });
}

/* ─────────────────────────────────────────────────────────
   INSIGHTS VIEW
───────────────────────────────────────────────────────── */
function renderInsights() {
  const s    = DB.stats   || {};
  const rows = DB.summary || [];
  const v    = document.getElementById('v-insights');
  if (!v) return;

  // Calculate insights
  const netPos   = (s.netPL||0) >= 0;
  const margin   = s.totalSale ? ((s.netPL/s.totalSale)*100).toFixed(1) : 0;
  const expRatio = s.totalSale ? ((s.totalExpenses/s.totalSale)*100).toFixed(1) : 0;
  const purRatio = s.totalSale ? ((s.totalPurchase/s.totalSale)*100).toFixed(1) : 0;

  // Best & worst months
  const withData  = rows.filter(r => r.sale || r.purchase);
  const bestMonth = withData.sort((a,b)=>(b.netPL||0)-(a.netPL||0))[0];
  const worstMonth= [...withData].sort((a,b)=>(a.netPL||0)-(b.netPL||0))[0];

  const insights = [
    {
      icon: 'fa-chart-line', color: netPos?'var(--green)':'var(--red)', bg: netPos?'var(--green-l)':'var(--red-l)',
      title: netPos ? '✅ Business Profitable Hai' : '⚠️ Net Loss Mein Hai',
      desc: `FY 2025–26 mein Net P/L <strong>${INR(Math.abs(s.netPL||0))}</strong> ${netPos?'profit':'loss'} hai. Net margin <strong>${margin}%</strong>.`
    },
    {
      icon: 'fa-file-invoice', color:'var(--amber)', bg:'var(--amber-l)',
      title: `Expense Ratio: ${expRatio}%`,
      desc: `Har ₹100 sale par ₹${expRatio} expenses ja rahe hain. ${+expRatio>30?'Expenses thode zyada hain — control karne ki zaroorat.':'Expenses controlled hain — achha hai!'}`
    },
    {
      icon: 'fa-shopping-cart', color:'var(--brand)', bg:'var(--brand-l)',
      title: `Purchase: ${purRatio}% of Sale`,
      desc: `Purchase cost sale ka <strong>${purRatio}%</strong> hai. ${+purRatio>80?'Purchase cost zyada hai — margin kam ho sakta hai.':'Purchase cost reasonable range mein hai.'}`
    },
    ...(bestMonth ? [{
      icon: 'fa-trophy', color:'var(--green)', bg:'var(--green-l)',
      title: `Best Month: ${bestMonth.month}`,
      desc: `Sabse zyada profit <strong>${bestMonth.month}</strong> mein raha — <strong>${INR(Math.abs(bestMonth.netPL||0))}</strong> net P/L.`
    }] : []),
    ...(worstMonth && worstMonth.month !== (bestMonth||{}).month ? [{
      icon: 'fa-arrow-trend-down', color:'var(--red)', bg:'var(--red-l)',
      title: `Worst Month: ${worstMonth.month}`,
      desc: `Sabse kam performance <strong>${worstMonth.month}</strong> mein rahi — Net P/L <strong>${INR(Math.abs(worstMonth.netPL||0))}</strong> ${(worstMonth.netPL||0)<0?'loss':'profit'}.`
    }] : []),
  ];

  const insightCards = insights.map(ins => `
    <div class="card" style="margin-bottom:12px">
      <div class="card-body" style="padding:16px 18px">
        <div style="display:flex;gap:12px;align-items:flex-start">
          <div style="width:40px;height:40px;border-radius:10px;background:${ins.bg};color:${ins.color};display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0">
            <i class="fas ${ins.icon}"></i>
          </div>
          <div>
            <div style="font-size:13.5px;font-weight:800;color:var(--text);margin-bottom:4px">${ins.title}</div>
            <div style="font-size:12.5px;color:var(--text2);line-height:1.5">${ins.desc}</div>
          </div>
        </div>
      </div>
    </div>`).join('');

  v.innerHTML = `
  <div class="ph">
    <div class="ph-l"><h2>Business Insights</h2><p>FY 2025–26 ke key metrics & performance analysis</p></div>
  </div>

  <div class="g-6-4">
    <div>
      <div class="notice info" style="margin-bottom:14px">
        <i class="fas fa-lightbulb"></i>
        <span>Yeh insights aapke actual data ke basis par automatically generate hote hain.</span>
      </div>
      ${insightCards}
    </div>

    <div>
      <!-- Health Score -->
      <div class="card" style="margin-bottom:16px">
        <div class="card-hd"><div class="card-title"><i class="fas fa-heartbeat"></i> Business Health</div></div>
        <div class="card-body no-top">
          ${_healthBar('Net Margin', Math.max(0,Math.min(100,+margin)), +margin>=10?'var(--green)':+margin>=0?'var(--amber)':'var(--red)')}
          ${_healthBar('Expense Control', Math.max(0,100-+expRatio), +expRatio<20?'var(--green)':+expRatio<40?'var(--amber)':'var(--red)')}
          ${_healthBar('Purchase Efficiency', Math.max(0,100-+purRatio), +purRatio<60?'var(--green)':+purRatio<80?'var(--amber)':'var(--red)')}
        </div>
      </div>

      <!-- Key Ratios -->
      <div class="card">
        <div class="card-hd"><div class="card-title"><i class="fas fa-calculator"></i> Key Ratios</div></div>
        <div class="card-body no-top">
          <div class="stat-strip">
            ${_ssRow('Gross Margin %', (s.totalSale?((s.grossPL/s.totalSale)*100).toFixed(1):0)+'%','var(--text)')}
            ${_ssRow('Net Margin %', margin+'%', +margin>=0?'var(--green)':'var(--red)')}
            ${_ssRow('Expense %', expRatio+'%','var(--amber)')}
            ${_ssRow('Purchase %', purRatio+'%','var(--brand)')}
            ${_ssRow('Total Entries', (DB.stats.purchaseCount||0)+(DB.stats.saleCount||0),'var(--text)')}
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Trend chart -->
  <div class="card">
    <div class="card-hd"><div class="card-title"><i class="fas fa-chart-area"></i> Purchase vs Sale vs Net P/L (6M Trend)</div></div>
    <div class="card-body">
      <div class="chart-box" style="height:260px"><canvas id="ch-insights"></canvas></div>
    </div>
  </div>`;

  requestAnimationFrame(() => {
    const c = DB.chart || {};
    if (c.labels && c.labels.length) {
      _drawChart('ch-insights','bar',c.labels,[
        { label:'Purchase', data:c.purchase||[], backgroundColor:'rgba(192,57,43,.6)', borderRadius:4 },
        { label:'Sale',     data:c.sale||[],     backgroundColor:'rgba(39,174,96,.6)',  borderRadius:4 },
        { label:'Net P/L',  data:c.net||[],      type:'line', borderColor:'#2980B9', backgroundColor:'rgba(41,128,185,.1)', pointRadius:4, tension:.4, fill:true, yAxisID:'y1' },
      ], true, false, true);
    }
  });
}

function _healthBar(label, pct, color) {
  return `<div style="margin-bottom:12px">
    <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:600;color:var(--text2);margin-bottom:5px">
      <span>${label}</span><span style="color:${color}">${Math.round(pct)}%</span>
    </div>
    <div style="height:7px;background:var(--border);border-radius:7px;overflow:hidden">
      <div style="height:100%;width:${pct}%;background:${color};border-radius:7px;transition:width .8s ease"></div>
    </div>
  </div>`;
}

/* ─────────────────────────────────────────────────────────
   CHART HELPERS
───────────────────────────────────────────────────────── */
function _drawTrend() {
  const c = DB.chart || {};
  if (!c.labels || !c.labels.length) return;
  _drawChart('ch-trend', 'bar', c.labels, [
    { label:'Purchase', data:c.purchase||[], backgroundColor:'rgba(192,57,43,.75)', borderRadius:5, borderSkipped:false },
    { label:'Sale',     data:c.sale||[],     backgroundColor:'rgba(39,174,96,.75)',  borderRadius:5, borderSkipped:false },
  ], true, false);
}

function _drawPartyDash() {
  const pm   = DB.partyMap || {};
  const keys = Object.keys(pm);
  if (!keys.length) return;
  _drawDoughnut('ch-party-dash', keys, keys.map(k=>pm[k].total), ['#C0392B','#27AE60','#E67E22','#2980B9','#8E44AD']);
}

function _drawChart(id, type, labels, datasets, legend, yFmt, dualAxis) {
  if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; }
  const ctx = document.getElementById(id); if (!ctx) return;
  const scales = {
    y:  { beginAtZero:true, grid:{color:'rgba(0,0,0,.05)'}, ticks:{font:{size:11,family:'Inter'}, callback: v => yFmt===false?v.toLocaleString('en-IN'):'₹'+fmt(v)} },
    x:  { grid:{display:false}, ticks:{font:{size:11,family:'Inter'}} }
  };
  if (dualAxis) {
    scales.y1 = { type:'linear', position:'right', beginAtZero:true, grid:{display:false}, ticks:{font:{size:11,family:'Inter'}, callback:v=>'₹'+fmt(v)} };
  }
  _charts[id] = new Chart(ctx, {
    data: { labels, datasets },
    options: {
      responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
      plugins: { legend:{ display:!!legend, position:'top', labels:{font:{size:11,family:'Inter'},boxWidth:12,padding:12} },
        tooltip:{ callbacks:{ label: ctx => ctx.dataset.label+': ₹'+fmt(ctx.parsed.y) } } },
      scales
    }
  });
}

function _drawDoughnut(id, labels, data, colors) {
  if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; }
  const ctx = document.getElementById(id); if (!ctx) return;
  _charts[id] = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets:[{ data, backgroundColor:colors, borderWidth:3, borderColor:'#fff', hoverBorderWidth:4 }] },
    options: {
      responsive:true, maintainAspectRatio:false, cutout:'62%',
      plugins: {
        legend:{ position:'bottom', labels:{ font:{size:11,family:'Inter'}, boxWidth:10, padding:10 } },
        tooltip:{ callbacks:{ label: ctx => ctx.label+': ₹'+fmt(ctx.parsed) } }
      }
    }
  });
}

/* ─────────────────────────────────────────────────────────
   SAVE OPERATIONS
───────────────────────────────────────────────────────── */
let _busy = false;
function _startBtn(id) {
  if (_busy) return false; _busy = true;
  const b = document.getElementById(id); if(b){ b.classList.add('busy'); b.disabled=true; }
  return true;
}
function _endBtn(id) {
  _busy = false;
  const b = document.getElementById(id); if(b){ b.classList.remove('busy'); b.disabled=false; }
}

function savePurchaseEntry() {
  const date = document.getElementById('pur-date').value;
  const qty  = document.getElementById('pur-qty').value;
  const amt  = document.getElementById('pur-amt').value;
  if (!date)           { toast('Date select karein','warning'); return; }
  if (!qty || +qty<=0) { toast('Qty daalna zaroori hai','warning'); return; }
  if (!amt || +amt<=0) { toast('Amount daalna zaroori hai','warning'); return; }
  if (!_startBtn('pur-save')) return;

  _api('savePurchase', { date, qty: +qty, amount: +amt },
    r => {
      _endBtn('pur-save');
      if (r && r.success) {
        closeModal('m-pur'); toast('✅ Purchase entry save ho gayi!', 'success');
        _waNotify('purchase', { date: document.getElementById('pur-date').value, qty: document.getElementById('pur-qty').value, amount: document.getElementById('pur-amt').value });
        _loadData(false);
      } else toast('❌ ' + ((r && r.error) || 'Save failed'), 'error');
    },
    e => { _endBtn('pur-save'); toast('❌ ' + (e.message || 'Error'), 'error'); }
  );
}

function saveSaleEntry() {
  const date  = document.getElementById('sal-date').value;
  const party = document.getElementById('sal-party').value;
  const qty   = document.getElementById('sal-qty').value;
  const amt   = document.getElementById('sal-amt').value;
  if (!date)           { toast('Date select karein','warning'); return; }
  if (!qty || +qty<=0) { toast('Qty daalna zaroori hai','warning'); return; }
  if (!amt || +amt<=0) { toast('Amount daalna zaroori hai','warning'); return; }
  if (!_startBtn('sal-save')) return;

  _api('saveSale', { date, party, qty: +qty, amount: +amt },
    r => {
      _endBtn('sal-save');
      if (r && r.success) {
        closeModal('m-sal'); toast('✅ Sale entry save ho gayi!', 'success');
        _waNotify('sale', { date: document.getElementById('sal-date').value, party: document.getElementById('sal-party').value, qty: document.getElementById('sal-qty').value, amount: document.getElementById('sal-amt').value });
        _loadData(false);
      } else toast('❌ ' + ((r && r.error) || 'Save failed'), 'error');
    },
    e => { _endBtn('sal-save'); toast('❌ ' + (e.message || 'Error'), 'error'); }
  );
}

function saveExpenseEntry() {
  const month = document.getElementById('exp-month').value;
  const amt   = document.getElementById('exp-amt').value;
  if (!amt || +amt < 0) { toast('Amount daalna zaroori hai','warning'); return; }
  if (!_startBtn('exp-save')) return;

  _api('saveExpenses', { month, amount: +amt },
    r => {
      _endBtn('exp-save');
      if (r && r.success) {
        closeModal('m-exp'); toast('✅ Expense save ho gayi!', 'success');
        _waNotify('expense', { month: document.getElementById('exp-month').value, amount: document.getElementById('exp-amt').value });
        _loadData(false);
      } else toast('❌ ' + ((r && r.error) || 'Save failed'), 'error');
    },
    e => { _endBtn('exp-save'); toast('❌ ' + (e.message || 'Error'), 'error'); }
  );
}

/* ─────────────────────────────────────────────────────────
   MODAL HELPERS
───────────────────────────────────────────────────────── */
function openModal(id) {
  // Pre-fill date fields
  const today = _todayStr();
  if (id === 'm-pur') {
    document.getElementById('pur-date').value = today;
    document.getElementById('pur-qty').value  = '';
    document.getElementById('pur-amt').value  = '';
  } else if (id === 'm-sal') {
    document.getElementById('sal-date').value = today;
    document.getElementById('sal-qty').value  = '';
    document.getElementById('sal-amt').value  = '';
  } else if (id === 'm-exp') {
    document.getElementById('exp-amt').value  = '';
    _populateMonths();
  }
  document.getElementById(id).classList.add('active');
}
function closeModal(id) { document.getElementById(id).classList.remove('show'); }

/* ─────────────────────────────────────────────────────────
   UTILITIES
───────────────────────────────────────────────────────── */
function fmt(n) { return Math.round(Math.abs(Number(n)||0)).toLocaleString('en-IN'); }
function fmt0(n) { return Math.round(Number(n)||0).toLocaleString('en-IN'); }
function INR(n) { return '₹' + fmt(n); }

function fmtD(v) {
  if (!v) return '—';
  if (v instanceof Date) {
    return String(v.getDate()).padStart(2,'0') + '/' + String(v.getMonth()+1).padStart(2,'0') + '/' + v.getFullYear();
  }
  return String(v);
}

function _todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function _curMonthLabel() {
  const now = new Date();
  const LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return LABELS[now.getMonth()] + '-' + String(now.getFullYear()).slice(2);
}

function toast(msg, type='success') {
  Swal.mixin({
    toast:true, position:'top-end', showConfirmButton:false,
    timer:3000, timerProgressBar:true,
    customClass:{ popup:'swal2-toast-custom' }
  }).fire({ icon:type, title:msg });
}

/* ─────────────────────────────────────────────────────────
   KEYBOARD SHORTCUTS
───────────────────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.show').forEach(m => m.classList.remove('show'));
    closeSidebar();
  }
  // Ctrl+D = Dashboard, Ctrl+P = Purchase, Ctrl+S = Sales
  if (e.ctrlKey && e.key === 'd' && document.getElementById('app-wrapper').style.display === 'block') {
    e.preventDefault(); goTo('dashboard');
  }
});

/* ─────────────────────────────────────────────────────────
   INIT — handled in WINDOW LOAD — FINAL INIT section
───────────────────────────────────────────────────────── */

/* ──────────────────────────────────────────
   ENHANCED CHART — PURCHASE VIEW BAR CHART
────────────────────────────────────────── */
function renderPurchaseChart() {
  const arr = DB.purchases || [];
  if (!arr.length) return;
  // Group by month
  const map = {};
  arr.forEach(r => {
    const d = String(r.date || '');
    let key = d.length >= 7 ? d.slice(0,7) : 'Unknown';
    if (!map[key]) map[key] = 0;
    map[key] += (r.amount || 0);
  });
  const labels = Object.keys(map).sort();
  const data   = labels.map(k => map[k]);
  if (document.getElementById('ch-pur-trend')) {
    _drawChart('ch-pur-trend', 'bar', labels, [{
      label: 'Purchase Amount',
      data,
      backgroundColor: 'rgba(192,57,43,.75)',
      borderRadius: 5,
      borderSkipped: false
    }], false, false);
  }
}

/* ─────────────────────────────────────────────────────────
   ENHANCED CHART — SALES VIEW BAR CHART
───────────────────────────────────────────────────────── */
function renderSalesChart() {
  const arr = DB.sales || [];
  if (!arr.length) return;
  const pm = DB.partyMap || {};
  const keys = Object.keys(pm);
  if (!keys.length) return;
  if (document.getElementById('ch-sal-split')) {
    _drawDoughnut('ch-sal-split', keys, keys.map(k => pm[k].total), ['#C0392B','#27AE60','#E67E22','#2980B9']);
  }
}

/* ─────────────────────────────────────────────────────────
   PRINT REPORT
───────────────────────────────────────────────────────── */
function printMonthly() {
  window.print();
}

/* ─────────────────────────────────────────────────────────
   EXPORT CSV
───────────────────────────────────────────────────────── */
function exportCSV(type) {
  let rows = [], headers = [], filename = '';
  if (type === 'purchase') {
    headers = ['Timestamp','Added By','Date','Qty','Amount'];
    rows    = (DB.purchases||[]).map(r => [r.ts,r.by,r.date,r.qty,r.amount]);
    filename = 'fresko_purchase.csv';
  } else if (type === 'sales') {
    headers = ['Timestamp','Added By','Date','Party','Qty','Amount'];
    rows    = (DB.sales||[]).map(r => [r.ts,r.by,r.date,r.party,r.qty,r.amount]);
    filename = 'fresko_sales.csv';
  } else if (type === 'expenses') {
    headers = ['Timestamp','Added By','Month','Amount'];
    rows    = (DB.expenses||[]).map(r => [r.ts,r.by,r.month,r.amount]);
    filename = 'fresko_expenses.csv';
  } else if (type === 'summary') {
    headers = ['Month','Purchase','Sale','Expenses','Gross P/L','Net P/L'];
    rows    = (DB.summary||[]).map(r => [r.month,r.purchase,r.sale,r.expenses,r.grossPL,r.netPL]);
    filename = 'fresko_summary.csv';
  }
  if (!rows.length) { toast('Export karne ke liye data nahi hai','warning'); return; }
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c||'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  toast('✅ CSV exported!', 'success');
}

/* ─────────────────────────────────────────────────────────
   QUICK ENTRY SHORTCUT KEYS INFO
───────────────────────────────────────────────────────── */
function showShortcuts() {
  Swal.fire({
    title: '⌨️ Keyboard Shortcuts',
    html: `
      <table style="width:100%;text-align:left;font-size:13px;border-collapse:collapse">
        <tr style="border-bottom:1px solid #eee"><td style="padding:7px 8px;font-weight:700">Ctrl + D</td><td style="padding:7px 8px">Dashboard</td></tr>
        <tr style="border-bottom:1px solid #eee"><td style="padding:7px 8px;font-weight:700">Escape</td><td style="padding:7px 8px">Close modal / sidebar</td></tr>
        <tr style="border-bottom:1px solid #eee"><td style="padding:7px 8px;font-weight:700">Enter</td><td style="padding:7px 8px">Login form submit</td></tr>
      </table>`,
    confirmButtonColor: '#C0392B',
    width: 380
  });
}

/* ─────────────────────────────────────────────────────────
   RIPPLE EFFECT ON BUTTONS
───────────────────────────────────────────────────────── */
document.addEventListener('click', function(e) {
  const btn = e.target.closest('.btn, .sb-nav-item, .stat-card');
  if (!btn) return;
  const circle = document.createElement('span');
  const diameter = Math.max(btn.clientWidth, btn.clientHeight);
  const radius = diameter / 2;
  const rect = btn.getBoundingClientRect();
  circle.style.cssText = `
    width:${diameter}px;height:${diameter}px;
    left:${e.clientX-rect.left-radius}px;top:${e.clientY-rect.top-radius}px;
    position:absolute;border-radius:50%;
    background:rgba(255,255,255,.25);transform:scale(0);
    animation:ripple .5s linear;pointer-events:none;
  `;
  if (!btn.style.position || btn.style.position === 'static') btn.style.position = 'relative';
  btn.style.overflow = 'hidden';
  btn.appendChild(circle);
  setTimeout(() => circle.remove(), 500);
});

/* ─────────────────────────────────────────────────────────
   RESPONSIVE SIDEBAR AUTO-CLOSE ON RESIZE
───────────────────────────────────────────────────────── */
window.addEventListener('resize', () => {
  if (window.innerWidth > 900) closeSidebar();
});

/* ─────────────────────────────────────────────────────────
   NUMBER ANIMATION ON KPI CARDS
───────────────────────────────────────────────────────── */
function animateNumbers() {
  document.querySelectorAll('.k-val').forEach(el => {
    const text = el.textContent;
    const num  = parseInt(text.replace(/[₹,]/g, ''));
    if (isNaN(num) || num === 0) return;
    let start = 0;
    const duration = 800;
    const step = duration / 60;
    const inc  = num / 60;
    const timer = setInterval(() => {
      start += inc;
      if (start >= num) { start = num; clearInterval(timer); }
      // Keep ₹ prefix if present
      el.textContent = text.startsWith('₹') ? '₹' + Math.floor(start).toLocaleString('en-IN') : Math.floor(start).toLocaleString('en-IN');
    }, step);
  });
}

/* ─────────────────────────────────────────────────────────
   TOOLTIP INIT (on stat cards hover)
───────────────────────────────────────────────────────── */
function _addTooltips() {
  document.querySelectorAll('[data-tip]').forEach(el => {
    el.addEventListener('mouseenter', function(e) {
      const tip = document.createElement('div');
      tip.id = '__tip';
      tip.style.cssText = `position:fixed;background:#1A1D2E;color:#fff;font-size:11px;font-weight:600;padding:5px 10px;border-radius:7px;z-index:9999;pointer-events:none;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,.2)`;
      tip.textContent = this.dataset.tip;
      document.body.appendChild(tip);
      const rect = this.getBoundingClientRect();
      tip.style.left = rect.left + (rect.width/2) - (tip.offsetWidth/2) + 'px';
      tip.style.top  = rect.bottom + 6 + 'px';
    });
    el.addEventListener('mouseleave', () => { const t = document.getElementById('__tip'); if(t) t.remove(); });
  });
}

/* ─────────────────────────────────────────────────────────
   DARK MODE TOGGLE (bonus feature)
───────────────────────────────────────────────────────── */
let _dark = false;
function toggleDark() {
  _dark = !_dark;
  const root = document.documentElement;
  const ico  = document.getElementById('dark-ico') || {className:''};
  if (_dark) {
    root.style.setProperty('--bg',    '#0F1117');
    root.style.setProperty('--bg2',   '#1A1D2E');
    root.style.setProperty('--white', '#1E2235');
    root.style.setProperty('--border','#2D3147');
    root.style.setProperty('--border-d','#3D4266');
    root.style.setProperty('--text',  '#E8EAEF');
    root.style.setProperty('--text2', '#A8ADBE');
    root.style.setProperty('--muted', '#7A7F99');
    if (ico) ico.className = 'fas fa-sun';
  } else {
    root.style.setProperty('--bg',    '#F5F6FA');
    root.style.setProperty('--bg2',   '#ECEEF5');
    root.style.setProperty('--white', '#FFFFFF');
    root.style.setProperty('--border','#E8EAEF');
    root.style.setProperty('--border-d','#D5D8E0');
    root.style.setProperty('--text',  '#1A1D2E');
    root.style.setProperty('--text2', '#4A5066');
    root.style.setProperty('--muted', '#7A7F99');
    if (ico) ico.className = 'fas fa-moon';
  }
  toast(_dark ? '🌙 Dark mode on' : '☀️ Light mode on', 'info');
}

/* ─────────────────────────────────────────────────────────
   RIPPLE CSS INJECTION
───────────────────────────────────────────────────────── */
(function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes ripple { to { transform:scale(2.5); opacity:0; } }

    /* SweetAlert custom */
    .swal2-popup { font-family:'Inter',sans-serif !important; border-radius:18px !important; }
    .swal2-title { font-size:18px !important; font-weight:800 !important; }
    .swal2-confirm { border-radius:9px !important; font-weight:700 !important; }
    .swal2-cancel  { border-radius:9px !important; font-weight:700 !important; }
    .swal2-toast   { border-radius:12px !important; }

    /* Smooth page transitions handled by viewIn keyframe */

    /* Glowing active nav item */
    .sb-nav-item.active::before {
      content:''; position:absolute; left:0; top:0; bottom:0; width:3px;
      background:linear-gradient(180deg,#EA4335,#C5221F);
      border-radius:0 3px 3px 0;
    }

    /* Custom scrollbar for content */
    #content::-webkit-scrollbar { width:5px; }
    #content::-webkit-scrollbar-track { background:transparent; }
    #content::-webkit-scrollbar-thumb { background:#DDD; border-radius:5px; }
    #content::-webkit-scrollbar-thumb:hover { background:#C0392B; }

    /* Topbar shadow on scroll */
    #topbar { transition: box-shadow .2s; }
    #topbar.scrolled { box-shadow:0 2px 12px rgba(0,0,0,.1); }

    /* Card hover effect */
    .kcard { cursor:default; user-select:none; }

    /* Loading shimmer for tables */
    .tbl-skeleton td { padding:10px 14px; }
    .tbl-skeleton .skel { display:inline-block; width:80%; }

    /* Active pill border animation */
    .pill.on { position:relative; overflow:hidden; }
    .pill.on::after {
      content:'';position:absolute;inset:0;
      background:linear-gradient(90deg,transparent,rgba(255,255,255,.15),transparent);
      animation:shine 2s infinite;
    }
    @keyframes shine { from{transform:translateX(-100%)} to{transform:translateX(100%)} }

    /* Floating action button pulse (mobile) */
    @media(max-width:600px){
      .tb-btn.brand { border-radius:50%; width:44px;height:44px;padding:0;justify-content:center; }
      .tb-btn.brand span { display:none; }
      .tb-btn.brand i { font-size:16px; }
    }

    /* Print styles */
    @media print {
      #sb, #topbar, #footer-bar, .ph-r, .pager, .btn, button { display:none !important; }
      #app { display:block !important; height:auto !important; }
      #main { height:auto !important; overflow:visible !important; }
      #content { overflow:visible !important; height:auto !important; padding:0 !important; }
      .card { box-shadow:none !important; break-inside:avoid; }
    }
  `;
  document.head.appendChild(style);
})();

/* ─────────────────────────────────────────────────────────
   TOPBAR SCROLL SHADOW
───────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const content = document.getElementById('content');
  const topbar  = document.getElementById('topbar');
  if (content && topbar) {
    content.addEventListener('scroll', () => {
      topbar.classList.toggle('scrolled', content.scrollTop > 4);
    });
  }
});

/* ─────────────────────────────────────────────────────────
   KEYBOARD SHORTCUTS (full)
───────────────────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.show').forEach(m => m.classList.remove('show'));
    closeSidebar();
  }
  if (document.getElementById('app-wrapper').style.display !== 'block') return;
  if (e.ctrlKey && e.key === 'd') { e.preventDefault(); goTo('dashboard'); }
  if (e.ctrlKey && e.key === 'p') { e.preventDefault(); openModal('m-pur'); }
  if (e.ctrlKey && e.key === 'k') { e.preventDefault(); openModal('m-sal'); }
  if (e.ctrlKey && e.key === 'e') { e.preventDefault(); openModal('m-exp'); }
  if (e.ctrlKey && e.key === 'r') { e.preventDefault(); doRefresh(); }
});

/* ─────────────────────────────────────────────────────────
   WINDOW LOAD — FINAL INIT
───────────────────────────────────────────────────────── */
window.addEventListener('load', () => {
  // Set footer year
  const fyEl = document.getElementById('footer-year');
  if (fyEl) fyEl.textContent = new Date().getFullYear();

  // Backdrop close on modal click
  document.querySelectorAll('.modal-overlay').forEach(el => {
    el.addEventListener('click', function(e) {
      if (e.target === this) this.classList.remove('show');
    });
  });

  // PWA: Auto-enter if session saved
  if (USER && _TOKEN) {
    enterApp();
  }
});

/* ─────────────────────────────────────────────────────────
   SERVICE WORKER (offline support shell)
───────────────────────────────────────────────────────── */
// Note: GAS doesn't support SW, but we handle offline gracefully
window.addEventListener('offline', () => toast('📡 Internet connection lost', 'warning'));
window.addEventListener('online',  () => { toast('✅ Back online', 'success'); doRefresh(); });

/* ─────────────────────────────────────────────────────────
   PWA — SERVICE WORKER REGISTRATION
───────────────────────────────────────────────────────── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('sw.js', { scope: './' })
      .then(function(reg) { console.log('SW registered:', reg.scope); })
      .catch(function(err) { console.log('SW registration failed:', err); });
  });
}
