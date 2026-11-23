// Kudukka — Phase 1: sign-in, PIN lock, accounts and cards, entries, working month, Home summary.
// Phase 2: editable categories and income sources, trips, shop memory and quick repeat, search and filters,
// "Ask Sree/Sha" flags, spending donut, export.
import * as fb from './firebase.js';
import * as D from './data.js';
import { evaluateToPence, isSum } from './calc.js';
import * as PIN from './pin.js';
import { icon, POT_LOGO } from './icons.js';
import * as CSV from './bankcsv.js';

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
  bioSupported: false,
  bioTried: false,
  trips: [],
  bills: [],
  plans: {}, // money month label → { expected: { sree, sha, joint } }
  billsOffset: 0, // 0 = this money month on the Bills screen, 1 = next
  billsMode: 'list',
  billsDay: null,
  backTo: null,
  pots: [],
  potMoves: [],
  months: {}, // 'YYYY-MM' → { closed, closedAt, closedBy, balanceChecks, reportSeen }
  report: { mode: 'month', month: null, year: null },
  closeDraft: {}, // account id → text typed on the close-the-month screen
  imp: null, // bank statement import in progress
  view: 'home', // home | entries | accounts | more | trips | trip | categories
  viewArg: null, // trip id for the trip page
  person: 'home',
  month: LS.get('month') || D.currentMonth(),
  showArchived: false,
  search: blankSearch(),
  sheet: null, // entry | account | month | filters | trip | group | income
  form: {},
  errors: {},
};
function blankSearch() {
  return { text: '', scope: 'month', type: '', accountId: '', groupId: '', tripId: '', flagged: false };
}
const filterCount = () => ['type', 'accountId', 'groupId', 'tripId'].filter((k) => S.search[k]).length + (S.search.flagged ? 1 : 0);
const otherRole = () => (myRole() === 'sree' ? 'sha' : 'sree');
const tripById = (id) => S.trips.find((t) => t.id === id);
const settings = () => (S.household && S.household.settings) || {};
const payday = () => Number(settings().payday) || 25;
const billById = (id) => S.bills.find((b) => b.id === id);
const liveBills = () => S.bills.filter((b) => !b.archived);
function currentPlan() {
  const win = D.moneyMonth(D.todayISO(), payday());
  const override = S.plans[win.label] && S.plans[win.label].expected;
  return D.paydayPlan({ txns: S.txns, accounts: S.accounts, bills: S.bills, today: D.todayISO(), payday: payday(), incomeOverride: override || null });
}
const activeTrips = () => S.trips.filter((t) => !t.archived).sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
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
  // Categories: Firestore holds only edits and additions on top of the defaults in data.js.
  unsubs.push(fb.watchCollection('categories', (rows) => { D.setCategories(rows); renderMain(); if (S.sheet === 'group' || S.sheet === 'income') renderSheet(); }, onErr));
  unsubs.push(fb.watchCollection('trips', (rows) => { S.trips = rows; renderMain(); }, onErr));
  unsubs.push(fb.watchCollection('bills', (rows) => { S.bills = rows; renderMain(); }, onErr));
  unsubs.push(fb.watchCollection('plans', (rows) => { S.plans = Object.fromEntries(rows.map((r) => [r.id, r])); renderMain(); }, onErr));
  unsubs.push(fb.watchCollection('pots', (rows) => { S.pots = rows; renderMain(); }, onErr));
  unsubs.push(fb.watchCollection('potMoves', (rows) => { S.potMoves = rows.map((m) => ({ ...m, createdMs: m.createdAt && m.createdAt.toMillis ? m.createdAt.toMillis() : Date.now() })); renderMain(); }, onErr));
  unsubs.push(fb.watchCollection('months', (rows) => { S.months = Object.fromEntries(rows.map((r) => [r.id, r])); renderMain(); if (S.sheet === 'entry') renderSheet(); }, onErr));
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
    // Offer Face ID straight away when the lock screen appears.
    if (g === 'pin-unlock' && PIN.hasBio() && !S.bioTried) {
      S.bioTried = true;
      setTimeout(() => bioUnlock(false), 250);
    }
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
    <p class="muted center">Signed in as ${esc(S.user && S.user.email)}, but the household data didn't open.</p>
    <p class="muted center small">If this is one of your two accounts, check that the Firestore rules are published with both email addresses, wait a minute, then try again.</p>
    <div class="grow"></div>
    <button type="button" class="btn btn-primary btn-block" data-act="retry">Try again</button>
    <button type="button" class="link" data-act="signout">Use a different Google account</button>
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
    ${st.stage === 'unlock' && PIN.hasBio() ? `<button type="button" class="btn btn-ghost bio-btn" data-act="bio-unlock">${icon('face', 22)} Unlock with ${PIN.bioName()}</button>` : ''}
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

async function bioUnlock(byTap) {
  try {
    if (await PIN.unlockWithBio()) {
      S.pin = { stage: null, buffer: '', first: '', error: '' };
      S.locked = false;
      render();
      return;
    }
  } catch (e) {
    // Without a tap, iPhone may refuse to show Face ID; the button is there for that.
    if (!byTap) return;
  }
  if (byTap && S.locked) { S.pin.error = `${PIN.bioName()} didn't work. Use your PIN.`; render(); }
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
  const views = { home: viewHome, entries: viewEntries, accounts: viewAccounts, more: viewMore, trips: viewTrips, trip: viewTrip, categories: viewCategories, bills: viewBills, plan: viewPlan, pots: viewPots, pot: viewPot, reports: viewReports, close: viewClose, import: viewImport };
  // Keep the search box focused (and its cursor) while results update underneath.
  const q = document.activeElement && document.activeElement.id === 'q' ? document.activeElement.selectionStart : null;
  main.innerHTML = header() + (views[v] || viewMore)();
  if (q !== null) { const el = $('#q'); if (el) { el.focus(); el.setSelectionRange(q, q); } }
}

// A small back bar for the screens inside More.
function subhead(title, back) {
  if (S.backTo && S.backTo !== S.view && back !== 'trips' && back !== 'pots') back = S.backTo;
  return `<div class="subhead"><button type="button" class="icon-btn" data-act="nav" data-v="${back}" aria-label="Back">${icon('left', 22)}</button><h1 class="h2">${esc(title)}</h1></div>`;
}

// Spending donut: one ring segment per category group, largest first.
function donut(byGroup, total) {
  const groups = Object.entries(byGroup)
    .map(([id, amt]) => ({ g: D.groupById(id) || D.groupById('other'), amt }))
    .sort((a, b) => b.amt - a.amt);
  const C = 2 * Math.PI * 52;
  let run = 0;
  const segs = groups.map(({ g, amt }) => {
    const len = (amt / total) * C;
    const shown = groups.length > 1 && len > 3 ? len - 2 : len;
    const seg = `<circle cx="70" cy="70" r="52" fill="none" stroke="${g.color}" stroke-width="18" stroke-dasharray="${shown.toFixed(2)} ${(C - shown).toFixed(2)}" stroke-dashoffset="${(-run).toFixed(2)}"></circle>`;
    run += len;
    return seg;
  }).join('');
  const label = groups.map(({ g, amt }) => `${g.name} ${D.money(amt)}`).join(', ');
  return `<div class="donut-row">
    <div class="donut"><svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label="Spending by category: ${esc(label)}"><g transform="rotate(-90 70 70)">${segs}</g></svg>
      <div class="donut-mid"><span class="donut-total">${D.money(total)}</span><span class="small muted">spent</span></div></div>
    <ul class="legend-list">${groups.map(({ g, amt }) => `<li><button type="button" class="leg" data-act="filter-group" data-id="${g.id}">
      <span class="leg-dot" style="background:${g.color}"></span><span class="leg-name">${esc(g.name)}</span><b>${D.money(amt)}</b></button></li>`).join('')}</ul>
  </div>`;
}

function flagCard() {
  const flagged = S.txns.filter((t) => t.flag);
  if (!flagged.length) return '';
  const forSree = flagged.filter((t) => t.flagFor === 'sree').length;
  const forSha = flagged.filter((t) => t.flagFor === 'sha').length;
  const parts = [forSree ? `${forSree} to check with Sree` : '', forSha ? `${forSha} to check with Sha` : ''].filter(Boolean).join(' · ');
  return `<button type="button" class="card flag-card" data-act="show-flagged">
    <span class="gicon warn">${icon('flag', 18)}</span>
    <span class="entry-main"><span class="entry-title">${parts || `${flagged.length} flagged`}</span><span class="entry-sub">Tap to see them</span></span>${icon('right', 18)}
  </button>`;
}

function tripCard() {
  const live = activeTrips().filter((t) => D.tripStatus(t) === 'now');
  if (!live.length) return '';
  return live.map((t) => {
    const st = D.tripStats(t, S.txns, S.accounts);
    const pct = t.budget ? Math.min(100, (st.total / t.budget) * 100) : 0;
    return `<button type="button" class="card trip-card" data-act="open-trip" data-id="${t.id}">
      <span class="row-between"><span class="entry-title">${icon('travel', 16)} ${esc(t.name)}</span><span class="tag">On now</span></span>
      <span class="row-between"><span class="muted small">Spent</span><b>${D.money(st.total)}${t.budget ? ` <span class="muted small">of ${D.money(t.budget)}</span>` : ''}</b></span>
      ${t.budget ? `<span class="bar thin full"><span style="width:${pct}%;background:${pct > 90 ? 'var(--warn)' : 'var(--travel)'}"></span></span>` : ''}
    </button>`;
  }).join('');
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
  const recent = D.entriesFor(S.txns, S.accounts, S.month, S.person).slice(0, 5);
  const moved = S.person !== 'home' && (s.movedIn || s.movedOut)
    ? `<p class="moved">${s.movedOut ? `Moved to ${S.person === 'sree' ? 'Sha' : 'Sree'}: <b>${D.money(s.movedOut)}</b>` : ''}${s.movedIn && s.movedOut ? ' · ' : ''}${s.movedIn ? `Received from ${S.person === 'sree' ? 'Sha' : 'Sree'}: <b>${D.money(s.movedIn)}</b>` : ''}</p>`
    : '';
  return `${monthPill()}${personSwitch()}${planCards()}${closeCard()}${flagCard()}${tripCard()}
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
      ${s.spend ? donut(s.byGroup, s.spend) : `<p class="muted">No spending entered for ${D.monthLabel(S.month)} yet.</p>`}
    </section>
    ${potsCard()}
    <section class="card">
      <div class="row-between"><h2 class="h3">Latest entries</h2>${recent.length ? '<button type="button" class="link" data-act="nav" data-v="entries">See all</button>' : ''}</div>
      ${recent.length ? `<ul class="entries">${recent.map(entryRow).join('')}</ul>` : `<p class="muted">Tap + to add your first entry for ${D.monthLabel(S.month)}.</p>`}
    </section>`;
}

function entryVisual(t) {
  if (t.type === 'spend') {
    const g = D.groupOf(t.categoryId) || D.groupById('other');
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
  const trip = tripById(t.tripId);
  let title = t.shop || t.note || (cat ? cat.name : D.ENTRY_TYPES[t.type]);
  const bits = [];
  if (t.type === 'transfer') {
    title = t.note || (D.isDebt(to) ? `Paid ${to.name}` : 'Transfer');
    bits.push(`${acc ? esc(acc.name) : '?'} → ${to ? esc(to.name) : '?'}`);
  } else {
    if (cat && title !== cat.name) bits.push(esc(cat.name));
    if (t.shop && t.note) bits.push(esc(t.note));
    bits.push(acc ? esc(acc.name) : 'Deleted account');
  }
  if (trip) bits.push(`${icon('travel', 12)} ${esc(trip.name)}`);
  if (t.calc) bits.push(`<span class="calc-note">${esc(t.calc)}</span>`);
  const amt = t.type === 'spend' ? `−${D.money(t.amount)}` : t.type === 'income' ? `+${D.money(t.amount)}` : t.type === 'adjust' ? `${t.amount >= 0 ? '+' : '−'}${D.money(Math.abs(t.amount))}` : D.money(t.amount);
  const cls = t.type === 'income' ? 'pos' : t.type === 'transfer' || t.type === 'adjust' ? 'quiet' : '';
  const flag = t.flag ? `<span class="flag-note">${icon('flag', 12)} Ask ${D.PEOPLE[t.flagFor] ? D.PEOPLE[t.flagFor].name : ''}${t.flagNote ? `: ${esc(t.flagNote)}` : ''}</span>` : '';
  return `<li><button type="button" class="entry" data-act="edit-entry" data-id="${t.id}">
    <span class="gicon" style="background:${v.color}">${icon(v.ic, 18)}</span>
    <span class="entry-main"><span class="entry-title">${esc(title)}</span><span class="entry-sub">${acc ? ownerDot(acc.owner) : ''}${bits.join(' · ')}</span>${flag}</span>
    <span class="entry-amt ${cls}">${amt}</span>
  </button></li>`;
}

function dayGroups(list, withYear) {
  const byDay = [];
  for (const t of list) {
    const last = byDay.at(-1);
    if (last && last.date === t.date) last.items.push(t);
    else byDay.push({ date: t.date, items: [t] });
  }
  return byDay.map((d) => `<h3 class="day">${D.dayLabel(d.date)}${withYear ? ` ${d.date.slice(0, 4)}` : ''}</h3><ul class="entries card tight">${d.items.map(entryRow).join('')}</ul>`).join('');
}

function currentResults() {
  const q = S.search;
  return D.searchEntries(S.txns, S.accounts, {
    person: S.person, month: q.scope === 'all' ? null : S.month,
    text: q.text, type: q.type, accountId: q.accountId, groupId: q.groupId, tripId: q.tripId, flagged: q.flagged,
  }, S.trips);
}

function entriesResults() {
  const list = currentResults();
  const searching = S.search.text.trim() || filterCount();
  if (!list.length) {
    if (searching) return `<section class="card"><p class="muted">Nothing matches${S.search.scope === 'month' ? ` in ${D.monthLabel(S.month)}` : ''}.</p>${S.search.scope === 'month' ? '<button type="button" class="btn btn-ghost btn-block" data-act="search-scope" data-s="all">Search all months</button>' : ''}</section>`;
    return `<section class="card"><p class="muted">No entries for ${D.monthLabel(S.month)} yet.</p>${activeAccounts().length ? '<button type="button" class="btn btn-primary btn-block" data-act="add-entry">Add an entry</button>' : '<button type="button" class="btn btn-primary btn-block" data-act="add-account">Add an account first</button>'}</section>`;
  }
  const inSum = list.filter((t) => t.type === 'income').reduce((n, t) => n + t.amount, 0);
  const outSum = list.filter((t) => t.type === 'spend').reduce((n, t) => n + t.amount, 0);
  return `<div class="summary-line"><span>${list.length} ${list.length === 1 ? 'entry' : 'entries'}</span><span>In <b>${D.money(inSum)}</b> · Out <b>${D.money(outSum)}</b></span></div>
    ${dayGroups(list, S.search.scope === 'all')}`;
}

function activeFilterChips() {
  const q = S.search;
  const chips = [];
  if (q.type) chips.push(['type', D.ENTRY_TYPES[q.type]]);
  if (q.accountId) { const a = accountById(q.accountId); chips.push(['accountId', a ? a.name : 'Account']); }
  if (q.groupId) { const g = D.groupById(q.groupId); chips.push(['groupId', g ? g.name : 'Category']); }
  if (q.tripId) { const t = tripById(q.tripId); chips.push(['tripId', t ? t.name : 'Trip']); }
  if (q.flagged) chips.push(['flagged', 'Ask flags']);
  if (!chips.length) return '';
  return `<div class="chips">${chips.map(([k, label]) => `<button type="button" class="chip on" data-act="clear-filter" data-k="${k}" aria-label="Remove filter ${esc(label)}">${esc(label)} ${icon('x', 14)}</button>`).join('')}
    <button type="button" class="link" data-act="clear-filters">Clear all</button></div>`;
}

function viewEntries() {
  const q = S.search;
  const n = filterCount();
  const scope = `<div class="segs two" role="group" aria-label="Where to look">
    <button type="button" class="seg${q.scope === 'month' ? ' on' : ''}" data-act="search-scope" data-s="month">${D.monthShort(S.month)}</button>
    <button type="button" class="seg${q.scope === 'all' ? ' on' : ''}" data-act="search-scope" data-s="all">All months</button></div>`;
  return `${q.scope === 'month' ? monthPill() : ''}${personSwitch()}
    <div class="search-row">
      <label class="search-box" for="q">${icon('search', 18)}<input id="q" type="search" class="bare-input" placeholder="Search shop, note, amount…" autocomplete="off" value="${esc(q.text)}"></label>
      <button type="button" class="btn btn-ghost btn-sm filter-btn${n ? ' on' : ''}" data-act="open-filters" aria-label="Filters${n ? `, ${n} on` : ''}">${icon('filter', 18)}${n ? `<span class="count">${n}</span>` : ''}</button>
    </div>
    ${scope}${activeFilterChips()}
    <div id="results">${entriesResults()}</div>`;
}

function viewAccounts() {
  const show = (a) => (S.person === 'home' || a.owner === S.person) && (S.showArchived || !a.archived);
  const accs = S.accounts.filter(show);
  const banks = accs.filter((a) => !D.isDebt(a));
  const cards = accs.filter((a) => a.type === 'credit');
  const loans = accs.filter((a) => a.type === 'loan');
  const archivedCount = S.accounts.filter((a) => a.archived && (S.person === 'home' || a.owner === S.person)).length;
  const bankTotal = banks.filter((a) => !a.archived).reduce((n, a) => n + D.balanceOf(a, S.txns), 0);
  const owedTotal = [...cards, ...loans].filter((a) => !a.archived).reduce((n, a) => n + Math.max(0, -D.balanceOf(a, S.txns)), 0);
  const debtInfo = Object.fromEntries(D.debtsList(S.accounts, S.txns, S.bills).map((d) => [d.account.id, d]));

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
      ${a.creditLimit ? `<span class="bar thin full"><span style="width:${pct}%;background:${pct > 80 ? 'var(--warn)' : 'var(--rust)'}"></span></span><span class="entry-sub">${D.money(owed)} of ${D.money(a.creditLimit)} limit${a.apr ? ` · ${a.apr}% APR` : ''}</span>` : ''}
    </button></li>`;
  };
  const loanRow = (a) => {
    const owed = Math.max(0, -D.balanceOf(a, S.txns));
    const d = debtInfo[a.id];
    const free = d && d.months !== null && d.months !== undefined ? `Debt-free ${D.monthShort(D.shiftMonth(D.currentMonth(), d.months))}` : '';
    return `<li><button type="button" class="entry col" data-act="edit-account" data-id="${a.id}">
      <span class="entry-top">
        <span class="gicon" style="background:${D.PEOPLE[a.owner].color};color:${D.PEOPLE[a.owner].ink}">${icon('loan', 18)}</span>
        <span class="entry-main"><span class="entry-title">${esc(a.name)}${a.archived ? ' <span class="tag">Archived</span>' : ''}</span>
        <span class="entry-sub">${D.PEOPLE[a.owner].name}${a.apr ? ` · ${a.apr}% APR` : ''}${d && d.payment ? ` · ${D.money(d.payment)} a month` : ''}</span></span>
        <span class="entry-amt"><span class="small muted block">${owed ? 'Owed' : 'Paid off'}</span>${D.money(owed)}</span>
      </span>
      ${free ? `<span class="entry-sub ok-text">${icon('check', 12)} ${free} at this rate</span>` : d && !d.payment ? '<span class="entry-sub">Add its monthly repayment in Bills to see a debt-free date</span>' : ''}
    </button></li>`;
  };
  return `${personSwitch()}
    <section class="totals">
      <div class="card stat"><span class="muted small">In accounts</span><span class="big-sm">${D.money(bankTotal)}</span></div>
      <div class="card stat"><span class="muted small">${loans.length ? 'Owed on cards and loans' : 'Owed on cards'}</span><span class="big-sm">${D.money(owedTotal)}</span></div>
    </section>
    <div class="row-between"><h2 class="h3">Bank and savings</h2></div>
    ${banks.length ? `<ul class="entries card tight">${banks.map(bankRow).join('')}</ul>` : '<p class="muted pad">No bank accounts yet.</p>'}
    <div class="row-between"><h2 class="h3">Credit cards</h2></div>
    ${cards.length ? `<ul class="entries card tight">${cards.map(cardRow).join('')}</ul>` : '<p class="muted pad">No credit cards yet.</p>'}
    ${loans.length ? `<div class="row-between"><h2 class="h3">Loans and finance</h2></div><ul class="entries card tight">${loans.map(loanRow).join('')}</ul>` : ''}
    <button type="button" class="btn btn-ghost btn-block" data-act="add-account">${icon('plus', 18)} Add account, card or loan</button>
    ${archivedCount ? `<button type="button" class="link center-block" data-act="toggle-archived">${S.showArchived ? 'Hide' : 'Show'} archived (${archivedCount})</button>` : ''}`;
}

const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

function viewMore() {
  const role = myRole();
  return `<section class="card">
      <div class="me">${avatar(role, 52)}<div><b>${D.PEOPLE[role].name}</b><span class="muted small block">${esc(S.user.email)}</span></div></div>
    </section>
    <ul class="entries card tight">
      <li><button type="button" class="entry" data-act="nav" data-v="plan"><span class="gicon plain">${icon('income', 18)}</span><span class="entry-main"><span class="entry-title">Payday plan</span><span class="entry-sub">Free to plan, safe to spend, suggestions</span></span>${icon('right', 18)}</button></li>
      <li><button type="button" class="entry" data-act="nav" data-v="bills"><span class="gicon plain">${icon('bills', 18)}</span><span class="entry-main"><span class="entry-title">Bills and repayments</span><span class="entry-sub">${liveBills().length ? `${liveBills().length} regular ${liveBills().length === 1 ? 'bill' : 'bills'}` : 'Rent, energy, loans and subscriptions'}</span></span>${icon('right', 18)}</button></li>
      <li><button type="button" class="entry" data-act="nav" data-v="pots"><span class="gicon plain">${icon('pot', 18)}</span><span class="entry-main"><span class="entry-title">Pots</span><span class="entry-sub">${livePots().length ? `${livePots().length} ${livePots().length === 1 ? 'pot' : 'pots'} · ${D.money(livePots().reduce((n, p) => n + D.potBalance(p, S.potMoves), 0))}` : 'Optional: save for a holiday or yearly bills'}</span></span>${icon('right', 18)}</button></li>
      <li><button type="button" class="entry" data-act="nav" data-v="reports"><span class="gicon plain">${icon('chart', 18)}</span><span class="entry-main"><span class="entry-title">Reports</span><span class="entry-sub">Month and year, by category, person and shop</span></span>${icon('right', 18)}</button></li>
      <li><button type="button" class="entry" data-act="open-close" data-m=""><span class="gicon plain">${icon('check', 18)}</span><span class="entry-main"><span class="entry-title">Close the month</span><span class="entry-sub">Check balances, sort the last few, lock it</span></span>${icon('right', 18)}</button></li>
      <li><button type="button" class="entry" data-act="nav" data-v="import"><span class="gicon plain">${icon('upload', 18)}</span><span class="entry-main"><span class="entry-title">Import a bank statement</span><span class="entry-sub">Add entries from a CSV file</span></span>${icon('right', 18)}</button></li>
      <li><button type="button" class="entry" data-act="nav" data-v="trips"><span class="gicon plain">${icon('travel', 18)}</span><span class="entry-main"><span class="entry-title">Trips</span><span class="entry-sub">${activeTrips().length ? `${activeTrips().length} ${activeTrips().length === 1 ? 'trip' : 'trips'}` : 'Track a holiday as one total'}</span></span>${icon('right', 18)}</button></li>
      <li><button type="button" class="entry" data-act="nav" data-v="categories"><span class="gicon plain">${icon('tag', 18)}</span><span class="entry-main"><span class="entry-title">Categories and income</span><span class="entry-sub">Rename, add, recolour or hide</span></span>${icon('right', 18)}</button></li>
      <li><button type="button" class="entry" data-act="export"><span class="gicon plain">${icon('download', 18)}</span><span class="entry-main"><span class="entry-title">Export my data</span><span class="entry-sub">Spreadsheet files of all entries and accounts</span></span>${icon('right', 18)}</button></li>
    </ul>
    <ul class="entries card tight">
      ${S.bioSupported ? `<li><button type="button" class="entry" data-act="bio-toggle" aria-pressed="${PIN.hasBio()}"><span class="gicon plain">${icon('face', 18)}</span><span class="entry-main"><span class="entry-title">Unlock with ${PIN.bioName()}</span><span class="entry-sub">${PIN.hasBio() ? 'On · PIN still works too' : 'Off · tap to turn on'}</span></span><span class="switch${PIN.hasBio() ? ' on' : ''}" aria-hidden="true"></span></button></li>` : ''}
      <li><button type="button" class="entry" data-act="change-pin"><span class="gicon plain">${icon('key', 18)}</span><span class="entry-main"><span class="entry-title">Change PIN</span></span>${icon('right', 18)}</button></li>
      <li><button type="button" class="entry" data-act="lock"><span class="gicon plain">${icon('lock', 18)}</span><span class="entry-main"><span class="entry-title">Lock now</span></span>${icon('right', 18)}</button></li>
      <li><button type="button" class="entry" data-act="signout"><span class="gicon plain">${icon('logout', 18)}</span><span class="entry-main"><span class="entry-title">Sign out</span></span>${icon('right', 18)}</button></li>
    </ul>
    <p class="footer-note"><span class="tagline-sm">Neeyum Njanum, Oru Kudukka</span><br>Phase 5</p>`;
}

// ---------- Phase 3: bills ----------
const winLabel = (win) => `${D.shortDate(win.start)} – ${D.shortDate(win.end)}`;
const monthName = (label) => D.monthLabel(label).split(' ')[0];

function billVisual(b) {
  if (b.kind === 'repayment') return { color: 'var(--quiet)', ic: 'loan' };
  const g = D.groupOf(b.categoryId) || D.groupById('bills');
  return { color: g.color, ic: g.icon };
}

function billRow(row) {
  const b = row.bill;
  const v = billVisual(b);
  const acc = accountById(b.accountId);
  const change = D.billPriceChange(b, S.txns);
  const when = row.paid ? `Paid ${D.shortDate(row.paid.date)}` : row.status === 'late' ? `Was due ${D.shortDate(row.due)} · not entered yet` : row.daysTo === 0 ? 'Due today' : row.daysTo === 1 ? 'Due tomorrow' : `Due ${D.dayLabel(row.due)}`;
  const chip = row.paid ? `<span class="pill-chip ok">${icon('check', 12)} Paid</span>` : row.status === 'late' ? '<span class="pill-chip warn">Check</span>' : row.daysTo <= 3 ? '<span class="pill-chip soon">Soon</span>' : '';
  return `<li class="bill-li${row.paid ? ' is-paid' : ''}"><button type="button" class="entry" data-act="edit-bill" data-id="${b.id}">
      <span class="gicon" style="background:${v.color}">${icon(v.ic, 18)}</span>
      <span class="entry-main"><span class="entry-title">${esc(b.name)}</span>
        <span class="entry-sub">${when}${acc ? ` · ${esc(acc.name)}` : ''}</span>
        ${change ? `<span class="flag-note">${icon('alert', 12)} ${change.diff > 0 ? 'Went up' : 'Went down'} ${D.money(Math.abs(change.diff))} on ${D.shortDate(change.date)}</span>` : ''}</span>
      <span class="entry-amt">${b.varies && !row.paid ? '~' : ''}${D.money(row.amount)}${chip}</span>
    </button>
    ${row.paid ? '' : `<button type="button" class="paid-btn" data-act="pay-bill" data-id="${b.id}" data-due="${row.due}" aria-label="Enter payment for ${esc(b.name)}">${icon('check', 16)} Paid</button>`}
  </li>`;
}

function billsCalendar(rows, win) {
  const start = win.start;
  const days = D.daysBetween(start, win.end) + 1;
  const [y, m, d] = start.split('-').map(Number);
  const lead = (new Date(y, m - 1, d).getDay() + 6) % 7; // Monday first
  const byDay = {};
  for (const r of rows) (byDay[r.due] = byDay[r.due] || []).push(r);
  const today = D.todayISO();
  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<span class="cal-cell empty"></span>';
  for (let i = 0; i < days; i++) {
    const iso = D.addDays(start, i);
    const list = byDay[iso] || [];
    const dots = list.slice(0, 4).map((r) => `<span class="cal-dot ${r.paid ? 'ok' : r.status === 'late' ? 'warn' : 'due'}"></span>`).join('');
    const isPay = iso === start;
    cells += `<button type="button" class="cal-cell${iso === today ? ' today' : ''}${S.billsDay === iso ? ' on' : ''}${isPay ? ' pay' : ''}" data-act="cal-day" data-d="${iso}" aria-label="${D.dayLabel(iso)}${list.length ? `, ${list.length} bill${list.length > 1 ? 's' : ''}` : ''}${isPay ? ', payday' : ''}">
      <span class="cal-num">${Number(iso.slice(8))}</span><span class="cal-dots">${isPay ? `<span class="cal-pay">${icon('income', 11)}</span>` : ''}${dots}</span></button>`;
  }
  const picked = S.billsDay ? rows.filter((r) => r.due === S.billsDay) : [];
  return `<section class="card cal">
    <div class="cal-head">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => `<span>${x}</span>`).join('')}</div>
    <div class="cal-grid">${cells}</div>
    <div class="legend"><span><span class="cal-dot due"></span>Due</span><span><span class="cal-dot ok"></span>Paid</span><span><span class="cal-dot warn"></span>Check</span><span>${icon('income', 12)} Payday</span></div>
  </section>
  ${S.billsDay ? `<h3 class="day">${D.dayLabel(S.billsDay)}</h3>${picked.length ? `<ul class="entries card tight">${picked.map(billRow).join('')}</ul>` : '<p class="muted pad">No bills due this day.</p>'}` : ''}`;
}

function detectedCards() {
  const dismissed = settings().dismissedBills || [];
  const found = D.detectBills(S.txns, S.bills, D.todayISO(), dismissed).slice(0, 3);
  return found.map((f) => `<section class="card suggest-card">
    <div class="row-between"><span class="entry-title">${icon('bulb', 16)} Looks like a ${f.varies ? 'regular' : 'monthly'} bill</span></div>
    <span><b>${esc(f.name)}</b> · ${f.varies ? 'about ' : ''}${D.money(f.amount)} around the ${ordinal(f.dueDay)}, seen in ${f.months} months</span>
    <div class="row-gap"><button type="button" class="btn btn-primary btn-sm" data-act="add-detected" data-k="${esc(f.key)}">Add as a bill</button>
    <button type="button" class="btn btn-ghost btn-sm" data-act="dismiss-detected" data-k="${esc(f.key)}">Not a bill</button></div>
  </section>`).join('');
}

function viewBills() {
  let win = D.moneyMonth(D.todayISO(), payday());
  for (let i = 0; i < S.billsOffset; i++) win = D.nextMoneyMonth(win, payday());
  const rows = D.billsForWindow(S.bills, S.txns, win, D.todayISO());
  const total = rows.reduce((n, r) => n + r.amount, 0);
  const paid = rows.filter((r) => r.paid).reduce((n, r) => n + r.amount, 0);
  const nextWin = D.nextMoneyMonth(win, payday());
  const nextTotal = D.billsForWindow(S.bills, S.txns, nextWin, D.todayISO()).reduce((n, r) => n + r.expected, 0);
  const order = { late: 0, due: 1, paid: 2 };
  const sorted = [...rows].sort((a, b) => order[a.status] - order[b.status] || (a.due < b.due ? -1 : 1));
  const renew = S.billsOffset === 0 ? D.renewalsSoon(S.bills, D.todayISO()) : [];
  const yearlySetAside = liveBills().filter((b) => b.freq === 'yearly').reduce((n, b) => n + D.billMonthly(b, S.txns), 0);
  return `${subhead('Bills', 'more')}
    <div class="win-nav">
      <button type="button" class="icon-btn" data-act="bills-win" data-d="-1" ${S.billsOffset === 0 ? 'disabled' : ''} aria-label="Earlier">${icon('left', 20)}</button>
      <div class="win-title"><b>${monthName(win.label)}'s bills</b><span class="muted small">${winLabel(win)}</span></div>
      <button type="button" class="icon-btn" data-act="bills-win" data-d="1" ${S.billsOffset >= 2 ? 'disabled' : ''} aria-label="Later">${icon('right', 20)}</button>
    </div>
    <section class="totals">
      <div class="card stat"><span class="muted small">Promised</span><span class="big-sm">${D.money(total)}</span><span class="small muted">${rows.length} ${rows.length === 1 ? 'bill' : 'bills'}</span></div>
      <div class="card stat"><span class="muted small">Still due</span><span class="big-sm">${D.money(total - paid)}</span><span class="small muted">${rows.filter((r) => r.paid).length} of ${rows.length} paid</span></div>
    </section>
    ${S.billsOffset === 0 ? detectedCards() : ''}
    ${renew.map((r) => `<section class="card suggest-card warn-card"><span class="entry-title">${icon('alert', 16)} ${esc(r.bill.name)} renews ${r.days === 0 ? 'today' : `in ${r.days} ${r.days === 1 ? 'day' : 'days'}`}</span><span class="muted small">Worth comparing prices before ${D.shortDate(r.date)}.</span></section>`).join('')}
    <div class="segs two" role="group" aria-label="View"><button type="button" class="seg${S.billsMode === 'list' ? ' on' : ''}" data-act="bills-mode" data-m="list">List</button><button type="button" class="seg${S.billsMode === 'cal' ? ' on' : ''}" data-act="bills-mode" data-m="cal">Calendar</button></div>
    ${S.billsMode === 'cal' ? billsCalendar(rows, win) : rows.length ? `<ul class="entries card tight">${sorted.map(billRow).join('')}</ul>` : `<section class="card"><p class="muted">${S.bills.length ? `No bills due in ${monthName(win.label)}.` : 'Add your rent, council tax, energy, phones and subscriptions. Kudukka then shows what’s promised each month and what’s still due.'}</p></section>`}
    <button type="button" class="btn btn-ghost btn-block" data-act="add-bill">${icon('plus', 18)} Add a bill or repayment</button>
    <p class="muted small pad">${monthName(nextWin.label)} (${winLabel(nextWin)}): <b>${D.money(nextTotal)}</b> already promised.${yearlySetAside ? ` Yearly bills: put aside about <b>${D.money(yearlySetAside)}</b> a month.` : ''}</p>`;
}

// ---------- Phase 3: payday plan ----------
function moneyBar(p) {
  const total = Math.max(1, p.have + p.coming);
  const seg = (amt, color, label) => (amt > 0 ? `<span style="width:${(Math.min(amt, total) / total) * 100}%;background:${color}" title="${label}"></span>` : '');
  return `<div class="bar money-bar">${seg(p.billsDue, 'var(--olive)', 'Bills')}${seg(p.cardsOwed, 'var(--rust)', 'Cards')}${seg(Math.max(0, p.free), 'var(--sha)', 'Free')}</div>
    <div class="legend"><span><span class="odot" style="background:var(--olive)"></span>Bills</span><span><span class="odot" style="background:var(--rust)"></span>Cards</span><span><span class="odot" style="background:var(--sha)"></span>Free to plan</span></div>`;
}

function suggestionCard(s, i, p) {
  const n = `<span class="step-num">${i + 1}</span>`;
  if (s.kind === 'short') return `<li class="card tip warn-card">${n}<div><b>You're ${D.money(s.amount)} short before payday</b><span class="muted small">Move money from savings, or hold off on extras until ${D.shortDate(p.win.nextPayday)}.</span></div></li>`;
  if (s.kind === 'spend') return `<li class="card tip">${n}<div><b>Keep ${D.money(s.amount)} for everyday spending</b><span class="muted small">About ${D.money(s.perWeek)} a week until payday${s.typicalWeek ? `, close to your usual ${D.money(s.typicalWeek)}` : ''}.</span></div></li>`;
  if (s.kind === 'emergency') return `<li class="card tip">${n}<div><b>Put ${D.money(s.amount)} into savings</b><span class="muted small">Emergency fund: ${D.money(s.saved)} of ${D.money(s.target)}${s.saved < D.STARTER_EMERGENCY ? '. First aim: £1,000 for small shocks' : ' (3 months of bills)'}.</span></div></li>`;
  if (s.kind === 'debt') return `<li class="card tip">${n}<div><b>Pay ${D.money(s.amount)} extra off ${esc(s.debt.account.name)}</b><span class="muted small">${s.debt.apr ? `${s.debt.apr}% interest, the highest you have` : 'Your loan'}${s.monthsSooner ? `. Debt-free about ${s.monthsSooner} ${s.monthsSooner === 1 ? 'month' : 'months'} sooner` : ''}.</span></div></li>`;
  const pp = D.potsPlan(S.pots, S.potMoves, s.amount);
  if (pp.length) {
    return `<li class="card tip">${n}<div><b>${D.money(s.amount)} for goals</b><span class="muted small">Pots still due this month: ${pp.map((x) => `${esc(x.pot.name)} ${D.money(x.need)}`).join(' · ')}.</span><button type="button" class="link" data-act="nav" data-v="pots">Open pots</button></div></li>`;
  }
  return `<li class="card tip">${n}<div><b>${D.money(s.amount)} left for goals or a buffer</b><span class="muted small">Keep it for a holiday or a pot, or let it roll into next month.</span>${livePots().length ? '' : '<button type="button" class="link" data-act="nav" data-v="pots">Start a pot</button>'}</div></li>`;
}

function viewPlan() {
  const p = currentPlan();
  const noData = !S.bills.length && !S.txns.some((t) => t.type === 'income');
  const ex = p.expected;
  const who = ['sree', 'sha', 'joint'].filter((k) => (ex[k] || 0) || (p.received[k] || 0));
  const guardLine = (g) => g.status === 'short'
    ? `<span class="pill-chip bad">Top up ${D.money(-g.after)}</span><span class="muted small block">${g.shortDate > D.todayISO() ? `before ${D.shortDate(g.shortDate)}` : 'now'} · ${g.count} ${g.count === 1 ? 'bill' : 'bills'}, ${D.money(g.due)}</span>`
    : g.status === 'tight'
      ? `<span class="pill-chip warn">Tight</span><span class="muted small block">only ${D.money(g.after)} left after ${D.money(g.due)} of bills</span>`
      : `<span class="pill-chip ok">${icon('check', 12)} Covered</span><span class="muted small block">${D.money(g.due)} of bills to ${D.shortDate(g.lastDue)} · ${D.money(g.after)} left</span>`;
  const debts = D.debtsList(S.accounts, S.txns, S.bills);
  return `${subhead('Payday plan', 'more')}
    <section class="card plan-head">
      <div class="row-between"><span class="muted small">Money for ${monthName(p.win.label)} · ${winLabel(p.win)}</span>
        <button type="button" class="link" data-act="open-payday">Payday: ${ordinal(payday())} ${icon('edit', 14)}</button></div>
      <span class="muted small">Free to plan</span>
      <span class="big" style="color:${p.free < 0 ? 'var(--danger)' : 'var(--olive)'}">${D.money(p.free)}</span>
      ${moneyBar(p)}
      <ul class="calc-list">
        <li><span>In current accounts now</span><b>+${D.money(p.have)}</b></li>
        <li><button type="button" class="link-row" data-act="open-expected"><span>Pay still to come ${icon('edit', 13)}</span><b>+${D.money(p.coming)}</b></button>
          ${who.length ? `<span class="muted small">${who.map((k) => ((ex[k] || 0) > (p.received[k] || 0) ? `${D.PEOPLE[k].name}: ${D.money(p.received[k] || 0)} in of ~${D.money(ex[k])}` : `${D.PEOPLE[k].name}: ${D.money(p.received[k] || 0)} in`)).join(' · ')}</span>` : '<span class="muted small">Enter pay as Income, or tap to set what you expect</span>'}</li>
        <li><button type="button" class="link-row" data-act="nav" data-v="bills"><span>Bills still due</span><b>−${D.money(p.billsDue)}</b></button></li>
        <li><span>Credit card balances</span><b>−${D.money(p.cardsOwed)}</b></li>
      </ul>
      ${p.saved ? `<span class="muted small">Not counted: ${D.money(p.saved)} in savings.</span>` : ''}
    </section>
    ${noData ? `<section class="card"><p class="muted">Add your bills and enter your pay as Income, and this plan fills itself in.</p><button type="button" class="btn btn-primary btn-block" data-act="nav" data-v="bills">Add bills</button></section>` : ''}
    <section class="card safe-card"><span class="muted small">Safe to spend</span>
      <span class="big-sm">${D.money(p.safePerWeek)} <span class="small muted">a week</span></span>
      <span class="small muted">until payday on ${D.dayLabel(p.win.nextPayday)} · ${p.daysLeft} ${p.daysLeft === 1 ? 'day' : 'days'} left</span></section>
    <h2 class="h3 pad">Suggestions</h2>
    <ol class="tips">${p.suggestions.map((s, i) => suggestionCard(s, i, p)).join('')}</ol>
    <p class="muted small pad">Suggestions only, based on common UK guidance: spending money first, then a £1,000 emergency starter, then 3 months of bills, and the highest-interest debt first. Not financial advice.</p>
    ${p.guard.length ? `<h2 class="h3 pad">${icon('shield', 16)} Direct debit guard</h2>
      <ul class="entries card tight wrap">${p.guard.map((g) => `<li><div class="entry"><span class="gicon" style="background:${D.PEOPLE[g.account.owner].color};color:${D.PEOPLE[g.account.owner].ink}">${icon('bank', 18)}</span>
        <span class="entry-main"><span class="entry-title">${esc(g.account.name)}</span><span class="entry-sub">Balance ${D.money(g.balance)}</span></span>
        <span class="guard-status">${guardLine(g)}</span></div></li>`).join('')}</ul>` : ''}
    ${debts.length ? `<h2 class="h3 pad">Debts, highest interest first</h2>
      <ul class="entries card tight wrap">${debts.map((d) => `<li><button type="button" class="entry" data-act="edit-account" data-id="${d.account.id}">
        <span class="gicon" style="background:${D.PEOPLE[d.account.owner].color};color:${D.PEOPLE[d.account.owner].ink}">${icon(d.account.type === 'loan' ? 'loan' : 'card', 18)}</span>
        <span class="entry-main"><span class="entry-title">${esc(d.account.name)}</span><span class="entry-sub">${d.apr ? `${d.apr}% APR` : 'No rate set'}${d.months ? ` · debt-free ${D.monthShort(D.shiftMonth(D.currentMonth(), d.months))}` : ''}</span></span>
        <span class="entry-amt">${D.money(d.owed)}</span></button></li>`).join('')}</ul>` : ''}`;
}

function planCards() {
  if (S.person !== 'home') return '';
  const p = currentPlan();
  const rows = p.winBills;
  const due = rows.filter((r) => !r.paid);
  const next = due[0];
  return `<section class="totals">
    <button type="button" class="card stat link-card" data-act="nav" data-v="plan">
      <span class="muted small">Safe to spend</span><span class="big-sm">${D.money(p.safePerWeek)}</span><span class="small muted">a week till ${D.shortDate(p.win.nextPayday)}</span></button>
    <button type="button" class="card stat link-card" data-act="nav" data-v="bills">
      <span class="muted small">Bills to pay</span><span class="big-sm">${D.money(due.reduce((n, r) => n + r.expected, 0))}</span>
      <span class="small muted">${rows.length ? (next ? `Next: ${esc(next.bill.name)} ${D.shortDate(next.due)}` : `All ${rows.length} paid`) : 'Add your bills'}</span></button>
  </section>`;
}

// ======================= Phase 4: pots =======================
const potById = (id) => S.pots.find((p) => p.id === id);
const livePots = () => S.pots.filter((p) => !p.archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
const POT_STATE = { done: ['ok', 'Done'], ontrack: ['ok', 'On track'], behind: ['soon', 'Add this month'], late: ['warn', 'Past its date'], open: ['', ''] };
const POT_BODY = 'M24 13 h16 v5 c10 4 16 12 16 22 c0 12 -10 19 -24 19 c-14 0 -24 -7 -24 -19 c0 -10 6 -18 16 -22 z';

// A clay kudukka that fills from the bottom.
function potSVG(pct, size, uid) {
  // A little money always shows a little clay colour, so a started pot never looks empty.
  const fill = pct > 0 ? Math.max(0.08, Math.min(1, pct)) : 0;
  const y = 59 - 44 * fill;
  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">
    <defs><clipPath id="pc-${uid}"><path d="${POT_BODY}"/></clipPath></defs>
    <path d="${POT_BODY}" fill="var(--cream-2)"/>
    <rect x="0" y="${y.toFixed(1)}" width="64" height="${(64 - y).toFixed(1)}" fill="var(--rust)" clip-path="url(#pc-${uid})"/>
    <path d="${POT_BODY}" fill="none" stroke="var(--rosewood)" stroke-width="1.2" opacity="0.45"/>
    <rect x="22" y="12" width="20" height="3.5" rx="1.75" fill="var(--rosewood)"/>
    <rect x="27" y="22" width="10" height="2.4" rx="1.2" fill="var(--ink)"/>
  </svg>`;
}

function potLine(st) {
  if (st.state === 'done') return 'Target reached';
  if (st.state === 'late') return `Its month has passed · ${D.money(st.left)} to go`;
  if (st.monthly) return `${D.money(st.monthly)} a month · ${st.monthsLeft} ${st.monthsLeft === 1 ? 'month' : 'months'} left`;
  return st.target ? `${D.money(st.left)} to go` : 'No target, just saving';
}

function potCard(p) {
  const st = D.potStatus(p, S.potMoves);
  const [cls, label] = POT_STATE[st.state];
  return `<button type="button" class="card pot-card" data-act="open-pot" data-id="${p.id}">
    <span class="pot-art">${potSVG(st.pct, 58, `c${p.id}`)}</span>
    <span class="entry-main"><span class="row-between"><span class="entry-title">${esc(p.name)}</span>${label ? `<span class="pill-chip ${cls}">${label}</span>` : ''}</span>
      <span class="pot-amt"><b>${D.money(st.saved)}</b>${st.target ? ` <span class="muted small">of ${D.money(st.target)}</span>` : ''}</span>
      <span class="entry-sub">${potLine(st)}${p.byMonth ? ` · by ${D.monthShort(p.byMonth)}` : ''}</span></span>
  </button>`;
}

function viewPots() {
  const pots = livePots();
  const total = pots.reduce((n, p) => n + D.potBalance(p, S.potMoves), 0);
  const accs = D.potAccounts(S.pots, S.potMoves, S.accounts, S.txns);
  const archived = S.pots.filter((p) => p.archived);
  const hasYearly = liveBills().some((b) => b.freq === 'yearly') && !pots.some((p) => p.preset === 'yearly');
  const hasEmergency = !pots.some((p) => p.preset === 'emergency');
  return `${subhead('Pots', 'more')}
    <p class="muted small pad">Optional. Set money aside for things you plan ahead, like the US trip or yearly bills. Kudukka works the same without them.</p>
    ${pots.length ? `<section class="card stat"><span class="muted small">Set aside in pots</span><span class="big-sm">${D.money(total)}</span><span class="small muted">${pots.length} ${pots.length === 1 ? 'pot' : 'pots'}</span></section>`
      : `<section class="card welcome-card"><div class="pot-md">${potSVG(0.35, 84, 'empty')}</div><p class="muted">No pots yet. Start one for a holiday, an emergency fund or yearly bills.</p></section>`}
    ${pots.map(potCard).join('')}
    <div class="chips">
      ${hasEmergency ? `<button type="button" class="chip" data-act="add-pot" data-preset="emergency">${icon('shield', 16)} Emergency fund</button>` : ''}
      ${hasYearly ? `<button type="button" class="chip" data-act="add-pot" data-preset="yearly">${icon('bills', 16)} Yearly bills</button>` : ''}
      <button type="button" class="chip" data-act="add-pot" data-preset="">${icon('plus', 16)} New pot</button>
    </div>
    ${accs.length ? `<h3 class="day">Where the money is</h3><ul class="entries card tight wrap">${accs.map((x) => `<li><div class="entry">
      <span class="gicon" style="background:${D.PEOPLE[x.account.owner].color};color:${D.PEOPLE[x.account.owner].ink}">${icon('bank', 18)}</span>
      <span class="entry-main"><span class="entry-title">${esc(x.account.name)}</span><span class="entry-sub">${D.money(x.balance)} in the account · ${D.money(x.inPots)} in pots</span></span>
      <span class="entry-amt ${x.free < 0 ? 'neg' : ''}"><span class="small muted block">${x.free < 0 ? 'Short' : 'Not in a pot'}</span>${D.money(Math.abs(x.free))}</span></div></li>`).join('')}</ul>` : ''}
    ${archived.length ? `<h3 class="day">Finished or stopped</h3>${archived.map(potCard).join('')}` : ''}`;
}

function viewPot() {
  const p = potById(S.viewArg);
  if (!p) return `${subhead('Pot', 'pots')}<p class="muted pad">This pot has been removed.</p>`;
  const st = D.potStatus(p, S.potMoves);
  const hist = D.potMoves(p, S.potMoves);
  const acc = accountById(p.accountId);
  const [cls, label] = POT_STATE[st.state];
  return `${subhead(p.name, 'pots')}
    <section class="card pot-hero">
      <div class="pot-big">${potSVG(st.pct, 128, 'hero')}</div>
      <span class="big" style="color:var(--rust)">${D.money(st.saved)}</span>
      ${st.target ? `<span class="muted">of ${D.money(st.target)} · ${Math.round(st.pct * 100)}%</span>` : ''}
      ${label ? `<span class="pill-chip ${cls}">${label}</span>` : ''}
      <span class="small muted">${potLine(st)}${p.byMonth ? ` · by ${D.monthLabel(p.byMonth)}` : ''}</span>
      ${st.monthly ? `<span class="small muted">This month: ${D.money(Math.max(0, st.thisMonth))} of ${D.money(st.monthly)}</span>` : ''}
      ${acc ? `<span class="small muted">${icon('bank', 12)} Kept in ${esc(acc.name)}</span>` : ''}
      <div class="btn-row">${p.archived ? '' : `<button type="button" class="btn btn-primary grow" data-act="pot-move" data-dir="add">${icon('plus', 18)} Add money</button>`}
        <button type="button" class="btn btn-ghost grow" data-act="pot-move" data-dir="take">${icon('minus', 18)} Take out</button></div>
    </section>
    <h3 class="day">History</h3>
    ${hist.length ? `<ul class="entries card tight">${hist.map((m) => `<li><button type="button" class="entry" data-act="edit-pot-move" data-id="${m.id}">
      <span class="gicon" style="background:${m.amount >= 0 ? 'var(--olive)' : 'var(--quiet)'}">${icon(m.amount >= 0 ? 'plus' : 'minus', 16)}</span>
      <span class="entry-main"><span class="entry-title">${esc(m.note || (m.amount >= 0 ? 'Added' : 'Taken out'))}</span><span class="entry-sub">${D.dayLabel(m.date)} ${m.date.slice(0, 4)}${D.PEOPLE[m.createdBy] ? ` · ${D.PEOPLE[m.createdBy].name}` : ''}</span></span>
      <span class="entry-amt ${m.amount >= 0 ? 'pos' : 'quiet'}">${m.amount >= 0 ? '+' : '−'}${D.money(Math.abs(m.amount))}</span></button></li>`).join('')}</ul>`
      : '<p class="muted pad">Nothing added yet. Tap Add money when you move money for this goal.</p>'}
    <button type="button" class="btn btn-ghost btn-block" data-act="edit-pot" data-id="${p.id}">${icon('edit', 18)} Edit pot</button>`;
}

// Home: a small row of pots (only when there are some).
function potsCard() {
  if (S.person !== 'home') return '';
  const pots = livePots();
  if (!pots.length) return '';
  const total = pots.reduce((n, p) => n + D.potBalance(p, S.potMoves), 0);
  return `<button type="button" class="card pots-strip" data-act="nav" data-v="pots">
    <span class="row-between"><span class="h3">Pots</span><b>${D.money(total)}</b></span>
    <span class="pot-row">${pots.slice(0, 4).map((p) => { const st = D.potStatus(p, S.potMoves); return `<span class="pot-mini">${potSVG(st.pct, 44, `h${p.id}`)}<span class="small">${esc(p.name)}</span><span class="small muted">${st.target ? `${Math.round(st.pct * 100)}%` : D.money(st.saved)}</span></span>`; }).join('')}</span>
  </button>`;
}

// ======================= Phase 4: reports =======================
const NEEDS_C = '#6E5A4E';
const WANTS_C = '#C98B6B';
const pctText = (x) => `${Math.round(x * 100)}%`;

function changeLine(now, before, goodWhenUp) {
  if (!before) return '';
  const d = now - before;
  if (!d) return '<span class="small muted">Same as the month before</span>';
  const up = d > 0;
  return `<span class="small ${up === goodWhenUp ? 'ok-text' : 'warn-text'}">${up ? '▲' : '▼'} ${D.money(Math.abs(d))} vs the month before</span>`;
}

function fiftyCard(needs, wants, income) {
  if (!(needs + wants) && !income) return '';
  const saved = income - needs - wants;
  const base = Math.max(income, needs + wants) || 1;
  const seg = (v, c) => (v > 0 ? `<span style="width:${(v / base) * 100}%;background:${c}"></span>` : '');
  const row = (label, v, aim, c) => `<li><span class="leg-label"><span class="odot" style="background:${c}"></span>${label}</span><span class="small muted">${income > 0 ? `${pctText(v / income)} · aim ${aim}` : ''}</span><b>${D.money(v)}</b></li>`;
  return `<section class="card"><h2 class="h3">Needs, wants and saved</h2>
    <div class="bar money-bar">${seg(needs, NEEDS_C)}${seg(wants, WANTS_C)}${seg(saved, 'var(--olive)')}</div>
    <ul class="calc-list split">${row('Needs', needs, '50%', NEEDS_C)}${row('Wants', wants, '30%', WANTS_C)}${income > 0 ? row(saved >= 0 ? 'Saved' : 'Overspent', Math.abs(saved), '20%', saved >= 0 ? 'var(--olive)' : 'var(--danger)') : ''}</ul>
    <p class="small muted">A common UK guide is 50/30/20 of what comes in; many households need nearer 60/20/20. Choose what counts as a need in Categories.</p></section>`;
}

function catRows(byGroup, avg) {
  const groups = Object.entries(byGroup).map(([id, amt]) => ({ g: D.groupById(id) || D.groupById('other'), amt })).sort((a, b) => b.amt - a.amt);
  const max = groups.length ? groups[0].amt : 1;
  return groups.map(({ g, amt }) => {
    const a = avg && avg[g.id];
    const d = a ? amt - a : 0;
    const note = a && Math.abs(d) >= Math.max(1000, a * 0.15) ? `<span class="small ${d > 0 ? 'warn-text' : 'ok-text'}">${d > 0 ? '▲' : '▼'} ${D.money(Math.abs(d))} vs usual</span>` : '';
    return `<button type="button" class="grp grp-btn" data-act="report-group" data-id="${g.id}">
      <span class="gicon" style="background:${g.color}">${icon(g.icon, 18)}</span>
      <span class="grp-main"><span class="row-between"><span>${esc(g.name)}</span><b>${D.money(amt)}</b></span>
      <span class="bar thin full"><span style="width:${(amt / max) * 100}%;background:${g.color}"></span></span>${note}</span></button>`;
  }).join('');
}

function reportMonthView() {
  const R = S.report;
  const r = D.monthReport(S.txns, S.accounts, R.month, S.person, S.trips);
  const closed = D.isClosed(S.months, R.month);
  const nav = `<div class="win-nav">
    <button type="button" class="icon-btn" data-act="report-step" data-d="-1" aria-label="Month before">${icon('left', 20)}</button>
    <div class="win-title"><b>${D.monthLabel(R.month)}</b><span class="muted small">${r.count} ${r.count === 1 ? 'entry' : 'entries'}${closed ? ' · closed' : ''}</span></div>
    <button type="button" class="icon-btn" data-act="report-step" data-d="1" ${R.month >= D.currentMonth() ? 'disabled' : ''} aria-label="Month after">${icon('right', 20)}</button></div>`;
  if (!r.count) return `${nav}<section class="card"><p class="muted">Nothing entered for ${D.monthLabel(R.month)}.</p></section>`;
  const tight = (list, row) => (list.length ? `<ul class="entries card tight wrap">${list.map(row).join('')}</ul>` : '');
  return `${nav}
    <section class="card hero">
      <span class="muted small">Left over</span>
      <span class="big" style="color:${r.left >= 0 ? 'var(--olive)' : 'var(--danger)'}">${D.money(r.left)}</span>
      ${r.savedRate !== null ? `<span class="small muted">${r.left >= 0 ? `Kept ${pctText(r.savedRate)} of what came in` : 'More went out than came in'}</span>` : ''}
      <div class="row-between"><span>Came in</span><b>${D.money(r.income)}</b></div>${changeLine(r.income, r.prev.income, true)}
      <div class="row-between"><span>Went out</span><b>${D.money(r.spend)}</b></div>${changeLine(r.spend, r.prev.spend, false)}
    </section>
    ${fiftyCard(r.needs, r.wants, r.income)}
    ${r.spend ? `<section class="card"><h2 class="h3">By category</h2>${catRows(r.byGroup, r.avgByGroup)}
      ${r.avgMonths ? `<p class="small muted">"Usual" is the average of the ${r.avgMonths === 1 ? 'month' : `${r.avgMonths} months`} before.</p>` : ''}</section>` : ''}
    ${S.person === 'home' && r.spend ? `<section class="card"><h2 class="h3">Who spent</h2>${splitBar(r.spendBy, r.spend)}
      <div class="legend">${['sree', 'sha', 'joint'].filter((k) => r.spendBy[k]).map((k) => `<span>${ownerDot(k)}${D.PEOPLE[k].name} ${D.money(r.spendBy[k])}</span>`).join('')}</div></section>` : ''}
    ${r.byAccount.length ? `<h3 class="day">By account and card</h3>${tight(r.byAccount, (x) => `<li><div class="entry"><span class="gicon" style="background:${D.PEOPLE[x.account.owner].color};color:${D.PEOPLE[x.account.owner].ink}">${icon(D.isDebt(x.account) ? 'card' : 'bank', 18)}</span><span class="entry-main"><span class="entry-title">${esc(x.account.name)}</span></span><span class="entry-amt">${D.money(x.amount)}</span></div></li>`)}` : ''}
    ${r.topShops.length ? `<h3 class="day">Top shops</h3>${tight(r.topShops, (x) => `<li><div class="entry"><span class="entry-main"><span class="entry-title">${esc(x.name)}</span><span class="entry-sub">${x.count} ${x.count === 1 ? 'time' : 'times'}</span></span><span class="entry-amt">${D.money(x.amount)}</span></div></li>`)}` : ''}
    ${r.trips.length ? `<h3 class="day">Trips</h3>${tight(r.trips, (x) => `<li><button type="button" class="entry" data-act="open-trip" data-id="${x.trip.id}"><span class="gicon" style="background:var(--travel)">${icon('travel', 18)}</span><span class="entry-main"><span class="entry-title">${esc(x.trip.name)}</span></span><span class="entry-amt">${D.money(x.amount)}</span></button></li>`)}` : ''}
    ${!closed && R.month < D.currentMonth() && S.person === 'home' ? `<button type="button" class="btn btn-ghost btn-block" data-act="open-close" data-m="${R.month}">${icon('check', 18)} Close ${monthName(R.month)}</button>` : ''}`;
}

function reportYearView() {
  const R = S.report;
  const y = D.yearReport(S.txns, S.accounts, R.year, S.person, S.trips);
  const nowYear = Number(D.currentMonth().slice(0, 4));
  const nav = `<div class="win-nav">
    <button type="button" class="icon-btn" data-act="report-year" data-d="-1" aria-label="Year before">${icon('left', 20)}</button>
    <div class="win-title"><b>${R.year}</b><span class="muted small">${y.activeMonths} ${y.activeMonths === 1 ? 'month' : 'months'} with entries</span></div>
    <button type="button" class="icon-btn" data-act="report-year" data-d="1" ${R.year >= nowYear ? 'disabled' : ''} aria-label="Year after">${icon('right', 20)}</button></div>`;
  if (!y.activeMonths) return `${nav}<section class="card"><p class="muted">Nothing entered for ${R.year}.</p></section>`;
  const max = Math.max(1, ...y.months.map((m) => Math.max(m.income, m.spend)));
  const cols = y.months.map((m) => `<button type="button" class="ycol" data-act="report-month" data-m="${m.month}" aria-label="${D.monthLabel(m.month)}: in ${D.money(m.income)}, out ${D.money(m.spend)}">
    <span class="ybars"><span class="ybar in" style="height:${(m.income / max) * 100}%"></span><span class="ybar out" style="height:${(m.spend / max) * 100}%"></span></span>
    <span class="ylab">${D.monthLabel(m.month).charAt(0)}</span></button>`).join('');
  return `${nav}
    <section class="card hero">
      <span class="muted small">Left over in ${R.year}</span>
      <span class="big" style="color:${y.left >= 0 ? 'var(--olive)' : 'var(--danger)'}">${D.money(y.left)}</span>
      ${y.savedRate !== null ? `<span class="small muted">Savings rate ${pctText(Math.max(0, y.savedRate))}</span>` : ''}
      <div class="row-between"><span>Came in</span><b>${D.money(y.income)}</b></div>
      <div class="row-between"><span>Went out</span><b>${D.money(y.spend)}</b></div>
      <div class="row-between"><span>Usual month's spending</span><b>${D.money(y.avgSpend)}</b></div>
    </section>
    <section class="card"><h2 class="h3">Month by month</h2>
      <div class="ychart">${cols}</div>
      <div class="legend"><span><span class="odot" style="background:var(--olive)"></span>Came in</span><span><span class="odot" style="background:var(--rust)"></span>Went out</span><span>Tap a month to open it</span></div>
    </section>
    ${fiftyCard(y.needs, y.wants, y.income)}
    ${y.spend ? `<section class="card"><h2 class="h3">By category</h2>${catRows(y.byGroup)}</section>` : ''}
    ${y.trips.length ? `<h3 class="day">Trips in ${R.year}</h3><ul class="entries card tight wrap">${y.trips.map((x) => `<li><button type="button" class="entry" data-act="open-trip" data-id="${x.trip.id}"><span class="gicon" style="background:var(--travel)">${icon('travel', 18)}</span><span class="entry-main"><span class="entry-title">${esc(x.trip.name)}</span></span><span class="entry-amt">${D.money(x.amount)}</span></button></li>`).join('')}</ul>` : ''}`;
}

function viewReports() {
  const R = S.report;
  if (!R.month) R.month = S.month;
  if (!R.year) R.year = Number(R.month.slice(0, 4));
  return `${subhead('Reports', 'more')}${personSwitch()}
    <div class="segs two" role="group" aria-label="Report"><button type="button" class="seg${R.mode === 'month' ? ' on' : ''}" data-act="report-mode" data-m="month">Month</button><button type="button" class="seg${R.mode === 'year' ? ' on' : ''}" data-act="report-mode" data-m="year">Year</button></div>
    ${R.mode === 'year' ? reportYearView() : reportMonthView()}`;
}

// ======================= Phase 4: close the month =======================
function closeCard() {
  if (S.person !== 'home') return '';
  const m = D.shiftMonth(D.currentMonth(), -1);
  if (D.isClosed(S.months, m) || !S.txns.some((t) => t.month === m)) return '';
  return `<button type="button" class="card flag-card close-card" data-act="open-close" data-m="${m}">
    <span class="gicon" style="background:var(--olive)">${icon('check', 18)}</span>
    <span class="entry-main"><span class="entry-title">Close ${monthName(m)}</span><span class="entry-sub">Check balances, sort the last few, see the report</span></span>${icon('right', 18)}</button>`;
}

function stepCard(n, done, title, body) {
  return `<section class="card step-card${done ? ' is-done' : ''}">
    <div class="step-head"><span class="step-num">${done ? icon('check', 16) : n}</span><h2 class="h3">${title}</h2></div>${body}</section>`;
}

function viewClose() {
  const m = S.viewArg || D.shiftMonth(D.currentMonth(), -1);
  const doc = S.months[m] || {};
  const c = D.closeChecks({ month: m, txns: S.txns, accounts: S.accounts, bills: S.bills, closing: doc });
  const choices = [-3, -2, -1, 0].map((k) => D.shiftMonth(D.currentMonth(), k));
  if (!choices.includes(m)) choices.unshift(m);
  const picker = `<div class="chips">${choices.map((x) => `<button type="button" class="chip${x === m ? ' on' : ''}" data-act="open-close" data-m="${x}">${D.monthShort(x)}${D.isClosed(S.months, x) ? ` ${icon('check', 14)}` : ''}</button>`).join('')}</div>`;
  if (doc.closed) {
    return `${subhead('Close the month', 'more')}${picker}
      <section class="card welcome-card sealed"><span class="seal">${icon('check', 30)}</span><h2 class="h2">${D.monthLabel(m)} is closed</h2>
        <p class="muted">Closed${doc.closedAt ? ` on ${D.dayLabel(doc.closedAt)}` : ''}${D.PEOPLE[doc.closedBy] ? ` by ${D.PEOPLE[doc.closedBy].name}` : ''}. Entries in this month are locked so the numbers stay as they were.</p>
        <button type="button" class="btn btn-primary btn-block" data-act="report-month" data-m="${m}">${icon('chart', 18)} See the report</button>
        <button type="button" class="btn btn-ghost btn-block" data-act="reopen-month" data-m="${m}">Reopen ${monthName(m)}</button></section>`;
  }
  const accRow = (x) => {
    const draft = S.closeDraft[x.account.id] ?? (x.bank !== null ? poundsText(x.bank) : '');
    const res = x.diff === null ? '' : x.diff === 0 ? `<span class="ok">${icon('check', 14)} Matches</span>`
      : `<span class="small warn-text">Off by ${D.money(Math.abs(x.diff))}</span><button type="button" class="btn btn-ghost btn-sm" data-act="close-adjust" data-id="${x.account.id}" data-m="${m}">Add a ${D.money(Math.abs(x.diff))} adjustment</button>`;
    return `<li class="chk-row"><div class="row-between"><span class="entry-title">${ownerDot(x.account.owner)}${esc(x.account.name)}</span><span class="small muted">Kudukka: <b>${D.money(x.shown)}</b>${D.isDebt(x.account) ? ' owed' : ''}</span></div>
      <div class="chk-input"><div class="amount-wrap small"><span class="pound">£</span><input name="chk:${x.account.id}" class="input bare" inputmode="decimal" placeholder="${D.isDebt(x.account) ? `Owed on ${D.shortDate(c.end)}` : `Balance on ${D.shortDate(c.end)}`}" value="${esc(draft)}" aria-label="${esc(x.account.name)}: bank balance on ${D.shortDate(c.end)}"></div>${res}</div></li>`;
  };
  const allMatch = !c.accounts.length || c.checked === c.accounts.length;
  return `${subhead('Close the month', 'more')}${picker}
    <p class="muted small pad">Five short steps for ${D.monthLabel(m)}. Nothing here is required; do what helps.</p>
    ${stepCard(1, allMatch, 'Check balances with the bank', `<p class="small muted">Type what each bank app shows for the end of ${monthName(m)} (${D.shortDate(c.end)}). Use the statement or scroll back in the app.</p>
      ${c.accounts.length ? `<ul class="chk-list">${c.accounts.map(accRow).join('')}</ul>
      <button type="button" class="btn btn-primary btn-sm" data-act="save-checks" data-m="${m}">Check</button>` : `<span class="small muted">No accounts started before the end of ${monthName(m)}: their opening balances begin later, so there's nothing to check.</span>`}`)}
    ${stepCard(2, !c.flagged.length && !c.unsorted.length, 'Sort out the last few', `${c.flagged.length ? `<div class="row-between"><span>${c.flagged.length} with an Ask flag</span><button type="button" class="link" data-act="close-show" data-k="flagged" data-m="${m}">Show</button></div>` : ''}
      ${c.unsorted.length ? `<div class="row-between"><span>${c.unsorted.length} in Other → General</span><button type="button" class="link" data-act="close-show" data-k="other" data-m="${m}">Show</button></div>` : ''}
      ${!c.flagged.length && !c.unsorted.length ? '<span class="ok-text small">Nothing to sort.</span>' : ''}`)}
    ${stepCard(3, !c.unpaid.length, 'Bills', c.unpaid.length ? `<p class="small muted">Due in ${monthName(m)} with no payment entered:</p><ul class="entries tight-list">${c.unpaid.map((u) => `<li class="bill-li"><div class="entry"><span class="entry-main"><span class="entry-title">${esc(u.bill.name)}</span><span class="entry-sub">Due ${D.shortDate(u.due)}</span></span><span class="entry-amt">${D.money(u.expected)}</span></div><button type="button" class="paid-btn" data-act="pay-bill" data-id="${u.bill.id}" data-due="${u.due}">${icon('check', 16)} Paid</button></li>`).join('')}</ul>` : '<span class="ok-text small">Every bill has a payment.</span>')}
    ${stepCard(4, !!doc.reportSeen, 'Look at the report', `<button type="button" class="btn btn-ghost btn-sm" data-act="report-month" data-m="${m}" data-seen="1">${icon('chart', 16)} See ${monthName(m)}'s report</button>`)}
    ${stepCard(5, false, `Close ${monthName(m)}`, `<p class="small muted">Locks ${monthName(m)}'s entries so the numbers stay as they were. You can reopen it any time.</p>
      <button type="button" class="btn btn-primary btn-block" data-act="close-month" data-m="${m}">Close ${monthName(m)}</button>`)}`;
}

// ======================= Phase 5: import a bank statement =======================
function viewImport() {
  const I = S.imp;
  if (I && I.step === 'review') return importReview();
  if (I && I.step === 'done') return importDone();
  return importStart();
}

function importStart() {
  const I = S.imp || {};
  const accs = activeAccounts();
  return `${subhead('Import a statement', 'more')}
    <section class="card"><ol class="steps-list">
      <li>In your bank app or website, download a statement as a <b>CSV</b> file (look under Statements, Export or Download).</li>
      <li>Choose the account it's from, then the file.</li>
      <li>Check the list, then import. Anything already in Kudukka is skipped.</li></ol>
      <p class="small muted">${icon('lock', 12)} Only the date, shop name and amount are kept. Account numbers and sort codes are removed.</p></section>
    <div class="field"><span class="label">Statement from</span>${accs.length ? `<div class="chips">${accs.map((a) => `<button type="button" class="chip acc${I.accountId === a.id ? ' on' : ''}" data-act="imp-acc" data-id="${a.id}">${ownerDot(a.owner)}${esc(a.name)}</button>`).join('')}</div>` : '<p class="muted">Add an account first.</p>'}</div>
    <label class="btn btn-primary btn-block file-btn${I.accountId ? '' : ' is-off'}">${icon('upload', 18)} Choose CSV file
      <input type="file" id="imp-file" accept=".csv,text/csv,text/plain,application/vnd.ms-excel" ${I.accountId ? '' : 'disabled'}></label>
    ${I.accountId ? '' : '<p class="hint center">Choose the account first.</p>'}
    ${I.error ? `<p class="err">${esc(I.error)}</p>` : ''}`;
}

const IMP_GROUPS = [['ready', 'Ready to import'], ['needs', 'Needs a category'], ['transfer', 'Look like transfers'], ['duplicate', 'Already in Kudukka'], ['closed', 'In a closed month'], ['skip', 'Left out']];

function impRow(it) {
  const cat = D.categoryById(it.categoryId);
  const g = it.type === 'spend' && cat ? cat.group : null;
  const color = it.status === 'skip' ? 'var(--cream-2)' : it.type === 'spend' ? (g ? g.color : 'var(--cream-2)') : it.type === 'income' ? 'var(--olive)' : 'var(--quiet)';
  const ic = it.type === 'spend' ? (g ? g.icon : 'tag') : it.type === 'income' ? 'income' : it.type === 'transfer' ? 'transfer' : 'adjust';
  const other = accountById(it.dir === 'in' ? it.fromAccountId : it.toAccountId);
  const what = it.status === 'skip' ? 'Left out'
    : it.status === 'duplicate' || it.status === 'closed' ? it.why
      : it.type === 'transfer' ? (other ? `${it.dir === 'in' ? 'From' : 'To'} ${esc(other.name)}` : 'Transfer · tap to choose the account')
        : it.type === 'adjust' ? 'Refund' : cat ? esc(cat.name) : 'Tap to choose a category';
  const title = it.type === 'spend' ? it.shop : (it.note || it.raw || it.shop);
  const ready = CSV.itemReady(it);
  return `<li class="imp-li${it.include ? ' on' : ''}">
    <button type="button" class="imp-tick" data-act="imp-tick" data-k="${it.key}" aria-pressed="${it.include}" aria-label="Import ${esc(title)}" ${ready && it.status !== 'closed' ? '' : 'disabled'}>${it.include ? icon('check', 16) : ''}</button>
    <button type="button" class="entry" data-act="imp-edit" data-k="${it.key}"><span class="gicon" style="background:${color}">${icon(ic, 16)}</span>
      <span class="entry-main"><span class="entry-title">${esc(title)}</span><span class="entry-sub">${D.shortDate(it.date)} · ${what}</span></span>
      <span class="entry-amt ${it.dir === 'in' ? 'pos' : ''}">${it.dir === 'in' ? '+' : '−'}${D.money(it.amount)}</span></button></li>`;
}

function importMapFields() {
  const I = S.imp;
  const opts = (sel) => `<option value="-1">Not used</option>${I.map.header.map((h, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(h || `Column ${i + 1}`)}</option>`).join('')}`;
  const sel = (role, label) => `<label class="map-field"><span class="label">${label}</span><select class="input" data-imp-map="${role}">${opts(I.map[role])}</select></label>`;
  return `<div class="map-grid">${sel('date', 'Date')}${sel('desc', 'Shop or description')}${sel('amount', 'Amount (one column)')}${sel('out', 'Money out')}${sel('in', 'Money in')}</div>
    <div class="field"><span class="label">Dates are written</span><div class="segs two"><button type="button" class="seg${I.map.order !== 'mdy' ? ' on' : ''}" data-act="imp-order" data-o="dmy">Day first (UK)</button><button type="button" class="seg${I.map.order === 'mdy' ? ' on' : ''}" data-act="imp-order" data-o="mdy">Month first</button></div></div>
    ${I.map.amount >= 0 ? `<div class="field"><span class="label">Spending shows as</span><div class="segs two"><button type="button" class="seg${I.spendSign === 'minus' ? ' on' : ''}" data-act="imp-sign" data-s="minus">−12.50 (most banks)</button><button type="button" class="seg${I.spendSign === 'plus' ? ' on' : ''}" data-act="imp-sign" data-s="plus">12.50 (most cards)</button></div></div>` : ''}`;
}

function importReview() {
  const I = S.imp;
  const acc = accountById(I.accountId);
  const items = I.items || [];
  const count = items.filter((it) => it.include && CSV.itemReady(it)).length;
  const colName = (i) => (i >= 0 ? esc(I.map.header[i] || `Column ${i + 1}`) : '—');
  const groups = IMP_GROUPS.map(([k, title]) => [k, title, items.filter((it) => it.status === k)]).filter(([, , list]) => list.length);
  return `${subhead('Import a statement', 'more')}
    <section class="card map-card">
      <div class="row-between"><span class="entry-title">${icon('upload', 14)} ${esc(I.fileName)}</span><button type="button" class="link" data-act="imp-showmap">${I.showMap ? 'Done' : 'Columns'}</button></div>
      <span class="small muted">${acc ? `Into ${esc(acc.name)} · ` : ''}${items.length} ${items.length === 1 ? 'row' : 'rows'}</span>
      ${I.showMap ? importMapFields() : `<span class="small muted">Date: ${colName(I.map.date)} · Shop: ${colName(I.map.desc)} · ${I.map.amount >= 0 ? `Amount: ${colName(I.map.amount)}` : `Out: ${colName(I.map.out)} · In: ${colName(I.map.in)}`}</span>`}
      ${I.problems && I.problems.length ? `<span class="small warn-text">${I.problems.length} ${I.problems.length === 1 ? 'line' : 'lines'} couldn't be read (line ${I.problems.slice(0, 4).join(', ')}${I.problems.length > 4 ? '…' : ''}). If that's most of them, check Columns.</span>` : ''}
    </section>
    ${items.length ? `<div class="chips imp-summary">${groups.map(([k, title, list]) => `<a class="chip" href="#imp-${k}">${title.split(' ')[0] === 'Ready' ? 'Ready' : title} · ${list.length}</a>`).join('')}</div>` : '<section class="card"><p class="muted">No rows could be read. Tap Columns and check which column is which.</p></section>'}
    ${groups.map(([k, title, list]) => `<h3 class="day" id="imp-${k}">${title} (${list.length})</h3>
      ${k === 'needs' ? '<p class="small muted pad">Tap one to choose its category. Kudukka offers to use it for the same shop everywhere in the file.</p>' : ''}
      ${k === 'transfer' ? '<p class="small muted pad">Usually already entered from the other account. Tap one to add it as a transfer.</p>' : ''}
      <ul class="entries card tight imp-list">${list.map(impRow).join('')}</ul>`).join('')}
    <div class="imp-bar"><button type="button" class="btn btn-ghost" data-act="imp-cancel">Cancel</button>
      <button type="button" class="btn btn-primary grow" data-act="imp-go" ${count ? '' : 'disabled'}>Import ${count} ${count === 1 ? 'entry' : 'entries'}</button></div>`;
}

function importDone() {
  const I = S.imp;
  const acc = accountById(I.accountId);
  return `${subhead('Import a statement', 'more')}
    <section class="card welcome-card"><span class="seal">${icon('check', 30)}</span>
      <h2 class="h2">${I.imported} ${I.imported === 1 ? 'entry' : 'entries'} added</h2>
      <p class="muted">From ${esc(I.fileName)}${acc ? ` into ${esc(acc.name)}` : ''}.${I.left ? ` ${I.left} ${I.left === 1 ? 'row was' : 'rows were'} left out.` : ''}</p>
      <button type="button" class="btn btn-primary btn-block" data-act="imp-see">See entries</button>
      <button type="button" class="btn btn-ghost btn-block" data-act="imp-again">Import another file</button></section>`;
}

async function loadStatement(file) {
  const I = S.imp || {};
  const account = accountById(I.accountId);
  if (!file || !account) return;
  try {
    const text = await file.text();
    const rows = CSV.parseCSV(text);
    const map = CSV.detectColumns(rows);
    if (rows.length < 2 || map.date < 0) throw new Error('not a statement');
    const saved = LS.get(`imp.${account.id}`);
    const spendSign = (saved && saved.spendSign) || CSV.guessSpendSign(rows, map, account);
    const complete = map.desc >= 0 && (map.amount >= 0 || map.out >= 0 || map.in >= 0);
    S.imp = { accountId: account.id, step: 'review', fileName: file.name, rows, map, spendSign, showMap: !complete };
    rebuildImport();
  } catch (e) {
    S.imp = { accountId: account.id, step: 'start', error: "That file didn't open as a statement. Check it's the CSV download (not a PDF), then try again." };
  }
  window.scrollTo(0, 0);
  renderMain();
}

function rebuildImport() {
  const I = S.imp;
  const account = accountById(I.accountId);
  const read = CSV.readRows(I.rows, I.map, I.spendSign);
  I.problems = read.problems;
  I.items = CSV.buildImport(read, {
    account, accounts: S.accounts, txns: S.txns, bills: S.bills, shopIdx: D.shopIndex(S.txns),
    closedMonths: Object.keys(S.months).filter((m) => D.isClosed(S.months, m)), incomeCategory: incomeDefault(account.id),
  });
}

// ---------- trips ----------
function tripDates(t) {
  const f = (d) => `${Number(d.slice(8))} ${D.monthShort(d.slice(0, 7)).slice(0, 3)}`;
  if (!t.startDate) return '';
  const sameYear = t.startDate.slice(0, 4) === (t.endDate || '').slice(0, 4);
  return `${f(t.startDate)}${sameYear ? '' : ` ${t.startDate.slice(0, 4)}`} – ${t.endDate ? `${f(t.endDate)} ${t.endDate.slice(0, 4)}` : ''}`;
}
const STATUS_LABEL = { now: 'On now', upcoming: 'Coming up', past: 'Done' };

function tripRow(t) {
  const st = D.tripStats(t, S.txns, S.accounts);
  const pct = t.budget ? Math.min(100, (st.total / t.budget) * 100) : 0;
  return `<li><button type="button" class="entry col" data-act="open-trip" data-id="${t.id}">
    <span class="entry-top"><span class="gicon" style="background:var(--travel)">${icon('travel', 18)}</span>
      <span class="entry-main"><span class="entry-title">${esc(t.name)}${t.archived ? ' <span class="tag">Archived</span>' : ''}</span><span class="entry-sub">${tripDates(t)} · ${STATUS_LABEL[D.tripStatus(t)]}</span></span>
      <span class="entry-amt">${D.money(st.total)}</span></span>
    ${t.budget ? `<span class="bar thin full"><span style="width:${pct}%;background:${pct > 90 ? 'var(--warn)' : 'var(--travel)'}"></span></span><span class="entry-sub">${D.money(st.total)} of ${D.money(t.budget)} budget</span>` : ''}
  </button></li>`;
}

function viewTrips() {
  const live = activeTrips();
  const archived = S.trips.filter((t) => t.archived);
  return `${subhead('Trips', 'more')}
    <p class="muted small pad">Tag entries with a trip to see the whole holiday as one total. They still count in their monthly categories too.</p>
    ${live.length ? `<ul class="entries card tight">${live.map(tripRow).join('')}</ul>` : '<section class="card"><p class="muted">No trips yet. Add one for your next holiday.</p></section>'}
    <button type="button" class="btn btn-ghost btn-block" data-act="add-trip">${icon('plus', 18)} New trip</button>
    ${archived.length ? `<h3 class="day">Archived</h3><ul class="entries card tight">${archived.map(tripRow).join('')}</ul>` : ''}`;
}

function viewTrip() {
  const t = tripById(S.viewArg);
  if (!t) return `${subhead('Trip', 'trips')}<p class="muted pad">This trip has been removed.</p>`;
  const st = D.tripStats(t, S.txns, S.accounts);
  const pct = t.budget ? Math.min(100, (st.total / t.budget) * 100) : 0;
  const groups = Object.entries(st.byGroup).map(([id, amt]) => ({ g: D.groupById(id) || D.groupById('other'), amt })).sort((a, b) => b.amt - a.amt);
  const max = groups.length ? groups[0].amt : 0;
  return `${subhead(t.name, 'trips')}
    <section class="card hero">
      <span class="muted small">${tripDates(t)} · ${STATUS_LABEL[D.tripStatus(t)]}</span>
      <span class="big" style="color:var(--travel)">${D.money(st.total)}</span>
      ${t.budget ? `<div class="row-between"><span>Budget</span><b>${D.money(t.budget)}</b></div>
        <div class="bar"><div style="width:${pct}%;background:${pct > 90 ? 'var(--warn)' : 'var(--travel)'}"></div></div>
        <span class="small ${st.left < 0 ? 'neg-text' : 'muted'}">${st.left < 0 ? `${D.money(-st.left)} over budget` : `${D.money(st.left)} left`}</span>` : ''}
      <div class="row-between"><span>Who paid</span></div>${splitBar(st.spendBy, st.total)}
      <div class="legend"><span>${ownerDot('sree')}Sree</span><span>${ownerDot('sha')}Sha</span><span>${ownerDot('joint')}Joint</span></div>
    </section>
    <section class="card"><h2 class="h3">By category</h2>
      ${groups.length ? groups.map(({ g, amt }) => `<div class="grp">
        <span class="gicon" style="background:${g.color}">${icon(g.icon, 18)}</span>
        <div class="grp-main"><div class="row-between"><span>${esc(g.name)}</span><b>${D.money(amt)}</b></div>
        <div class="bar thin"><div style="width:${(amt / max) * 100}%;background:${g.color}"></div></div></div></div>`).join('') : '<p class="muted">No spending tagged with this trip yet. When you add an entry, tap the trip under "Trip".</p>'}
    </section>
    ${st.entries.length ? dayGroups(st.entries, true) : ''}
    <button type="button" class="btn btn-ghost btn-block" data-act="edit-trip" data-id="${t.id}">${icon('edit', 18)} Edit trip</button>`;
}

// ---------- categories ----------
function viewCategories() {
  const groups = D.spendGroups(true);
  const incomes = D.incomeSources(true);
  return `${subhead('Categories and income', 'more')}
    <h3 class="day">Spending</h3>
    <ul class="entries card tight">${groups.map((g) => `<li><button type="button" class="entry" data-act="edit-group" data-id="${g.id}">
      <span class="gicon" style="background:${g.color}">${icon(g.icon, 18)}</span>
      <span class="entry-main"><span class="entry-title">${esc(g.name)}${g.hidden ? ' <span class="tag">Hidden</span>' : ''}</span><span class="entry-sub">${esc(D.visibleSubs(g).map((s) => s.name).join(', ') || 'No subcategories')}</span></span>${icon('right', 18)}
    </button></li>`).join('')}</ul>
    <button type="button" class="btn btn-ghost btn-block" data-act="add-group">${icon('plus', 18)} New category group</button>
    <h3 class="day">Income sources</h3>
    <p class="muted small pad">Add one for each job, so you can see where money comes from.</p>
    <ul class="entries card tight">${incomes.map((s) => `<li><button type="button" class="entry" data-act="edit-income" data-id="${s.id}">
      <span class="gicon" style="background:var(--olive)">${icon('income', 18)}</span>
      <span class="entry-main"><span class="entry-title">${esc(s.name)}${s.hidden ? ' <span class="tag">Hidden</span>' : ''}</span></span>${icon('right', 18)}
    </button></li>`).join('')}</ul>
    <button type="button" class="btn btn-ghost btn-block" data-act="add-income">${icon('plus', 18)} New income source</button>`;
}

function renderNav() {
  const nav = $('#nav');
  if (!nav) return;
  const inner = ['trips', 'trip', 'categories', 'bills', 'plan', 'pots', 'pot', 'reports', 'close', 'import'];
  const tab = inner.includes(S.view) ? (S.backTo === 'home' && !['trips', 'trip', 'categories'].includes(S.view) ? 'home' : 'more') : S.view;
  const b = (v, ic, label) => `<button type="button" class="nav-btn${tab === v ? ' on' : ''}" data-act="nav" data-v="${v}" ${tab === v ? 'aria-current="page"' : ''}>${icon(ic, 24)}<span>${label}</span></button>`;
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
  const sheets = { entry: sheetEntry, account: sheetAccount, month: sheetMonth, filters: sheetFilters, trip: sheetTrip, group: sheetGroup, income: sheetIncome, bill: sheetBill, payday: sheetPayday, expected: sheetExpected, pot: sheetPot, potmove: sheetPotMove, improw: sheetImpRow };
  const body = (sheets[S.sheet] || sheetMonth)();
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
    shop: '', tripId: '', flag: false, flagFor: '', flagNote: '', billId: '',
    templates: D.recentTemplates(S.txns, 6), shopIdx: D.shopIndex(S.txns),
  };
  if (type === 'income') f.categoryId = incomeDefault(accountId);
  return f;
}
const poundsText = (p) => (Math.abs(p || 0) / 100).toFixed(2).replace(/\.00$/, '');
function incomeDefault(accountId) {
  const a = accountById(accountId);
  const visible = D.incomeSources().map((s) => s.id);
  const pick = a && a.owner === 'sree' ? 'income.sree' : a && a.owner === 'sha' ? 'income.sha' : 'income.other';
  return visible.includes(pick) ? pick : visible[0] || '';
}
function applyTemplate(f, tpl) {
  f.type = tpl.type;
  f.amountText = poundsText(tpl.amount);
  if (activeAccounts().some((a) => a.id === tpl.accountId)) f.accountId = tpl.accountId;
  const cat = D.categoryById(tpl.categoryId);
  if (cat && !cat.hidden) { f.categoryId = tpl.categoryId; f.groupId = cat.group ? cat.group.id : ''; }
  else if (tpl.type === 'income') f.categoryId = incomeDefault(f.accountId);
  f.shop = tpl.shop || '';
  return f;
}
function editEntryForm(t) {
  const g = D.groupOf(t.categoryId);
  return {
    isNew: false, id: t.id, type: t.type,
    amountText: t.calc || poundsText(t.amount),
    accountId: t.accountId || '', toAccountId: t.toAccountId || '',
    groupId: g ? g.id : '', categoryId: t.categoryId || '', date: t.date, note: t.note || '',
    adjSign: t.amount < 0 ? '-' : '+', original: t,
    shop: t.shop || '', tripId: t.tripId || '', flag: !!t.flag, flagFor: t.flagFor || '', flagNote: t.flagNote || '', billId: t.billId || '',
    templates: [], shopIdx: D.shopIndex(S.txns),
  };
}

function shopSuggestions() {
  const f = S.form;
  const typed = D.shopKey(f.shop);
  const list = D.matchShops(f.shopIdx || new Map(), f.shop, 5).filter((m) => D.shopKey(m.shop) !== typed || !f.shopApplied);
  if (!list.length) return '';
  return list.map((m) => {
    const cat = D.categoryById(m.categoryId);
    return `<button type="button" class="chip sugg" data-act="pick-shop" data-k="${esc(D.shopKey(m.shop))}">${esc(m.shop)}${cat ? `<span class="muted small">${esc(cat.name)}</span>` : ''}</button>`;
  }).join('');
}

function tripChips() {
  const f = S.form;
  const trips = activeTrips();
  const current = f.tripId && !trips.some((t) => t.id === f.tripId) ? [tripById(f.tripId)].filter(Boolean) : [];
  const all = [...current, ...trips];
  if (!all.length) return '';
  const onDate = D.tripsOnDate(trips, f.date || '').map((t) => t.id);
  const ordered = [...all.filter((t) => onDate.includes(t.id)), ...all.filter((t) => !onDate.includes(t.id))].slice(0, 6);
  return `<div class="field"><span class="label">Trip</span><div class="chips">
    <button type="button" class="chip${!f.tripId ? ' on' : ''}" data-act="pick-trip" data-id="">None</button>
    ${ordered.map((t) => {
      const suggest = !f.tripId && onDate.includes(t.id);
      return `<button type="button" class="chip${f.tripId === t.id ? ' on' : ''}${suggest ? ' suggest' : ''}" data-act="pick-trip" data-id="${t.id}">${icon('travel', 14)}${esc(t.name)}${suggest ? '?' : ''}</button>`;
    }).join('')}</div></div>`;
}

function flagBlock() {
  const f = S.form;
  const who = D.PEOPLE[f.flagFor || otherRole()].name;
  return `<div class="field">
    <button type="button" class="toggle-row" data-act="toggle-flag" aria-pressed="${f.flag}">
      <span class="gicon ${f.flag ? 'warn' : 'plain'}">${icon('flag', 16)}</span>
      <span class="entry-main"><span class="entry-title">Ask ${who} about this</span><span class="entry-sub">${f.flag ? 'Shows on Home until it’s sorted' : 'Flag it to check later'}</span></span>
      <span class="switch${f.flag ? ' on' : ''}" aria-hidden="true"></span>
    </button>
    ${f.flag ? `<input name="flagNote" class="input" maxlength="80" placeholder="What to ask, e.g. what was this for?" value="${esc(f.flagNote)}" aria-label="Question for ${who}">` : ''}
  </div>`;
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
    const g = D.groupById(f.groupId);
    const groups = D.spendGroups().concat(g && g.hidden ? [g] : []);
    const subs = g ? g.subs.filter((s) => !s.hidden || s.id === f.categoryId) : [];
    catBlock = `<div class="field"><span class="label">Category</span>
      <div class="chips">${groups.map((x) => `<button type="button" class="chip grp-chip${f.groupId === x.id ? ' on' : ''}" style="--c:${x.color}" data-act="pick-group" data-id="${x.id}">${icon(x.icon, 16)}${esc(x.name)}</button>`).join('')}</div>
      ${g ? `<div class="chips sub">${subs.map((s) => `<button type="button" class="chip${f.categoryId === s.id ? ' on' : ''}" data-act="pick-cat" data-id="${s.id}">${esc(s.name)}</button>`).join('')}</div>` : ''}
      ${err('categoryId')}</div>`;
  } else if (f.type === 'income') {
    const cur = D.categoryById(f.categoryId);
    const sources = D.incomeSources().concat(cur && cur.hidden ? [cur] : []);
    catBlock = `<div class="field"><span class="label">Income from</span>
      <div class="chips">${sources.map((x) => `<button type="button" class="chip${f.categoryId === x.id ? ' on' : ''}" data-act="pick-cat" data-id="${x.id}">${esc(x.name)}</button>`).join('')}</div>${err('categoryId')}</div>`;
  }
  const quick = f.isNew && f.templates && f.templates.length
    ? `<div class="field"><span class="label">${icon('repeat', 14)} Repeat a recent one</span><div class="chips scroll">${f.templates.map((tp, i) => {
      const cat = D.categoryById(tp.categoryId);
      return `<button type="button" class="chip quick" data-act="quick" data-i="${i}">${esc(tp.shop || (cat ? cat.name : D.ENTRY_TYPES[tp.type]))}<span class="small muted">${D.money(tp.amount)}</span></button>`;
    }).join('')}</div></div>`
    : '';
  const shopField = f.type === 'spend'
    ? `<div class="field"><label class="label" for="f-shop">Shop or payee</label>
      <input id="f-shop" name="shop" class="input" maxlength="40" autocomplete="off" placeholder="e.g. Tesco" value="${esc(f.shop)}">
      <div class="chips" id="shop-sugg">${shopSuggestions()}</div></div>`
    : '';
  const fromLabel = f.type === 'transfer' ? 'From' : f.type === 'income' ? 'Paid into' : f.type === 'adjust' ? 'Account to correct' : 'Paid with';
  const outside = f.date && D.monthOf(f.date) !== S.month ? `<p class="note-warn">This saves into ${D.monthLabel(D.monthOf(f.date))}, not your working month.</p>` : '';
  return `<div class="sheet-head"><h2 class="h2" id="sheet-title">${f.isNew ? 'New entry' : 'Edit entry'}</h2><button type="button" class="icon-btn" data-act="sheet-close" aria-label="Close">${icon('x', 22)}</button></div>
    <div class="segs four" role="group" aria-label="Type of entry">${types}</div>
    ${quick}
    ${f.type === 'adjust' ? `<div class="segs two" role="group" aria-label="Direction"><button type="button" class="seg${f.adjSign === '+' ? ' on' : ''}" data-act="adj-sign" data-s="+">Add to balance</button><button type="button" class="seg${f.adjSign === '-' ? ' on' : ''}" data-act="adj-sign" data-s="-">Take from balance</button></div>` : ''}
    <div class="field">
      <label class="label" for="f-amount">Amount</label>
      <div class="amount-wrap"><span class="pound">£</span><input id="f-amount" name="amountText" class="amount" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(f.amountText)}" ${f.isNew ? 'data-autofocus' : ''}></div>
      <div class="ops-row"><div class="ops">${ops}</div><span class="calc-result" id="calc-result">${calcShown}</span></div>
      ${err('amount')}
    </div>
    ${shopField}
    <div class="field"><span class="label">${fromLabel}</span>${accountChips('accountId')}${err('accountId')}</div>
    ${f.type === 'transfer' ? `<div class="field"><span class="label">To</span>${accountChips('toAccountId', f.accountId)}${err('toAccountId')}</div>` : ''}
    ${catBlock}
    ${f.type === 'spend' ? tripChips() : ''}
    <div class="field two-col">
      <div><label class="label" for="f-date">Date</label><input id="f-date" name="date" type="date" class="input" value="${esc(f.date)}"></div>
      <div><label class="label" for="f-note">Note</label><input id="f-note" name="note" class="input" maxlength="80" placeholder="Optional" value="${esc(f.note)}"></div>
    </div>
    ${outside}${lockedMonth() ? `<div class="lock-note">${icon('lock', 16)}<span>${monthName(lockedMonth())} is closed.</span><button type="button" class="link" data-act="reopen-month" data-m="${lockedMonth()}">Reopen</button></div>` : ''}${err('date')}
    ${flagBlock()}
    <div class="sheet-actions">
      ${f.isNew ? '' : `<button type="button" class="btn btn-danger" data-act="delete-entry" aria-label="Delete">${icon('trash', 18)}</button>
        <button type="button" class="btn btn-ghost" data-act="repeat-entry">${icon('repeat', 18)} Repeat</button>`}
      <button type="button" class="btn btn-primary grow" data-act="save-entry">${f.isNew ? 'Save entry' : 'Save'}</button>
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
  else if (lockedMonth()) e.date = `${D.monthLabel(lockedMonth())} is closed. Reopen it to change its entries.`;
  return { e, pence };
}
// A closed month an entry form touches (its new date, or the date it had), or null.
function lockedMonth() {
  const f = S.form;
  const ms = [f.date && D.monthOf(f.date), f.original && f.original.month].filter(Boolean);
  return ms.find((m) => D.isClosed(S.months, m)) || null;
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
    shop: f.type === 'spend' ? (f.shop || '').trim() : '',
    tripId: f.type === 'spend' && f.tripId ? f.tripId : null,
    flag: !!f.flag,
    flagFor: f.flag ? (f.flagFor || otherRole()) : null,
    flagNote: f.flag ? (f.flagNote || '').trim() : '',
    billId: f.billId || null,
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
  if (lockedMonth()) { S.errors = { date: `${D.monthLabel(lockedMonth())} is closed. Reopen it to delete entries.` }; renderSheet(); return; }
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
    type: 'current', openingText: '', openingDate: D.monthStart(S.month), limitText: '', last4: '', dueDay: '', checkText: '', aprText: '',
  };
}
function editAccountForm(a) {
  const ob = D.isDebt(a) ? -(a.openingBalance || 0) : (a.openingBalance || 0);
  return {
    isNew: false, id: a.id, name: a.name || '', bank: a.bank || '', owner: a.owner, type: a.type,
    openingText: (ob / 100).toFixed(2).replace(/\.00$/, ''), openingDate: a.openingDate || D.monthStart(S.month),
    limitText: a.creditLimit ? String(a.creditLimit / 100) : '', last4: a.last4 || '', dueDay: a.dueDay ? String(a.dueDay) : '',
    checkText: '', archived: !!a.archived, aprText: a.apr ? String(a.apr) : '',
  };
}

function checkLine() {
  const f = S.form;
  const a = accountById(f.id);
  if (!a || !f.checkText) return '';
  const real = evaluateToPence(f.checkText);
  if (real === null) return '<span class="err">Enter the amount shown in your bank app.</span>';
  const now = D.balanceOf(a, S.txns);
  const realBal = D.isDebt(a) ? -real : real;
  const diff = realBal - now;
  if (diff === 0) return `<span class="ok">${icon('check', 16)} Matches. Kudukka agrees with your bank.</span>`;
  return `<span>Kudukka shows ${D.money(D.isDebt(a) ? -now : now)}. Difference ${D.money(Math.abs(diff))}.</span>
    <button type="button" class="btn btn-ghost btn-sm" data-act="add-adjust" data-diff="${diff}">Add a ${D.money(Math.abs(diff))} adjustment</button>`;
}

function sheetAccount() {
  const f = S.form;
  const owners = ['sree', 'sha', 'joint'].map((o) => `<button type="button" class="seg seg-${o}${f.owner === o ? ' on' : ''}" aria-pressed="${f.owner === o}" data-act="acc-owner" data-o="${o}">${D.PEOPLE[o].name}</button>`).join('');
  const types = Object.entries(D.ACCOUNT_TYPES).map(([k, v]) => `<button type="button" class="chip${f.type === k ? ' on' : ''}" data-act="acc-type" data-t="${k}">${v}</button>`).join('');
  const isCard = f.type === 'credit';
  const isOwed = isCard || f.type === 'loan';
  const used = !f.isNew && S.txns.some((t) => t.accountId === f.id || t.toAccountId === f.id);
  return `<div class="sheet-head"><h2 class="h2" id="sheet-title">${f.isNew ? 'New account' : 'Edit account'}</h2><button type="button" class="icon-btn" data-act="sheet-close" aria-label="Close">${icon('x', 22)}</button></div>
    <div class="field"><span class="label">Whose is it?</span><div class="segs" role="group" aria-label="Owner">${owners}</div></div>
    <div class="field"><span class="label">Type</span><div class="chips">${types}</div></div>
    <div class="field"><label class="label" for="a-name">Nickname</label><input id="a-name" name="name" class="input" maxlength="40" placeholder="${isCard ? 'e.g. Amex' : f.type === 'loan' ? 'e.g. Car finance' : 'e.g. Monzo current'}" value="${esc(f.name)}" ${f.isNew ? 'data-autofocus' : ''}>${err('name')}</div>
    <div class="field"><label class="label" for="a-bank">Bank</label><input id="a-bank" name="bank" class="input" maxlength="40" placeholder="Optional" value="${esc(f.bank)}"></div>
    <div class="field two-col">
      <div><label class="label" for="a-open">${isOwed ? 'Amount owed' : 'Balance'}</label><div class="amount-wrap small"><span class="pound">£</span><input id="a-open" name="openingText" class="input bare" inputmode="decimal" placeholder="0.00" value="${esc(f.openingText)}"></div></div>
      <div><label class="label" for="a-odate">On this date</label><input id="a-odate" name="openingDate" type="date" class="input" value="${esc(f.openingDate)}"></div>
    </div>
    <p class="hint block">${isOwed ? 'What you owed on this date, before any entries you add from then on.' : 'The balance on this date, before any entries you add from then on.'}</p>
    ${err('openingText')}
    ${isCard ? `<div class="field three-col">
      <div><label class="label" for="a-limit">Credit limit</label><input id="a-limit" name="limitText" class="input" inputmode="decimal" placeholder="Optional" value="${esc(f.limitText)}"></div>
      <div><label class="label" for="a-last4">Last 4 digits</label><input id="a-last4" name="last4" class="input" inputmode="numeric" maxlength="4" placeholder="Optional" value="${esc(f.last4)}"></div>
      <div><label class="label" for="a-due">Due day</label><input id="a-due" name="dueDay" class="input" inputmode="numeric" maxlength="2" placeholder="1–31" value="${esc(f.dueDay)}"></div>
    </div>${err('last4')}${err('dueDay')}` : ''}
    ${isOwed ? `<div class="field"><label class="label" for="a-apr">Interest rate (APR %)</label><input id="a-apr" name="aprText" class="input" inputmode="decimal" maxlength="6" placeholder="Optional, e.g. 9.9" value="${esc(f.aprText)}">
      <p class="hint">${f.type === 'loan' ? 'Used to work out your debt-free date. Add the monthly repayment in Bills.' : 'Helps Kudukka suggest which debt to clear first.'}</p>${err('apr')}</div>` : ''}
    ${f.isNew ? '' : `<div class="field check">
      <label class="label" for="a-check">Check against your bank</label>
      <div class="amount-wrap small"><span class="pound">£</span><input id="a-check" name="checkText" class="input bare" inputmode="decimal" placeholder="${isOwed ? 'Owed now, from your bank app' : 'Balance now, from your bank app'}" value="${esc(f.checkText)}"></div>
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
  const apr = f.aprText ? Number(String(f.aprText).replace('%', '')) : null;
  if (f.aprText && !(apr >= 0 && apr < 100)) e.apr = 'Enter the rate as a number, like 9.9.';
  S.errors = e;
  if (Object.keys(e).length) { renderSheet(); return; }
  const isCard = f.type === 'credit';
  const isOwed = D.isDebt({ type: f.type });
  const data = {
    name: f.name.trim(), bank: f.bank.trim(), owner: f.owner, type: f.type,
    openingBalance: isOwed ? -opening : opening,
    apr: isOwed && apr !== null ? apr : null,
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

// ----- bill -----
function billForm(b, seed) {
  if (b) {
    const g = D.groupOf(b.categoryId);
    return { isNew: false, id: b.id, kind: b.kind || 'bill', name: b.name || '', amountText: b.amount ? poundsText(b.amount) : '', varies: !!b.varies,
      freq: b.freq || 'monthly', dueDay: b.dueDay ? String(b.dueDay) : '', dueMonth: Number(b.dueMonth) || Number(D.todayISO().slice(5, 7)),
      accountId: b.accountId || '', toAccountId: b.toAccountId || '', groupId: g ? g.id : 'bills', categoryId: b.categoryId || '', shop: b.shop || '', archived: !!b.archived };
  }
  const f = { isNew: true, id: fb.newId('bills'), kind: 'bill', name: '', amountText: '', varies: false, freq: 'monthly', dueDay: '',
    dueMonth: Number(D.todayISO().slice(5, 7)), accountId: (activeAccounts().find((a) => D.isSpendable(a)) || {}).id || '', toAccountId: '', groupId: 'bills', categoryId: '', shop: '' };
  if (seed) {
    Object.assign(f, { name: seed.name, amountText: poundsText(seed.amount), varies: seed.varies, dueDay: String(seed.dueDay), shop: seed.name, seedKey: seed.key });
    if (activeAccounts().some((a) => a.id === seed.accountId)) f.accountId = seed.accountId;
    const g = D.groupOf(seed.categoryId);
    if (g) { f.groupId = g.id; f.categoryId = seed.categoryId; }
  }
  return f;
}

function sheetBill() {
  const f = S.form;
  const fromAccs = activeAccounts().filter((a) => !D.isDebt(a));
  const debtAccs = activeAccounts().filter((a) => D.isDebt(a));
  const chips = (list, field) => (list.length
    ? `<div class="chips">${list.map((a) => `<button type="button" class="chip acc${f[field] === a.id ? ' on' : ''}" data-act="pick-account" data-field="${field}" data-id="${a.id}">${ownerDot(a.owner)}${esc(a.name)}</button>`).join('')}</div>`
    : `<p class="muted small">${field === 'toAccountId' ? 'Add the card or loan in Accounts first.' : 'Add an account first.'}</p>`);
  const g = D.groupById(f.groupId);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const used = !f.isNew && S.txns.some((t) => t.billId === f.id);
  return `<div class="sheet-head"><h2 class="h2" id="sheet-title">${f.isNew ? 'New bill' : 'Edit bill'}</h2><button type="button" class="icon-btn" data-act="sheet-close" aria-label="Close">${icon('x', 22)}</button></div>
    <div class="segs two" role="group" aria-label="Kind"><button type="button" class="seg${f.kind === 'bill' ? ' on' : ''}" data-act="bill-kind" data-k="bill">Bill</button><button type="button" class="seg${f.kind === 'repayment' ? ' on' : ''}" data-act="bill-kind" data-k="repayment">Card or loan repayment</button></div>
    <div class="field"><label class="label" for="b-name">Name</label><input id="b-name" name="name" class="input" maxlength="40" placeholder="${f.kind === 'bill' ? 'e.g. Rent, Octopus, Netflix' : 'e.g. Car finance'}" value="${esc(f.name)}" ${f.isNew && !f.seedKey ? 'data-autofocus' : ''}>${err('name')}</div>
    <div class="field"><label class="label" for="b-amount">${f.varies ? 'Usual amount' : 'Amount'}</label><div class="amount-wrap small"><span class="pound">£</span><input id="b-amount" name="amountText" class="input bare" inputmode="decimal" placeholder="0.00" value="${esc(f.amountText)}"></div>${err('amount')}</div>
    <button type="button" class="toggle-row" data-act="bill-varies" aria-pressed="${f.varies}"><span class="entry-main"><span class="entry-title">The amount changes</span><span class="entry-sub">Like energy or water: Kudukka uses the average of the last 3 payments</span></span><span class="switch${f.varies ? ' on' : ''}" aria-hidden="true"></span></button>
    <div class="field"><span class="label">How often</span><div class="segs two" role="group" aria-label="How often"><button type="button" class="seg${f.freq === 'monthly' ? ' on' : ''}" data-act="bill-freq" data-f="monthly">Every month</button><button type="button" class="seg${f.freq === 'yearly' ? ' on' : ''}" data-act="bill-freq" data-f="yearly">Once a year</button></div></div>
    ${f.freq === 'yearly' ? `<div class="field"><span class="label">Month</span><div class="chips">${months.map((m, i) => `<button type="button" class="chip${f.dueMonth === i + 1 ? ' on' : ''}" data-act="bill-month" data-m="${i + 1}">${m}</button>`).join('')}</div></div>` : ''}
    <div class="field"><label class="label" for="b-day">Day it goes out</label><input id="b-day" name="dueDay" class="input short" inputmode="numeric" maxlength="2" placeholder="1–31" value="${esc(f.dueDay)}">${err('dueDay')}</div>
    <div class="field"><span class="label">Paid from</span>${chips(fromAccs, 'accountId')}${err('accountId')}</div>
    ${f.kind === 'repayment' ? `<div class="field"><span class="label">Pays off</span>${chips(debtAccs, 'toAccountId')}${err('toAccountId')}</div>` : `
    <div class="field"><span class="label">Category</span><div class="chips">${D.spendGroups().map((x) => `<button type="button" class="chip grp-chip${f.groupId === x.id ? ' on' : ''}" style="--c:${x.color}" data-act="pick-group" data-id="${x.id}">${icon(x.icon, 16)}${esc(x.name)}</button>`).join('')}</div>
      ${g ? `<div class="chips sub">${D.visibleSubs(g).map((s) => `<button type="button" class="chip${f.categoryId === s.id ? ' on' : ''}" data-act="pick-cat" data-id="${s.id}">${esc(s.name)}</button>`).join('')}</div>` : ''}${err('categoryId')}</div>
    <div class="field"><label class="label" for="b-shop">Shop name on your entries</label><input id="b-shop" name="shop" class="input" maxlength="40" placeholder="Same as the name" value="${esc(f.shop)}">
      <p class="hint">Entries with this shop name count as this bill being paid.</p></div>`}
    <div class="sheet-actions">
      ${f.isNew ? '' : used || f.archived
        ? `<button type="button" class="btn btn-ghost" data-act="archive-bill">${f.archived ? 'Restart' : 'Stop bill'}</button>`
        : `<button type="button" class="btn btn-danger" data-act="delete-bill" aria-label="Delete">${icon('trash', 18)}</button>`}
      <button type="button" class="btn btn-primary grow" data-act="save-bill">${f.isNew ? 'Add bill' : 'Save'}</button>
    </div>`;
}

function saveBill() {
  const f = S.form;
  const e = {};
  if (!f.name.trim()) e.name = 'Give it a name.';
  const amount = evaluateToPence(f.amountText);
  if (amount === null || amount <= 0) e.amount = 'Enter the amount.';
  const day = Number(f.dueDay);
  if (!(day >= 1 && day <= 31)) e.dueDay = 'Enter a day from 1 to 31.';
  if (!f.accountId) e.accountId = 'Choose the account it comes out of.';
  if (f.kind === 'repayment' && !f.toAccountId) e.toAccountId = 'Choose the card or loan it pays.';
  S.errors = e;
  if (Object.keys(e).length) { renderSheet(); return; }
  const data = {
    name: f.name.trim(), kind: f.kind, amount, varies: !!f.varies, freq: f.freq, dueDay: day,
    dueMonth: f.freq === 'yearly' ? f.dueMonth : null, accountId: f.accountId,
    toAccountId: f.kind === 'repayment' ? f.toAccountId : null,
    categoryId: f.kind === 'bill' ? f.categoryId || null : null,
    shop: f.kind === 'bill' ? (f.shop || f.name).trim() : '',
  };
  if (f.isNew) data.archived = false;
  const { isNew, id } = f;
  closeSheet();
  fb.saveDoc('bills', id, data, isNew).catch(() => toast("Couldn't save the bill. Check your connection."));
  toast(isNew ? `${data.name} added` : 'Bill saved');
}

// Opens a new entry already filled in from a bill.
function payBillForm(b, due) {
  const today = D.todayISO();
  const f = newEntryForm(b.kind === 'repayment' ? 'transfer' : 'spend');
  f.amountText = poundsText(D.billExpected(b, S.txns));
  if (activeAccounts().some((a) => a.id === b.accountId)) f.accountId = b.accountId;
  if (b.kind === 'repayment') f.toAccountId = b.toAccountId;
  const cat = D.categoryById(b.categoryId);
  if (cat) { f.categoryId = b.categoryId; f.groupId = cat.group ? cat.group.id : ''; }
  f.shop = b.kind === 'bill' ? (b.shop || b.name) : '';
  f.shopApplied = true;
  f.note = b.kind === 'repayment' ? b.name : '';
  f.date = due && due < today ? due : today;
  f.billId = b.id;
  f.templates = [];
  return f;
}

// ----- payday and expected pay -----
function paydayPreview() {
  const day = Number(S.form.day);
  if (!(day >= 1 && day <= 31)) return '';
  const ex = D.moneyMonth(D.todayISO(), day);
  return `Right now that's ${monthName(ex.label)}'s money: ${winLabel(ex)}.`;
}

function sheetPayday() {
  const f = S.form;
  return `<div class="sheet-head"><h2 class="h2" id="sheet-title">Payday</h2><button type="button" class="icon-btn" data-act="sheet-close" aria-label="Close">${icon('x', 22)}</button></div>
    <p class="muted">The day your main pay arrives. Pay on this day covers the next month, so the plan runs from payday to the day before the next one.</p>
    <div class="field"><label class="label" for="p-day">Day of the month</label><input id="p-day" name="day" class="input short" inputmode="numeric" maxlength="2" value="${esc(f.day)}" data-autofocus>${err('day')}</div>
    <p class="hint block" id="payday-preview">${paydayPreview()}</p>
    <div class="sheet-actions"><button type="button" class="btn btn-primary grow" data-act="save-payday">Save</button></div>`;
}

function sheetExpected() {
  const f = S.form;
  const p = currentPlan();
  const avg = D.expectedIncome(S.txns, S.accounts, p.win, payday());
  const row = (k) => `<div class="field"><label class="label" for="x-${k}">${D.PEOPLE[k].name}${k === 'joint' ? ' (joint accounts)' : ''}</label>
    <div class="amount-wrap small"><span class="pound">£</span><input id="x-${k}" name="x_${k}" class="input bare" inputmode="decimal" value="${esc(f[`x_${k}`])}"></div>
    <span class="hint">${D.money(p.received[k] || 0)} in so far · recent average ${D.money(avg[k] || 0)}${avg.months ? ` (${avg.months} ${avg.months === 1 ? 'month' : 'months'})` : ''}</span></div>`;
  return `<div class="sheet-head"><h2 class="h2" id="sheet-title">Pay for ${monthName(p.win.label)}</h2><button type="button" class="icon-btn" data-act="sheet-close" aria-label="Close">${icon('x', 22)}</button></div>
    <p class="muted">How much you each expect for the whole money month (${winLabel(p.win)}). Sree's pay varies, so this starts from his recent average. Change it if you know better.</p>
    ${row('sree')}${row('sha')}${S.accounts.some((a) => a.owner === 'joint' && !a.archived) ? row('joint') : ''}
    ${err('x')}
    <div class="sheet-actions"><button type="button" class="btn btn-ghost" data-act="reset-expected">Use averages</button><button type="button" class="btn btn-primary grow" data-act="save-expected">Save</button></div>`;
}

// ----- pot -----
function potForm(p, preset) {
  if (p) {
    return { isNew: false, id: p.id, name: p.name || '', targetText: p.target ? poundsText(p.target) : '', byMonth: p.byMonth || '', accountId: p.accountId || '', archived: !!p.archived, preset: p.preset || '' };
  }
  const f = { isNew: true, id: fb.newId('pots'), name: '', targetText: '', byMonth: '', accountId: '', preset: preset || '' };
  if (preset === 'emergency') { const plan = currentPlan(); Object.assign(f, { name: 'Emergency fund', targetText: poundsText(plan.emergencyTarget) }); }
  if (preset === 'yearly') {
    const total = liveBills().filter((b) => b.freq === 'yearly').reduce((n, b) => n + D.billExpected(b, S.txns), 0);
    Object.assign(f, { name: 'Yearly bills', targetText: poundsText(total) });
  }
  const savings = activeAccounts().find((a) => D.isSaving(a));
  if (savings && preset) f.accountId = savings.id;
  return f;
}

function potMonthHint() {
  const f = S.form;
  const target = evaluateToPence(f.targetText);
  const months = /^\d{4}-\d{2}$/.test(f.byMonth || '') && target ? D.monthsBetween(D.currentMonth(), f.byMonth) : 0;
  return months > 0 ? `About ${D.money(Math.ceil(target / months))} a month for ${months} ${months === 1 ? 'month' : 'months'} (before anything you've added).`
    : 'Optional. With a target month, Kudukka works out how much to add each month.';
}

function sheetPot() {
  const f = S.form;
  const hint = f.preset === 'emergency' ? 'Suggested: 3 months of your bills, or £1,000 to start. Change it to suit you.'
    : f.preset === 'yearly' ? 'Your yearly bills added up. Saving a twelfth each month means they never surprise you.' : '';
  const accs = activeAccounts().filter((a) => !D.isDebt(a));
  return `<div class="sheet-head"><h2 class="h2" id="sheet-title">${f.isNew ? 'New pot' : 'Edit pot'}</h2><button type="button" class="icon-btn" data-act="sheet-close" aria-label="Close">${icon('x', 22)}</button></div>
    <div class="preview-row"><span class="pot-art">${potSVG(0.4, 56, 'form')}</span><span class="entry-title">${esc(f.name || 'New pot')}</span></div>
    <div class="field"><label class="label" for="p-name">Name</label><input id="p-name" name="name" class="input" maxlength="30" placeholder="e.g. US trip" value="${esc(f.name)}" ${f.isNew && !f.preset ? 'data-autofocus' : ''}>${err('name')}</div>
    <div class="field"><label class="label" for="p-target">Target</label><div class="amount-wrap small"><span class="pound">£</span><input id="p-target" name="targetText" class="input bare" inputmode="decimal" placeholder="Optional" value="${esc(f.targetText)}"></div>${err('target')}
      ${hint ? `<p class="hint">${hint}</p>` : ''}</div>
    <div class="field"><label class="label" for="p-by">Save it by</label><input id="p-by" name="byMonth" type="month" class="input" min="${D.currentMonth()}" value="${esc(f.byMonth)}">
      <p class="hint" id="pot-month-hint">${potMonthHint()}</p>${err('byMonth')}</div>
    <div class="field"><span class="label">Kept in</span><div class="chips">
      <button type="button" class="chip${!f.accountId ? ' on' : ''}" data-act="pick-account" data-field="accountId" data-id="">Not set</button>
      ${accs.map((a) => `<button type="button" class="chip acc${f.accountId === a.id ? ' on' : ''}" data-act="pick-account" data-field="accountId" data-id="${a.id}">${ownerDot(a.owner)}${esc(a.name)}</button>`).join('')}</div>
      <p class="hint">Optional. The account that holds this money, ideally a spare savings account.</p></div>
    <div class="sheet-actions">
      ${f.isNew ? '' : S.potMoves.some((m) => m.potId === f.id)
        ? `<button type="button" class="btn btn-ghost" data-act="archive-pot">${f.archived ? 'Restart' : 'Finish'}</button>`
        : `<button type="button" class="btn btn-danger" data-act="delete-pot" aria-label="Delete">${icon('trash', 18)}</button>`}
      <button type="button" class="btn btn-primary grow" data-act="save-pot">${f.isNew ? 'Add pot' : 'Save'}</button></div>`;
}

function savePot() {
  const f = S.form;
  const e = {};
  if (!f.name.trim()) e.name = 'Give it a name.';
  const target = f.targetText ? evaluateToPence(f.targetText) : null;
  if (f.targetText && (target === null || target <= 0)) e.target = "That target doesn't look right.";
  if (f.byMonth && !/^\d{4}-\d{2}$/.test(f.byMonth)) e.byMonth = 'Choose a month.';
  else if (f.byMonth && f.byMonth < D.currentMonth() && f.isNew) e.byMonth = 'Choose this month or later.';
  if (f.byMonth && !target) e.target = 'Add a target to save by a month.';
  S.errors = e;
  if (Object.keys(e).length) { renderSheet(); return; }
  const data = { name: f.name.trim(), target: target || null, byMonth: f.byMonth || null, accountId: f.accountId || null, preset: f.preset || null };
  if (f.isNew) { data.archived = false; data.order = Date.now(); }
  const { isNew, id } = f;
  closeSheet();
  fb.saveDoc('pots', id, data, isNew).catch(() => toast("Couldn't save the pot. Check your connection."));
  toast(isNew ? `${data.name} pot added` : 'Pot saved');
  if (isNew) { S.backTo = null; S.view = 'pot'; S.viewArg = id; window.scrollTo(0, 0); renderMain(); renderNav(); }
}

// ----- add to / take from a pot -----
function sheetPotMove() {
  const f = S.form;
  const p = potById(f.potId);
  const saved = p ? D.potBalance(p, S.potMoves) - (f.isNew ? 0 : f.original.amount) : 0;
  return `<div class="sheet-head"><h2 class="h2" id="sheet-title">${f.isNew ? (f.dir === 'add' ? 'Add money' : 'Take money out') : 'Edit'}</h2><button type="button" class="icon-btn" data-act="sheet-close" aria-label="Close">${icon('x', 22)}</button></div>
    <p class="muted">${esc(p ? p.name : '')} · ${D.money(saved)} in the pot now</p>
    <div class="segs two" role="group" aria-label="Add or take out"><button type="button" class="seg${f.dir === 'add' ? ' on' : ''}" data-act="pm-dir" data-d="add">Add</button><button type="button" class="seg${f.dir === 'take' ? ' on' : ''}" data-act="pm-dir" data-d="take">Take out</button></div>
    <div class="field"><label class="label" for="f-amount">Amount</label>
      <div class="amount-wrap"><span class="pound">£</span><input id="f-amount" name="amountText" class="amount" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(f.amountText)}" ${f.isNew ? 'data-autofocus' : ''}></div>
      <div class="ops-row"><span></span><span class="calc-result" id="calc-result"></span></div>${err('amount')}</div>
    <div class="field two-col">
      <div><label class="label" for="pm-date">Date</label><input id="pm-date" name="date" type="date" class="input" value="${esc(f.date)}"></div>
      <div><label class="label" for="pm-note">Note</label><input id="pm-note" name="note" class="input" maxlength="60" placeholder="Optional" value="${esc(f.note)}"></div></div>
    <p class="hint block">This only moves money inside Kudukka. If you also move it between bank accounts, add that as a Transfer.</p>
    <div class="sheet-actions">
      ${f.isNew ? '' : `<button type="button" class="btn btn-danger" data-act="delete-pot-move" aria-label="Delete">${icon('trash', 18)}</button>`}
      <button type="button" class="btn btn-primary grow" data-act="save-pot-move">${f.isNew ? (f.dir === 'add' ? 'Add to pot' : 'Take out') : 'Save'}</button></div>`;
}

function savePotMove() {
  const f = S.form;
  const pence = evaluateToPence(f.amountText);
  const e = {};
  if (pence === null || pence <= 0) e.amount = 'Enter an amount.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date || '')) e.amount = e.amount || 'Choose a date.';
  S.errors = e;
  if (Object.keys(e).length) { renderSheet(); return; }
  const data = { potId: f.potId, amount: f.dir === 'take' ? -pence : pence, date: f.date, note: (f.note || '').trim(), updatedBy: myRole() };
  if (f.isNew) data.createdBy = myRole();
  const { isNew, id } = f;
  closeSheet();
  fb.saveDoc('potMoves', id, data, isNew).catch(() => toast("Couldn't save. Check your connection."));
  toast(isNew ? `${f.dir === 'take' ? 'Took out' : 'Added'} ${D.money(pence)}` : 'Saved');
}

// ----- one imported row -----
function sheetImpRow() {
  const f = S.form;
  const I = S.imp;
  const acc = accountById(I.accountId);
  const choices = f.dir === 'out' ? [['spend', 'Spend'], ['transfer', 'Transfer'], ['skip', 'Leave out']]
    : [['income', 'Income'], ['transfer', 'Transfer'], ...(D.isDebt(acc) ? [['adjust', 'Refund']] : []), ['skip', 'Leave out']];
  const others = activeAccounts().filter((a) => a.id !== I.accountId);
  const field = f.dir === 'in' ? 'fromAccountId' : 'toAccountId';
  let body = '';
  if (f.choice === 'spend') {
    const g = D.groupById(f.groupId);
    const same = I.items.filter((x) => x.key !== f.key && x.dir === 'out' && D.shopKey(x.raw) === D.shopKey(f.raw) && !['duplicate', 'closed'].includes(x.status)).length;
    body = `<div class="field"><label class="label" for="ir-shop">Shop or payee</label><input id="ir-shop" name="shop" class="input" maxlength="40" value="${esc(f.shop)}"></div>
      <div class="field"><span class="label">Category</span><div class="chips">${D.spendGroups().map((x) => `<button type="button" class="chip grp-chip${f.groupId === x.id ? ' on' : ''}" style="--c:${x.color}" data-act="pick-group" data-id="${x.id}">${icon(x.icon, 16)}${esc(x.name)}</button>`).join('')}</div>
      ${g ? `<div class="chips sub">${D.visibleSubs(g).map((s) => `<button type="button" class="chip${f.categoryId === s.id ? ' on' : ''}" data-act="pick-cat" data-id="${s.id}">${esc(s.name)}</button>`).join('')}</div>` : ''}${err('categoryId')}</div>
      ${same ? `<button type="button" class="toggle-row" data-act="ir-all" aria-pressed="${f.all}"><span class="entry-main"><span class="entry-title">Same for ${same} more from "${esc(f.raw)}"</span><span class="entry-sub">Uses this shop name and category for them too</span></span><span class="switch${f.all ? ' on' : ''}" aria-hidden="true"></span></button>` : ''}`;
  } else if (f.choice === 'income') {
    body = `<div class="field"><span class="label">Income from</span><div class="chips">${D.incomeSources().map((x) => `<button type="button" class="chip${f.categoryId === x.id ? ' on' : ''}" data-act="pick-cat" data-id="${x.id}">${esc(x.name)}</button>`).join('')}</div></div>`;
  } else if (f.choice === 'transfer') {
    body = `<div class="field"><span class="label">${f.dir === 'in' ? 'Came from' : 'Went to'}</span><div class="chips">${others.map((a) => `<button type="button" class="chip acc${f[field] === a.id ? ' on' : ''}" data-act="pick-account" data-field="${field}" data-id="${a.id}">${ownerDot(a.owner)}${esc(a.name)}</button>`).join('')}</div>${err(field)}
      <p class="hint">Check it isn't already entered from ${f.dir === 'in' ? 'that' : 'the other'} account.</p></div>`;
  } else if (f.choice === 'adjust') {
    body = '<p class="muted small">Adds the money back to the card balance. It doesn\'t count as income or spending.</p>';
  }
  return `<div class="sheet-head"><h2 class="h2" id="sheet-title">${f.dir === 'in' ? '+' : '−'}${D.money(f.amount)}</h2><button type="button" class="icon-btn" data-act="sheet-close" aria-label="Close">${icon('x', 22)}</button></div>
    <p class="muted">${D.dayLabel(f.date)} · "${esc(f.raw || 'No description')}"${f.why ? `<br><span class="small">${esc(f.why)}</span>` : ''}</p>
    <div class="segs ${choices.length === 4 ? 'four' : ''}" role="group" aria-label="What is it">${choices.map(([k, label]) => `<button type="button" class="seg${f.choice === k ? ' on' : ''}" data-act="ir-type" data-t="${k}">${label}</button>`).join('')}</div>
    ${body}
    <div class="sheet-actions"><button type="button" class="btn btn-primary grow" data-act="ir-save">Done</button></div>`;
}

function saveImpRow() {
  const f = S.form;
  const I = S.imp;
  const it = I.items.find((x) => x.key === f.key);
  if (!it) { closeSheet(); return; }
  if (f.choice === 'transfer') {
    const field = f.dir === 'in' ? 'fromAccountId' : 'toAccountId';
    if (!f[field]) { S.errors = { [field]: 'Choose the other account.' }; renderSheet(); return; }
  }
  const apply = (x, shop) => {
    if (f.choice === 'skip') { x.status = 'skip'; x.include = false; return; }
    x.type = f.choice;
    x.categoryId = f.choice === 'spend' || f.choice === 'income' ? f.categoryId : '';
    x.toAccountId = f.choice === 'transfer' && x.dir === 'out' ? f.toAccountId : '';
    x.fromAccountId = f.choice === 'transfer' && x.dir === 'in' ? f.fromAccountId : '';
    if (f.choice === 'spend') x.shop = shop;
    if (f.choice === 'adjust') x.note = `Refund · ${x.raw || ''}`.trim();
    const ok = CSV.itemReady(x);
    x.status = ok ? 'ready' : 'needs';
    x.include = ok;
  };
  const shop = (f.shop || '').trim() || it.raw || it.shop;
  apply(it, shop);
  if (f.choice === 'spend' && f.all && f.categoryId) {
    I.items.filter((x) => x !== it && x.dir === 'out' && D.shopKey(x.raw) === D.shopKey(it.raw) && !['duplicate', 'closed'].includes(x.status)).forEach((x) => apply(x, shop));
  }
  closeSheet();
  renderMain();
}

// ----- filters -----
function sheetFilters() {
  const q = S.search;
  const chip = (k, v, label, extra = '') => `<button type="button" class="chip${q[k] === v ? ' on' : ''}" data-act="f-set" data-k="${k}" data-v="${esc(v)}">${extra}${esc(label)}</button>`;
  const count = currentResults().length;
  return `<div class="sheet-head"><h2 class="h2" id="sheet-title">Filters</h2><button type="button" class="icon-btn" data-act="sheet-close" aria-label="Close">${icon('x', 22)}</button></div>
    <div class="field"><span class="label">Type</span><div class="chips">${chip('type', '', 'All')}${Object.entries(D.ENTRY_TYPES).map(([k, v]) => chip('type', k, v)).join('')}</div></div>
    <div class="field"><span class="label">Account</span><div class="chips">${chip('accountId', '', 'All')}${S.accounts.filter((a) => !a.archived || a.id === q.accountId).map((a) => chip('accountId', a.id, a.name, ownerDot(a.owner))).join('')}</div></div>
    <div class="field"><span class="label">Category</span><div class="chips">${chip('groupId', '', 'All')}${D.spendGroups(true).map((g) => chip('groupId', g.id, g.name, icon(g.icon, 14))).join('')}</div></div>
    ${S.trips.length ? `<div class="field"><span class="label">Trip</span><div class="chips">${chip('tripId', '', 'All')}${S.trips.map((t) => chip('tripId', t.id, t.name, icon('travel', 14))).join('')}</div></div>` : ''}
    <button type="button" class="toggle-row" data-act="f-flag" aria-pressed="${q.flagged}">
      <span class="gicon ${q.flagged ? 'warn' : 'plain'}">${icon('flag', 16)}</span>
      <span class="entry-main"><span class="entry-title">Only "Ask" flags</span></span>
      <span class="switch${q.flagged ? ' on' : ''}" aria-hidden="true"></span>
    </button>
    <div class="sheet-actions">
      <button type="button" class="btn btn-ghost" data-act="clear-filters">Clear all</button>
      <button type="button" class="btn btn-primary grow" data-act="sheet-close">Show ${count} ${count === 1 ? 'entry' : 'entries'}</button>
    </div>`;
}

// ----- trip -----
function tripForm(t) {
  if (!t) return { isNew: true, id: fb.newId('trips'), name: '', startDate: D.todayISO(), endDate: D.todayISO(), budgetText: '' };
  return { isNew: false, id: t.id, name: t.name || '', startDate: t.startDate || '', endDate: t.endDate || '', budgetText: t.budget ? poundsText(t.budget) : '', archived: !!t.archived };
}

function sheetTrip() {
  const f = S.form;
  const used = !f.isNew && S.txns.some((t) => t.tripId === f.id);
  return `<div class="sheet-head"><h2 class="h2" id="sheet-title">${f.isNew ? 'New trip' : 'Edit trip'}</h2><button type="button" class="icon-btn" data-act="sheet-close" aria-label="Close">${icon('x', 22)}</button></div>
    <div class="field"><label class="label" for="t-name">Trip name</label><input id="t-name" name="name" class="input" maxlength="40" placeholder="e.g. Thailand" value="${esc(f.name)}" ${f.isNew ? 'data-autofocus' : ''}>${err('name')}</div>
    <div class="field two-col">
      <div><label class="label" for="t-start">From</label><input id="t-start" name="startDate" type="date" class="input" value="${esc(f.startDate)}"></div>
      <div><label class="label" for="t-end">To</label><input id="t-end" name="endDate" type="date" class="input" value="${esc(f.endDate)}"></div>
    </div>${err('dates')}
    <div class="field"><label class="label" for="t-budget">Budget</label><div class="amount-wrap small"><span class="pound">£</span><input id="t-budget" name="budgetText" class="input bare" inputmode="decimal" placeholder="Optional" value="${esc(f.budgetText)}"></div>${err('budget')}</div>
    <p class="hint block">Entries dated inside these days will suggest this trip.</p>
    <div class="sheet-actions">
      ${f.isNew ? '' : used
        ? `<button type="button" class="btn btn-ghost" data-act="archive-trip">${f.archived ? 'Unarchive' : 'Archive'}</button>`
        : `<button type="button" class="btn btn-danger" data-act="delete-trip">${icon('trash', 18)} Delete</button>`}
      <button type="button" class="btn btn-primary grow" data-act="save-trip">${f.isNew ? 'Add trip' : 'Save'}</button>
    </div>`;
}

function saveTrip() {
  const f = S.form;
  const e = {};
  if (!f.name.trim()) e.name = 'Give the trip a name.';
  if (!f.startDate || !f.endDate) e.dates = 'Choose both dates.';
  else if (f.endDate < f.startDate) e.dates = 'The end date is before the start.';
  const budget = f.budgetText ? evaluateToPence(f.budgetText) : null;
  if (f.budgetText && (budget === null || budget < 0)) e.budget = "That budget doesn't look right.";
  S.errors = e;
  if (Object.keys(e).length) { renderSheet(); return; }
  const data = { name: f.name.trim(), startDate: f.startDate, endDate: f.endDate, budget: budget || null };
  if (f.isNew) data.archived = false;
  const { isNew, id } = f;
  closeSheet();
  fb.saveDoc('trips', id, data, isNew).catch(() => toast("Couldn't save the trip. Check your connection."));
  toast(isNew ? `${data.name} added` : 'Trip saved');
}

// ----- category group -----
function groupForm(g) {
  if (!g) {
    return { isNew: true, id: '', name: '', color: D.GROUP_COLORS[6], icon: 'other', hidden: false, subs: [{ id: '', name: 'General', hidden: false, isNew: true, key: 'n0' }], newSub: '' };
  }
  return { isNew: false, id: g.id, name: g.name, color: g.color, icon: g.icon, hidden: !!g.hidden, order: g.order,
    subs: g.subs.map((s, i) => ({ id: s.id, name: s.name, hidden: !!s.hidden, need: !!s.need, key: `s${i}` })), newSub: '' };
}

function sheetGroup() {
  const f = S.form;
  const swatches = D.GROUP_COLORS.map((c) => `<button type="button" class="swatch${f.color === c ? ' on' : ''}" style="background:${c}" data-act="g-color" data-c="${c}" aria-label="Colour ${c}" aria-pressed="${f.color === c}"></button>`).join('');
  const icons = D.GROUP_ICONS.map((i) => `<button type="button" class="icon-pick${f.icon === i ? ' on' : ''}" style="--c:${f.color}" data-act="g-icon" data-i="${i}" aria-label="Icon ${i}" aria-pressed="${f.icon === i}">${icon(i, 20)}</button>`).join('');
  const subs = f.subs.map((s) => `<div class="sub-row${s.hidden ? ' is-hidden' : ''}">
      <input name="sub:${s.key}" class="input" maxlength="30" value="${esc(s.name)}" aria-label="Subcategory name">
      <button type="button" class="btn btn-ghost btn-sm need-btn${s.need ? ' is-need' : ''}" data-act="g-sub-need" data-k="${s.key}" aria-label="${esc(s.name)} counts as ${s.need ? 'a need' : 'a want'}">${s.need ? 'Need' : 'Want'}</button>
      <button type="button" class="btn btn-ghost btn-sm" data-act="g-sub-hide" data-k="${s.key}">${s.hidden ? 'Show' : 'Hide'}</button>
    </div>`).join('');
  return `<div class="sheet-head"><h2 class="h2" id="sheet-title">${f.isNew ? 'New category group' : 'Edit category'}</h2><button type="button" class="icon-btn" data-act="sheet-close" aria-label="Close">${icon('x', 22)}</button></div>
    <div class="preview-row"><span class="gicon lg" style="background:${f.color}">${icon(f.icon, 22)}</span><span class="entry-title">${esc(f.name || 'New group')}</span></div>
    <div class="field"><label class="label" for="g-name">Name</label><input id="g-name" name="name" class="input" maxlength="30" value="${esc(f.name)}" ${f.isNew ? 'data-autofocus' : ''}>${err('name')}</div>
    <div class="field"><span class="label">Colour</span><div class="swatches">${swatches}</div></div>
    <div class="field"><span class="label">Icon</span><div class="icon-grid">${icons}</div></div>
    <div class="field"><span class="label">Subcategories</span><p class="hint">Need or Want sets where it goes in the 50/30/20 report.</p>${subs}
      <div class="sub-row"><input name="newSub" class="input" maxlength="30" placeholder="Add a subcategory" value="${esc(f.newSub)}" aria-label="New subcategory">
      <button type="button" class="btn btn-ghost btn-sm" data-act="g-add-sub">${icon('plus', 16)} Add</button></div>${err('subs')}</div>
    ${f.isNew ? '' : `<button type="button" class="toggle-row" data-act="g-hide" aria-pressed="${f.hidden}">
      <span class="entry-main"><span class="entry-title">Hide this group</span><span class="entry-sub">Old entries keep it; it just stops showing when you add new ones</span></span>
      <span class="switch${f.hidden ? ' on' : ''}" aria-hidden="true"></span></button>`}
    <div class="sheet-actions"><button type="button" class="btn btn-primary grow" data-act="save-group">${f.isNew ? 'Add group' : 'Save'}</button></div>`;
}

function saveGroup() {
  const f = S.form;
  if (f.newSub && f.newSub.trim()) { f.subs.push({ id: '', name: f.newSub.trim(), hidden: false, need: f.id === 'bills', isNew: true, key: `n${Date.now()}` }); f.newSub = ''; }
  const e = {};
  if (!f.name.trim()) e.name = 'Give it a name.';
  const subs = f.subs.filter((s) => s.name.trim() || !s.isNew);
  if (subs.some((s) => !s.name.trim())) e.subs = 'Every subcategory needs a name.';
  else if (!subs.some((s) => !s.hidden)) e.subs = 'Keep at least one subcategory showing.';
  S.errors = e;
  if (Object.keys(e).length) { renderSheet(); return; }
  const gid = f.isNew ? D.newCategoryId('g', f.name) : f.id;
  const order = f.isNew ? Math.max(0, ...D.spendGroups(true).map((g) => g.order || 0)) + 10 : (f.order ?? 0);
  const writes = [fb.mergeDoc('categories', gid, { kind: 'group', name: f.name.trim(), color: f.color, icon: f.icon, hidden: !!f.hidden, order })];
  subs.forEach((s, i) => {
    const sid = s.id || D.newCategoryId(`${gid}.`, s.name);
    writes.push(fb.mergeDoc('categories', sid, { kind: 'sub', parent: gid, name: s.name.trim(), hidden: !!s.hidden, need: !!s.need, order: i * 10 }));
  });
  closeSheet();
  Promise.all(writes).catch(() => toast("Couldn't save the category. Check your connection."));
  toast(f.isNew ? `${f.name.trim()} added` : 'Category saved');
}

// ----- income source -----
function sheetIncome() {
  const f = S.form;
  return `<div class="sheet-head"><h2 class="h2" id="sheet-title">${f.isNew ? 'New income source' : 'Edit income source'}</h2><button type="button" class="icon-btn" data-act="sheet-close" aria-label="Close">${icon('x', 22)}</button></div>
    <div class="field"><label class="label" for="i-name">Name</label><input id="i-name" name="name" class="input" maxlength="30" placeholder="e.g. Sree's care job" value="${esc(f.name)}" ${f.isNew ? 'data-autofocus' : ''}>${err('name')}</div>
    ${f.isNew ? '' : `<button type="button" class="toggle-row" data-act="i-hide" aria-pressed="${f.hidden}">
      <span class="entry-main"><span class="entry-title">Hide this source</span><span class="entry-sub">Old entries keep it</span></span>
      <span class="switch${f.hidden ? ' on' : ''}" aria-hidden="true"></span></button>`}
    <div class="sheet-actions"><button type="button" class="btn btn-primary grow" data-act="save-income">${f.isNew ? 'Add source' : 'Save'}</button></div>`;
}

function saveIncome() {
  const f = S.form;
  if (!f.name.trim()) { S.errors = { name: 'Give it a name.' }; renderSheet(); return; }
  if (!f.isNew && f.hidden && D.incomeSources().filter((s) => s.id !== f.id).length === 0) { S.errors = { name: 'Keep at least one income source showing.' }; renderSheet(); return; }
  const id = f.isNew ? D.newCategoryId('income.', f.name) : f.id;
  const order = f.isNew ? Math.max(0, ...D.incomeSources(true).map((s) => s.order || 0)) + 10 : (f.order ?? 0);
  closeSheet();
  fb.mergeDoc('categories', id, { kind: 'income', name: f.name.trim(), hidden: !!f.hidden, order }).catch(() => toast("Couldn't save. Check your connection."));
  toast(f.isNew ? `${f.name.trim()} added` : 'Saved');
}

// ----- export -----
async function exportData() {
  const day = D.todayISO();
  const files = [
    new File([`﻿${D.entriesCSV(S.txns, S.accounts, S.trips)}`], `kudukka-entries-${day}.csv`, { type: 'text/csv' }),
    new File([`﻿${D.accountsCSV(S.accounts, S.txns)}`], `kudukka-accounts-${day}.csv`, { type: 'text/csv' }),
  ];
  try {
    if (navigator.canShare && navigator.canShare({ files })) {
      await navigator.share({ files, title: 'Kudukka backup' });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  for (const file of files) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url; a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  toast(`Exported ${S.txns.length} entries`);
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
    case 'retry':
      S.denied = false; S.householdLoaded = false;
      render();
      startData();
      break;
    case 'signout':
      closeSheet();
      await fb.logOut();
      break;
    case 'pin-key': pinKey(el.dataset.k); break;
    case 'pin-del': S.pin.buffer = S.pin.buffer.slice(0, -1); render(); break;
    case 'bio-unlock': bioUnlock(true); break;
    case 'bio-toggle':
      if (PIN.hasBio()) {
        PIN.disableBio();
        toast(`${PIN.bioName()} turned off`);
        renderMain();
      } else {
        try {
          await PIN.enableBio(`Kudukka · ${D.PEOPLE[myRole()].name}`);
          toast(`${PIN.bioName()} is on`);
        } catch (e) {
          if (!e || e.name !== 'NotAllowedError') console.error(e);
          toast(e && e.name === 'NotAllowedError' ? 'Cancelled' : `Couldn't turn on ${PIN.bioName()}`);
        }
        renderMain();
      }
      break;
    case 'pin-forgot':
      PIN.clearPin(); PIN.disableBio(); S.locked = false; S.pin = { stage: null, buffer: '', first: '', error: '' };
      await fb.logOut();
      break;
    case 'change-pin':
      PIN.clearPin(); S.pin = { stage: null, buffer: '', first: '', error: '' }; render();
      break;
    case 'lock': S.locked = true; S.bioTried = false; render(); break;
    case 'role':
      el.disabled = true;
      fb.claimRole(S.user, el.dataset.role).catch((e) => { console.error(e); toast("Couldn't save that. Try again."); el.disabled = false; });
      break;
    case 'nav':
      if (S.view === 'entries' && el.dataset.v !== 'entries') S.search = blankSearch();
      if (el.closest('#nav')) S.backTo = null; else if (['bills', 'plan', 'trips', 'categories', 'pots', 'reports', 'import'].includes(el.dataset.v) && !['bills', 'plan', 'pots', 'pot', 'reports', 'close', 'import'].includes(S.view)) S.backTo = S.view;
      if (el.dataset.v === 'import' && S.imp && S.imp.step === 'done') S.imp = { step: 'start', accountId: S.imp.accountId };
      if (el.dataset.v === 'bills' && S.view !== 'bills') { S.billsOffset = 0; S.billsDay = null; }
      S.view = el.dataset.v; S.viewArg = null; window.scrollTo(0, 0); renderMain(); renderNav();
      break;
    case 'open-trip': S.view = 'trip'; S.viewArg = el.dataset.id; window.scrollTo(0, 0); renderMain(); renderNav(); break;
    case 'filter-group': S.search = { ...blankSearch(), groupId: el.dataset.id }; S.view = 'entries'; window.scrollTo(0, 0); renderMain(); renderNav(); break;
    case 'show-flagged': S.search = { ...blankSearch(), flagged: true, scope: 'all' }; S.view = 'entries'; window.scrollTo(0, 0); renderMain(); renderNav(); break;
    case 'search-scope': S.search.scope = el.dataset.s; renderMain(); break;
    case 'open-filters': openSheet('filters'); break;
    case 'f-set': { const k = el.dataset.k; S.search[k] = S.search[k] === el.dataset.v ? '' : el.dataset.v; renderSheet(); renderMain(); break; }
    case 'f-flag': S.search.flagged = !S.search.flagged; renderSheet(); renderMain(); break;
    case 'clear-filter': if (el.dataset.k === 'flagged') S.search.flagged = false; else S.search[el.dataset.k] = ''; renderMain(); break;
    case 'clear-filters': S.search = { ...blankSearch(), text: S.search.text, scope: S.search.scope }; renderSheet(); renderMain(); break;
    case 'quick': { const tp = f.templates && f.templates[Number(el.dataset.i)]; if (tp) { applyTemplate(f, tp); f.shopApplied = true; S.errors = {}; renderSheet(); } break; }
    case 'repeat-entry': {
      const tp = { type: f.type, amount: Math.abs(f.original.amount), accountId: f.original.accountId, categoryId: f.original.categoryId, shop: f.original.shop || '' };
      const nf = applyTemplate(newEntryForm(tp.type), tp);
      nf.shopApplied = true;
      nf.tripId = '';
      S.sheet = null; // reopen as a fresh sheet
      openSheet('entry', nf);
      toast('Copied. Check the date, then save');
      break;
    }
    case 'pick-shop': {
      const m = f.shopIdx && f.shopIdx.get(el.dataset.k);
      if (!m) break;
      f.shop = m.shop; f.shopApplied = true;
      const cat = D.categoryById(m.categoryId);
      if (m.type === 'spend' && cat && !cat.hidden && (f.isNew || !f.categoryId)) { f.categoryId = m.categoryId; f.groupId = cat.group ? cat.group.id : ''; delete S.errors.categoryId; }
      if (f.isNew && activeAccounts().some((a) => a.id === m.accountId)) { f.accountId = m.accountId; delete S.errors.accountId; }
      renderSheet();
      break;
    }
    case 'pick-trip': f.tripId = el.dataset.id; renderSheet(); break;
    case 'toggle-flag': f.flag = !f.flag; if (f.flag && !f.flagFor) f.flagFor = otherRole(); renderSheet(); if (f.flag) setTimeout(() => { const n = document.querySelector('[name="flagNote"]'); if (n) n.focus(); }, 50); break;
    case 'add-trip': openSheet('trip', tripForm(null)); break;
    case 'edit-trip': { const t = tripById(el.dataset.id); if (t) openSheet('trip', tripForm(t)); break; }
    case 'save-trip': saveTrip(); break;
    case 'archive-trip': {
      const id = f.id; const archived = !f.archived;
      closeSheet();
      fb.saveDoc('trips', id, { archived }, false);
      toast(archived ? 'Trip archived' : 'Trip restored');
      break;
    }
    case 'delete-trip': {
      const t = tripById(f.id);
      const { id, ...rest } = t;
      closeSheet();
      S.view = 'trips'; renderMain();
      fb.removeDoc('trips', id);
      toast('Trip deleted', () => fb.restoreDoc('trips', id, rest));
      break;
    }
    case 'add-group': openSheet('group', groupForm(null)); break;
    case 'edit-group': { const g = D.groupById(el.dataset.id); if (g) openSheet('group', groupForm(g)); break; }
    case 'g-color': f.color = el.dataset.c; renderSheet(); break;
    case 'g-icon': f.icon = el.dataset.i; renderSheet(); break;
    case 'g-sub-hide': { const s = f.subs.find((x) => x.key === el.dataset.k); if (s) { if (s.isNew) f.subs = f.subs.filter((x) => x !== s); else s.hidden = !s.hidden; } renderSheet(); break; }
    case 'g-add-sub':
      if (f.newSub && f.newSub.trim()) { f.subs.push({ id: '', name: f.newSub.trim(), hidden: false, need: f.id === 'bills', isNew: true, key: `n${Date.now()}` }); f.newSub = ''; delete S.errors.subs; }
      renderSheet();
      setTimeout(() => { const n = document.querySelector('[name="newSub"]'); if (n) n.focus(); }, 50);
      break;
    case 'g-hide': f.hidden = !f.hidden; renderSheet(); break;
    case 'save-group': saveGroup(); break;
    case 'add-income': openSheet('income', { isNew: true, name: '', hidden: false }); break;
    case 'edit-income': { const s = D.incomeSources(true).find((x) => x.id === el.dataset.id); if (s) openSheet('income', { isNew: false, id: s.id, name: s.name, hidden: !!s.hidden, order: s.order }); break; }
    case 'i-hide': f.hidden = !f.hidden; renderSheet(); break;
    case 'save-income': saveIncome(); break;
    case 'bills-win': S.billsOffset = Math.max(0, Math.min(2, S.billsOffset + Number(el.dataset.d))); S.billsDay = null; renderMain(); break;
    case 'bills-mode': S.billsMode = el.dataset.m; S.billsDay = null; renderMain(); break;
    case 'cal-day': S.billsDay = S.billsDay === el.dataset.d ? null : el.dataset.d; renderMain(); break;
    case 'add-bill': openSheet('bill', billForm(null)); break;
    case 'edit-bill': { const b = billById(el.dataset.id); if (b) openSheet('bill', billForm(b)); break; }
    case 'bill-kind': f.kind = el.dataset.k; S.errors = {}; renderSheet(); break;
    case 'bill-varies': f.varies = !f.varies; renderSheet(); break;
    case 'bill-freq': f.freq = el.dataset.f; renderSheet(); break;
    case 'bill-month': f.dueMonth = Number(el.dataset.m); renderSheet(); break;
    case 'save-bill': saveBill(); break;
    case 'archive-bill': {
      const id = f.id; const archived = !f.archived;
      closeSheet();
      fb.saveDoc('bills', id, { archived }, false);
      toast(archived ? 'Bill stopped. Its past payments stay.' : 'Bill restarted');
      break;
    }
    case 'delete-bill': {
      const b = billById(f.id);
      const { id, ...rest } = b;
      closeSheet();
      fb.removeDoc('bills', id);
      toast('Bill deleted', () => fb.restoreDoc('bills', id, rest));
      break;
    }
    case 'pay-bill': { const b = billById(el.dataset.id); if (b) { openSheet('entry', payBillForm(b, el.dataset.due)); } break; }
    case 'add-detected': {
      const found = D.detectBills(S.txns, S.bills, D.todayISO(), settings().dismissedBills || []).find((x) => x.key === el.dataset.k);
      if (found) openSheet('bill', billForm(null, found));
      break;
    }
    case 'dismiss-detected': {
      const list = [...new Set([...(settings().dismissedBills || []), el.dataset.k])];
      fb.saveHouseholdSettings({ ...settings(), dismissedBills: list }).catch(() => toast("Couldn't save. Check your connection."));
      toast('OK, it won’t be suggested again');
      break;
    }
    case 'open-payday': openSheet('payday', { day: String(payday()) }); break;
    case 'save-payday': {
      const day = Number(f.day);
      if (!(day >= 1 && day <= 31)) { S.errors = { day: 'Enter a day from 1 to 31.' }; renderSheet(); break; }
      closeSheet();
      fb.saveHouseholdSettings({ ...settings(), payday: day }).catch(() => toast("Couldn't save. Check your connection."));
      toast(`Payday set to the ${ordinal(day)}`);
      break;
    }
    case 'open-expected': {
      const p = currentPlan();
      openSheet('expected', { x_sree: poundsText(p.expected.sree), x_sha: poundsText(p.expected.sha), x_joint: poundsText(p.expected.joint) });
      break;
    }
    case 'reset-expected': {
      const p = currentPlan();
      const avg = D.expectedIncome(S.txns, S.accounts, p.win, payday());
      Object.assign(f, { x_sree: poundsText(avg.sree), x_sha: poundsText(avg.sha), x_joint: poundsText(avg.joint), reset: true });
      renderSheet();
      break;
    }
    case 'save-expected': {
      const vals = {};
      for (const k of ['sree', 'sha', 'joint']) {
        const v = f[`x_${k}`] ? evaluateToPence(f[`x_${k}`]) : 0;
        if (v === null || v < 0) { S.errors = { x: `Check ${D.PEOPLE[k].name}'s amount.` }; renderSheet(); return; }
        vals[k] = v;
      }
      const label = currentPlan().win.label;
      closeSheet();
      fb.mergeDoc('plans', label, { expected: f.reset ? null : vals }).catch(() => toast("Couldn't save. Check your connection."));
      toast('Expected pay saved');
      break;
    }
    // ----- Phase 4: pots -----
    case 'add-pot': openSheet('pot', potForm(null, el.dataset.preset)); break;
    case 'edit-pot': { const p = potById(el.dataset.id); if (p) openSheet('pot', potForm(p)); break; }
    case 'open-pot': S.view = 'pot'; S.viewArg = el.dataset.id; window.scrollTo(0, 0); renderMain(); renderNav(); break;
    case 'save-pot': savePot(); break;
    case 'archive-pot': {
      const id = f.id; const archived = !f.archived;
      closeSheet();
      fb.saveDoc('pots', id, { archived }, false);
      toast(archived ? 'Pot finished. Its history stays.' : 'Pot restarted');
      break;
    }
    case 'delete-pot': {
      const p = potById(f.id);
      const { id, ...rest } = p;
      closeSheet();
      S.view = 'pots'; renderMain();
      fb.removeDoc('pots', id);
      toast('Pot deleted', () => fb.restoreDoc('pots', id, rest));
      break;
    }
    case 'pot-move': {
      const p = potById(S.viewArg);
      if (!p) break;
      const st = D.potStatus(p, S.potMoves);
      const due = el.dataset.dir === 'add' && st.monthly ? Math.max(0, st.monthly - Math.max(0, st.thisMonth)) : 0;
      openSheet('potmove', { isNew: true, id: fb.newId('potMoves'), potId: p.id, dir: el.dataset.dir, amountText: due ? poundsText(due) : '', date: D.todayISO(), note: '' });
      break;
    }
    case 'edit-pot-move': {
      const m = S.potMoves.find((x) => x.id === el.dataset.id);
      if (m) openSheet('potmove', { isNew: false, id: m.id, potId: m.potId, dir: m.amount < 0 ? 'take' : 'add', amountText: poundsText(m.amount), date: m.date, note: m.note || '', original: m });
      break;
    }
    case 'pm-dir': f.dir = el.dataset.d; renderSheet(); break;
    case 'save-pot-move': savePotMove(); break;
    case 'delete-pot-move': {
      const { id, createdMs, ...rest } = f.original;
      closeSheet();
      fb.removeDoc('potMoves', id);
      toast('Removed', () => fb.restoreDoc('potMoves', id, rest));
      break;
    }
    case 'g-sub-need': { const s = f.subs.find((x) => x.key === el.dataset.k); if (s) s.need = !s.need; renderSheet(); break; }
    // ----- Phase 4: reports -----
    case 'report-mode': S.report.mode = el.dataset.m; renderMain(); break;
    case 'report-step': S.report.month = D.shiftMonth(S.report.month, Number(el.dataset.d)); renderMain(); break;
    case 'report-year': S.report.year += Number(el.dataset.d); renderMain(); break;
    case 'report-month': {
      const m = el.dataset.m;
      S.report = { ...S.report, mode: 'month', month: m, year: Number(m.slice(0, 4)) };
      if (el.dataset.seen) fb.mergeDoc('months', m, { reportSeen: true }).catch(() => {});
      if (S.view !== 'reports') { if (S.view === 'home') S.backTo = 'home'; S.view = 'reports'; S.viewArg = null; renderNav(); }
      window.scrollTo(0, 0);
      renderMain();
      break;
    }
    case 'report-group': {
      const m = S.report.month;
      S.search = { ...blankSearch(), groupId: el.dataset.id, scope: S.report.mode === 'month' && m === S.month ? 'month' : 'all' };
      if (S.report.mode === 'month' && m !== S.month) S.search.text = '';
      S.backTo = null; S.view = 'entries'; window.scrollTo(0, 0); renderMain(); renderNav();
      break;
    }
    // ----- Phase 4: close the month -----
    case 'open-close':
      if (S.view === 'home') S.backTo = 'home'; else if (S.view === 'more') S.backTo = null;
      S.closeDraft = {};
      S.view = 'close'; S.viewArg = el.dataset.m || null; window.scrollTo(0, 0); renderMain(); renderNav();
      break;
    case 'save-checks': {
      const m = el.dataset.m;
      const checks = { ...((S.months[m] && S.months[m].balanceChecks) || {}) };
      let bad = 0;
      for (const [id, txt] of Object.entries(S.closeDraft)) {
        if (!String(txt).trim()) { delete checks[id]; continue; }
        const v = evaluateToPence(txt);
        if (v === null) bad++; else checks[id] = v;
      }
      S.closeDraft = {};
      fb.mergeDoc('months', m, { balanceChecks: checks }).catch(() => toast("Couldn't save. Check your connection."));
      toast(bad ? `${bad} ${bad === 1 ? 'amount' : 'amounts'} didn't look right` : 'Checked');
      break;
    }
    case 'close-adjust': {
      const m = el.dataset.m;
      const c = D.closeChecks({ month: m, txns: S.txns, accounts: S.accounts, bills: S.bills, closing: S.months[m] || {} });
      const x = c.accounts.find((a) => a.account.id === el.dataset.id);
      if (!x || !x.diff) break;
      const amount = D.isDebt(x.account) ? -x.diff : x.diff;
      const data = { type: 'adjust', amount, date: c.end, month: m, accountId: x.account.id, toAccountId: null, categoryId: null, note: 'Balance check', calc: null, createdBy: myRole(), updatedBy: myRole() };
      fb.saveDoc('transactions', fb.newId('transactions'), data, true).catch(() => toast("Couldn't save the adjustment."));
      toast(`Adjusted ${x.account.name} by ${D.money(Math.abs(amount))}`);
      break;
    }
    case 'close-show':
      S.search = el.dataset.k === 'flagged' ? { ...blankSearch(), flagged: true, scope: 'all' } : { ...blankSearch(), groupId: 'other', scope: 'all' };
      S.backTo = null; S.view = 'entries'; window.scrollTo(0, 0); renderMain(); renderNav();
      break;
    case 'close-month': {
      const m = el.dataset.m;
      fb.mergeDoc('months', m, { closed: true, closedAt: D.todayISO(), closedBy: myRole() }).catch(() => toast("Couldn't close. Check your connection."));
      window.scrollTo(0, 0);
      toast(`${D.monthLabel(m)} closed`);
      break;
    }
    case 'reopen-month': {
      const m = el.dataset.m;
      fb.mergeDoc('months', m, { closed: false }).catch(() => toast("Couldn't reopen. Check your connection."));
      toast(`${D.monthLabel(m)} reopened`);
      break;
    }
    // ----- Phase 5: import -----
    case 'imp-acc': S.imp = { step: 'start', accountId: el.dataset.id }; renderMain(); break;
    case 'imp-showmap': S.imp.showMap = !S.imp.showMap; renderMain(); break;
    case 'imp-order': S.imp.map.order = el.dataset.o; rebuildImport(); renderMain(); break;
    case 'imp-sign': S.imp.spendSign = el.dataset.s; rebuildImport(); renderMain(); break;
    case 'imp-tick': {
      const it = S.imp.items.find((x) => x.key === el.dataset.k);
      if (it && CSV.itemReady(it) && it.status !== 'closed') { it.include = !it.include; if (it.include && it.status !== 'ready') it.status = 'ready'; }
      renderMain();
      break;
    }
    case 'imp-edit': {
      const it = S.imp.items.find((x) => x.key === el.dataset.k);
      if (!it) break;
      if (it.status === 'closed') { toast(`${D.monthLabel(D.monthOf(it.date))} is closed. Reopen it to add to it.`); break; }
      const cat = D.categoryById(it.categoryId);
      openSheet('improw', { ...it, choice: it.status === 'skip' ? 'skip' : it.type, shop: it.type === 'spend' ? it.shop : (it.raw || it.shop), groupId: cat && cat.group ? cat.group.id : '', all: true });
      break;
    }
    case 'ir-type':
      f.choice = el.dataset.t; S.errors = {};
      if (f.choice === 'income' && !String(f.categoryId || '').startsWith('income.')) f.categoryId = incomeDefault(S.imp.accountId);
      if (f.choice === 'spend' && String(f.categoryId || '').startsWith('income.')) { f.categoryId = ''; f.groupId = ''; }
      renderSheet();
      break;
    case 'ir-all': f.all = !f.all; renderSheet(); break;
    case 'ir-save': saveImpRow(); break;
    case 'imp-cancel': S.imp = { step: 'start', accountId: S.imp.accountId }; window.scrollTo(0, 0); renderMain(); break;
    case 'imp-go': {
      const I = S.imp;
      const list = I.items.filter((it) => it.include && CSV.itemReady(it) && it.status !== 'closed');
      if (!list.length) break;
      const role = myRole();
      const ids = [];
      const writes = list.map((it) => {
        const id = fb.newId('transactions');
        ids.push(id);
        return fb.saveDoc('transactions', id, { ...CSV.itemToEntry(it, I.accountId), createdBy: role, updatedBy: role }, true);
      });
      Promise.all(writes).catch(() => toast("Some entries didn't save. Check your connection."));
      LS.set(`imp.${I.accountId}`, { spendSign: I.spendSign });
      S.imp = { step: 'done', accountId: I.accountId, fileName: I.fileName, imported: list.length, left: I.items.length - list.length };
      window.scrollTo(0, 0);
      renderMain();
      toast(`Imported ${list.length} ${list.length === 1 ? 'entry' : 'entries'}`, () => Promise.all(ids.map((id) => fb.removeDoc('transactions', id))));
      break;
    }
    case 'imp-again': S.imp = { step: 'start', accountId: S.imp.accountId }; renderMain(); break;
    case 'imp-see': S.search = { ...blankSearch(), scope: 'all' }; S.backTo = null; S.view = 'entries'; window.scrollTo(0, 0); renderMain(); renderNav(); break;
    case 'export': exportData().catch((e) => { console.error(e); toast("Couldn't export. Try again."); }); break;
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
    case 'pick-group': {
      f.groupId = el.dataset.id;
      const g = D.groupById(f.groupId);
      const cur = D.groupOf(f.categoryId);
      if (!cur || cur.id !== f.groupId) {
        const subs = D.visibleSubs(g);
        f.categoryId = subs.length === 1 ? subs[0].id : '';
      }
      renderSheet();
      break;
    }
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

let searchTimer;
document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (el.id === 'q') {
    // Search: update only the results so the keyboard stays up.
    S.search.text = el.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { const r = $('#results'); if (r) r.innerHTML = entriesResults(); }, 120);
    return;
  }
  if (el.name && el.name.startsWith('chk:')) { S.closeDraft[el.name.slice(4)] = el.value; return; }
  if (!el.name || !S.sheet) return;
  if (el.name.startsWith('sub:')) {
    const s = S.form.subs && S.form.subs.find((x) => x.key === el.name.slice(4));
    if (s) s.name = el.value;
    return;
  }
  S.form[el.name] = el.value;
  if (el.name === 'shop') {
    S.form.shopApplied = false;
    const box = $('#shop-sugg');
    if (box) box.innerHTML = shopSuggestions();
  }
  if (el.name === 'amountText') { updateCalc(); if (S.errors.amount) { delete S.errors.amount; const e = el.closest('.field').querySelector('.err'); if (e) e.remove(); } }
  if (el.name === 'day' && S.sheet === 'payday') { const p = $('#payday-preview'); if (p) p.textContent = paydayPreview(); }
  if (S.sheet === 'pot' && (el.name === 'byMonth' || el.name === 'targetText')) { const h = $('#pot-month-hint'); if (h) h.textContent = potMonthHint(); }
  if (el.name === 'checkText') { const l = $('#check-line'); if (l) l.innerHTML = checkLine(); }
  if (el.name === 'name' && S.errors.name) { delete S.errors.name; const e = el.closest('.field').querySelector('.err'); if (e) e.remove(); }
});
document.addEventListener('change', (ev) => {
  if (ev.target.id === 'imp-file') { loadStatement(ev.target.files && ev.target.files[0]); return; }
  if (ev.target.dataset && ev.target.dataset.impMap) { S.imp.map[ev.target.dataset.impMap] = Number(ev.target.value); rebuildImport(); renderMain(); return; }
  if (ev.target.name === 'date' && S.sheet === 'entry') renderSheet();
  if (ev.target.name === 'openingDate' || ev.target.name === 'type') renderSheet();
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && S.sheet) closeSheet();
  if (ev.key === 'Enter' && S.sheet === 'entry' && ev.target.id === 'f-amount') { ev.preventDefault(); saveEntry(); }
  if (ev.key === 'Enter' && S.sheet === 'group' && ev.target.name === 'newSub') { ev.preventDefault(); document.querySelector('[data-act="g-add-sub"]').click(); }
  if (ev.key === 'Enter' && ev.target.id === 'q') { ev.preventDefault(); ev.target.blur(); }
  const g = gate();
  if ((g === 'pin-set' || g === 'pin-unlock') && /^[0-9]$/.test(ev.key)) pinKey(ev.key);
  if ((g === 'pin-set' || g === 'pin-unlock') && ev.key === 'Backspace') { S.pin.buffer = S.pin.buffer.slice(0, -1); render(); }
});

// ---------- start ----------
PIN.watchBackground(() => { if (PIN.hasPin() && S.user) { S.locked = true; S.bioTried = false; closeSheet(); render(); } });
PIN.bioAvailable().then((ok) => { S.bioSupported = ok; if (S.view === 'more') renderMain(); });

fb.finishRedirect();
fb.watchAuth((user) => {
  S.authReady = true;
  const changed = (S.user && S.user.uid) !== (user && user.uid);
  S.user = user;
  if (!user) {
    stopData();
    S.household = null; S.householdLoaded = false; S.accounts = []; S.txns = []; S.trips = []; S.bills = []; S.plans = {}; S.pots = []; S.potMoves = []; S.months = {}; S.imp = null; S.closeDraft = {}; S.denied = false;
    D.setCategories([]);
  } else if (changed) {
    S.householdLoaded = false;
    startData();
  }
  render();
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
