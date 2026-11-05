// Kudukka — Phase 1: sign-in, PIN lock, accounts and cards, entries, working month, Home summary.
// Phase 2: editable categories and income sources, trips, shop memory and quick repeat, search and filters,
// "Ask Sree/Sha" flags, spending donut, export.
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
  bioSupported: false,
  bioTried: false,
  trips: [],
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
  const views = { home: viewHome, entries: viewEntries, accounts: viewAccounts, more: viewMore, trips: viewTrips, trip: viewTrip, categories: viewCategories };
  // Keep the search box focused (and its cursor) while results update underneath.
  const q = document.activeElement && document.activeElement.id === 'q' ? document.activeElement.selectionStart : null;
  main.innerHTML = header() + (views[v] || viewMore)();
  if (q !== null) { const el = $('#q'); if (el) { el.focus(); el.setSelectionRange(q, q); } }
}

// A small back bar for the screens inside More.
function subhead(title, back) {
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
  return `${monthPill()}${personSwitch()}${flagCard()}${tripCard()}
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
    title = t.note || (to && to.type === 'credit' ? `Paid ${to.name}` : 'Transfer');
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
    <section class="card">
      <h2 class="h3">Coming next</h2>
      <p class="muted">Phase 3 brings bills, a calendar of bills and paydays, next month's prediction and the direct debit guard. Then pots and reports.</p>
    </section>
    <p class="footer-note"><span class="tagline-sm">Neeyum Njanum, Oru Kudukka</span><br>Phase 2</p>`;
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
  const tab = ['trips', 'trip', 'categories'].includes(S.view) ? 'more' : S.view;
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
  const sheets = { entry: sheetEntry, account: sheetAccount, month: sheetMonth, filters: sheetFilters, trip: sheetTrip, group: sheetGroup, income: sheetIncome };
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
    shop: '', tripId: '', flag: false, flagFor: '', flagNote: '',
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
    shop: t.shop || '', tripId: t.tripId || '', flag: !!t.flag, flagFor: t.flagFor || '', flagNote: t.flagNote || '',
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
    ${outside}${err('date')}
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
    shop: f.type === 'spend' ? (f.shop || '').trim() : '',
    tripId: f.type === 'spend' && f.tripId ? f.tripId : null,
    flag: !!f.flag,
    flagFor: f.flag ? (f.flagFor || otherRole()) : null,
    flagNote: f.flag ? (f.flagNote || '').trim() : '',
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
    subs: g.subs.map((s, i) => ({ id: s.id, name: s.name, hidden: !!s.hidden, key: `s${i}` })), newSub: '' };
}

function sheetGroup() {
  const f = S.form;
  const swatches = D.GROUP_COLORS.map((c) => `<button type="button" class="swatch${f.color === c ? ' on' : ''}" style="background:${c}" data-act="g-color" data-c="${c}" aria-label="Colour ${c}" aria-pressed="${f.color === c}"></button>`).join('');
  const icons = D.GROUP_ICONS.map((i) => `<button type="button" class="icon-pick${f.icon === i ? ' on' : ''}" style="--c:${f.color}" data-act="g-icon" data-i="${i}" aria-label="Icon ${i}" aria-pressed="${f.icon === i}">${icon(i, 20)}</button>`).join('');
  const subs = f.subs.map((s) => `<div class="sub-row${s.hidden ? ' is-hidden' : ''}">
      <input name="sub:${s.key}" class="input" maxlength="30" value="${esc(s.name)}" aria-label="Subcategory name">
      <button type="button" class="btn btn-ghost btn-sm" data-act="g-sub-hide" data-k="${s.key}">${s.hidden ? 'Show' : 'Hide'}</button>
    </div>`).join('');
  return `<div class="sheet-head"><h2 class="h2" id="sheet-title">${f.isNew ? 'New category group' : 'Edit category'}</h2><button type="button" class="icon-btn" data-act="sheet-close" aria-label="Close">${icon('x', 22)}</button></div>
    <div class="preview-row"><span class="gicon lg" style="background:${f.color}">${icon(f.icon, 22)}</span><span class="entry-title">${esc(f.name || 'New group')}</span></div>
    <div class="field"><label class="label" for="g-name">Name</label><input id="g-name" name="name" class="input" maxlength="30" value="${esc(f.name)}" ${f.isNew ? 'data-autofocus' : ''}>${err('name')}</div>
    <div class="field"><span class="label">Colour</span><div class="swatches">${swatches}</div></div>
    <div class="field"><span class="label">Icon</span><div class="icon-grid">${icons}</div></div>
    <div class="field"><span class="label">Subcategories</span>${subs}
      <div class="sub-row"><input name="newSub" class="input" maxlength="30" placeholder="Add a subcategory" value="${esc(f.newSub)}" aria-label="New subcategory">
      <button type="button" class="btn btn-ghost btn-sm" data-act="g-add-sub">${icon('plus', 16)} Add</button></div>${err('subs')}</div>
    ${f.isNew ? '' : `<button type="button" class="toggle-row" data-act="g-hide" aria-pressed="${f.hidden}">
      <span class="entry-main"><span class="entry-title">Hide this group</span><span class="entry-sub">Old entries keep it; it just stops showing when you add new ones</span></span>
      <span class="switch${f.hidden ? ' on' : ''}" aria-hidden="true"></span></button>`}
    <div class="sheet-actions"><button type="button" class="btn btn-primary grow" data-act="save-group">${f.isNew ? 'Add group' : 'Save'}</button></div>`;
}

function saveGroup() {
  const f = S.form;
  if (f.newSub && f.newSub.trim()) { f.subs.push({ id: '', name: f.newSub.trim(), hidden: false, isNew: true, key: `n${Date.now()}` }); f.newSub = ''; }
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
    writes.push(fb.mergeDoc('categories', sid, { kind: 'sub', parent: gid, name: s.name.trim(), hidden: !!s.hidden, order: i * 10 }));
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
      if (f.newSub && f.newSub.trim()) { f.subs.push({ id: '', name: f.newSub.trim(), hidden: false, isNew: true, key: `n${Date.now()}` }); f.newSub = ''; delete S.errors.subs; }
      renderSheet();
      setTimeout(() => { const n = document.querySelector('[name="newSub"]'); if (n) n.focus(); }, 50);
      break;
    case 'g-hide': f.hidden = !f.hidden; renderSheet(); break;
    case 'save-group': saveGroup(); break;
    case 'add-income': openSheet('income', { isNew: true, name: '', hidden: false }); break;
    case 'edit-income': { const s = D.incomeSources(true).find((x) => x.id === el.dataset.id); if (s) openSheet('income', { isNew: false, id: s.id, name: s.name, hidden: !!s.hidden, order: s.order }); break; }
    case 'i-hide': f.hidden = !f.hidden; renderSheet(); break;
    case 'save-income': saveIncome(); break;
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
    S.household = null; S.householdLoaded = false; S.accounts = []; S.txns = []; S.trips = []; S.denied = false;
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
