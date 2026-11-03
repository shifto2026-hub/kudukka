// Kudukka — Phase 1: sign-in, PIN lock, accounts and cards, entries, working month, Home summary.
import * as fb from './firebase.js';
import * as D from './data.js';
import { evaluateToPence, isSum } from './calc.js';
import * as PIN from './pin.js';
import { icon, POT_LOGO } from './icons.js';

// ---------- small helpers ----------
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = {
  get(k, d = null) { try { const v = localStorage.getItem(`kudukka.${k}`); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`kudukka.${k}`, JSON.stringify(v)); } catch { /* storage blocked */ } },
};

// ---------- state ----------
const S = {
  authReady: false,
  user: null,
  denied: false,
  householdLoaded: false,
  household: null,
  accounts: [],
  txns: [],
  locked: PIN.hasPin(),
  pin: { stage: null, buffer: '', first: '', error: '' },
  view: 'home',
  person: 'home',
  month: LS.get('month') || D.currentMonth(),
  showArchived: false,
  sheet: null, // 'entry' | 'account' | 'month'
  form: {},
  errors: {},
};
let unsubs = [];

const myRole = () => (S.user && S.household && S.household.members && S.household.members[S.user.uid]
  ? S.household.members[S.user.uid].role : null);
const activeAccounts = () => S.accounts.filter((a) => !a.archived);
const accountById = (id) => S.accounts.find((a) => a.id === id);

function setMonth(m) {
  S.month = m;
  LS.set('month', m);
}

// ---------- toast ----------
let toastTimer;
function toast(msg, undo) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button" data-act="undo">Undo</button>' : ''}`;
  el.classList.add('show');
  toast.undo = undo || null;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('show'); toast.undo = null; }, undo ? 6000 : 3000);
}

// ---------- data subscriptions ----------
function startData() {
  stopData();
  const onErr = (e) => {
    if (e && e.code === 'permission-denied') { S.denied = true; render(); }
    else console.error(e);
  };
  unsubs.push(fb.watchHousehold((h) => { S.household = h; S.householdLoaded = true; S.denied = false; render(); }, onErr));
  unsubs.push(fb.watchCollection('accounts', (rows) => {
    S.accounts = rows.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(b.name));
    renderMain();
  }, onErr));
  unsubs.push(fb.watchCollection('transactions', (rows) => {
    S.txns = rows.map((t) => ({ ...t, createdMs: t.createdAt && t.createdAt.toMillis ? t.createdAt.toMillis() : Date.now() }));
    renderMain();
  }, onErr));
}
function stopData() {
  unsubs.forEach((u) => u && u());
  unsubs = [];
}

// ---------- top-level render ----------
function gate() {
  if (!S.authReady) return 'splash';
  if (!S.user) return 'signin';
  if (S.denied) return 'denied';
  if (!S.householdLoaded) return 'splash';
  if (!PIN.hasPin()) return 'pin-set';
  if (S.locked) return 'pin-unlock';
  if (!myRole()) return 'role';
  return 'app';
}

function render() {
  const g = gate();
  const root = $('#app');
  if (g !== 'app') {
    root.dataset.mode = g;
    root.innerHTML = renderGate(g);
    return;
  }
  if (root.dataset.mode !== 'app') {
    root.dataset.mode = 'app';
    root.innerHTML = '<div id="main"></div><nav id="nav" aria-label="Main"></nav><div id="sheet-root"></div>';
  }
  renderMain();
  renderNav();
  renderSheet();
}

function renderGate(g) {
  if (g === 'splash') return `<div class="splash"><div class="logo-xl">${POT_LOGO}</div><p class="brand-word">Kudukka</p></div>`;
  if (g === 'signin') return renderSignIn();
  if (g === 'denied') return renderDenied();
  if (g === 'role') return renderRole();
  if (g === 'pin-set' || g === 'pin-unlock') return renderPin(g);
  return '';
}

// ---------- gate screens ----------
function renderSignIn() {
  return `<section class="welcome">
    <div class="welcome-pot">${POT_LOGO}</div>
    <h1 class="brand-xl">Kudukka</h1>
    <p class="tagline">Neeyum Njanum, Oru Kudukka</p>
    <p class="tagline-ml" lang="ml">നീയും ഞാനും, ഒരു കുടുക്ക</p>
    <p class="tagline-en">You and me, one kudukka</p>
    <div class="grow"></div>
    <div class="pair">${avatar('sha', 48)}${avatar('sree', 48, true)}<span>Sha &amp; Sree's home</span></div>
    <button type="button" class="btn btn-primary btn-block" data-act="signin">Sign in with Google</button>
    <p class="err" id="signin-err">${esc(S.signinError || '')}</p>
  </section>`;
}

function renderDenied() {
  return `<section class="welcome">
    <div class="welcome-pot small">${POT_LOGO}</div>
    <h1 class="h1">This Kudukka is private</h1>
    <p class="muted center">${esc(S.user && S.user.email)} isn't one of the two accounts allowed into this household.</p>
    <div class="grow"></div>
    <button type="button" class="btn btn-primary btn-block" data-act="signout">Use a different Google account</button>
  </section>`;
}

function renderRole() {
  const members = (S.household && S.household.members) || {};
  const taken = Object.values(members).map((m) => m.role);
  const opt = (r) => {
    const p = D.PEOPLE[r];
    const isTaken = taken.includes(r);
    return `<button type="button" class="role-card" data-act="role" data-role="${r}" ${isTaken ? 'disabled' : ''}>
      ${avatar(r, 64)}<span class="role-name">I'm ${p.name}</span>${isTaken ? '<span class="muted small">Already set up</span>' : ''}
    </button>`;
  };
  return `<section class="welcome">
    <div class="welcome-pot small">${POT_LOGO}</div>
    <h1 class="h1">Who's this?</h1>
    <p class="muted center">Kudukka uses this to colour your accounts and entries. You only choose once.</p>
    <div class="role-row">${opt('sha')}${opt('sree')}</div>
  </section>`;
}

function renderPin(g) {
  const st = S.pin;
  if (g === 'pin-set' && st.stage !== 'set' && st.stage !== 'confirm') { st.stage = 'set'; st.buffer = ''; st.first = ''; }
  if (g === 'pin-unlock' && st.stage !== 'unlock') { st.stage = 'unlock'; st.buffer = ''; }
  const title = st.stage === 'set' ? 'Choose a 4-digit PIN' : st.stage === 'confirm' ? 'Type it once more' : 'Enter your PIN';
  const sub = st.stage === 'unlock' ? 'Kudukka is locked' : 'This locks Kudukka on this phone';
  const dots = [0, 1, 2, 3].map((i) => `<span class="dot ${i < st.buffer.length ? 'on' : ''}"></span>`).join('');
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((k) => {
    if (!k) return '<span></span>';
    if (k === 'del') return `<button type="button" class="key key-del" data-act="pin-del" aria-label="Delete">${icon('left', 26)}</button>`;
    return `<button type="button" class="key" data-act="pin-key" data-k="${k}">${k}</button>`;
  }).join('');
  return `<section class="pin">
    <div class="welcome-pot small">${POT_LOGO}</div>
    <h1 class="h1">${title}</h1>
    <p class="muted">${sub}</p>
    <div class="dots" aria-label="${st.buffer.length} of 4 digits entered">${dots}</div>
    <p class="err">${esc(st.error)}</p>
    <div class="keypad">${keys}</div>
    ${st.stage === 'unlock' ? '<button type="button" class="link" data-act="pin-forgot">Forgot PIN? Sign out and set a new one</button>' : ''}
  </section>`;
}

async function pinKey(k) {
  const st = S.pin;
  if (st.buffer.length >= 4) return;
  st.buffer += k;
  st.error = '';
  render();
  if (st.buffer.length < 4) return;
  const pin = st.buffer;
  if (st.stage === 'set') {
    st.first = pin; st.buffer = ''; st.stage = 'confirm';
  } else if (st.stage === 'confirm') {
    if (pin === st.first) {
      await PIN.setPin(pin);
      st.stage = null; st.buffer = ''; st.first = '';
      S.locked = false;
      toast('PIN saved');
    } else {
      st.stage = 'set'; st.buffer = ''; st.first = ''; st.error = "Those didn't match. Try again.";
    }
  } else if (await PIN.checkPin(pin)) {
    st.stage = null; st.buffer = ''; S.locked = false;
  } else {
    st.buffer = ''; st.error = 'Wrong PIN';
  }
  render();
}

// ---------- shared bits ----------
function avatar(role, size = 34, overlap = false) {
  const p = D.PEOPLE[role];
  const fs = Math.round(size * (role === 'sree' ? 0.29 : 0.32));
  return `<span class="avatar${overlap ? ' overlap' : ''}" style="width:${size}px;height:${size}px;background:${p.color};color:${p.ink};font-size:${fs}px">${p.name}</span>`;
}
const ownerDot = (owner) => `<span class="odot" style="background:${(D.PEOPLE[owner] || D.PEOPLE.joint).color}"></span>`;

function monthPill() {
  return `<div class="month-row">
    <button type="button" class="pill" data-act="open-month" aria-label="Change working month, currently ${D.monthLabel(S.month)}">
      ${icon('calendar', 18)}<span>${D.monthLabel(S.month)}</span>${icon('down', 16)}
    </button>
    <span class="hint">Working month · new entries are dated here</span>
  </div>`;
}

function personSwitch() {
  const b = (id, label) => `<button type="button" class="seg seg-${id}${S.person === id ? ' on' : ''}" aria-pressed="${S.person === id}" data-act="person" data-p="${id}">${label}</button>`;
  return `<div class="segs" role="group" aria-label="Whose money to show">${b('home', 'Home')}${b('sree', 'Sree')}${b('sha', 'Sha')}</div>`;
}

function header() {
  return `<header class="top">
    <div class="brand"><span class="logo-sm">${POT_LOGO}</span><span class="brand-word">Kudukka</span></div>
    <div class="pair-sm">${avatar('sha', 34)}${avatar('sree', 34, true)}</div>
  </header>`;
}

// ---------- main views ----------
function renderMain() {
  const main = $('#main');
  if (!main) return;
  const v = S.view;
  main.innerHTML = header() + (v === 'home' ? viewHome() : v === 'entries' ? viewEntries() : v === 'accounts' ? viewAccounts() : viewMore());
}

function splitBar(by, total) {
  if (!total) return '<div class="bar"></div>';
  const seg = (k) => (by[k] ? `<div style="width:${(by[k] / total) * 100}%;background:${D.PEOPLE[k].color}"></div>` : '');
  return `<div class="bar">${seg('sree')}${seg('sha')}${seg('joint')}</div>`;
}

function viewHome() {
  const accs = activeAccounts();
  if (!accs.length) {
    return `${monthPill()}<section class="card welcome-card">
      <div class="pot-md">${POT_LOGO}</div>
      <h2 class="h2">Let's fill your kudukka</h2>
      <p class="muted">Start by adding your bank accounts and credit cards. Each one belongs to Sree, Sha or both of you.</p>
      <button type="button" class="btn btn-primary btn-block" data-act="add-account">Add first account</button>
    </section>`;
  }
  const s = D.monthStats(S.txns, S.accounts, S.month, S.person);
  const label = S.person === 'home' ? 'Left this month, together' : `Left this month, ${D.PEOPLE[S.person].name}`;
  const accent = S.person === 'sree' ? 'var(--sree)' : S.person === 'sha' ? 'var(--ink)' : 'var(--rust)';
  const groups = D.SPEND_GROUPS.filter((g) => s.byGroup[g.id]).sort((a, b) => s.byGroup[b.id] - s.byGroup[a.id]);
  const max = groups.length ? s.byGroup[groups[0].id] : 0;
  const recent = D.entriesFor(S.txns, S.accounts, S.month, S.person).slice(0, 5);
  const moved = S.person !== 'home' && (s.movedIn || s.movedOut)
    ? `<p class="moved">${s.movedOut ? `Moved to ${S.person === 'sree' ? 'Sha' : 'Sree'}: <b>${D.money(s.movedOut)}</b>` : ''}${s.movedIn && s.movedOut ? ' · ' : ''}${s.movedIn ? `Received from ${S.person === 'sree' ? 'Sha' : 'Sree'}: <b>${D.money(s.movedIn)}</b>` : ''}</p>`
    : '';
  return `${monthPill()}${personSwitch()}
    <section class="card hero">
      <span class="muted small">${label}</span>
      <span class="big" style="color:${accent}">${D.money(s.left)}</span>
      <div class="row-between"><span>Came in</span><b>${D.money(s.income)}</b></div>
      ${splitBar(s.incomeBy, s.income)}
      <div class="row-between"><span>Went out</span><b>${D.money(s.spend)}</b></div>
      ${splitBar(s.spendBy, s.spend)}
      <div class="legend">${S.person === 'home' ? `<span>${ownerDot('sree')}Sree</span><span>${ownerDot('sha')}Sha</span><span>${ownerDot('joint')}Joint</span>` : `<span>${ownerDot(S.person)}${D.PEOPLE[S.person].name}'s accounts</span>`}</div>
      ${moved}
    </section>
    <section class="card">
      <h2 class="h3">Where it went</h2>
      ${groups.length ? groups.map((g) => `<div class="grp">
        <span class="gicon" style="background:${g.color}">${icon(g.icon, 18)}</span>
        <div class="grp-main"><div class="row-between"><span>${g.name}</span><b>${D.money(s.byGroup[g.id])}</b></div>
        <div class="bar thin"><div style="width:${(s.byGroup[g.id] / max) * 100}%;background:${g.color}"></div></div></div>
      </div>`).join('') : `<p class="muted">No spending entered for ${D.monthLabel(S.month)} yet.</p>`}
    </section>
    <section class="card">
      <div class="row-between"><h2 class="h3">Latest entries</h2>${recent.length ? '<button type="button" class="link" data-act="nav" data-v="entries">See all</button>' : ''}</div>
      ${recent.length ? `<ul class="entries">${recent.map(entryRow).join('')}</ul>` : `<p class="muted">Tap + to add your first entry for ${D.monthLabel(S.month)}.</p>`}
    </section>`;
}

function entryVisual(t) {
  if (t.type === 'spend') {
    const g = D.groupOf(t.categoryId) || D.SPEND_GROUPS.at(-1);
    return { color: g.color, ic: g.icon };
  }
  if (t.type === 'income') return { color: 'var(--olive)', ic: 'income' };
  if (t.type === 'transfer') return { color: 'var(--quiet)', ic: 'transfer' };
  return { color: 'var(--quiet)', ic: 'adjust' };
}

function entryRow(t) {
  const v = entryVisual(t);
  const acc = accountById(t.accountId);
  const to = accountById(t.toAccountId);
  const cat = D.categoryById(t.categoryId);
  let title = t.note || (cat ? cat.name : D.ENTRY_TYPES[t.type]);
  let sub = '';
  if (t.type === 'transfer') {
    title = t.note || (to && to.type === 'credit' ? `Paid ${to.name}` : 'Transfer');
    sub = `${acc ? esc(acc.name) : '?'} → ${to ? esc(to.name) : '?'}`;
  } else {
    sub = `${t.note && cat ? `${esc(cat.name)} · ` : ''}${acc ? esc(acc.name) : 'Deleted account'}`;
  }
  const amt = t.type === 'spend' ? `−${D.money(t.amount)}` : t.type === 'income' ? `+${D.money(t.amount)}` : t.type === 'adjust' ? `${t.amount >= 0 ? '+' : '−'}${D.money(Math.abs(t.amount))}` : D.money(t.amount);
  const cls = t.type === 'income' ? 'pos' : t.type === 'transfer' || t.type === 'adjust' ? 'quiet' : '';
  return `<li><button type="button" class="entry" data-act="edit-entry" data-id="${t.id}">
    <span class="gicon" style="background:${v.color}">${icon(v.ic, 18)}</span>
    <span class="entry-main"><span class="entry-title">${esc(title)}</span><span class="entry-sub">${acc ? ownerDot(acc.owner) : ''}${sub}${t.calc ? ` · <span class="calc-note">${esc(t.calc)}</span>` : ''}</span></span>
    <span class="entry-amt ${cls}">${amt}</span>
  </button></li>`;
}

function viewEntries() {
  const list = D.entriesFor(S.txns, S.accounts, S.month, S.person);
  const byDay = [];
  for (const t of list) {
    const last = byDay.at(-1);
    if (last && last.date === t.date) last.items.push(t);
    else byDay.push({ date: t.date, items: [t] });
  }
  const body = list.length
    ? byDay.map((d) => `<h3 class="day">${D.dayLabel(d.date)}</h3><ul class="entries card tight">${d.items.map(entryRow).join('')}</ul>`).join('')
    : `<section class="card"><p class="muted">No entries for ${D.monthLabel(S.month)} yet.</p>${activeAccounts().length ? `<button type="button" class="btn btn-primary btn-block" data-act="add-entry">Add an entry</button>` : '<button type="button" class="btn btn-primary btn-block" data-act="add-account">Add an account first</button>'}</section>`;
  const s = D.monthStats(S.txns, S.accounts, S.month, S.person);
  return `${monthPill()}${personSwitch()}
    ${list.length ? `<div class="summary-line"><span>${list.length} ${list.length === 1 ? 'entry' : 'entries'}</span><span>In <b>${D.money(s.income)}</b> · Out <b>${D.money(s.spend)}</b></span></div>` : ''}
    ${body}`;
}

function viewAccounts() {
  const show = (a) => (S.person === 'home' || a.owner === S.person) && (S.showArchived || !a.archived);
  const accs = S.accounts.filter(show);
  const banks = accs.filter((a) => a.type !== 'credit');
  const cards = accs.filter((a) => a.type === 'credit');
  const archivedCount = S.accounts.filter((a) => a.archived && (S.person === 'home' || a.owner === S.person)).length;
  const bankTotal = banks.filter((a) => !a.archived).reduce((n, a) => n + D.balanceOf(a, S.txns), 0);
  const owedTotal = cards.filter((a) => !a.archived).reduce((n, a) => n + Math.max(0, -D.balanceOf(a, S.txns)), 0);

  const bankRow = (a) => {
    const b = D.balanceOf(a, S.txns);
    return `<li><button type="button" class="entry" data-act="edit-account" data-id="${a.id}">
      <span class="gicon" style="background:${D.PEOPLE[a.owner].color};color:${D.PEOPLE[a.owner].ink}">${icon('bank', 18)}</span>
      <span class="entry-main"><span class="entry-title">${esc(a.name)}${a.archived ? ' <span class="tag">Archived</span>' : ''}</span>
      <span class="entry-sub">${D.PEOPLE[a.owner].name} · ${esc(a.bank || D.ACCOUNT_TYPES[a.type])}</span></span>
      <span class="entry-amt ${b < 0 ? 'neg' : ''}">${D.money(b)}</span></button></li>`;
  };
  const cardRow = (a) => {
    const owed = Math.max(0, -D.balanceOf(a, S.txns));
    const credit = Math.max(0, D.balanceOf(a, S.txns));
    const pct = a.creditLimit ? Math.min(100, (owed / a.creditLimit) * 100) : 0;
    return `<li><button type="button" class="entry col" data-act="edit-account" data-id="${a.id}">
      <span class="entry-top">
        <span class="gicon" style="background:${D.PEOPLE[a.owner].color};color:${D.PEOPLE[a.owner].ink}">${icon('card', 18)}</span>
        <span class="entry-main"><span class="entry-title">${esc(a.name)}${a.last4 ? ` ·· ${esc(a.last4)}` : ''}${a.archived ? ' <span class="tag">Archived</span>' : ''}</span>
        <span class="entry-sub">${D.PEOPLE[a.owner].name}${a.dueDay ? ` · Due on the ${ordinal(a.dueDay)}` : ''}</span></span>
        <span class="entry-amt"><span class="small muted block">${credit ? 'In credit' : 'Owed'}</span>${D.money(credit || owed)}</span>
      </span>
      ${a.creditLimit ? `<span class="bar thin full"><span style="width:${pct}%;background:${pct > 80 ? 'var(--warn)' : 'var(--rust)'}"></span></span><span class="entry-sub">${D.money(owed)} of ${D.money(a.creditLimit)} limit</span>` : ''}
    </button></li>`;
  };
  return `${personSwitch()}
    <section class="totals">
      <div class="card stat"><span class="muted small">In accounts</span><span class="big-sm">${D.money(bankTotal)}</span></div>
      <div class="card stat"><span class="muted small">Owed on cards</span><span class="big-sm">${D.money(owedTotal)}</span></div>
    </section>
    <div class="row-between"><h2 class="h3">Bank and savings</h2></div>
    ${banks.length ? `<ul class="entries card tight">${banks.map(bankRow).join('')}</ul>` : '<p class="muted pad">No bank accounts yet.</p>'}
    <div class="row-between"><h2 class="h3">Credit cards</h2></div>
    ${cards.length ? `<ul class="entries card tight">${cards.map(cardRow).join('')}</ul>` : '<p class="muted pad">No credit cards yet.</p>'}
    <button type="button" class="btn btn-ghost btn-block" data-act="add-account">${icon('plus', 18)} Add account or card</button>
    ${archivedCount ? `<button type="button" class="link center-block" data-act="toggle-archived">${S.showArchived ? 'Hide' : 'Show'} archived (${archivedCount})</button>` : ''}`;
}

const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

function viewMore() {
  const role = myRole();
  return `<section class="card">
      <div class="me">${avatar(role, 52)}<div><b>${D.PEOPLE[role].name}</b><span class="muted small block">${esc(S.user.email)}</span></div></div>
    </section>
    <ul class="entries card tight">
      <li><button type="button" class="entry" data-act="change-pin"><span class="gicon plain">${icon('key', 18)}</span><span class="entry-main"><span class="entry-title">Change PIN</span></span>${icon('right', 18)}</button></li>
      <li><button type="button" class="entry" data-act="lock"><span class="gicon plain">${icon('lock', 18)}</span><span class="entry-main"><span class="entry-title">Lock now</span></span>${icon('right', 18)}</button></li>
      <li><button type="button" class="entry" data-act="signout"><span class="gicon plain">${icon('logout', 18)}</span><span class="entry-main"><span class="entry-title">Sign out</span></span>${icon('right', 18)}</button></li>
    </ul>
    <section class="card">
      <h2 class="h3">Coming next</h2>
      <p class="muted">Phase 2 brings editable categories, trips, the spending donut and nicer charts. Then bills and the direct debit guard, then pots and reports.</p>
    </section>
    <p class="footer-note"><span class="tagline-sm">Neeyum Njanum, Oru Kudukka</span><br>Phase 1</p>`;
}

function renderNav() {
  const nav = $('#nav');
  if (!nav) return;
  const b = (v, ic, label) => `<button type="button" class="nav-btn${S.view === v ? ' on' : ''}" data-act="nav" data-v="${v}" ${S.view === v ? 'aria-current="page"' : ''}>${icon(ic, 24)}<span>${label}</span></button>`;
  nav.innerHTML = `${b('home', 'home', 'Home')}${b('entries', 'list', 'Entries')}
    <div class="nav-add-wrap"><button type="button" class="nav-add" data-act="add-entry" aria-label="Add an entry">${icon('plus', 28)}</button></div>
    ${b('accounts', 'wallet', 'Accounts')}${b('more', 'more', 'More')}`;
}

// ---------- sheets ----------
function openSheet(kind, form = {}) {
  S.sheet = kind;
  S.form = form;
  S.errors = {};
  renderSheet();
  document.body.classList.add('sheet-open');
  setTimeout(() => { const f = document.querySelector('#sheet-root [data-autofocus]'); if (f) f.focus(); }, 60);
}
function closeSheet() {
  S.sheet = null;
  S.form = {};
  S.errors = {};
  renderSheet();
  document.body.classList.remove('sheet-open');
}

function renderSheet() {
  const root = $('#sheet-root');
  if (!root) return;
  if (!S.sheet) { root.innerHTML = ''; return; }
  const body = S.sheet === 'entry' ? sheetEntry() : S.sheet === 'account' ? sheetAccount() : sheetMonth();
  const existing = root.querySelector('.sheet');
  if (existing && existing.dataset.kind === S.sheet) {
    // Same sheet: swap the contents only, so it doesn't re-animate or jump.
    const top = existing.scrollTop;
    existing.innerHTML = `<div class="grabber"></div>${body}`;
    existing.scrollTop = top;
    return;
  }
  root.innerHTML = `<div class="backdrop" data-act="sheet-close"></div>
    <div class="sheet" data-kind="${S.sheet}" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div class="grabber"></div>${body}</div>`;
}

const err = (k) => (S.errors[k] ? `<p class="err">${esc(S.errors[k])}</p>` : '');

// ----- month picker -----
function sheetMonth() {
  const cur = D.currentMonth();
  const months = [];
  for (let i = 0; i < 12; i++) months.push(D.shiftMonth(cur, -i));
  if (!months.includes(S.month)) months.push(S.month);
  return `<div class="sheet-head"><h2 class="h2" id="sheet-title">Working month</h2><button type="button" class="icon-btn" data-act="sheet-close" aria-label="Close">${icon('x', 22)}</button></div>
    <p class="muted">New entries are dated in this month, so you can catch up on last month without fixing dates.</p>
    <div class="month-grid">${months.map((m) => `<button type="button" class="chip${m === S.month ? ' on' : ''}" data-act="month-pick" data-m="${m}">${D.monthShort(m)}${m === cur ? ' · now' : ''}</button>`).join('')}</div>`;
}

// ----- entry -----
function newEntryForm(type = 'spend') {
  const accs = activeAccounts();
  const lastAcc = LS.get('lastAccount');
  const accountId = accs.some((a) => a.id === lastAcc) ? lastAcc : (accs[0] && accs[0].id) || '';
  const f = {
    isNew: true, id: fb.newId('transactions'), type, amountText: '', accountId, toAccountId: '',
    groupId: '', categoryId: '', date: D.defaultEntryDate(S.month, LS.get('lastDate')), note: '', adjSign: '+',
  };
  if (type === 'income') f.categoryId = incomeDefault(accountId);
  return f;
}
function incomeDefault(accountId) {
  const a = accountById(accountId);
  return a && a.owner === 'sree' ? 'income.sree' : a && a.owner === 'sha' ? 'income.sha' : 'income.other';
}
function editEntryForm(t) {
  const g = D.groupOf(t.categoryId);
  return {
    isNew: false, id: t.id, type: t.type,
    amountText: t.calc || (Math.abs(t.amount) / 100).toFixed(2).replace(/\.00$/, ''),
    accountId: t.accountId || '', toAccountId: t.toAccountId || '',
    groupId: g ? g.id : '', categoryId: t.categoryId || '', date: t.date, note: t.note || '',
    adjSign: t.amount < 0 ? '-' : '+', original: t,
  };
}

function accountChips(field, exclude) {
  const f = S.form;
  const accs = activeAccounts().filter((a) => a.id !== exclude);
  if (!accs.length) return '<p class="muted">Add an account first.</p>';
  return `<div class="chips">${accs.map((a) => `<button type="button" class="chip acc${f[field] === a.id ? ' on' : ''}" data-act="pick-account" data-field="${field}" data-id="${a.id}">${ownerDot(a.owner)}${esc(a.name)}</button>`).join('')}</div>`;
}

function sheetEntry() {
  const f = S.form;
  const types = Object.entries(D.ENTRY_TYPES).map(([k, v]) => `<button type="button" class="seg${f.type === k ? ' on' : ''}" aria-pressed="${f.type === k}" data-act="entry-type" data-t="${k}">${v}</button>`).join('');
  const pence = evaluateToPence(f.amountText);
  const calcShown = isSum(f.amountText) && pence !== null ? `= ${D.money(pence)}` : '';
  const ops = ['+', '−', '×', '÷'].map((o) => `<button type="button" class="op" data-act="op" data-o="${o}" aria-label="${o === '−' ? 'minus' : o === '×' ? 'times' : o === '÷' ? 'divide' : 'plus'}">${o}</button>`).join('');
  let catBlock = '';
  if (f.type === 'spend') {
    const g = D.SPEND_GROUPS.find((x) => x.id === f.groupId);
    catBlock = `<div class="field"><span class="label">Category</span>
      <div class="chips">${D.SPEND_GROUPS.map((x) => `<button type="button" class="chip grp-chip${f.groupId === x.id ? ' on' : ''}" style="--c:${x.color}" data-act="pick-group" data-id="${x.id}">${icon(x.icon, 16)}${x.name}</button>`).join('')}</div>
      ${g ? `<div class="chips sub">${g.subs.map(([sid, sname]) => { const id = `${g.id}.${sid}`; return `<button type="button" class="chip${f.categoryId === id ? ' on' : ''}" data-act="pick-cat" data-id="${id}">${sname}</button>`; }).join('')}</div>` : ''}
      ${err('categoryId')}</div>`;
  } else if (f.type === 'income') {
    catBlock = `<div class="field"><span class="label">Income from</span>
      <div class="chips">${D.INCOME_SOURCES.map((x) => `<button type="button" class="chip${f.categoryId === x.id ? ' on' : ''}" data-act="pick-cat" data-id="${x.id}">${x.name}</button>`).join('')}</div>${err('categoryId')}</div>`;
  }
  const fromLabel = f.type === 'transfer' ? 'From' : f.type === 'income' ? 'Paid into' : f.type === 'adjust' ? 'Account to correct' : 'Paid with';
  const outside = f.date && D.monthOf(f.date) !== S.month ? `<p class="note-warn">This saves into ${D.monthLabel(D.monthOf(f.date))}, not your working month.</p>` : '';
  return `<div class="sheet-head"><h2 class="h2" id="sheet-title">${f.isNew ? 'New entry' : 'Edit entry'}</h2><button type="button" class="icon-btn" data-act="sheet-close" aria-label="Close">${icon('x', 22)}</button></div>
    <div class="segs four" role="group" aria-label="Type of entry">${types}</div>
    ${f.type === 'adjust' ? `<div class="segs two" role="group" aria-label="Direction"><button type="button" class="seg${f.adjSign === '+' ? ' on' : ''}" data-act="adj-sign" data-s="+">Add to balance</button><button type="button" class="seg${f.adjSign === '-' ? ' on' : ''}" data-act="adj-sign" data-s="-">Take from balance</button></div>` : ''}
    <div class="field">
      <label class="label" for="f-amount">Amount</label>
      <div class="amount-wrap"><span class="pound">£</span><input id="f-amount" name="amountText" class="amount" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(f.amountText)}" ${f.isNew ? 'data-autofocus' : ''}></div>
      <div class="ops-row"><div class="ops">${ops}</div><span class="calc-result" id="calc-result">${calcShown}</span></div>
      ${err('amount')}
    </div>
    <div class="field"><span class="label">${fromLabel}</span>${accountChips('accountId')}${err('accountId')}</div>
    ${f.type === 'transfer' ? `<div class="field"><span class="label">To</span>${accountChips('toAccountId', f.accountId)}${err('toAccountId')}</div>` : ''}
    ${catBlock}
    <div class="field two-col">
      <div><label class="label" for="f-date">Date</label><input id="f-date" name="date" type="date" class="input" value="${esc(f.date)}"></div>
      <div><label class="label" for="f-note">Note</label><input id="f-note" name="note" class="input" maxlength="80" placeholder="Optional" value="${esc(f.note)}"></div>
    </div>
    ${outside}${err('date')}
    <div class="sheet-actions">
      ${f.isNew ? '' : `<button type="button" class="btn btn-danger" data-act="delete-entry">${icon('trash', 18)} Delete</button>`}
      <button type="button" class="btn btn-primary grow" data-act="save-entry">${f.isNew ? 'Save entry' : 'Save changes'}</button>
    </div>`;
}

function validateEntry() {
  const f = S.form;
  const e = {};
  const pence = evaluateToPence(f.amountText);
  if (pence === null) e.amount = f.amountText ? "That sum doesn't work out. Check the numbers." : 'Enter an amount.';
  else if (pence <= 0) e.amount = 'The amount needs to be more than £0.';
  if (!f.accountId) e.accountId = 'Choose an account.';
  if (f.type === 'transfer' && !f.toAccountId) e.toAccountId = 'Choose where the money went.';
  if (f.type === 'transfer' && f.toAccountId && f.toAccountId === f.accountId) e.toAccountId = 'Choose a different account.';
  if ((f.type === 'spend' || f.type === 'income') && !f.categoryId) e.categoryId = f.type === 'spend' ? 'Choose a category.' : 'Choose where it came from.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date || '')) e.date = 'Choose a date.';
  return { e, pence };
}

function saveEntry() {
  const f = S.form;
  const { e, pence } = validateEntry();
  S.errors = e;
  if (Object.keys(e).length) { renderSheet(); return; }
  const data = {
    type: f.type,
    amount: f.type === 'adjust' && f.adjSign === '-' ? -pence : pence,
    date: f.date,
    month: D.monthOf(f.date),
    accountId: f.accountId,
    toAccountId: f.type === 'transfer' ? f.toAccountId : null,
    categoryId: f.type === 'spend' || f.type === 'income' ? f.categoryId : null,
    note: (f.note || '').trim(),
    calc: isSum(f.amountText) ? f.amountText.trim() : null,
    updatedBy: myRole(),
  };
  if (f.isNew) data.createdBy = myRole();
  LS.set('lastDate', f.date);
  LS.set('lastAccount', f.accountId);
  const isNew = f.isNew;
  const id = f.id;
  closeSheet();
  fb.saveDoc('transactions', id, data, isNew).catch((x) => { console.error(x); toast("Couldn't save that entry. Check your connection."); });
  toast(isNew ? `Saved · ${D.money(pence)}` : 'Changes saved');
}

function deleteEntry() {
  const t = S.form.original;
  const { createdMs, id, ...rest } = t;
  closeSheet();
  fb.removeDoc('transactions', id).catch(() => toast("Couldn't delete. Check your connection."));
  toast('Entry deleted', () => fb.restoreDoc('transactions', id, rest));
}

// ----- account -----
function newAccountForm() {
  const role = myRole();
  return {
    isNew: true, id: fb.newId('accounts'), name: '', bank: '', owner: S.person !== 'home' ? S.person : role || 'sha',
    type: 'current', openingText: '', openingDate: D.monthStart(S.month), limitText: '', last4: '', dueDay: '', checkText: '',
  };
}
function editAccountForm(a) {
  const ob = a.type === 'credit' ? -(a.openingBalance || 0) : (a.openingBalance || 0);
  return {
    isNew: false, id: a.id, name: a.name || '', bank: a.bank || '', owner: a.owner, type: a.type,
    openingText: (ob / 100).toFixed(2).replace(/\.00$/, ''), openingDate: a.openingDate || D.monthStart(S.month),
    limitText: a.creditLimit ? String(a.creditLimit / 100) : '', last4: a.last4 || '', dueDay: a.dueDay ? String(a.dueDay) : '',
    checkText: '', archived: !!a.archived,
  };
}

function checkLine() {
  const f = S.form;
  const a = accountById(f.id);
  if (!a || !f.checkText) return '';
  const real = evaluateToPence(f.checkText);
  if (real === null) return '<span class="err">Enter the amount shown in your bank app.</span>';
  const now = D.balanceOf(a, S.txns);
  const realBal = a.type === 'credit' ? -real : real;
  const diff = realBal - now;
  if (diff === 0) return `<span class="ok">${icon('check', 16)} Matches. Kudukka agrees with your bank.</span>`;
  return `<span>Kudukka shows ${D.money(a.type === 'credit' ? -now : now)}. Difference ${D.money(Math.abs(diff))}.</span>
    <button type="button" class="btn btn-ghost btn-sm" data-act="add-adjust" data-diff="${diff}">Add a ${D.money(Math.abs(diff))} adjustment</button>`;
}

function sheetAccount() {
  const f = S.form;
  const owners = ['sree', 'sha', 'joint'].map((o) => `<button type="button" class="seg seg-${o}${f.owner === o ? ' on' : ''}" aria-pressed="${f.owner === o}" data-act="acc-owner" data-o="${o}">${D.PEOPLE[o].name}</button>`).join('');
  const types = Object.entries(D.ACCOUNT_TYPES).map(([k, v]) => `<button type="button" class="chip${f.type === k ? ' on' : ''}" data-act="acc-type" data-t="${k}">${v}</button>`).join('');
  const isCard = f.type === 'credit';
  const used = !f.isNew && S.txns.some((t) => t.accountId === f.id || t.toAccountId === f.id);
  return `<div class="sheet-head"><h2 class="h2" id="sheet-title">${f.isNew ? 'New account' : 'Edit account'}</h2><button type="button" class="icon-btn" data-act="sheet-close" aria-label="Close">${icon('x', 22)}</button></div>
    <div class="field"><span class="label">Whose is it?</span><div class="segs" role="group" aria-label="Owner">${owners}</div></div>
    <div class="field"><span class="label">Type</span><div class="chips">${types}</div></div>
    <div class="field"><label class="label" for="a-name">Nickname</label><input id="a-name" name="name" class="input" maxlength="40" placeholder="${isCard ? 'e.g. Amex' : 'e.g. Monzo current'}" value="${esc(f.name)}" ${f.isNew ? 'data-autofocus' : ''}>${err('name')}</div>
    <div class="field"><label class="label" for="a-bank">Bank</label><input id="a-bank" name="bank" class="input" maxlength="40" placeholder="Optional" value="${esc(f.bank)}"></div>
    <div class="field two-col">
      <div><label class="label" for="a-open">${isCard ? 'Amount owed' : 'Balance'}</label><div class="amount-wrap small"><span class="pound">£</span><input id="a-open" name="openingText" class="input bare" inputmode="decimal" placeholder="0.00" value="${esc(f.openingText)}"></div></div>
      <div><label class="label" for="a-odate">On this date</label><input id="a-odate" name="openingDate" type="date" class="input" value="${esc(f.openingDate)}"></div>
    </div>
    <p class="hint block">${isCard ? 'What you owed on this date, before any entries you add from then on.' : 'The balance on this date, before any entries you add from then on.'}</p>
    ${err('openingText')}
    ${isCard ? `<div class="field three-col">
      <div><label class="label" for="a-limit">Credit limit</label><input id="a-limit" name="limitText" class="input" inputmode="decimal" placeholder="Optional" value="${esc(f.limitText)}"></div>
      <div><label class="label" for="a-last4">Last 4 digits</label><input id="a-last4" name="last4" class="input" inputmode="numeric" maxlength="4" placeholder="Optional" value="${esc(f.last4)}"></div>
      <div><label class="label" for="a-due">Due day</label><input id="a-due" name="dueDay" class="input" inputmode="numeric" maxlength="2" placeholder="1–31" value="${esc(f.dueDay)}"></div>
    </div>${err('last4')}${err('dueDay')}` : ''}
    ${f.isNew ? '' : `<div class="field check">
      <label class="label" for="a-check">Check against your bank</label>
      <div class="amount-wrap small"><span class="pound">£</span><input id="a-check" name="checkText" class="input bare" inputmode="decimal" placeholder="${isCard ? 'Owed now, from your bank app' : 'Balance now, from your bank app'}" value="${esc(f.checkText)}"></div>
      <div class="check-line" id="check-line">${checkLine()}</div>
    </div>`}
    <div class="sheet-actions">
      ${f.isNew ? '' : used
        ? `<button type="button" class="btn btn-ghost" data-act="archive-account">${f.archived ? 'Unarchive' : 'Archive'}</button>`
        : `<button type="button" class="btn btn-danger" data-act="delete-account">${icon('trash', 18)} Delete</button>`}
      <button type="button" class="btn btn-primary grow" data-act="save-account">${f.isNew ? 'Add account' : 'Save changes'}</button>
    </div>`;
}

function saveAccount() {
  const f = S.form;
  const e = {};
  if (!f.name.trim()) e.name = 'Give it a nickname.';
  const opening = f.openingText ? evaluateToPence(f.openingText) : 0;
  if (opening === null) e.openingText = "That amount doesn't look right.";
  const limit = f.limitText ? evaluateToPence(f.limitText) : null;
  if (f.last4 && !/^\d{4}$/.test(f.last4)) e.last4 = 'Last 4 digits should be 4 numbers.';
  const due = f.dueDay ? Number(f.dueDay) : null;
  if (f.dueDay && !(due >= 1 && due <= 31)) e.dueDay = 'Due day should be 1 to 31.';
  S.errors = e;
  if (Object.keys(e).length) { renderSheet(); return; }
  const isCard = f.type === 'credit';
  const data = {
    name: f.name.trim(), bank: f.bank.trim(), owner: f.owner, type: f.type,
    openingBalance: isCard ? -opening : opening,
    openingDate: f.openingDate || D.monthStart(S.month),
    creditLimit: isCard && limit ? limit : null,
    last4: isCard ? f.last4 || '' : '',
    dueDay: isCard && due ? due : null,
  };
  if (f.isNew) { data.archived = false; data.order = Date.now(); }
  const { isNew, id } = f;
  closeSheet();
  fb.saveDoc('accounts', id, data, isNew).catch((x) => { console.error(x); toast("Couldn't save the account. Check your connection."); });
  toast(isNew ? `${data.name} added` : 'Account saved');
}

function addAdjustment(diff) {
  const f = S.form;
  const a = accountById(f.id);
  if (!a || !diff) return;
  const date = D.todayISO();
  const data = {
    type: 'adjust', amount: diff, date, month: D.monthOf(date), accountId: a.id, toAccountId: null,
    categoryId: null, note: 'Balance check', calc: null, createdBy: myRole(), updatedBy: myRole(),
  };
  fb.saveDoc('transactions', fb.newId('transactions'), data, true).catch(() => toast("Couldn't save the adjustment."));
  S.form.checkText = '';
  renderSheet();
  toast(`Adjusted ${a.name} by ${D.money(Math.abs(diff))}`);
}

// ---------- events ----------
document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  const f = S.form;
  switch (act) {
    case 'signin':
      S.signinError = '';
      fb.signIn().catch((e) => {
        if (e.code === 'auth/popup-closed-by-user') return;
        S.signinError = "Sign-in didn't finish. Please try again.";
        render();
      });
      break;
    case 'signout':
      closeSheet();
      await fb.logOut();
      break;
    case 'pin-key': pinKey(el.dataset.k); break;
    case 'pin-del': S.pin.buffer = S.pin.buffer.slice(0, -1); render(); break;
    case 'pin-forgot':
      PIN.clearPin(); S.locked = false; S.pin = { stage: null, buffer: '', first: '', error: '' };
      await fb.logOut();
      break;
    case 'change-pin':
      PIN.clearPin(); S.pin = { stage: null, buffer: '', first: '', error: '' }; render();
      break;
    case 'lock': S.locked = true; render(); break;
    case 'role':
      el.disabled = true;
      fb.claimRole(S.user, el.dataset.role).catch((e) => { console.error(e); toast("Couldn't save that. Try again."); el.disabled = false; });
      break;
    case 'nav': S.view = el.dataset.v; window.scrollTo(0, 0); renderMain(); renderNav(); break;
    case 'person': S.person = el.dataset.p; renderMain(); break;
    case 'toggle-archived': S.showArchived = !S.showArchived; renderMain(); break;
    case 'open-month': openSheet('month'); break;
    case 'month-pick': setMonth(el.dataset.m); closeSheet(); renderMain(); toast(`Working month: ${D.monthLabel(S.month)}`); break;
    case 'sheet-close': closeSheet(); break;
    case 'add-entry':
      if (!activeAccounts().length) { openSheet('account', newAccountForm()); toast('Add an account first'); break; }
      openSheet('entry', newEntryForm());
      break;
    case 'edit-entry': { const t = S.txns.find((x) => x.id === el.dataset.id); if (t) openSheet('entry', editEntryForm(t)); break; }
    case 'entry-type':
      f.type = el.dataset.t;
      if (f.type === 'income') { f.groupId = ''; f.categoryId = incomeDefault(f.accountId); }
      else if (f.type === 'spend') { if (!D.groupOf(f.categoryId)) f.categoryId = ''; }
      else { f.categoryId = ''; f.groupId = ''; }
      if (f.type === 'transfer' && f.toAccountId === f.accountId) f.toAccountId = '';
      S.errors = {};
      renderSheet();
      break;
    case 'adj-sign': f.adjSign = el.dataset.s; renderSheet(); break;
    case 'pick-account':
      f[el.dataset.field] = el.dataset.id;
      if (el.dataset.field === 'accountId') {
        if (f.toAccountId === f.accountId) f.toAccountId = '';
        if (f.type === 'income' && (!f.categoryId || f.categoryId.startsWith('income.'))) f.categoryId = incomeDefault(f.accountId);
      }
      delete S.errors[el.dataset.field];
      renderSheet();
      break;
    case 'pick-group':
      f.groupId = el.dataset.id;
      if (!f.categoryId || !f.categoryId.startsWith(`${f.groupId}.`)) {
        const g = D.SPEND_GROUPS.find((x) => x.id === f.groupId);
        f.categoryId = g.subs.length === 1 ? `${g.id}.${g.subs[0][0]}` : '';
      }
      renderSheet();
      break;
    case 'pick-cat': f.categoryId = el.dataset.id; delete S.errors.categoryId; renderSheet(); break;
    case 'op': {
      const input = $('#f-amount');
      const o = { '−': '-', '×': '×', '÷': '÷', '+': '+' }[el.dataset.o];
      const pos = input.selectionStart ?? input.value.length;
      input.value = `${input.value.slice(0, pos)} ${o} ${input.value.slice(input.selectionEnd ?? pos)}`.replace(/\s+/g, ' ').trimStart();
      f.amountText = input.value;
      input.focus();
      updateCalc();
      break;
    }
    case 'save-entry': saveEntry(); break;
    case 'delete-entry': deleteEntry(); break;
    case 'add-account': openSheet('account', newAccountForm()); break;
    case 'edit-account': { const a = accountById(el.dataset.id); if (a) openSheet('account', editAccountForm(a)); break; }
    case 'acc-owner': f.owner = el.dataset.o; renderSheet(); break;
    case 'acc-type': f.type = el.dataset.t; renderSheet(); break;
    case 'save-account': saveAccount(); break;
    case 'add-adjust': addAdjustment(Number(el.dataset.diff)); break;
    case 'archive-account': {
      const id = f.id; const archived = !f.archived;
      closeSheet();
      fb.saveDoc('accounts', id, { archived }, false);
      toast(archived ? 'Account archived' : 'Account restored');
      break;
    }
    case 'delete-account': {
      const a = accountById(f.id);
      const { id, ...rest } = a;
      closeSheet();
      fb.removeDoc('accounts', id);
      toast('Account deleted', () => fb.restoreDoc('accounts', id, rest));
      break;
    }
    case 'undo':
      if (toast.undo) { const u = toast.undo; toast.undo = null; $('#toast').classList.remove('show'); try { await u(); toast('Restored'); } catch { toast("Couldn't undo."); } }
      break;
    default: break;
  }
});

function updateCalc() {
  const out = $('#calc-result');
  if (!out) return;
  const pence = evaluateToPence(S.form.amountText);
  out.textContent = isSum(S.form.amountText) && pence !== null ? `= ${D.money(pence)}` : '';
}

document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (!el.name || !S.sheet) return;
  S.form[el.name] = el.value;
  if (el.name === 'amountText') { updateCalc(); if (S.errors.amount) { delete S.errors.amount; const e = el.closest('.field').querySelector('.err'); if (e) e.remove(); } }
  if (el.name === 'checkText') { const l = $('#check-line'); if (l) l.innerHTML = checkLine(); }
  if (el.name === 'name' && S.errors.name) { delete S.errors.name; const e = el.closest('.field').querySelector('.err'); if (e) e.remove(); }
});
document.addEventListener('change', (ev) => {
  if (ev.target.name === 'date' && S.sheet === 'entry') renderSheet();
  if (ev.target.name === 'openingDate' || ev.target.name === 'type') renderSheet();
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && S.sheet) closeSheet();
  if (ev.key === 'Enter' && S.sheet === 'entry' && ev.target.id === 'f-amount') { ev.preventDefault(); saveEntry(); }
  const g = gate();
  if ((g === 'pin-set' || g === 'pin-unlock') && /^[0-9]$/.test(ev.key)) pinKey(ev.key);
  if ((g === 'pin-set' || g === 'pin-unlock') && ev.key === 'Backspace') { S.pin.buffer = S.pin.buffer.slice(0, -1); render(); }
});

// ---------- start ----------
PIN.watchBackground(() => { if (PIN.hasPin() && S.user) { S.locked = true; closeSheet(); render(); } });

fb.finishRedirect();
fb.watchAuth((user) => {
  S.authReady = true;
  const changed = (S.user && S.user.uid) !== (user && user.uid);
  S.user = user;
  if (!user) {
    stopData();
    S.household = null; S.householdLoaded = false; S.accounts = []; S.txns = []; S.denied = false;
  } else if (changed) {
    S.householdLoaded = false;
    startData();
  }
  render();
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
