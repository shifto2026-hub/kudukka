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
};

// Phase 1 categories live in code with stable ids, so they can move to Firestore later.
export const SPEND_GROUPS = [
  { id: 'bills', name: 'Bills', color: '#5C633E', icon: 'bills', subs: [
    ['rent', 'Rent or mortgage'], ['council', 'Council tax'], ['energy', 'Energy'], ['water', 'Water'],
    ['broadband', 'Broadband'], ['phones', 'Phones'], ['subs', 'Subscriptions'], ['insurance', 'Insurance'],
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

const CATEGORY_INDEX = (() => {
  const m = {};
  for (const g of SPEND_GROUPS) {
    for (const [sid, sname] of g.subs) m[`${g.id}.${sid}`] = { id: `${g.id}.${sid}`, name: sname, group: g };
  }
  for (const s of INCOME_SOURCES) m[s.id] = { id: s.id, name: s.name, group: null };
  return m;
})();

export const categoryById = (id) => CATEGORY_INDEX[id] || null;
export const groupOf = (id) => (CATEGORY_INDEX[id] && CATEGORY_INDEX[id].group) || null;

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

// Entries that belong in a person's view for a month, newest first.
export function entriesFor(txns, accounts, month, person) {
  const acc = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const owns = (id) => acc[id] && (person === 'home' || acc[id].owner === person);
  return txns
    .filter((t) => t.month === month && (owns(t.accountId) || (t.type === 'transfer' && owns(t.toAccountId))))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdMs || 0) - (a.createdMs || 0)));
}
