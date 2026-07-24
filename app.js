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
var API = 'https://script.google.com/macros/s/AKfycbzPsjWq27q3ckAFxMVeGiNefMk5LAKTBhpjd9L1Qls0wL0t3WL0USvNnl6hQVAI8FIs/exec';

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
  document.getElementById('et').textContent = msg;
  el.classList.add('on');
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
  if (aw) { aw.style.display = 'block'; }
  // Show loader while data loads
  const ldr = document.getElementById('loader');
  if (ldr) ldr.style.display = 'flex';
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
      DB._loaded = true;
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
  const ico = document.getElementById('refresh-icon');
  if (ico) ico.classList.add('spinning');
  _loadData(false, () => {
    if (ico) ico.classList.remove('spinning');
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
    <button class="btn btn-primary" onclick="doRefresh()"><i class="fas fa-redo"></i> Retry</button>
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
  const nel = document.getElementById('nav-' + v); if (nel) nel.classList.add('active');

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
  if (!rerender && !DB._loaded) return; // data not loaded yet
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
  document.getElementById('sb').classList.add('mobile-show');
  document.getElementById('sb-backdrop').classList.add('show');
}
function closeSidebar() {
  document.getElementById('sb').classList.remove('mobile-show');
  document.getElementById('sb-backdrop').classList.remove('show');
}

/* ─────────────────────────────────────────────────────────
   SIGN OUT
───────────────────────────────────────────────────────── */
function signOutPrompt() { openModal('m-signout'); }

/* ─────────────────────────────────────────────────────────
   DASHBOARD
───────────────────────────────────────────────────────── */

/* ═══════════════════════════════════════════════════════════
   RENDER HELPERS
═══════════════════════════════════════════════════════════ */

// Stat card builder
function _statCard(label, val, sub, colorClass, icon) {
  return `<div class="stat-card ${colorClass}">
    <div class="stat-label"><i class="fas ${icon}" style="margin-right:6px"></i>${label}</div>
    <div class="stat-val">${val}</div>
    ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
  </div>`;
}

// Card with header + body
function _card(hd, body, extra) {
  return `<div class="card" ${extra||''}>
    <div class="card-p" style="border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;padding:14px 20px">
      <div style="font-size:14px;font-weight:700;color:var(--text);display:flex;align-items:center;gap:8px">${hd}</div>
    </div>
    <div class="card-p">${body}</div>
  </div>`;
}

// Page header
function _pageHd(title, sub, actions) {
  return `<div class="page-hd">
    <div><div class="page-title">${title}</div><div class="page-sub">${sub}</div></div>
    <div class="page-actions">${actions||''}</div>
  </div>`;
}

// KV row (key-value)
function _kv(lbl, val, color) {
  return `<div class="kv-row">
    <span class="kv-lbl">${lbl}</span>
    <span class="kv-val" style="color:${color||'var(--text)'}">${val}</span>
  </div>`;
}

// Empty state
function _empty(msg, sub) {
  return `<div class="empty"><i class="fas fa-inbox"></i><p>${msg}</p>${sub?`<small>${sub}</small>`:''}</div>`;
}

// Table wrapper
function _tbl(thead, tbody) {
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr>${thead}</tr></thead><tbody>${tbody||`<tr><td colspan="20">${_empty('Koi data nahi hai')}</td></tr>`}</tbody></table></div>`;
}

function _th(t) { return `<th>${t}</th>`; }
function _td(t, cls) { return `<td${cls?' class="'+cls+'"':''}>${t}</td>`; }

// Pager
function _pager(page, total, perPage, fnName) {
  const pages = Math.ceil(total / perPage) || 1;
  const from  = total ? (page-1)*perPage+1 : 0;
  const to    = Math.min(page*perPage, total);
  return `<div class="pager">
    <div class="pager-info">${total ? `${from}–${to} of ${total} entries` : 'No entries'}</div>
    <div class="pager-btns">
      <button class="pager-btn" ${page<=1?'disabled':''} onclick="${fnName}(${page-1})"><i class="fas fa-chevron-left" style="font-size:10px"></i></button>
      <span class="pager-page">${page} / ${pages}</span>
      <button class="pager-btn" ${page>=pages?'disabled':''} onclick="${fnName}(${page+1})"><i class="fas fa-chevron-right" style="font-size:10px"></i></button>
    </div>
  </div>`;
}

// btn shortcuts
function _btnPrimary(lbl, onclick, icon) {
  return `<button class="btn btn-primary btn-sm" onclick="${onclick}"><i class="fas ${icon}" style="margin-right:6px"></i>${lbl}</button>`;
}
function _btnSecondary(lbl, onclick, icon) {
  return `<button class="btn btn-secondary btn-sm" onclick="${onclick}"><i class="fas ${icon}" style="margin-right:6px"></i>${lbl}</button>`;
}

/* ═══════════════════════════════════════════════════════════
   DASHBOARD
═══════════════════════════════════════════════════════════ */
function renderDashboard() {
  const s   = DB.stats    || {};
  const pur = DB.purchases || [];
  const sal = DB.sales     || [];
  const v   = document.getElementById('v-dashboard');
  if (!v) return;

  const netPos   = (s.netPL   || 0) >= 0;
  const grossPos = (s.grossPL || 0) >= 0;

  // Stat cards
  const cards = `<div class="g4" style="margin-bottom:20px">
    ${_statCard('Total Purchase', INR(s.totalPurchase), s.purchaseCount+' entries', 'sc-red', 'fa-shopping-cart')}
    ${_statCard('Total Sale', INR(s.totalSale), s.saleCount+' entries', 'sc-green', 'fa-truck')}
    ${_statCard('Total Expenses', INR(s.totalExpenses), 'FY 2025–26', 'sc-amber', 'fa-file-invoice')}
    ${_statCard(
      netPos ? 'Net Profit' : 'Net Loss',
      INR(Math.abs(s.netPL||0)),
      netPos ? '▲ Profitable' : '▼ Loss making',
      netPos ? 'sc-green' : 'sc-red',
      netPos ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'
    )}
  </div>`;

  // Charts row
  const charts = `<div class="g2" style="margin-bottom:20px">
    <div class="card">
      <div class="card-p" style="border-bottom:1px solid var(--border);padding:14px 20px">
        <span style="font-size:14px;font-weight:700;color:var(--text)"><i class="fas fa-chart-line" style="color:var(--blue);margin-right:8px"></i>Purchase vs Sale Trend</span>
      </div>
      <div class="card-p">
        <div style="height:220px;position:relative"><canvas id="ch-trend"></canvas></div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:16px">
      <div class="card" style="flex:1">
        <div class="card-p" style="border-bottom:1px solid var(--border);padding:14px 20px">
          <span style="font-size:14px;font-weight:700;color:var(--text)"><i class="fas fa-balance-scale" style="color:var(--red);margin-right:8px"></i>P/L Snapshot</span>
        </div>
        <div class="card-p">
          ${_kv('Gross Margin', INR(Math.abs(s.grossPL||0)) + (grossPos?' (P)':' (L)'), grossPos?'var(--green)':'var(--red)')}
          ${_kv('Net P/L', INR(Math.abs(s.netPL||0)) + (netPos?' (P)':' (L)'), netPos?'var(--green)':'var(--red)')}
          ${_kv('Net Margin %', (s.totalSale?((s.netPL/s.totalSale)*100).toFixed(1):0)+'%', netPos?'var(--green)':'var(--red)')}
          ${_kv('Expense Ratio', (s.totalSale?((s.totalExpenses/s.totalSale)*100).toFixed(1):0)+'%', 'var(--amber)')}
        </div>
      </div>
      <div class="card">
        <div class="card-p" style="border-bottom:1px solid var(--border);padding:14px 20px">
          <span style="font-size:14px;font-weight:700;color:var(--text)"><i class="fas fa-chart-pie" style="color:var(--red);margin-right:8px"></i>Sales Split</span>
        </div>
        <div class="card-p">
          <div style="height:120px;position:relative"><canvas id="ch-party-dash"></canvas></div>
        </div>
      </div>
    </div>
  </div>`;

  // Recent tables
  const recent = `<div class="g2">
    <div class="card">
      <div class="card-p" style="border-bottom:1px solid var(--border);padding:14px 20px;display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:14px;font-weight:700"><i class="fas fa-shopping-cart" style="color:var(--red);margin-right:8px"></i>Recent Purchases</span>
        <button class="btn btn-ghost btn-sm" onclick="goTo('purchase')" style="font-size:11px">View All →</button>
      </div>
      <div>${_miniPurchaseTable(pur.slice(0,5))}</div>
    </div>
    <div class="card">
      <div class="card-p" style="border-bottom:1px solid var(--border);padding:14px 20px;display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:14px;font-weight:700"><i class="fas fa-truck" style="color:var(--green);margin-right:8px"></i>Recent Sales</span>
        <button class="btn btn-ghost btn-sm" onclick="goTo('sales')" style="font-size:11px">View All →</button>
      </div>
      <div>${_miniSaleTable(sal.slice(0,5))}</div>
    </div>
  </div>`;

  v.innerHTML = _pageHd('Dashboard', 'FY 2025–26 · Real-time Profit & Loss Overview',
    `<button class="btn btn-secondary btn-sm" onclick="goTo('monthly')"><i class="fas fa-calendar-alt" style="margin-right:6px"></i>Monthly Report</button>
     <button class="btn btn-secondary btn-sm" onclick="goTo('summary')"><i class="fas fa-chart-bar" style="margin-right:6px"></i>Annual</button>`
  ) + cards + charts + recent;

  requestAnimationFrame(() => { _drawTrend(); _drawPartyDash(); });
}

function _miniPurchaseTable(arr) {
  if (!arr.length) return _empty('Koi purchase entry nahi');
  const rows = arr.map(r =>
    `<tr>${_td(fmtD(r.date))}${_td(fmt0(r.qty))}${_td('₹'+fmt(r.amount),'num')}</tr>`
  ).join('');
  return _tbl(`${_th('Date')}${_th('Qty')}${_th('Amount')}`, rows);
}

function _miniSaleTable(arr) {
  if (!arr.length) return _empty('Koi sale entry nahi');
  const rows = arr.map(r => {
    const cls = String(r.party||'').includes('LOCAL') ? 'b-red' : 'b-green';
    return `<tr>${_td(fmtD(r.date))}${_td(`<span class="badge ${cls}">${r.party||'—'}</span>`)}${_td('₹'+fmt(r.amount),'num')}</tr>`;
  }).join('');
  return _tbl(`${_th('Date')}${_th('Party')}${_th('Amount')}`, rows);
}

/* ═══════════════════════════════════════════════════════════
   ANNUAL SUMMARY
═══════════════════════════════════════════════════════════ */
function renderSummary() {
  const s    = DB.stats   || {};
  const rows = DB.summary || [];
  const v    = document.getElementById('v-summary');
  if (!v) return;

  const netPos   = (s.netPL||0) >= 0;
  const curMo    = _curMonthLabel();
  const totGross = (s.totalSale||0) - (s.totalPurchase||0);
  const totNet   = totGross - (s.totalExpenses||0);

  let tblRows = '';
  rows.forEach(r => {
    const empty  = !r.purchase && !r.sale && !r.expenses;
    const gpos   = (r.grossPL||0) >= 0;
    const npos   = (r.netPL||0)   >= 0;
    const margin = r.sale ? ((r.netPL/r.sale)*100).toFixed(1) : '—';
    const isCur  = (r.month||'') === curMo;
    tblRows += `<tr class="${isCur?'cur-month':''}">
      <td style="font-weight:700">${r.month||'—'}${isCur?' <span class="badge b-amber" style="font-size:9px;margin-left:4px">Current</span>':''}</td>
      <td class="num">${r.purchase?'₹'+fmt(r.purchase):'—'}</td>
      <td class="num">${r.sale?'₹'+fmt(r.sale):'—'}</td>
      <td class="num">${r.expenses?'₹'+fmt(r.expenses):'—'}</td>
      <td class="num ${gpos&&!empty?'profit':!empty?'loss':''}">${!empty?'₹'+fmt(Math.abs(r.grossPL))+(r.grossPL<0?' L':' P'):'—'}</td>
      <td class="num ${npos&&!empty?'profit':!empty?'loss':''}">${!empty?'₹'+fmt(Math.abs(r.netPL))+(r.netPL<0?' L':' P'):'—'}</td>
      <td class="num">${margin !== '—' ? margin+'%' : '—'}</td>
    </tr>`;
  });
  tblRows += `<tr class="total-row">
    <td style="font-weight:800">TOTAL</td>
    <td class="num">₹${fmt(s.totalPurchase)}</td>
    <td class="num">₹${fmt(s.totalSale)}</td>
    <td class="num">₹${fmt(s.totalExpenses)}</td>
    <td class="num ${totGross>=0?'profit':'loss'}">₹${fmt(Math.abs(totGross))} ${totGross>=0?'P':'L'}</td>
    <td class="num ${totNet>=0?'profit':'loss'}">₹${fmt(Math.abs(totNet))} ${totNet>=0?'P':'L'}</td>
    <td class="num">${s.totalSale?((totNet/s.totalSale)*100).toFixed(1):0}%</td>
  </tr>`;

  v.innerHTML = _pageHd('Annual Summary', 'FY 2025–26 · Month-wise complete P&L statement') +

  `<div class="g4" style="margin-bottom:20px">
    ${_statCard('YTD Purchase', INR(s.totalPurchase), '', 'sc-red', 'fa-shopping-cart')}
    ${_statCard('YTD Sale', INR(s.totalSale), '', 'sc-green', 'fa-truck')}
    ${_statCard('YTD Expenses', INR(s.totalExpenses), '', 'sc-amber', 'fa-file-invoice')}
    ${_statCard(netPos?'Net Profit':'Net Loss', INR(Math.abs(s.netPL||0)), '', netPos?'sc-green':'sc-red', 'fa-chart-line')}
  </div>

  <div class="g2" style="margin-bottom:20px">
    <div class="card">
      <div class="card-p" style="border-bottom:1px solid var(--border);padding:14px 20px">
        <span style="font-size:14px;font-weight:700"><i class="fas fa-chart-bar" style="color:var(--blue);margin-right:8px"></i>Monthly Net P/L</span>
      </div>
      <div class="card-p"><div style="height:220px;position:relative"><canvas id="ch-net"></canvas></div></div>
    </div>
    <div class="card">
      <div class="card-p" style="border-bottom:1px solid var(--border);padding:14px 20px">
        <span style="font-size:14px;font-weight:700"><i class="fas fa-info-circle" style="color:var(--red);margin-right:8px"></i>FY Metrics</span>
      </div>
      <div class="card-p">
        ${_kv('Total Purchase', INR(s.totalPurchase), 'var(--red)')}
        ${_kv('Total Sale', INR(s.totalSale), 'var(--green)')}
        ${_kv('Total Expenses', INR(s.totalExpenses), 'var(--amber)')}
        ${_kv('Gross P/L', INR(Math.abs(totGross))+(totGross>=0?' (P)':' (L)'), totGross>=0?'var(--green)':'var(--red)')}
        ${_kv('Net P/L', INR(Math.abs(totNet))+(totNet>=0?' (P)':' (L)'), totNet>=0?'var(--green)':'var(--red)')}
        ${_kv('Net Margin', (s.totalSale?((totNet/s.totalSale)*100).toFixed(1):0)+'%', totNet>=0?'var(--green)':'var(--red)')}
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-p" style="border-bottom:1px solid var(--border);padding:14px 20px;display:flex;align-items:center;justify-content:space-between">
      <span style="font-size:14px;font-weight:700"><i class="fas fa-table" style="color:var(--red);margin-right:8px"></i>Month-wise Breakdown</span>
      <div style="display:flex;gap:8px;align-items:center">
        <span class="badge b-amber" style="font-size:10px">★ Current month</span>
        <span class="badge b-slate" style="font-size:10px">${rows.length} months</span>
      </div>
    </div>
    <div>
      ${_tbl(
        `${_th('Month')}${_th('Purchase (₹)')}${_th('Sale (₹)')}${_th('Expenses (₹)')}${_th('Gross P/L')}${_th('Net P/L')}${_th('Margin %')}`,
        tblRows || null
      )}
    </div>
  </div>`;

  requestAnimationFrame(() => {
    const c = DB.chart || {};
    if (c.labels && c.labels.length) {
      _drawChart('ch-net', 'bar', c.labels, [{
        label: 'Net P/L',
        data: c.net||[],
        backgroundColor: (c.net||[]).map(v => v >= 0 ? 'rgba(52,168,83,.75)' : 'rgba(234,67,53,.75)'),
        borderRadius: 5, borderSkipped: false
      }], false, true);
    }
  });
}

/* ═══════════════════════════════════════════════════════════
   PURCHASE VIEW
═══════════════════════════════════════════════════════════ */
function renderPurchase(pg) {
  if (pg !== undefined) _page.purchase = pg;
  const arr  = DB.purchases || [];
  const v    = document.getElementById('v-purchase');
  if (!v) return;

  const q        = document.getElementById('pur-q') ? document.getElementById('pur-q').value.trim() : '';
  const filtered = q ? arr.filter(r => JSON.stringify(r).toLowerCase().includes(q.toLowerCase())) : arr;
  const page     = _page.purchase;
  const total    = filtered.length;
  const rows     = filtered.slice((page-1)*PER, page*PER);
  const s        = DB.stats || {};

  const tblRows = rows.map((r, i) => `<tr>
    <td style="color:var(--sub);font-size:11px;width:40px">${(page-1)*PER+i+1}</td>
    <td style="font-weight:600">${fmtD(r.date)}</td>
    <td>${fmt0(r.qty)}</td>
    <td class="num">₹${fmt(r.amount)}</td>
    <td style="color:var(--muted);font-size:12px">${r.by||'—'}</td>
    <td style="color:var(--sub);font-size:11px">${r.ts||'—'}</td>
  </tr>`).join('');

  v.innerHTML = _pageHd('Purchase Entry', 'Daily purchase record karein',
    `${_btnSecondary('Export CSV','exportCSV(\'purchase\')','fa-download')}
     ${_btnPrimary('New Entry','openModal(\'m-pur\')','fa-plus')}`
  ) +

  `<div class="g3" style="margin-bottom:20px">
    ${_statCard('Total Entries', arr.length, '', 'sc-slate', 'fa-hashtag')}
    ${_statCard('Total Purchase', INR(s.totalPurchase||0), '', 'sc-red', 'fa-shopping-cart')}
    ${_statCard('Avg. per Entry', arr.length?INR(Math.round((s.totalPurchase||0)/arr.length)):'—', '', 'sc-blue', 'fa-calculator')}
  </div>

  <div class="card">
    <div class="card-p" style="border-bottom:1px solid var(--border);padding:14px 20px">
      <span style="font-size:14px;font-weight:700"><i class="fas fa-list" style="color:var(--red);margin-right:8px"></i>Purchase History</span>
    </div>
    <div class="card-p">
      <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap">
        <div class="search-wrap" style="flex:1;min-width:200px">
          <i class="fas fa-search"></i>
          <input class="form-input" id="pur-q" placeholder="Search date, amount, qty…" value="${q}"
                 oninput="_page.purchase=1;renderPurchase()" style="padding-left:32px">
        </div>
        <span class="badge b-slate" style="align-self:center">${total} records</span>
      </div>
      ${_tbl(
        `${_th('#')}${_th('Date')}${_th('Qty')}${_th('Amount')}${_th('Added By')}${_th('Timestamp')}`,
        tblRows || null
      )}
    </div>
    ${_pager(page, total, PER, 'renderPurchase')}
  </div>`;
}

/* ═══════════════════════════════════════════════════════════
   SALES VIEW
═══════════════════════════════════════════════════════════ */
function renderSales(pg) {
  if (pg !== undefined) _page.sales = pg;
  const arr = DB.sales || [];
  const v   = document.getElementById('v-sales');
  if (!v) return;

  const q    = document.getElementById('sal-q') ? document.getElementById('sal-q').value.trim() : '';
  const filt = document.getElementById('sal-f') ? document.getElementById('sal-f').value : 'all';
  let filtered = q ? arr.filter(r => JSON.stringify(r).toLowerCase().includes(q.toLowerCase())) : arr;
  if (filt !== 'all') filtered = filtered.filter(r => (r.party||'').toLowerCase().includes(filt.toLowerCase()));

  const page     = _page.sales;
  const total    = filtered.length;
  const rows     = filtered.slice((page-1)*PER, page*PER);
  const locTotal = arr.filter(r=>(r.party||'').includes('LOCAL')).reduce((s,r)=>s+(r.amount||0),0);
  const supTotal = arr.filter(r=>!(r.party||'').includes('LOCAL')).reduce((s,r)=>s+(r.amount||0),0);
  const s        = DB.stats || {};

  const tblRows = rows.map((r, i) => {
    const cls = String(r.party||'').includes('LOCAL') ? 'b-red' : 'b-green';
    return `<tr>
      <td style="color:var(--sub);font-size:11px;width:40px">${(page-1)*PER+i+1}</td>
      <td style="font-weight:600">${fmtD(r.date)}</td>
      <td><span class="badge ${cls}">${r.party||'—'}</span></td>
      <td>${fmt0(r.qty)}</td>
      <td class="num">₹${fmt(r.amount)}</td>
      <td style="color:var(--muted);font-size:12px">${r.by||'—'}</td>
    </tr>`;
  }).join('');

  v.innerHTML = _pageHd('Sales Entry', 'Party-wise daily sales record karein',
    `${_btnSecondary('Export CSV','exportCSV(\'sales\')','fa-download')}
     <button class="btn btn-green btn-sm" onclick="openModal('m-sal')"><i class="fas fa-plus" style="margin-right:6px"></i>New Entry</button>`
  ) +

  `<div class="g3" style="margin-bottom:20px">
    ${_statCard('LOCAL SALE', INR(locTotal), '', 'sc-red', 'fa-store')}
    ${_statCard('SUPPLY SALE', INR(supTotal), '', 'sc-green', 'fa-truck')}
    ${_statCard('Total Sale', INR(s.totalSale||0), '', 'sc-blue', 'fa-chart-line')}
  </div>

  <div class="card">
    <div class="card-p" style="border-bottom:1px solid var(--border);padding:14px 20px">
      <span style="font-size:14px;font-weight:700"><i class="fas fa-list" style="color:var(--green);margin-right:8px"></i>Sales History</span>
    </div>
    <div class="card-p">
      <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap">
        <div class="search-wrap" style="flex:1;min-width:180px">
          <i class="fas fa-search"></i>
          <input class="form-input" id="sal-q" placeholder="Search sales…" value="${q}"
                 oninput="_page.sales=1;renderSales()" style="padding-left:32px">
        </div>
        <select class="form-input" id="sal-f" style="width:150px;flex:none" onchange="_page.sales=1;renderSales()">
          <option value="all" ${filt==='all'?'selected':''}>All Parties</option>
          <option value="LOCAL" ${filt==='LOCAL'?'selected':''}>LOCAL SALE</option>
          <option value="SUPPLY" ${filt==='SUPPLY'?'selected':''}>SUPPLY SALE</option>
        </select>
        <span class="badge b-slate" style="align-self:center">${total} records</span>
      </div>
      ${_tbl(
        `${_th('#')}${_th('Date')}${_th('Party')}${_th('Qty')}${_th('Amount')}${_th('Added By')}`,
        tblRows || null
      )}
    </div>
    ${_pager(page, total, PER, 'renderSales')}
  </div>`;
}

/* ═══════════════════════════════════════════════════════════
   EXPENSES VIEW
═══════════════════════════════════════════════════════════ */
function renderExpenses() {
  const arr = DB.expenses || [];
  const v   = document.getElementById('v-expenses');
  if (!v) return;
  const s   = DB.stats || {};

  const tblRows = arr.map((r, i) => `<tr>
    <td style="color:var(--sub);font-size:11px;width:40px">${i+1}</td>
    <td style="font-weight:600">${r.month||'—'}</td>
    <td class="num">₹${fmt(r.amount)}</td>
    <td style="color:var(--muted);font-size:12px">${r.by||'—'}</td>
    <td style="color:var(--sub);font-size:11px">${r.ts||'—'}</td>
  </tr>`).join('');

  v.innerHTML = _pageHd('Expenses Entry', 'Monthly operational expenses record karein',
    `${_btnSecondary('Export CSV','exportCSV(\'expenses\')','fa-download')}
     <button class="btn btn-amber btn-sm" onclick="openModal('m-exp')"><i class="fas fa-plus" style="margin-right:6px"></i>New Entry</button>`
  ) +

  `<div class="g2" style="margin-bottom:20px">
    ${_statCard('Total Expenses (YTD)', INR(s.totalExpenses||0), '', 'sc-amber', 'fa-file-invoice-dollar')}
    ${_statCard('Expense Ratio (vs Sale)', (s.totalSale?((s.totalExpenses/s.totalSale)*100).toFixed(1):0)+'%', '', 'sc-blue', 'fa-percent')}
  </div>

  <div class="card">
    <div class="card-p" style="border-bottom:1px solid var(--border);padding:14px 20px;display:flex;align-items:center;justify-content:space-between">
      <span style="font-size:14px;font-weight:700"><i class="fas fa-list" style="color:var(--amber);margin-right:8px"></i>Expenses History</span>
      <span class="badge b-amber">${arr.length} entries</span>
    </div>
    <div>
      ${_tbl(
        `${_th('#')}${_th('Month')}${_th('Amount')}${_th('Added By')}${_th('Timestamp')}`,
        tblRows || null
      )}
    </div>
  </div>`;
}

/* ═══════════════════════════════════════════════════════════
   MONTHLY P&L
═══════════════════════════════════════════════════════════ */
function renderMonthly() {
  const rows  = DB.summary || [];
  const v     = document.getElementById('v-monthly');
  const curMo = _curMonthLabel();
  if (!v) return;

  let totP=0, totS=0, totE=0;
  const tblRows = rows.map(r => {
    totP += r.purchase||0; totS += r.sale||0; totE += r.expenses||0;
    const empty = !r.purchase && !r.sale && !r.expenses;
    const gpos  = (r.grossPL||0) >= 0;
    const npos  = (r.netPL||0)   >= 0;
    const margin = r.sale ? ((r.netPL/r.sale)*100).toFixed(1) : '—';
    const isCur  = (r.month||'') === curMo;
    return `<tr class="${isCur?'cur-month':''}">
      <td style="font-weight:700;white-space:nowrap">${r.month||'—'}${isCur?' <span class="badge b-amber" style="font-size:9px;margin-left:4px">Current</span>':''}</td>
      <td class="num">${r.purchase?'₹'+fmt(r.purchase):'—'}</td>
      <td class="num">${r.sale?'₹'+fmt(r.sale):'—'}</td>
      <td class="num">${r.expenses?'₹'+fmt(r.expenses):'—'}</td>
      <td class="num ${gpos&&!empty?'profit':!empty?'loss':''}">${!empty?'₹'+fmt(Math.abs(r.grossPL))+(r.grossPL<0?' L':' P'):'—'}</td>
      <td class="num ${npos&&!empty?'profit':!empty?'loss':''}">${!empty?'₹'+fmt(Math.abs(r.netPL))+(r.netPL<0?' L':' P'):'—'}</td>
      <td class="num">${margin !== '—' ? margin+'%' : '—'}</td>
    </tr>`;
  }).join('');

  const totNet   = totS - totP - totE;
  const totGross = totS - totP;
  const totalRow = `<tr class="total-row">
    <td style="font-weight:800">TOTAL</td>
    <td class="num">₹${fmt(totP)}</td>
    <td class="num">₹${fmt(totS)}</td>
    <td class="num">₹${fmt(totE)}</td>
    <td class="num ${totGross>=0?'profit':'loss'}">₹${fmt(Math.abs(totGross))} ${totGross>=0?'P':'L'}</td>
    <td class="num ${totNet>=0?'profit':'loss'}">₹${fmt(Math.abs(totNet))} ${totNet>=0?'P':'L'}</td>
    <td class="num">${totS?((totNet/totS)*100).toFixed(1):0}%</td>
  </tr>`;

  v.innerHTML = _pageHd('Monthly P&L', 'Month-wise detailed profit & loss statement',
    `${_btnSecondary('Export CSV','exportCSV(\'summary\')','fa-download')}
     ${_btnSecondary('Print','window.print()','fa-print')}`
  ) +

  `<div class="card" style="margin-bottom:20px">
    <div class="card-p" style="border-bottom:1px solid var(--border);padding:14px 20px;display:flex;align-items:center;justify-content:space-between">
      <span style="font-size:14px;font-weight:700"><i class="fas fa-table" style="color:var(--red);margin-right:8px"></i>Month-wise P&L Statement</span>
      <div style="display:flex;gap:6px">
        <span class="badge b-amber" style="font-size:10px">★ Current month</span>
        <span class="badge b-slate" style="font-size:10px">${rows.length} months</span>
      </div>
    </div>
    <div>
      ${_tbl(
        `${_th('Month')}${_th('Purchase')}${_th('Sale')}${_th('Expenses')}${_th('Gross P/L')}${_th('Net P/L')}${_th('Margin %')}`,
        (tblRows + totalRow) || null
      )}
    </div>
  </div>

  <div class="card">
    <div class="card-p" style="border-bottom:1px solid var(--border);padding:14px 20px">
      <span style="font-size:14px;font-weight:700"><i class="fas fa-chart-bar" style="color:var(--blue);margin-right:8px"></i>Monthly Purchase vs Sale vs Expenses</span>
    </div>
    <div class="card-p"><div style="height:260px;position:relative"><canvas id="ch-monthly"></canvas></div></div>
  </div>`;

  requestAnimationFrame(() => {
    const c = DB.chart || {};
    if (c.labels && c.labels.length) {
      _drawChart('ch-monthly', 'bar', c.labels, [
        { label:'Purchase', data:c.purchase||[], backgroundColor:'rgba(234,67,53,.7)', borderRadius:4 },
        { label:'Sale',     data:c.sale||[],     backgroundColor:'rgba(52,168,83,.7)',  borderRadius:4 },
      ], true, false);
    }
  });
}

/* ═══════════════════════════════════════════════════════════
   PARTY ANALYSIS
═══════════════════════════════════════════════════════════ */
function renderAnalysis() {
  const pm    = DB.partyMap || {};
  const keys  = Object.keys(pm);
  const total = keys.reduce((s,k)=>s+(pm[k].total||0),0);
  const v     = document.getElementById('v-analysis');
  if (!v) return;

  const COLORS_CLS = ['sc-red','sc-green','sc-amber','sc-blue','sc-slate'];
  const HEX = ['#EA4335','#34A853','#FBBC05','#4285F4','#64748B'];
  const BADGE_CLS = ['b-red','b-green','b-amber','b-blue','b-slate'];

  const statCards = keys.map((k,i) => {
    const pct = total>0?((pm[k].total/total)*100).toFixed(1):0;
    return _statCard(k, INR(pm[k].total), `${pm[k].count} transactions · ${pct}%`, COLORS_CLS[i%COLORS_CLS.length], 'fa-store');
  }).join('');

  const tblRows = keys.map((k,i) => {
    const pct = total>0?((pm[k].total/total)*100).toFixed(1):0;
    const avg = pm[k].count ? Math.round(pm[k].total/pm[k].count) : 0;
    return `<tr>
      <td><span class="badge ${BADGE_CLS[i%BADGE_CLS.length]}">${k}</span></td>
      <td class="num">₹${fmt(pm[k].total)}</td>
      <td>${pm[k].count}</td>
      <td class="num">₹${fmt(avg)}</td>
      <td style="min-width:120px">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;height:6px;background:var(--border);border-radius:6px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${HEX[i%HEX.length]};border-radius:6px"></div>
          </div>
          <span style="font-size:11px;font-weight:700;color:${HEX[i%HEX.length]};min-width:38px">${pct}%</span>
        </div>
      </td>
    </tr>`;
  }).join('');

  v.innerHTML = _pageHd('Party Analysis', 'Party-wise sales breakdown & insights') +

  `<div class="g${Math.min(keys.length||1,4)}" style="margin-bottom:20px">${statCards||_empty('Party data nahi hai')}</div>

  <div class="g2">
    <div class="card">
      <div class="card-p" style="border-bottom:1px solid var(--border);padding:14px 20px">
        <span style="font-size:14px;font-weight:700"><i class="fas fa-table" style="color:var(--red);margin-right:8px"></i>Party-wise Details</span>
      </div>
      <div>
        ${_tbl(`${_th('Party')}${_th('Total (₹)')}${_th('Transactions')}${_th('Avg. (₹)')}${_th('Share %')}`, tblRows||null)}
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:16px">
      <div class="card" style="flex:1">
        <div class="card-p" style="border-bottom:1px solid var(--border);padding:14px 20px">
          <span style="font-size:14px;font-weight:700"><i class="fas fa-chart-pie" style="color:var(--red);margin-right:8px"></i>Sales Split</span>
        </div>
        <div class="card-p"><div style="height:200px;position:relative"><canvas id="ch-party-a"></canvas></div></div>
      </div>
      <div class="card">
        <div class="card-p" style="border-bottom:1px solid var(--border);padding:14px 20px">
          <span style="font-size:14px;font-weight:700"><i class="fas fa-info-circle" style="color:var(--red);margin-right:8px"></i>Summary</span>
        </div>
        <div class="card-p">
          ${_kv('Total Sale', INR(total), 'var(--green)')}
          ${_kv('Party Types', keys.length+' types', 'var(--text)')}
          ${_kv('Total Transactions', (DB.stats.saleCount||0)+' entries', 'var(--text)')}
        </div>
      </div>
    </div>
  </div>`;

  requestAnimationFrame(() => {
    if (keys.length) _drawDoughnut('ch-party-a', keys, keys.map(k=>pm[k].total), HEX);
  });
}

/* ═══════════════════════════════════════════════════════════
   INSIGHTS
═══════════════════════════════════════════════════════════ */
function renderInsights() {
  const s    = DB.stats   || {};
  const rows = DB.summary || [];
  const v    = document.getElementById('v-insights');
  if (!v) return;

  const netPos   = (s.netPL||0) >= 0;
  const margin   = s.totalSale ? ((s.netPL/s.totalSale)*100).toFixed(1) : 0;
  const expRatio = s.totalSale ? ((s.totalExpenses/s.totalSale)*100).toFixed(1) : 0;
  const purRatio = s.totalSale ? ((s.totalPurchase/s.totalSale)*100).toFixed(1) : 0;

  const withData   = rows.filter(r => r.sale || r.purchase);
  const sorted     = [...withData].sort((a,b)=>(b.netPL||0)-(a.netPL||0));
  const bestMonth  = sorted[0];
  const worstMonth = sorted[sorted.length-1];

  const insights = [
    { icon:'fa-chart-line', color:netPos?'var(--green)':'var(--red)', bg:netPos?'var(--green-l)':'var(--red-l)',
      title: netPos ? '✅ Business Profitable Hai' : '⚠️ Net Loss Mein Hai',
      desc: `FY 2025–26 mein Net P/L <strong>${INR(Math.abs(s.netPL||0))}</strong> ${netPos?'profit':'loss'} hai. Net margin <strong>${margin}%</strong>.`
    },
    { icon:'fa-file-invoice', color:'var(--amber)', bg:'var(--amber-l)',
      title: `Expense Ratio: ${expRatio}%`,
      desc: `Har ₹100 sale par ₹${expRatio} expenses ja rahe hain. ${+expRatio>30?'Expenses thode zyada hain.':'Expenses controlled hain — achha hai!'}`
    },
    { icon:'fa-shopping-cart', color:'var(--red)', bg:'var(--red-l)',
      title: `Purchase: ${purRatio}% of Sale`,
      desc: `Purchase cost sale ka <strong>${purRatio}%</strong> hai. ${+purRatio>80?'Purchase cost zyada hai — margin kam ho sakta hai.':'Purchase cost reasonable range mein hai.'}`
    },
    ...(bestMonth ? [{
      icon:'fa-trophy', color:'var(--green)', bg:'var(--green-l)',
      title: `Best Month: ${bestMonth.month}`,
      desc: `Sabse zyada profit <strong>${bestMonth.month}</strong> mein raha — <strong>${INR(Math.abs(bestMonth.netPL||0))}</strong> net P/L.`
    }] : []),
    ...(worstMonth && worstMonth.month !== (bestMonth||{}).month ? [{
      icon:'fa-arrow-trend-down', color:'var(--red)', bg:'var(--red-l)',
      title: `Worst Month: ${worstMonth.month}`,
      desc: `Sabse kam performance <strong>${worstMonth.month}</strong> mein — Net P/L <strong>${INR(Math.abs(worstMonth.netPL||0))}</strong> ${(worstMonth.netPL||0)<0?'loss':'profit'}.`
    }] : []),
  ];

  const insightCards = insights.map(ins => `
    <div class="card" style="margin-bottom:12px">
      <div class="card-p">
        <div style="display:flex;gap:14px;align-items:flex-start">
          <div style="width:42px;height:42px;border-radius:10px;background:${ins.bg};color:${ins.color};display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">
            <i class="fas ${ins.icon}"></i>
          </div>
          <div>
            <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:5px">${ins.title}</div>
            <div style="font-size:13px;color:var(--muted);line-height:1.6">${ins.desc}</div>
          </div>
        </div>
      </div>
    </div>`).join('');

  const netPctClamped  = Math.max(0, Math.min(100, +margin + 100));
  const expCtrl        = Math.max(0, 100 - +expRatio);
  const purEff         = Math.max(0, 100 - +purRatio);

  v.innerHTML = _pageHd('Business Insights', 'FY 2025–26 ke key metrics & performance analysis') +

  `<div class="info-box blue" style="margin-bottom:20px">
    <i class="fas fa-lightbulb"></i>
    <span>Yeh insights aapke actual data ke basis par automatically generate hote hain.</span>
  </div>

  <div class="g2">
    <div>${insightCards}</div>

    <div style="display:flex;flex-direction:column;gap:16px">
      <div class="card">
        <div class="card-p" style="border-bottom:1px solid var(--border);padding:14px 20px">
          <span style="font-size:14px;font-weight:700"><i class="fas fa-heartbeat" style="color:var(--red);margin-right:8px"></i>Business Health</span>
        </div>
        <div class="card-p">
          ${_healthBar('Net Margin', Math.max(0,Math.min(100,+margin+50)), +margin>=10?'var(--green)':+margin>=0?'var(--amber)':'var(--red)')}
          ${_healthBar('Expense Control', expCtrl, +expRatio<20?'var(--green)':+expRatio<40?'var(--amber)':'var(--red)')}
          ${_healthBar('Purchase Efficiency', purEff, +purRatio<60?'var(--green)':+purRatio<80?'var(--amber)':'var(--red)')}
        </div>
      </div>
      <div class="card">
        <div class="card-p" style="border-bottom:1px solid var(--border);padding:14px 20px">
          <span style="font-size:14px;font-weight:700"><i class="fas fa-calculator" style="color:var(--red);margin-right:8px"></i>Key Ratios</span>
        </div>
        <div class="card-p">
          ${_kv('Gross Margin %', (s.totalSale?((s.grossPL/s.totalSale)*100).toFixed(1):0)+'%', 'var(--text)')}
          ${_kv('Net Margin %', margin+'%', +margin>=0?'var(--green)':'var(--red)')}
          ${_kv('Expense %', expRatio+'%', 'var(--amber)')}
          ${_kv('Purchase %', purRatio+'%', 'var(--red)')}
          ${_kv('Total Entries', ((DB.stats.purchaseCount||0)+(DB.stats.saleCount||0))+' entries', 'var(--text)')}
        </div>
      </div>
    </div>
  </div>

  <div class="card" style="margin-top:20px">
    <div class="card-p" style="border-bottom:1px solid var(--border);padding:14px 20px">
      <span style="font-size:14px;font-weight:700"><i class="fas fa-chart-area" style="color:var(--blue);margin-right:8px"></i>Purchase vs Sale vs Net P/L Trend</span>
    </div>
    <div class="card-p"><div style="height:260px;position:relative"><canvas id="ch-insights"></canvas></div></div>
  </div>`;

  requestAnimationFrame(() => {
    const c = DB.chart || {};
    if (c.labels && c.labels.length) {
      _drawChart('ch-insights','bar',c.labels,[
        { label:'Purchase', data:c.purchase||[], backgroundColor:'rgba(234,67,53,.6)', borderRadius:4 },
        { label:'Sale',     data:c.sale||[],     backgroundColor:'rgba(52,168,83,.6)',  borderRadius:4 },
        { label:'Net P/L',  data:c.net||[],      type:'line', borderColor:'#4285F4', backgroundColor:'rgba(66,133,244,.1)', pointRadius:4, tension:.4, fill:true, yAxisID:'y1' },
      ], true, false, true);
    }
  });
}

function _healthBar(label, pct, color) {
  return `<div class="health-bar-wrap">
    <div class="health-bar-lbl"><span>${label}</span><span style="color:${color}">${Math.round(pct)}%</span></div>
    <div class="health-bar-track"><div class="health-bar-fill" style="width:${pct}%;background:${color}"></div></div>
  </div>`;
}

/* ─────────────────────────────────────────────────────────
   CHART HELPERS
───────────────────────────────────────────────────────── */
function _drawTrend() {
  const c = DB.chart || {};
  if (!c.labels || !c.labels.length) return;
  _drawChart('ch-trend', 'bar', c.labels, [
    { label:'Purchase', data:c.purchase||[], backgroundColor:'rgba(234,67,53,.75)', borderRadius:5, borderSkipped:false },
    { label:'Sale',     data:c.sale||[],     backgroundColor:'rgba(52,168,83,.75)',  borderRadius:5, borderSkipped:false },
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
  if (!date)  { toast('Date select karein','warning'); return; }
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
  if (!date)  { toast('Date select karein','warning'); return; }
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
  const today = _todayStr();
  if (id === 'm-pur') {
    // Reset to manual tab
    purTab('manual');
    document.getElementById('pur-date').value = today;
    document.getElementById('pur-qty').value  = '';
    document.getElementById('pur-amt').value  = '';
    pdfReset();
  } else if (id === 'm-sal') {
    // Reset to single tab
    salTab('single');
    document.getElementById('sal-date').value = today;
    document.getElementById('sal-qty').value  = '';
    document.getElementById('sal-amt').value  = '';
    salPDFReset();
  } else if (id === 'm-exp') {
    document.getElementById('exp-amt').value  = '';
    _populateMonths();
  }
  document.getElementById(id).classList.add('show');
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
      backgroundColor: 'rgba(234,67,53,.75)',
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
    .stat-card { cursor:default; user-select:none; }

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
      #sb, #topbar, #footer-bar, .page-actions, .pager, .btn, button { display:none !important; }
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

// Sidebar toggle alias
function toggleSB() { toggleSidebar(); }

/* ═══════════════════════════════════════════════════════════
   PURCHASE MODAL — TAB SWITCHING
═══════════════════════════════════════════════════════════ */
function purTab(tab) {
  var panels = { manual: 'pur-panel-manual', pdf: 'pur-panel-pdf' };
  var fts    = { manual: 'pur-ft-manual',    pdf: 'pur-ft-pdf'    };

  Object.keys(panels).forEach(function(t) {
    var panel = document.getElementById(panels[t]);
    var ft    = document.getElementById(fts[t]);
    var btn   = document.getElementById('pur-tab-' + t);
    if (!btn) return;
    var isActive = t === tab;
    if (panel) panel.style.display = isActive ? '' : 'none';
    if (ft)    ft.style.display    = isActive ? 'flex' : 'none';
    btn.style.borderBottom = isActive ? '2px solid var(--red)' : '2px solid transparent';
    btn.style.color        = isActive ? 'var(--red)'           : 'var(--muted)';
    btn.style.fontWeight   = isActive ? '700'                  : '600';
  });
}

/* ═══════════════════════════════════════════════════════════
   PDF.js SETUP
   pdf.js library se browser mein directly PDF read karte hain
   without any server — completely client side
═══════════════════════════════════════════════════════════ */
(function() {
  // Set worker path for PDF.js
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
})();

// ── Generic PDF text extractor ──
// Returns Promise<string> — full text of all pages concatenated
function _extractPDFText(file, onProgress) {
  return new Promise(function(resolve, reject) {
    if (typeof pdfjsLib === 'undefined') {
      reject(new Error('PDF.js library load nahi hua. Internet check karein.'));
      return;
    }

    var reader = new FileReader();
    reader.onload = function(e) {
      var typedArray = new Uint8Array(e.target.result);
      pdfjsLib.getDocument({ data: typedArray }).promise.then(function(pdf) {
        var totalPages = pdf.numPages;
        var pageTexts  = [];
        var promises   = [];

        for (var i = 1; i <= totalPages; i++) {
          (function(pageNum) {
            promises.push(
              pdf.getPage(pageNum).then(function(page) {
                return page.getTextContent();
              }).then(function(content) {
                var text = content.items.map(function(item) {
                  return item.str;
                }).join(' ');
                pageTexts[pageNum - 1] = text;
                if (onProgress) onProgress(pageNum, totalPages);
              })
            );
          })(i);
        }

        Promise.all(promises).then(function() {
          resolve(pageTexts.join('\n'));
        }).catch(reject);

      }).catch(function(err) {
        reject(new Error('PDF read nahi ho saka: ' + err.message));
      });
    };
    reader.onerror = function() { reject(new Error('File read failed')); };
    reader.readAsArrayBuffer(file);
  });
}

/* ═══════════════════════════════════════════════════════════
   PURCHASE PDF — FILE UPLOAD HANDLER
═══════════════════════════════════════════════════════════ */
var _pdfParsed = [];

function handlePDFDrop(event) {
  var file = event.dataTransfer.files[0];
  if (file) _processPurchasePDF(file);
}

function handlePDFFileSelect(input) {
  var file = input.files[0];
  if (file) _processPurchasePDF(file);
}

function _processPurchasePDF(file) {
  if (!file || file.type !== 'application/pdf') {
    toast('Sirf PDF file select karein', 'warning'); return;
  }

  // Show loading
  document.getElementById('pdf-dropzone').style.display  = 'none';
  document.getElementById('pdf-loading').style.display   = '';
  document.getElementById('pdf-loading-text').textContent = 'PDF read ho raha hai… (' + file.name + ')';

  _extractPDFText(file, function(page, total) {
    document.getElementById('pdf-loading-page').textContent = 'Page ' + page + ' / ' + total;
  }).then(function(text) {
    document.getElementById('pdf-loading').style.display = 'none';
    _parsePurchaseText(text, file.name);
  }).catch(function(err) {
    document.getElementById('pdf-loading').style.display  = 'none';
    document.getElementById('pdf-dropzone').style.display = '';
    toast('❌ ' + err.message, 'error');
  });
}

function _parsePurchaseText(rawText, fileName) {
  // PDF.js spaces words — we need to reconstruct lines
  // Strategy: split on newlines first, then also look for DATE TOTAL pattern
  // PDF.js often merges lines — so we look for pattern anywhere in the text

  // Normalize: replace multiple spaces with single
  var text  = rawText.replace(/\s{2,}/g, ' ');
  var lines = text.split('\n');

  var results  = [];
  var lastDate = null;
  var dateRe   = /(\d{2})\/(\d{2})\/(\d{4})/g;
  var totalRe  = /DATE\s+TOTAL[\s\.,]+(\d[\d,]*)\s+([\d,\.]+)\s+([\d,\.]+)\s+([\d,\.]+)/gi;

  // Pass 1: find all dates in order
  // Pass 2: find all DATE TOTAL entries and associate with preceding date
  // We work on the full raw text for more robustness

  var allMatches = [];

  // Find all date occurrences with their index
  var dMatch;
  dateRe.lastIndex = 0;
  while ((dMatch = dateRe.exec(text)) !== null) {
    allMatches.push({
      type: 'date',
      idx:  dMatch.index,
      date: dMatch[3] + '-' + dMatch[2] + '-' + dMatch[1] // YYYY-MM-DD
    });
  }

  // Find all DATE TOTAL occurrences
  totalRe.lastIndex = 0;
  var tMatch;
  while ((tMatch = totalRe.exec(text)) !== null) {
    allMatches.push({
      type:   'total',
      idx:    tMatch.index,
      qty:    parseFloat(String(tMatch[1]).replace(/,/g, '')) || 0,
      netAmt: parseFloat(String(tMatch[4]).replace(/,/g, '')) || 0
    });
  }

  // Sort all matches by their index in text
  allMatches.sort(function(a, b) { return a.idx - b.idx; });

  // Walk through: keep track of last seen date, associate with totals
  var curDate = null;
  for (var i = 0; i < allMatches.length; i++) {
    var m = allMatches[i];
    if (m.type === 'date') {
      curDate = m.date;
    } else if (m.type === 'total' && curDate && m.netAmt > 0) {
      // Check duplicate
      var dup = false;
      for (var j = 0; j < results.length; j++) {
        if (results[j].date === curDate) { dup = true; break; }
      }
      if (!dup) {
        results.push({ date: curDate, qty: Math.round(m.qty), netAmt: m.netAmt });
      }
    }
  }

  _pdfParsed = results;

  if (!results.length) {
    document.getElementById('pdf-dropzone').style.display = '';
    toast('DATE TOTAL rows nahi mile. Sahi Purchase Register PDF hai?', 'warning');
    return;
  }

  // Sort by date
  results.sort(function(a, b) { return a.date.localeCompare(b.date); });

  _showPurchasePDFPreview(results, fileName);
}

function _showPurchasePDFPreview(results, fileName) {
  var totalAmt = 0, totalQty = 0;
  var trows = results.map(function(r, i) {
    totalAmt += r.netAmt;
    totalQty += r.qty;
    return '<tr style="border-top:1px solid var(--border)">'
      + '<td style="padding:7px 10px;font-size:11px;color:var(--sub);width:28px">' + (i+1) + '</td>'
      + '<td style="padding:7px 10px;font-weight:600;font-size:12px;white-space:nowrap">' + fmtD(r.date) + '</td>'
      + '<td style="padding:7px 10px;font-size:12px;color:var(--muted);text-align:right">' + r.qty.toLocaleString('en-IN') + '</td>'
      + '<td style="padding:7px 10px;font-weight:700;font-size:12px;text-align:right;color:var(--red)">₹' + fmt(r.netAmt) + '</td>'
      + '</tr>';
  }).join('');

  document.getElementById('pdf-preview-table').innerHTML =
    '<table style="width:100%;border-collapse:collapse;font-size:12px">'
    + '<thead><tr style="background:var(--bg)">'
    + '<th style="padding:7px 10px;text-align:left;font-size:10px;color:var(--muted)">#</th>'
    + '<th style="padding:7px 10px;text-align:left;font-size:10px;color:var(--muted)">Date</th>'
    + '<th style="padding:7px 10px;text-align:right;font-size:10px;color:var(--muted)">Qty (kg)</th>'
    + '<th style="padding:7px 10px;text-align:right;font-size:10px;color:var(--muted)">Net Amount</th>'
    + '</tr></thead><tbody>' + trows + '</tbody></table>';

  document.getElementById('pdf-found-count').textContent  = results.length;
  document.getElementById('pdf-total-amt').textContent    = '₹' + fmt(totalAmt);
  document.getElementById('pdf-total-qty').textContent    = totalQty.toLocaleString('en-IN') + ' kg';
  document.getElementById('pdf-file-name').textContent    = fileName || '';

  document.getElementById('pdf-step-1').style.display   = 'none';
  document.getElementById('pdf-step-2').style.display   = '';
  document.getElementById('pdf-import-btn').style.display = '';
}

function pdfReset() {
  _pdfParsed = [];
  var fi = document.getElementById('pdf-file-input');
  if (fi) fi.value = '';
  var dz = document.getElementById('pdf-dropzone');
  var ld = document.getElementById('pdf-loading');
  var s1 = document.getElementById('pdf-step-1');
  var s2 = document.getElementById('pdf-step-2');
  var ib = document.getElementById('pdf-import-btn');
  if (dz) dz.style.display = '';
  if (ld) ld.style.display = 'none';
  if (s1) s1.style.display = '';
  if (s2) s2.style.display = 'none';
  if (ib) ib.style.display = 'none';
}

/* ═══════════════════════════════════════════════════════════
   PURCHASE PDF BULK IMPORT → GAS bulkSavePurchase
═══════════════════════════════════════════════════════════ */
function importPurchasePDF() {
  if (!_pdfParsed.length) { toast('Koi entries nahi hain', 'warning'); return; }
  if (_busy) return;

  var btn = document.getElementById('pdf-import-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importing…'; }
  _busy = true;

  var entries  = _pdfParsed.map(function(r) { return { date: r.date, qty: r.qty, amount: r.netAmt }; });
  var totalAmt = entries.reduce(function(s, e) { return s + e.amount; }, 0);

  _api('bulkSavePurchase', { entries: entries },
    function(r) {
      _busy = false;
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-upload"></i> Import All Entries'; }
      if (r && r.success) {
        closeModal('m-pur');
        pdfReset();
        toast('✅ ' + (r.saved || entries.length) + ' purchase entries import ho gayin!', 'success');
        _waSend(WA_ADMIN_NUMBERS,
          '📦 *Fresko — Bulk Purchase Import*\n'
          + '━━━━━━━━━━━━━━━━━━\n'
          + '📅 *Entries:* ' + (r.saved || entries.length) + ' din\n'
          + '💰 *Total:* ₹' + fmt(totalAmt) + '\n'
          + '👤 *By:* ' + (USER ? USER.name : '—') + '\n'
          + '━━━━━━━━━━━━━━━━━━\n_Fresko P&L Tracker_'
        );
        _loadData(false);
      } else {
        toast('❌ ' + ((r && r.error) || 'Import failed'), 'error');
      }
    },
    function(e) {
      _busy = false;
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-upload"></i> Import All Entries'; }
      toast('❌ ' + (e.message || 'Network error'), 'error');
    }
  );
}

/* ═══════════════════════════════════════════════════════════
   SALE PDF — FILE UPLOAD HANDLER
   Sale PDF format: DATE TOTAL rows with party type mention
   Parser looks for: party keyword (LOCAL/SUPPLY) before DATE TOTAL
═══════════════════════════════════════════════════════════ */
var _salePDFParsed = [];

function handleSalePDFDrop(event) {
  var file = event.dataTransfer.files[0];
  if (file) _processSalePDF(file);
}

function handleSalePDFSelect(input) {
  var file = input.files[0];
  if (file) _processSalePDF(file);
}

function _processSalePDF(file) {
  if (!file || file.type !== 'application/pdf') {
    toast('Sirf PDF file select karein', 'warning'); return;
  }

  document.getElementById('sal-pdf-dropzone').style.display  = 'none';
  document.getElementById('sal-pdf-loading').style.display   = '';
  document.getElementById('sal-pdf-loading-text').textContent = 'PDF read ho raha hai… (' + file.name + ')';

  _extractPDFText(file, function(page, total) {
    document.getElementById('sal-pdf-loading-page').textContent = 'Page ' + page + ' / ' + total;
  }).then(function(text) {
    document.getElementById('sal-pdf-loading').style.display = 'none';
    _parseSaleText(text, file.name);
  }).catch(function(err) {
    document.getElementById('sal-pdf-loading').style.display  = 'none';
    document.getElementById('sal-pdf-dropzone').style.display = '';
    toast('❌ ' + err.message, 'error');
  });
}

function _parseSaleText(rawText, fileName) {
  var text = rawText.replace(/\s{2,}/g, ' ');

  var results  = [];
  var dateRe   = /(\d{2})\/(\d{2})\/(\d{4})/g;
  var totalRe  = /DATE\s+TOTAL[\s\.,]+(\d[\d,]*)\s+([\d,\.]+)\s+([\d,\.]+)\s+([\d,\.]+)/gi;
  // Detect party from surrounding text — look for LOCAL or SUPPLY keyword near DATE TOTAL
  var localRe  = /LOCAL[\s\-]?SALE/i;
  var supplyRe = /SUPPLY[\s\-]?SALE/i;

  var allMatches = [];

  var dMatch;
  dateRe.lastIndex = 0;
  while ((dMatch = dateRe.exec(text)) !== null) {
    allMatches.push({
      type: 'date',
      idx:  dMatch.index,
      date: dMatch[3] + '-' + dMatch[2] + '-' + dMatch[1]
    });
  }

  totalRe.lastIndex = 0;
  var tMatch;
  while ((tMatch = totalRe.exec(text)) !== null) {
    // Look at context around this match to detect party type
    var context = text.substring(Math.max(0, tMatch.index - 200), tMatch.index);
    var party   = localRe.test(context) ? 'LOCAL SALE'
                : supplyRe.test(context) ? 'SUPPLY SALE'
                : 'LOCAL SALE'; // default

    allMatches.push({
      type:   'total',
      idx:    tMatch.index,
      qty:    parseFloat(String(tMatch[1]).replace(/,/g, '')) || 0,
      netAmt: parseFloat(String(tMatch[4]).replace(/,/g, '')) || 0,
      party:  party
    });
  }

  allMatches.sort(function(a, b) { return a.idx - b.idx; });

  var curDate = null;
  for (var i = 0; i < allMatches.length; i++) {
    var m = allMatches[i];
    if (m.type === 'date') {
      curDate = m.date;
    } else if (m.type === 'total' && curDate && m.netAmt > 0) {
      // Allow same date with different party types
      var dup = false;
      for (var j = 0; j < results.length; j++) {
        if (results[j].date === curDate && results[j].party === m.party) {
          dup = true; break;
        }
      }
      if (!dup) {
        results.push({ date: curDate, qty: Math.round(m.qty), netAmt: m.netAmt, party: m.party });
      }
    }
  }

  _salePDFParsed = results;

  if (!results.length) {
    document.getElementById('sal-pdf-dropzone').style.display = '';
    toast('DATE TOTAL rows nahi mile. Sahi date-wise Sale PDF hai?', 'warning');
    return;
  }

  results.sort(function(a, b) {
    var dc = a.date.localeCompare(b.date);
    return dc !== 0 ? dc : a.party.localeCompare(b.party);
  });

  _showSalePDFPreview(results, fileName);
}

function _showSalePDFPreview(results, fileName) {
  var localTotal = 0, supplyTotal = 0;

  var trows = results.map(function(r, i) {
    if (r.party === 'LOCAL SALE')  localTotal  += r.netAmt;
    else                           supplyTotal += r.netAmt;

    var partyColor = r.party === 'LOCAL SALE' ? 'var(--red)' : 'var(--green)';
    var partyBg    = r.party === 'LOCAL SALE' ? 'var(--red-l)' : 'var(--green-l)';

    return '<tr style="border-top:1px solid var(--border)">'
      + '<td style="padding:6px 8px;font-size:11px;color:var(--sub);width:26px">' + (i+1) + '</td>'
      + '<td style="padding:6px 8px;font-weight:600;font-size:11px;white-space:nowrap">' + fmtD(r.date) + '</td>'
      + '<td style="padding:6px 8px">'
      + '<span style="background:' + partyBg + ';color:' + partyColor + ';padding:2px 7px;border-radius:99px;font-size:10px;font-weight:700">' + r.party + '</span>'
      + '</td>'
      + '<td style="padding:6px 8px;font-size:11px;color:var(--muted);text-align:right">' + r.qty.toLocaleString('en-IN') + '</td>'
      + '<td style="padding:6px 8px;font-weight:700;font-size:11px;text-align:right;color:' + partyColor + '">₹' + fmt(r.netAmt) + '</td>'
      + '</tr>';
  }).join('');

  document.getElementById('sal-pdf-preview-table').innerHTML =
    '<table style="width:100%;border-collapse:collapse;font-size:12px">'
    + '<thead><tr style="background:var(--bg)">'
    + '<th style="padding:6px 8px;text-align:left;font-size:10px;color:var(--muted)">#</th>'
    + '<th style="padding:6px 8px;text-align:left;font-size:10px;color:var(--muted)">Date</th>'
    + '<th style="padding:6px 8px;text-align:left;font-size:10px;color:var(--muted)">Party</th>'
    + '<th style="padding:6px 8px;text-align:right;font-size:10px;color:var(--muted)">Qty</th>'
    + '<th style="padding:6px 8px;text-align:right;font-size:10px;color:var(--muted)">Net Amount</th>'
    + '</tr></thead><tbody>' + trows + '</tbody></table>';

  document.getElementById('sal-pdf-found-count').textContent  = results.length;
  document.getElementById('sal-pdf-local-total').textContent  = '₹' + fmt(localTotal);
  document.getElementById('sal-pdf-supply-total').textContent = '₹' + fmt(supplyTotal);
  document.getElementById('sal-pdf-file-name').textContent    = fileName || '';

  document.getElementById('sal-pdf-step-1').style.display    = 'none';
  document.getElementById('sal-pdf-step-2').style.display    = '';
  document.getElementById('sal-pdf-import-btn').style.display = '';
}

function salPDFReset() {
  _salePDFParsed = [];
  var fi = document.getElementById('sal-pdf-file-input');
  if (fi) fi.value = '';
  var dz = document.getElementById('sal-pdf-dropzone');
  var ld = document.getElementById('sal-pdf-loading');
  var s1 = document.getElementById('sal-pdf-step-1');
  var s2 = document.getElementById('sal-pdf-step-2');
  var ib = document.getElementById('sal-pdf-import-btn');
  if (dz) dz.style.display = '';
  if (ld) ld.style.display = 'none';
  if (s1) s1.style.display = '';
  if (s2) s2.style.display = 'none';
  if (ib) ib.style.display = 'none';
}

/* ═══════════════════════════════════════════════════════════
   SALE PDF BULK IMPORT → GAS bulkSaveSale
═══════════════════════════════════════════════════════════ */
function importSalePDF() {
  if (!_salePDFParsed.length) { toast('Koi entries nahi hain', 'warning'); return; }
  if (_busy) return;

  var btn = document.getElementById('sal-pdf-import-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importing…'; }
  _busy = true;

  var entries  = _salePDFParsed.map(function(r) {
    return { date: r.date, party: r.party, qty: r.qty, amount: r.netAmt };
  });
  var totalAmt = entries.reduce(function(s, e) { return s + e.amount; }, 0);

  _api('bulkSaveSale', { entries: entries },
    function(r) {
      _busy = false;
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-upload"></i> Import All Entries'; }
      if (r && r.success) {
        closeModal('m-sal');
        salPDFReset();
        toast('✅ ' + (r.saved || entries.length) + ' sale entries import ho gayin!', 'success');
        _waSend(WA_ADMIN_NUMBERS,
          '🚚 *Fresko — Bulk Sale Import (PDF)*\n'
          + '━━━━━━━━━━━━━━━━━━\n'
          + '📅 *Entries:* ' + (r.saved || entries.length) + ' rows\n'
          + '💰 *Total:* ₹' + fmt(totalAmt) + '\n'
          + '👤 *By:* ' + (USER ? USER.name : '—') + '\n'
          + '━━━━━━━━━━━━━━━━━━\n_Fresko P&L Tracker_'
        );
        _loadData(false);
      } else {
        toast('❌ ' + ((r && r.error) || 'Import failed'), 'error');
      }
    },
    function(e) {
      _busy = false;
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-upload"></i> Import All Entries'; }
      toast('❌ ' + (e.message || 'Network error'), 'error');
    }
  );
}

/* ═══════════════════════════════════════════════════════════
   SALE MODAL — TAB SWITCHING
═══════════════════════════════════════════════════════════ */
function salTab(tab) {
  var tabs   = ['single', 'pdf', 'local', 'supply'];
  var colors = { single: 'var(--green)', pdf: 'var(--green)', local: 'var(--red)', supply: 'var(--green)' };
  tabs.forEach(function(t) {
    var btn    = document.getElementById('sal-tab-' + t);
    var panel  = document.getElementById('sal-panel-' + t);
    var ft     = document.getElementById('sal-ft-' + t);
    if (!btn) return;
    var active = t === tab;
    var color  = colors[t] || 'var(--green)';
    btn.style.borderBottom = active ? '2px solid ' + color : '2px solid transparent';
    btn.style.color        = active ? color : 'var(--muted)';
    btn.style.fontWeight   = active ? '700' : '600';
    if (panel) panel.style.display = active ? '' : 'none';
    if (ft)    ft.style.display    = active ? 'flex' : 'none';
  });
}

/* ═══════════════════════════════════════════════════════════
   SALE BULK — BUILD DATE ROWS
   type = 'local' | 'supply'
═══════════════════════════════════════════════════════════ */
function salBuildRows(type) {
  var monthInput = document.getElementById(type + '-month');
  var tbody      = document.getElementById(type + '-tbody');
  var emptyEl    = document.getElementById(type + '-empty');
  var totalsEl   = document.getElementById(type + '-totals');
  if (!monthInput || !monthInput.value || !tbody) return;

  var parts       = monthInput.value.split('-');
  var year        = parseInt(parts[0]);
  var month       = parseInt(parts[1]);
  var daysInMonth = new Date(year, month, 0).getDate();
  var dayNames    = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  var rows = '';
  for (var d = 1; d <= daysInMonth; d++) {
    var dateObj  = new Date(year, month - 1, d);
    var dayName  = dayNames[dateObj.getDay()];
    var isSun    = dateObj.getDay() === 0;
    var mm       = String(month).padStart(2, '0');
    var dd       = String(d).padStart(2, '0');

    rows += '<tr id="' + type + '-row-' + d + '" style="border-top:1px solid var(--border);'
      + (isSun ? 'background:rgba(251,188,5,.07)' : '') + '">'
      + '<td style="padding:5px 6px;font-size:10px;color:var(--sub);width:22px">' + d + '</td>'
      + '<td style="padding:5px 6px;font-weight:' + (isSun ? '700' : '500') + ';font-size:11px;'
      + 'color:' + (isSun ? 'var(--amber-d)' : 'var(--text)') + ';white-space:nowrap">'
      + dd + ' ' + dayName
      + (isSun ? ' <span style="font-size:9px;background:var(--amber-l);color:var(--amber-d);padding:1px 4px;border-radius:3px">Sun</span>' : '')
      + '</td>'
      + '<td style="padding:4px 5px;text-align:right">'
      + '<input type="number" min="0" placeholder="0" id="' + type + '-qty-' + d + '"'
      + ' style="width:68px;text-align:right;padding:4px 5px;font-size:11px;border:1px solid var(--border);border-radius:6px;background:var(--white)"'
      + ' oninput="salUpdateTotal(\'' + type + '\')">'
      + '</td>'
      + '<td style="padding:4px 5px;text-align:right">'
      + '<input type="number" min="0" placeholder="0" id="' + type + '-amt-' + d + '"'
      + ' style="width:100px;text-align:right;padding:4px 5px;font-size:11px;border:1px solid var(--border);border-radius:6px;background:var(--white)"'
      + ' oninput="salUpdateTotal(\'' + type + '\')">'
      + '</td>'
      + '<td style="padding:4px 6px;text-align:center">'
      + '<input type="checkbox" id="' + type + '-skip-' + d + '"'
      + (isSun ? ' checked' : '')
      + ' onchange="salToggleRow(\'' + type + '\',' + d + ')" style="width:13px;height:13px;cursor:pointer">'
      + '</td>'
      + '</tr>';
  }

  tbody.innerHTML         = rows;
  emptyEl.style.display  = 'none';
  totalsEl.style.display = '';

  // Dim Sundays initially
  for (var d2 = 1; d2 <= daysInMonth; d2++) {
    if (new Date(year, month - 1, d2).getDay() === 0) {
      salToggleRow(type, d2);
    }
  }
  salUpdateTotal(type);
}

function salToggleRow(type, day) {
  var skipCb = document.getElementById(type + '-skip-' + day);
  var row    = document.getElementById(type + '-row-' + day);
  var qInp   = document.getElementById(type + '-qty-' + day);
  var aInp   = document.getElementById(type + '-amt-' + day);
  if (!skipCb || !row) return;
  var skipped        = skipCb.checked;
  row.style.opacity  = skipped ? '0.38' : '1';
  if (qInp) qInp.disabled = skipped;
  if (aInp) aInp.disabled = skipped;
  salUpdateTotal(type);
}

function salUpdateTotal(type) {
  var monthInput = document.getElementById(type + '-month');
  if (!monthInput || !monthInput.value) return;
  var parts       = monthInput.value.split('-');
  var daysInMonth = new Date(parseInt(parts[0]), parseInt(parts[1]), 0).getDate();
  var totalAmt = 0, count = 0;
  for (var d = 1; d <= daysInMonth; d++) {
    var skipCb = document.getElementById(type + '-skip-' + d);
    if (skipCb && skipCb.checked) continue;
    var aInp = document.getElementById(type + '-amt-' + d);
    if (!aInp) continue;
    var amt = parseFloat(aInp.value) || 0;
    if (amt > 0) { totalAmt += amt; count++; }
  }
  var totEl  = document.getElementById(type + '-total-amt');
  var cntEl  = document.getElementById(type + '-entry-count');
  if (totEl) totEl.textContent = '₹' + fmt(totalAmt);
  if (cntEl) cntEl.textContent = count + ' entries';
}

/* ═══════════════════════════════════════════════════════════
   SALE BULK SAVE — collects filled rows → GAS bulkSaveSale
═══════════════════════════════════════════════════════════ */
function saveBulkSale(type) {
  var monthInput = document.getElementById(type + '-month');
  if (!monthInput || !monthInput.value) {
    toast('Pehle month select karein', 'warning'); return;
  }
  var parts       = monthInput.value.split('-');
  var year        = parts[0];
  var month       = parts[1];
  var daysInMonth = new Date(parseInt(year), parseInt(month), 0).getDate();
  var partyLabel  = type === 'local' ? 'LOCAL SALE' : 'SUPPLY SALE';
  var entries     = [];

  for (var d = 1; d <= daysInMonth; d++) {
    var skipCb = document.getElementById(type + '-skip-' + d);
    if (skipCb && skipCb.checked) continue;
    var qInp = document.getElementById(type + '-qty-' + d);
    var aInp = document.getElementById(type + '-amt-' + d);
    var amt  = parseFloat((aInp && aInp.value) || 0) || 0;
    var qty  = parseFloat((qInp && qInp.value) || 0) || 0;
    if (amt <= 0) continue;
    entries.push({
      date:   year + '-' + month + '-' + String(d).padStart(2, '0'),
      party:  partyLabel,
      qty:    qty,
      amount: amt
    });
  }

  if (!entries.length) { toast('Koi amount nahi dala gaya', 'warning'); return; }
  if (_busy) return;

  var btnId = type + '-save-btn';
  var btn   = document.getElementById(btnId);
  var lbl   = type === 'local' ? 'LOCAL' : 'SUPPLY';
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…'; }
  _busy = true;

  var totalAmt = entries.reduce(function(s, e) { return s + e.amount; }, 0);

  _api('bulkSaveSale', { entries: entries },
    function(r) {
      _busy = false;
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-upload"></i> Save ' + lbl + ' Entries'; }
      if (r && r.success) {
        closeModal('m-sal');
        toast('✅ ' + (r.saved || entries.length) + ' ' + partyLabel + ' entries save ho gayin!', 'success');
        _waSend(WA_ADMIN_NUMBERS,
          '🚚 *Fresko — Bulk Sale Import*\n'
          + '━━━━━━━━━━━━━━━━━━\n'
          + '🏷️ *Party:* ' + partyLabel + '\n'
          + '📅 *Entries:* ' + (r.saved || entries.length) + ' din\n'
          + '💰 *Total:* ₹' + fmt(totalAmt) + '\n'
          + '👤 *By:* ' + (USER ? USER.name : '—') + '\n'
          + '━━━━━━━━━━━━━━━━━━\n'
          + '_Fresko P&L Tracker_'
        );
        _loadData(false);
      } else {
        toast('❌ ' + ((r && r.error) || 'Save failed'), 'error');
      }
    },
    function(e) {
      _busy = false;
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-upload"></i> Save ' + lbl + ' Entries'; }
      toast('❌ ' + (e.message || 'Network error'), 'error');
    }
  );
}
