// Pure data helpers: people, categories, money, dates, balances and month totals.
// No Firebase here, so this file can be tested on its own.

export const PEOPLE = {
  sree: { id: 'sree', name: 'Sree', color: '#225D65', ink: '#FFFFFF' },
  sha: { id: 'sha', name: 'Sha', color: '#D39932', ink: '#3B2119' },
  joint: { id: 'joint', name: 'Joint', color: '#AE5238', ink: '#FFFFFF' },
};

export const ACCOUNT_TYPES = {
  current: 'Current account',
  savings: 'Savings',
  isa: 'ISA',
  cash: 'Cash',
  credit: 'Credit card',
  loan: 'Loan or finance',
};

// Cards and loans hold money owed: their balance is negative while something is owed.
export const isDebt = (a) => !!a && (a.type === 'credit' || a.type === 'loan');
// Money you can actually spend from (savings and ISAs are counted separately).
export const isSpendable = (a) => !!a && (a.type === 'current' || a.type === 'cash');
export const isSaving = (a) => !!a && (a.type === 'savings' || a.type === 'isa');

// Phase 1 categories live in code with stable ids, so they can move to Firestore later.
export const SPEND_GROUPS = [
  { id: 'bills', name: 'Bills', color: '#5C633E', icon: 'bills', subs: [
    ['rent', 'Rent or mortgage'], ['council', 'Council tax'], ['energy', 'Energy'], ['water', 'Water'],
    ['broadband', 'Broadband'], ['phones', 'Phones'], ['subs', 'Subscriptions'], ['insurance', 'Insurance'],
    ['interest', 'Interest and fees'],
  ] },
  { id: 'food', name: 'Food', color: '#8FA382', icon: 'food', subs: [
    ['groceries', 'Groceries'], ['eatingout', 'Eating out'], ['takeaway', 'Takeaway'],
  ] },
  { id: 'car', name: 'Car', color: '#7A2E22', icon: 'car', subs: [
    ['fuel', 'Fuel'], ['parking', 'Parking'], ['roadcharges', 'Road charges'], ['insurance', 'Car insurance'], ['servicing', 'Servicing and MOT'],
  ] },
  { id: 'travel', name: 'Travel', color: '#4F7F86', icon: 'travel', subs: [
    ['flights', 'Flights'], ['hotels', 'Hotels'], ['airportparking', 'Airport parking'], ['transport', 'Trains and transport'],
  ] },
  { id: 'shopping', name: 'Shopping', color: '#C98B6B', icon: 'shopping', subs: [
    ['clothes', 'Clothes'], ['household', 'Household'], ['personal', 'Personal care'], ['gifts', 'Gifts'],
  ] },
  { id: 'other', name: 'Other', color: '#8A7F74', icon: 'other', subs: [['general', 'General']] },
];

export const INCOME_SOURCES = [
  { id: 'income.sree', name: "Sree's pay" },
  { id: 'income.sha', name: "Sha's pay" },
  { id: 'income.other', name: 'Other income' },
];

export const ENTRY_TYPES = {
  spend: 'Spend',
  income: 'Income',
  transfer: 'Transfer',
  adjust: 'Adjust',
};

// ---------- editable categories (Phase 2) ----------
// The defaults above live in code. Firestore `categories` docs only hold edits and additions,
// keyed by the same ids, so old entries keep their categories and nothing needs seeding.
// Doc shapes: group { kind:'group', name, color, icon, order, hidden }
//             sub   { kind:'sub', parent:<group id>, name, order, hidden }
//             income{ kind:'income', name, order, hidden }
export const GROUP_COLORS = ['#5C633E', '#8FA382', '#7A2E22', '#4F7F86', '#C98B6B', '#8A7F74', '#7D5A6E', '#9C6B30', '#5D6B8A', '#B07B7B'];
export const GROUP_ICONS = ['bills', 'food', 'car', 'travel', 'shopping', 'other', 'home', 'gift', 'heart', 'health', 'work', 'phone', 'pet', 'learn'];

export function defaultCategoryDocs() {
  const docs = [];
  SPEND_GROUPS.forEach((g, gi) => {
    docs.push({ id: g.id, kind: 'group', name: g.name, color: g.color, icon: g.icon, order: gi * 10, hidden: false });
    g.subs.forEach(([sid, sname], si) => docs.push({ id: `${g.id}.${sid}`, kind: 'sub', parent: g.id, name: sname, order: si * 10, hidden: false }));
  });
  INCOME_SOURCES.forEach((s, i) => docs.push({ id: s.id, kind: 'income', name: s.name, order: i * 10, hidden: false }));
  return docs;
}

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(String(b.name));

export function buildCategoryIndex(rows = []) {
  const merged = {};
  for (const d of defaultCategoryDocs()) merged[d.id] = { ...d };
  for (const r of rows) if (r && r.id) merged[r.id] = { ...(merged[r.id] || {}), ...r };
  const all = Object.values(merged);
  const groups = all.filter((d) => d.kind === 'group').sort(byOrder).map((g) => ({ ...g, hidden: !!g.hidden, subs: [] }));
  const gById = Object.fromEntries(groups.map((g) => [g.id, g]));
  const byId = {};
  for (const s of all.filter((d) => d.kind === 'sub').sort(byOrder)) {
    const g = gById[s.parent] || gById.other;
    const sub = { id: s.id, name: s.name, order: s.order ?? 0, hidden: !!s.hidden, parent: g.id };
    g.subs.push(sub);
    byId[s.id] = { id: s.id, name: s.name, hidden: sub.hidden, group: g };
  }
  const incomes = all.filter((d) => d.kind === 'income').sort(byOrder).map((s) => ({ id: s.id, name: s.name, order: s.order ?? 0, hidden: !!s.hidden }));
  for (const s of incomes) byId[s.id] = { id: s.id, name: s.name, hidden: s.hidden, group: null };
  return { groups, gById, incomes, byId };
}

let CAT = buildCategoryIndex([]);
export function setCategories(rows) { CAT = buildCategoryIndex(rows); }
export const categoryById = (id) => CAT.byId[id] || null;
export const groupOf = (id) => (CAT.byId[id] && CAT.byId[id].group) || null;
export const groupById = (id) => CAT.gById[id] || null;
export const spendGroups = (includeHidden = false) => CAT.groups.filter((g) => includeHidden || !g.hidden);
export const visibleSubs = (g) => (g ? g.subs.filter((s) => !s.hidden) : []);
export const incomeSources = (includeHidden = false) => CAT.incomes.filter((s) => includeHidden || !s.hidden);

// A safe, readable id for a new category: "<prefix><slug>-<random>".
export function newCategoryId(prefix, name) {
  const slug = String(name || 'new').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 16) || 'new';
  return `${prefix}${slug}-${Math.random().toString(36).slice(2, 6)}`;
}

// ---------- money ----------
const GBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
const GBP0 = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
export const money = (pence) => GBP.format((pence || 0) / 100);
export const moneyShort = (pence) => (Math.abs(pence) >= 100000 && pence % 100 === 0 ? GBP0 : GBP).format((pence || 0) / 100);

// ---------- dates ----------
const pad = (n) => String(n).padStart(2, '0');
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const monthOf = (iso) => String(iso).slice(0, 7);
export const currentMonth = () => monthOf(todayISO());
export const monthStart = (m) => `${m}-01`;
export function monthEnd(m) {
  const [y, mo] = m.split('-').map(Number);
  return `${m}-${pad(new Date(y, mo, 0).getDate())}`;
}
export function shiftMonth(m, by) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + by, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthLabel = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
export const monthShort = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1].slice(0, 3)} ${m.slice(0, 4)}`;
export function dayLabel(iso) {
  const [y, mo, d] = iso.split('-').map(Number);
  const wd = new Date(y, mo - 1, d).toLocaleDateString('en-GB', { weekday: 'short' });
  return `${wd} ${d} ${MONTHS[mo - 1].slice(0, 3)}`;
}

// The date a new entry should get: stays inside the working month.
export function defaultEntryDate(workingMonth, lastUsedDate) {
  if (lastUsedDate && monthOf(lastUsedDate) === workingMonth) return lastUsedDate;
  if (workingMonth === currentMonth()) return todayISO();
  return monthStart(workingMonth);
}

// ---------- balances ----------
// Effect of one entry on one account, in pence.
export function effectOn(t, accountId) {
  const a = t.amount || 0;
  let e = 0;
  if (t.accountId === accountId) {
    if (t.type === 'income') e += a;
    else if (t.type === 'spend') e -= a;
    else if (t.type === 'transfer') e -= a;
    else if (t.type === 'adjust') e += a; // adjust amounts are signed
  }
  if (t.type === 'transfer' && t.toAccountId === accountId) e += a;
  return e;
}

// Balance after all entries dated on or after the account's opening date (up to `upTo`, if given).
// For credit cards the balance is negative when money is owed.
export function balanceOf(account, txns, upTo) {
  let b = account.openingBalance || 0;
  const from = account.openingDate || '0000-00-00';
  for (const t of txns) {
    if (t.date < from) continue;
    if (upTo && t.date > upTo) continue;
    b += effectOn(t, account.id);
  }
  return b;
}

// ---------- month totals ----------
// person: 'home' (everyone), 'sree' or 'sha'. Joint accounts count only on Home.
export function monthStats(txns, accounts, month, person) {
  const acc = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const inScope = (a) => !!a && (person === 'home' || a.owner === person);
  const s = {
    income: 0, spend: 0,
    incomeBy: { sree: 0, sha: 0, joint: 0 },
    spendBy: { sree: 0, sha: 0, joint: 0 },
    byGroup: {}, movedOut: 0, movedIn: 0, count: 0,
  };
  for (const t of txns) {
    if (t.month !== month) continue;
    const from = acc[t.accountId];
    if (t.type === 'income' && inScope(from)) {
      s.income += t.amount; s.incomeBy[from.owner] += t.amount; s.count++;
    } else if (t.type === 'spend' && inScope(from)) {
      s.spend += t.amount; s.spendBy[from.owner] += t.amount; s.count++;
      const g = groupOf(t.categoryId);
      const gid = g ? g.id : 'other';
      s.byGroup[gid] = (s.byGroup[gid] || 0) + t.amount;
    } else if (t.type === 'transfer' && person !== 'home') {
      const to = acc[t.toAccountId];
      if (!from || !to) continue;
      if (from.owner === person && to.owner !== person) { s.movedOut += t.amount; s.count++; }
      if (to.owner === person && from.owner !== person) { s.movedIn += t.amount; s.count++; }
    } else if ((t.type === 'transfer' || t.type === 'adjust') && inScope(from)) {
      s.count++;
    }
  }
  s.left = s.income - s.spend;
  return s;
}

const newestFirst = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdMs || 0) - (a.createdMs || 0));

// Entries that belong in a person's view for a month, newest first.
export function entriesFor(txns, accounts, month, person) {
  return searchEntries(txns, accounts, { month, person });
}

// ---------- search and filters (Phase 2) ----------
// opts: { person, month (null = all months), text, type, accountId, groupId, tripId, flagged }, trips for names.
export function searchEntries(txns, accounts, opts = {}, trips = []) {
  const person = opts.person || 'home';
  const acc = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const tripName = Object.fromEntries(trips.map((t) => [t.id, t.name]));
  const owns = (id) => acc[id] && (person === 'home' || acc[id].owner === person);
  const q = String(opts.text || '').trim().toLowerCase();
  return txns.filter((t) => {
    if (opts.month && t.month !== opts.month) return false;
    if (!(owns(t.accountId) || (t.type === 'transfer' && owns(t.toAccountId)))) return false;
    if (opts.type && t.type !== opts.type) return false;
    if (opts.accountId && t.accountId !== opts.accountId && t.toAccountId !== opts.accountId) return false;
    if (opts.groupId) { const g = groupOf(t.categoryId); if (!g || g.id !== opts.groupId) return false; }
    if (opts.tripId && t.tripId !== opts.tripId) return false;
    if (opts.flagged && !t.flag) return false;
    if (q) {
      const cat = categoryById(t.categoryId);
      const g = groupOf(t.categoryId);
      const hay = [
        t.shop, t.note, t.flagNote, t.calc, cat && cat.name, g && g.name,
        acc[t.accountId] && acc[t.accountId].name, acc[t.toAccountId] && acc[t.toAccountId].name,
        tripName[t.tripId], (Math.abs(t.amount || 0) / 100).toFixed(2),
      ].filter(Boolean).join(' ').toLowerCase();
      if (!q.split(/\s+/).every((w) => hay.includes(w.replace(/^£/, '')))) return false;
    }
    return true;
  }).sort(newestFirst);
}

// ---------- shop memory and quick repeat (Phase 2) ----------
export const shopKey = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// For each shop: how often it's used, and the category, account and type from its latest entry.
export function shopIndex(txns) {
  const idx = new Map();
  const sorted = [...txns].sort((a, b) => -newestFirst(a, b)); // oldest first, so the latest wins
  for (const t of sorted) {
    const k = shopKey(t.shop);
    if (!k) continue;
    const cur = idx.get(k) || { shop: t.shop.trim(), count: 0 };
    idx.set(k, { ...cur, shop: t.shop.trim(), count: cur.count + 1, categoryId: t.categoryId || null, accountId: t.accountId, type: t.type, lastDate: t.date });
  }
  return idx;
}

export function matchShops(idx, text, limit = 5) {
  const q = shopKey(text);
  if (!q) return [];
  const all = [...idx.values()];
  // A match at the start of the name or of any word ranks first ("st" → "Shell Staplehurst" before "Costa").
  const wordStart = (s) => shopKey(s.shop).split(' ').some((w) => w.startsWith(q)) || shopKey(s.shop).startsWith(q);
  const starts = all.filter(wordStart);
  const contains = all.filter((s) => !wordStart(s) && shopKey(s.shop).includes(q));
  const rank = (a, b) => b.count - a.count || (a.lastDate < b.lastDate ? 1 : -1);
  return [...starts.sort(rank), ...contains.sort(rank)].slice(0, limit);
}

// Recent distinct spends and incomes, to repeat with one tap.
export function recentTemplates(txns, limit = 6) {
  const seen = new Set();
  const out = [];
  const sorted = [...txns].filter((t) => t.type === 'spend' || t.type === 'income')
    .sort((a, b) => (b.createdMs || 0) - (a.createdMs || 0) || newestFirst(a, b));
  for (const t of sorted) {
    const k = shopKey(t.shop) || `${t.categoryId}|${t.accountId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ type: t.type, amount: Math.abs(t.amount || 0), accountId: t.accountId, categoryId: t.categoryId || null, shop: t.shop || '' });
    if (out.length >= limit) break;
  }
  return out;
}

// ---------- trips (Phase 2) ----------
export function tripStatus(trip, today = todayISO()) {
  if (trip.startDate && today < trip.startDate) return 'upcoming';
  if (trip.endDate && today > trip.endDate) return 'past';
  return 'now';
}
export const tripsOnDate = (trips, date) => trips.filter((t) => !t.archived && t.startDate && t.endDate && date >= t.startDate && date <= t.endDate);

export function tripStats(trip, txns, accounts) {
  const acc = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const s = { total: 0, byGroup: {}, spendBy: { sree: 0, sha: 0, joint: 0 }, entries: [] };
  for (const t of txns) {
    if (t.tripId !== trip.id || t.type !== 'spend') continue;
    s.total += t.amount;
    const g = groupOf(t.categoryId);
    const gid = g ? g.id : 'other';
    s.byGroup[gid] = (s.byGroup[gid] || 0) + t.amount;
    const owner = acc[t.accountId] ? acc[t.accountId].owner : 'joint';
    s.spendBy[owner] = (s.spendBy[owner] || 0) + t.amount;
    s.entries.push(t);
  }
  s.entries.sort(newestFirst);
  s.left = trip.budget ? trip.budget - s.total : null;
  return s;
}

// ---------- export (Phase 2) ----------
const cell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCSV = (rows) => rows.map((r) => r.map(cell).join(',')).join('\r\n');
const pounds = (p) => (p === null || p === undefined ? '' : (p / 100).toFixed(2));

export function entriesCSV(txns, accounts, trips = []) {
  const acc = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const trip = Object.fromEntries(trips.map((t) => [t.id, t.name]));
  const rows = [['Date', 'Type', 'Amount (£)', 'Account', 'Whose', 'To account', 'Category group', 'Category', 'Shop', 'Note', 'Trip', 'Sum typed', 'Ask flag', 'Flag note']];
  for (const t of [...txns].sort((a, b) => -newestFirst(a, b))) {
    const a = acc[t.accountId];
    const g = groupOf(t.categoryId);
    const c = categoryById(t.categoryId);
    rows.push([t.date, ENTRY_TYPES[t.type] || t.type, pounds(t.amount), a ? a.name : '', a ? PEOPLE[a.owner].name : '',
      acc[t.toAccountId] ? acc[t.toAccountId].name : '', g ? g.name : '', c ? c.name : '', t.shop || '', t.note || '',
      trip[t.tripId] || '', t.calc || '', t.flag ? `Ask ${PEOPLE[t.flagFor] ? PEOPLE[t.flagFor].name : ''}`.trim() : '', t.flagNote || '']);
  }
  return toCSV(rows);
}

export function accountsCSV(accounts, txns) {
  const rows = [['Account', 'Bank', 'Whose', 'Type', 'Balance now (£)', 'Opening balance (£)', 'Opening date', 'Credit limit (£)', 'Last 4', 'Due day', 'Archived']];
  for (const a of accounts) {
    rows.push([a.name, a.bank || '', PEOPLE[a.owner] ? PEOPLE[a.owner].name : a.owner, ACCOUNT_TYPES[a.type] || a.type,
      pounds(balanceOf(a, txns)), pounds(a.openingBalance || 0), a.openingDate || '', pounds(a.creditLimit ?? null),
      a.last4 || '', a.dueDay || '', a.archived ? 'Yes' : '']);
  }
  return toCSV(rows);
}

// ======================= Phase 3: bills, loans and the payday plan =======================

// ---------- dates for pay cycles ----------
const daysIn = (y, m) => new Date(y, m, 0).getDate(); // m = 1..12
const isoOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const plusMonths = (y, m, by) => { const d = new Date(y, m - 1 + by, 1); return [d.getFullYear(), d.getMonth() + 1]; };
const clampDay = (y, m, day) => Math.min(Math.max(1, Number(day) || 1), daysIn(y, m));
export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return isoOf(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}
export function daysBetween(a, b) {
  const t = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / 864e5);
}

// The "money month": pay on the payday covers the NEXT month.
// With payday 25: 25 Oct – 24 Nov is November's money.
export function moneyMonth(iso, payday = 25) {
  const [y, m, d] = iso.split('-').map(Number);
  let [sy, sm] = [y, m];
  if (d < clampDay(y, m, payday)) [sy, sm] = plusMonths(y, m, -1);
  const start = isoOf(sy, sm, clampDay(sy, sm, payday));
  const [ny, nm] = plusMonths(sy, sm, 1);
  const nextPayday = isoOf(ny, nm, clampDay(ny, nm, payday));
  return { label: `${ny}-${pad(nm)}`, start, end: addDays(nextPayday, -1), nextPayday };
}
export const nextMoneyMonth = (mm, payday = 25) => moneyMonth(mm.nextPayday, payday);
export const prevMoneyMonth = (mm, payday = 25) => moneyMonth(addDays(mm.start, -1), payday);
export function shortDate(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1].slice(0, 3)}`;
}

// ---------- bills ----------
// Bill doc: { name, kind:'bill'|'repayment', amount (pence), varies, freq:'monthly'|'yearly', dueDay, dueMonth,
//             accountId (paid from), toAccountId (repayments: the card or loan), categoryId, shop, archived }
export const BILL_FREQ = { monthly: 'Every month', yearly: 'Once a year' };
export const billKey = (b) => shopKey(b.shop || b.name);

// The bill's due date inside a window (a window spans at most two calendar months), or null.
export function billDueIn(bill, win) {
  if (!bill || bill.archived) return null;
  const [sy, sm] = win.start.split('-').map(Number);
  for (let k = 0; k <= 1; k++) {
    const [y, m] = plusMonths(sy, sm, k);
    if (bill.freq === 'yearly' && Number(bill.dueMonth) !== m) continue;
    const due = isoOf(y, m, clampDay(y, m, bill.dueDay));
    if (due >= win.start && due <= win.end) return due;
  }
  return null;
}

// An entry pays a bill when it's linked to it, or (for older entries) by shop name / transfer route.
export function matchesBill(t, bill) {
  if (t.billId) return t.billId === bill.id;
  if (bill.kind === 'repayment') return t.type === 'transfer' && t.toAccountId === bill.toAccountId && (!bill.accountId || t.accountId === bill.accountId);
  const k = billKey(bill);
  return t.type === 'spend' && !!k && shopKey(t.shop || t.note) === k;
}
export const billPayments = (bill, txns) => txns.filter((t) => matchesBill(t, bill)).sort(newestFirst);

// Fixed bills use their amount; bills that vary use the average of the last 3 payments.
export function billExpected(bill, txns) {
  if (!bill.varies) return bill.amount || 0;
  const last = billPayments(bill, txns).slice(0, 3);
  if (!last.length) return bill.amount || 0;
  return Math.round(last.reduce((n, t) => n + t.amount, 0) / last.length);
}
export const billMonthly = (bill, txns) => (bill.freq === 'yearly' ? Math.round(billExpected(bill, txns) / 12) : billExpected(bill, txns));

// Paid when a matching entry falls in the same money month (bills are often paid a few days early or late).
export const billPaidIn = (bill, txns, win) => billPayments(bill, txns).find((t) => t.date >= win.start && t.date <= win.end) || null;

// A fixed bill whose latest payment differs from its amount: the price changed.
export function billPriceChange(bill, txns) {
  if (bill.varies || !bill.amount) return null;
  const last = billPayments(bill, txns)[0];
  if (!last || last.amount === bill.amount) return null;
  return { from: bill.amount, to: last.amount, diff: last.amount - bill.amount, date: last.date };
}

// Every bill due in a window with its status: 'paid', 'due' or 'late' (due date passed, no entry yet).
export function billsForWindow(bills, txns, win, today) {
  return bills.filter((b) => !b.archived).map((b) => {
    const due = billDueIn(b, win);
    if (!due) return null;
    const paid = billPaidIn(b, txns, win);
    const expected = billExpected(b, txns);
    return {
      bill: b, due, paid, expected, amount: paid ? paid.amount : expected,
      status: paid ? 'paid' : today && due < today ? 'late' : 'due',
      daysTo: today ? daysBetween(today, due) : null,
    };
  }).filter(Boolean).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
}

// Yearly bills renewing within `days`: time to shop around.
export function renewalsSoon(bills, today, days = 28) {
  return bills.filter((b) => !b.archived && b.freq === 'yearly' && b.dueMonth).map((b) => {
    const [y] = today.split('-').map(Number);
    let next = isoOf(y, Number(b.dueMonth), clampDay(y, Number(b.dueMonth), b.dueDay));
    if (next < today) next = isoOf(y + 1, Number(b.dueMonth), clampDay(y + 1, Number(b.dueMonth), b.dueDay));
    return { bill: b, date: next, days: daysBetween(today, next) };
  }).filter((r) => r.days <= days).sort((a, b) => a.days - b.days);
}

// Spot regular charges: the same shop once a month, in 2+ of the last ~4 months, at a similar amount.
export function detectBills(txns, bills, today, dismissed = []) {
  const taken = new Set(bills.filter((b) => !b.archived).map(billKey));
  const from = monthOf(addDays(today, -125));
  const groups = new Map();
  for (const t of txns) {
    if (t.type !== 'spend' || t.month < from || t.billId) continue;
    const k = shopKey(t.shop || t.note);
    if (!k || taken.has(k) || dismissed.includes(k)) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const out = [];
  for (const [k, list] of groups) {
    const perMonth = {};
    for (const t of list) perMonth[t.month] = (perMonth[t.month] || 0) + 1;
    const months = Object.keys(perMonth);
    if (months.length < 2 || Object.values(perMonth).some((n) => n > 1)) continue;
    const amts = list.map((t) => t.amount).sort((a, b) => a - b);
    const mid = amts[Math.floor(amts.length / 2)];
    if (!mid || (amts.at(-1) - amts[0]) / mid > 0.3) continue;
    const days = list.map((t) => Number(t.date.slice(8))).sort((a, b) => a - b);
    const latest = [...list].sort(newestFirst)[0];
    out.push({
      key: k, name: (latest.shop || latest.note).trim(), amount: mid, varies: amts.at(-1) !== amts[0],
      dueDay: days[Math.floor(days.length / 2)], accountId: latest.accountId, categoryId: latest.categoryId || null, months: months.length,
    });
  }
  return out.sort((a, b) => b.months - a.months || b.amount - a.amount);
}

// ---------- income, spending and debts ----------
export function incomeIn(txns, accounts, win) {
  const acc = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const by = { sree: 0, sha: 0, joint: 0 };
  for (const t of txns) {
    if (t.type !== 'income' || t.date < win.start || t.date > win.end || !acc[t.accountId]) continue;
    by[acc[t.accountId].owner] += t.amount;
  }
  return by;
}

// Expected pay for a money month: average of the last 3 money months that had any pay entered.
// Copes with Sree's weekly or varying pay; the plan lets you override it.
export function expectedIncome(txns, accounts, win, payday = 25) {
  const sums = { sree: 0, sha: 0, joint: 0 };
  let w = win;
  let n = 0;
  for (let i = 0; i < 3; i++) {
    w = prevMoneyMonth(w, payday);
    const got = incomeIn(txns, accounts, w);
    if (!(got.sree + got.sha + got.joint)) continue;
    n++;
    for (const k of Object.keys(sums)) sums[k] += got[k];
  }
  const avg = (k) => (n ? Math.round(sums[k] / n) : 0);
  return { sree: avg('sree'), sha: avg('sha'), joint: avg('joint'), months: n };
}

// Typical everyday spending per week: the last 12 weeks, leaving out bills and trip spending.
export function weeklySpending(txns, bills, today, weeks = 12) {
  const from = addDays(today, -weeks * 7);
  const list = txns.filter((t) => t.type === 'spend' && t.date > from && t.date <= today && !t.tripId && !bills.some((b) => !b.archived && matchesBill(t, b)));
  if (!list.length) return 0;
  const first = list.reduce((m, t) => (t.date < m ? t.date : m), today);
  const span = Math.max(1, Math.min(weeks, Math.ceil((daysBetween(first, today) + 1) / 7)));
  return Math.round(list.reduce((n, t) => n + t.amount, 0) / span);
}

// Months to clear a debt at a monthly payment and yearly interest rate; null if it never clears.
export function monthsToClear(owed, monthlyPayment, apr = 0) {
  if (!owed || owed <= 0) return 0;
  if (!monthlyPayment || monthlyPayment <= 0) return null;
  const r = Number(apr) / 100 / 12;
  if (!r) return Math.ceil(owed / monthlyPayment);
  if (monthlyPayment <= owed * r) return null;
  return Math.ceil(-Math.log(1 - (r * owed) / monthlyPayment) / Math.log(1 + r));
}

export function debtsList(accounts, txns, bills) {
  return accounts.filter((a) => !a.archived && isDebt(a)).map((a) => {
    const owed = Math.max(0, -balanceOf(a, txns));
    const rep = bills.find((b) => !b.archived && b.kind === 'repayment' && b.toAccountId === a.id);
    const payment = rep ? billExpected(rep, txns) : null;
    return { account: a, owed, apr: Number(a.apr) || 0, payment, months: payment ? monthsToClear(owed, payment, a.apr) : null };
  }).filter((d) => d.owed > 0)
    // Highest interest first; equal rates → smallest balance first.
    .sort((x, y) => y.apr - x.apr || x.owed - y.owed);
}

// Per account: can it cover the bills it pays before the next payday?
export function debitGuard(accounts, txns, winBills) {
  return accounts.filter((a) => !a.archived && !isDebt(a)).map((a) => {
    const due = winBills.filter((b) => !b.paid && b.bill.accountId === a.id);
    if (!due.length) return null;
    const balance = balanceOf(a, txns);
    let run = balance;
    let shortDate = null;
    for (const b of due) { run -= b.expected; if (run < 0 && !shortDate) shortDate = b.due; }
    const total = due.reduce((n, b) => n + b.expected, 0);
    const after = balance - total;
    return { account: a, balance, due: total, after, count: due.length, lastDue: due.at(-1).due, shortDate, status: after < 0 ? 'short' : after < 5000 ? 'tight' : 'ok' };
  }).filter(Boolean).sort((x, y) => x.after - y.after);
}

// ---------- the payday plan ----------
// Money for the month = left in current/cash accounts + pay still to come − bills still due − card balances.
// What's free is then suggested as: spending money until payday, emergency savings, extra off debt, the rest for goals.
export const STARTER_EMERGENCY = 100000; // £1,000
export function paydayPlan({ txns, accounts, bills = [], today = todayISO(), payday = 25, incomeOverride = null }) {
  const win = moneyMonth(today, payday);
  const live = accounts.filter((a) => !a.archived);
  const accById = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const have = live.filter(isSpendable).reduce((n, a) => n + balanceOf(a, txns), 0);
  const saved = live.filter(isSaving).reduce((n, a) => n + balanceOf(a, txns), 0);
  const expected = incomeOverride ? { ...expectedIncome(txns, accounts, win, payday), ...incomeOverride } : expectedIncome(txns, accounts, win, payday);
  const received = incomeIn(txns, accounts, win);
  const comingBy = {};
  for (const k of ['sree', 'sha', 'joint']) comingBy[k] = Math.max(0, (expected[k] || 0) - (received[k] || 0));
  const coming = comingBy.sree + comingBy.sha + comingBy.joint;

  const winBills = billsForWindow(bills, txns, win, today);
  // Card balances are counted in full below, so repayment bills to cards aren't counted twice.
  const unpaid = winBills.filter((b) => !b.paid && !(b.bill.kind === 'repayment' && accById[b.bill.toAccountId] && accById[b.bill.toAccountId].type === 'credit'));
  const billsDue = unpaid.reduce((n, b) => n + b.expected, 0);
  const cards = live.filter((a) => a.type === 'credit').map((a) => ({ account: a, owed: Math.max(0, -balanceOf(a, txns)) })).filter((c) => c.owed > 0);
  const cardsOwed = cards.reduce((n, c) => n + c.owed, 0);
  const free = have + coming - billsDue - cardsOwed;

  const daysLeft = Math.max(1, daysBetween(today, win.end) + 1);
  const weeksLeft = daysLeft / 7;
  const typicalWeek = weeklySpending(txns, bills, today);
  const essentials = bills.filter((b) => !b.archived && b.kind !== 'repayment').reduce((n, b) => n + billMonthly(b, txns), 0);
  const emergencyTarget = Math.max(STARTER_EMERGENCY, essentials * 3);
  const debts = debtsList(accounts, txns, bills).filter((d) => d.account.type === 'loan');

  const suggestions = [];
  let left = free;
  if (free < 0) {
    suggestions.push({ kind: 'short', amount: -free });
  } else {
    const spend = Math.min(left, Math.round(typicalWeek * weeksLeft));
    suggestions.push({ kind: 'spend', amount: spend, perWeek: Math.round(spend / Math.max(1, weeksLeft)), typicalWeek });
    left -= spend;
    if (left > 0 && saved < emergencyTarget) {
      // Below the £1,000 starter: fill that first. Above it: half of what's left, up to the target.
      const put = saved < STARTER_EMERGENCY ? Math.min(left, STARTER_EMERGENCY - saved) : Math.min(Math.round(left / 2), emergencyTarget - saved);
      if (put > 0) { suggestions.push({ kind: 'emergency', amount: put, saved, target: emergencyTarget }); left -= put; }
    }
    if (left > 0 && debts.length) {
      const d = debts[0];
      const put = Math.min(d.owed, Math.round(left / 2));
      if (put > 0) {
        const after = d.payment ? monthsToClear(d.owed - put, d.payment, d.apr) : null;
        suggestions.push({ kind: 'debt', amount: put, debt: d, monthsSooner: d.months !== null && after !== null ? Math.max(0, d.months - after) : null });
        left -= put;
      }
    }
    if (left > 0) suggestions.push({ kind: 'goals', amount: left });
  }
  const spendTip = suggestions.find((s) => s.kind === 'spend');
  return {
    win, today, have, saved, expected, received, comingBy, coming, winBills, unpaid, billsDue, cards, cardsOwed, free,
    daysLeft, weeksLeft, typicalWeek, essentials, emergencyTarget, debts, suggestions,
    safePerWeek: spendTip ? spendTip.perWeek : 0,
    guard: debitGuard(accounts, txns, winBills),
  };
}
