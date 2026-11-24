import assert from 'node:assert/strict';
import { evaluateToPence, isSum } from '../js/calc.js';
import * as D from '../js/data.js';

// calculator
assert.equal(evaluateToPence('12.40 + 8.99 + 23'), 4439);
assert.equal(evaluateToPence('3 × 2.50'), 750);
assert.equal(evaluateToPence('3x2.5'), 750);
assert.equal(evaluateToPence('£1,200'), 120000);
assert.equal(evaluateToPence('10 ÷ 4'), 250);
assert.equal(evaluateToPence('(2+3)*2'), 1000);
assert.equal(evaluateToPence('5 - 7.25'), -225);
assert.equal(evaluateToPence('1..2'), null);
assert.equal(evaluateToPence('2 +'), null);
assert.equal(evaluateToPence('abc'), null);
assert.equal(evaluateToPence(''), null);
assert.equal(evaluateToPence('0.1+0.2'), 30);
assert.ok(isSum('12 + 3'));
assert.ok(!isSum('12.50'));
assert.ok(!isSum('-5'));

// dates
assert.equal(D.monthEnd('2026-02'), '2026-02-28');
assert.equal(D.monthEnd('2028-02'), '2028-02-29');
assert.equal(D.shiftMonth('2026-01', -1), '2025-12');
assert.equal(D.monthLabel('2026-10'), 'October 2026');
assert.equal(D.defaultEntryDate('2026-10', '2026-10-14'), '2026-10-14');
assert.equal(D.defaultEntryDate('2020-03', '2026-10-14'), '2020-03-01');
assert.equal(D.defaultEntryDate(D.currentMonth(), null), D.todayISO());

// balances and month totals
const accounts = [
  { id: 'sreeBank', owner: 'sree', type: 'current', openingBalance: 50000, openingDate: '2026-10-01' },
  { id: 'shaBank', owner: 'sha', type: 'current', openingBalance: 20000, openingDate: '2026-10-01' },
  { id: 'card', owner: 'sha', type: 'credit', openingBalance: -10000, openingDate: '2026-10-01' },
  { id: 'joint', owner: 'joint', type: 'savings', openingBalance: 0, openingDate: '2026-10-01' },
];
const t = (o) => ({ month: o.date.slice(0, 7), ...o });
const txns = [
  t({ id: 1, type: 'income', amount: 200000, date: '2026-10-25', accountId: 'sreeBank', categoryId: 'income.sree' }),
  t({ id: 2, type: 'income', amount: 150000, date: '2026-10-28', accountId: 'shaBank', categoryId: 'income.sha' }),
  t({ id: 3, type: 'spend', amount: 4439, date: '2026-10-05', accountId: 'card', categoryId: 'food.groceries' }),
  t({ id: 4, type: 'spend', amount: 6000, date: '2026-10-06', accountId: 'sreeBank', categoryId: 'car.fuel' }),
  t({ id: 5, type: 'transfer', amount: 100000, date: '2026-10-26', accountId: 'sreeBank', toAccountId: 'shaBank' }),
  t({ id: 6, type: 'transfer', amount: 14439, date: '2026-10-29', accountId: 'shaBank', toAccountId: 'card' }),
  t({ id: 7, type: 'adjust', amount: -500, date: '2026-10-30', accountId: 'shaBank' }),
  t({ id: 8, type: 'spend', amount: 999, date: '2026-09-30', accountId: 'shaBank', categoryId: 'food.takeaway' }), // before opening
  t({ id: 9, type: 'spend', amount: 2500, date: '2026-11-02', accountId: 'joint', categoryId: 'bills.water' }),
];
const bal = (id) => D.balanceOf(accounts.find((a) => a.id === id), txns);
assert.equal(bal('sreeBank'), 50000 + 200000 - 6000 - 100000);
assert.equal(bal('shaBank'), 20000 + 150000 + 100000 - 14439 - 500);
assert.equal(bal('card'), -10000 - 4439 + 14439); // cleared to 0
assert.equal(bal('joint'), -2500);

const home = D.monthStats(txns, accounts, '2026-10', 'home');
assert.equal(home.income, 350000);
assert.equal(home.spend, 10439); // transfers and card payment not counted
assert.equal(home.left, 339561);
assert.equal(home.byGroup.food, 4439);
assert.equal(home.byGroup.car, 6000);
assert.equal(home.spendBy.sha, 4439);
assert.equal(home.spendBy.sree, 6000);

const sree = D.monthStats(txns, accounts, '2026-10', 'sree');
assert.equal(sree.income, 200000);
assert.equal(sree.spend, 6000);
assert.equal(sree.movedOut, 100000);
assert.equal(sree.movedIn, 0);
const sha = D.monthStats(txns, accounts, '2026-10', 'sha');
assert.equal(sha.movedIn, 100000);
assert.equal(sha.movedOut, 0); // paying her own card is not "moved"
assert.equal(D.monthStats(txns, accounts, '2026-11', 'sha').spend, 0); // joint only on Home
assert.equal(D.monthStats(txns, accounts, '2026-11', 'home').spend, 2500);

const list = D.entriesFor(txns, accounts, '2026-10', 'sree');
assert.deepEqual(list.map((x) => x.id), [5, 1, 4]);

// ---------- Phase 2: editable categories ----------
// Defaults keep their ids, so Phase 1 entries still resolve.
assert.equal(D.categoryById('food.groceries').name, 'Groceries');
assert.equal(D.groupOf('car.fuel').id, 'car');
D.setCategories([
  { id: 'food.takeaway', name: 'Takeaways' },
  { id: 'food.coffee-ab12', kind: 'sub', parent: 'food', name: 'Coffee', order: 35 },
  { id: 'gpets-xx', kind: 'group', name: 'Pets', color: '#7D5A6E', icon: 'pet', order: 55 },
  { id: 'gpets-xx.food', kind: 'sub', parent: 'gpets-xx', name: 'Pet food', order: 0 },
  { id: 'travel', hidden: true },
  { id: 'income.sree2-q', kind: 'income', name: "Sree's second job", order: 5 },
]);
assert.equal(D.categoryById('food.takeaway').name, 'Takeaways');
assert.deepEqual(D.visibleSubs(D.groupById('food')).map((x) => x.name), ['Groceries', 'Eating out', 'Takeaways', 'Coffee']);
assert.ok(!D.spendGroups().some((g) => g.id === 'travel'), 'hidden group not offered');
assert.ok(D.spendGroups(true).some((g) => g.id === 'travel'), 'hidden group still known');
assert.equal(D.groupOf('travel.flights').id, 'travel', 'old travel entries still resolve');
assert.equal(D.groupOf('gpets-xx.food').name, 'Pets');
assert.deepEqual(D.incomeSources().map((x) => x.id), ['income.sree', 'income.sree2-q', 'income.sha', 'income.other']);
const catTx = [t({ id: 'c1', type: 'spend', amount: 300, date: '2026-10-07', accountId: 'shaBank', categoryId: 'gpets-xx.food' })];
assert.equal(D.monthStats(catTx, accounts, '2026-10', 'home').byGroup['gpets-xx'], 300);
assert.ok(/^food\.coffee-[a-z0-9]{1,4}$/.test(D.newCategoryId('food.', 'Coffee!')));
D.setCategories([]);
assert.equal(D.categoryById('food.takeaway').name, 'Takeaway', 'reset to defaults');

// ---------- Phase 2: shop memory and quick repeat ----------
const shopTx = [
  t({ id: 's1', type: 'spend', amount: 4439, date: '2026-10-05', accountId: 'card', categoryId: 'food.groceries', shop: 'Tesco', createdMs: 1 }),
  t({ id: 's2', type: 'spend', amount: 2210, date: '2026-10-12', accountId: 'shaBank', categoryId: 'food.groceries', shop: ' tesco ', createdMs: 2 }),
  t({ id: 's3', type: 'spend', amount: 6000, date: '2026-10-06', accountId: 'sreeBank', categoryId: 'car.fuel', shop: 'Shell Staplehurst', createdMs: 3 }),
  t({ id: 's4', type: 'spend', amount: 850, date: '2026-10-20', accountId: 'card', categoryId: 'food.eatingout', shop: 'Costa', createdMs: 4 }),
  t({ id: 's5', type: 'spend', amount: 1200, date: '2026-10-21', accountId: 'card', categoryId: 'food.eatingout', createdMs: 5 }),
];
const idx = D.shopIndex(shopTx);
assert.equal(idx.get('tesco').count, 2);
assert.equal(idx.get('tesco').accountId, 'shaBank', 'latest entry wins');
assert.deepEqual(D.matchShops(idx, 'te').map((x) => x.shop), ['tesco']);
assert.deepEqual(D.matchShops(idx, 'st').map((x) => x.shop), ['Shell Staplehurst', 'Costa']);
assert.deepEqual(D.matchShops(idx, ''), []);
const tpl = D.recentTemplates(shopTx, 6);
assert.equal(tpl[0].amount, 1200);
assert.equal(tpl.filter((x) => D.shopKey(x.shop) === 'tesco').length, 1, 'one template per shop');

// ---------- Phase 2: search and filters ----------
const flagged = [...shopTx, t({ id: 'f1', type: 'spend', amount: 4000, date: '2026-09-15', accountId: 'sreeBank', categoryId: 'shopping.gifts', note: 'Mystery', flag: true, flagFor: 'sree', flagNote: 'What was this?', tripId: 'th' })];
const trips = [{ id: 'th', name: 'Thailand', startDate: '2026-09-10', endDate: '2026-09-24', budget: 200000 }];
assert.deepEqual(D.searchEntries(flagged, accounts, { text: 'tesco' }).map((x) => x.id), ['s2', 's1']);
assert.deepEqual(D.searchEntries(flagged, accounts, { text: '44.39' }).map((x) => x.id), ['s1']);
assert.deepEqual(D.searchEntries(flagged, accounts, { text: '£60' }).map((x) => x.id), ['s3']);
assert.deepEqual(D.searchEntries(flagged, accounts, { text: 'thailand' }, trips).map((x) => x.id), ['f1']);
assert.deepEqual(D.searchEntries(flagged, accounts, { flagged: true }).map((x) => x.id), ['f1']);
assert.deepEqual(D.searchEntries(flagged, accounts, { groupId: 'car' }).map((x) => x.id), ['s3']);
assert.deepEqual(D.searchEntries(flagged, accounts, { month: '2026-09' }).map((x) => x.id), ['f1']);
assert.deepEqual(D.searchEntries(flagged, accounts, { person: 'sree' }).map((x) => x.id), ['s3', 'f1']);
assert.deepEqual(D.searchEntries(flagged, accounts, { accountId: 'card', text: 'eating' }).map((x) => x.id), ['s5', 's4']);

// ---------- Phase 2: trips ----------
assert.equal(D.tripStatus(trips[0], '2026-09-01'), 'upcoming');
assert.equal(D.tripStatus(trips[0], '2026-09-15'), 'now');
assert.equal(D.tripStatus(trips[0], '2026-10-01'), 'past');
assert.deepEqual(D.tripsOnDate(trips, '2026-09-24').map((x) => x.id), ['th']);
assert.deepEqual(D.tripsOnDate(trips, '2026-09-25'), []);
const ts = D.tripStats(trips[0], flagged, accounts);
assert.equal(ts.total, 4000);
assert.equal(ts.left, 196000);
assert.equal(ts.spendBy.sree, 4000);

// ---------- Phase 2: export ----------
assert.equal(D.toCSV([['a', 'b,c', 'say "hi"', null]]), 'a,"b,c","say ""hi""",');
const csv = D.entriesCSV(flagged, accounts, trips).split('\r\n');
assert.equal(csv.length, flagged.length + 1);
assert.ok(csv[1].startsWith('2026-09-15,Spend,40.00,'), csv[1]);
assert.ok(csv[1].includes('Thailand') && csv[1].includes('Ask Sree'));
assert.ok(D.accountsCSV(accounts, txns).split('\r\n')[3].includes('Credit card'));

// ======================= Phase 3 =======================
// Money month: pay on the 25th covers the next month
assert.deepEqual(D.moneyMonth('2026-11-23', 25), { label: '2026-11', start: '2026-10-25', end: '2026-11-24', nextPayday: '2026-11-25' });
assert.deepEqual(D.moneyMonth('2026-11-25', 25), { label: '2026-12', start: '2026-11-25', end: '2026-12-24', nextPayday: '2026-12-25' });
assert.deepEqual(D.moneyMonth('2026-12-31', 25), { label: '2027-01', start: '2026-12-25', end: '2027-01-24', nextPayday: '2027-01-25' });
assert.deepEqual(D.moneyMonth('2027-02-27', 31), { label: '2027-02', start: '2027-01-31', end: '2027-02-27', nextPayday: '2027-02-28' });
assert.deepEqual(D.moneyMonth('2027-02-28', 31), { label: '2027-03', start: '2027-02-28', end: '2027-03-30', nextPayday: '2027-03-31' });
assert.equal(D.prevMoneyMonth(D.moneyMonth('2026-11-23')).label, '2026-10');
assert.equal(D.daysBetween('2026-11-03', '2026-11-24'), 21);

const win = D.moneyMonth('2026-11-03', 25); // 25 Oct – 24 Nov
assert.equal(D.billDueIn({ dueDay: 3 }, win), '2026-11-03');
assert.equal(D.billDueIn({ dueDay: 28 }, win), '2026-10-28');
assert.equal(D.billDueIn({ dueDay: 31 }, win), '2026-10-31');
assert.equal(D.billDueIn({ freq: 'yearly', dueMonth: 11, dueDay: 10 }, win), '2026-11-10');
assert.equal(D.billDueIn({ freq: 'yearly', dueMonth: 12, dueDay: 10 }, win), null);
assert.equal(D.billDueIn({ dueDay: 5, archived: true }, win), null);

// A realistic household
const P = [
  { id: 'sha', owner: 'sha', type: 'current', openingBalance: 50000, openingDate: '2026-08-01' },
  { id: 'sree', owner: 'sree', type: 'current', openingBalance: 20000, openingDate: '2026-08-01' },
  { id: 'sav', owner: 'joint', type: 'savings', openingBalance: 30000, openingDate: '2026-08-01' },
  { id: 'card', owner: 'sha', type: 'credit', openingBalance: 0, openingDate: '2026-08-01' },
  { id: 'loan', owner: 'joint', type: 'loan', openingBalance: -500000, openingDate: '2026-08-01', apr: 9.9 },
];
const ptx = [];
const add = (o) => ptx.push(t({ id: `p${ptx.length}`, createdMs: ptx.length, ...o }));
['2026-08-25', '2026-09-25', '2026-10-25'].forEach((date) => add({ type: 'income', amount: 150000, date, accountId: 'sha', categoryId: 'income.sha' }));
add({ type: 'income', amount: 120000, date: '2026-09-05', accountId: 'sree', categoryId: 'income.sree' });
add({ type: 'income', amount: 100000, date: '2026-10-05', accountId: 'sree', categoryId: 'income.sree' });
add({ type: 'income', amount: 40000, date: '2026-10-30', accountId: 'sree', categoryId: 'income.sree' });
['2026-09-01', '2026-10-01', '2026-11-01'].forEach((date) => add({ type: 'spend', amount: 90000, date, accountId: 'sha', categoryId: 'bills.rent', shop: 'Landlord' }));
[['2026-08-15', 8500], ['2026-09-15', 8700], ['2026-10-15', 8600]].forEach(([date, amount]) => add({ type: 'spend', amount, date, accountId: 'sree', categoryId: 'bills.energy', shop: 'Octopus' }));
['2026-09-10', '2026-10-10'].forEach((date) => add({ type: 'transfer', amount: 15000, date, accountId: 'sha', toAccountId: 'loan' }));
for (let i = 0; i < 12; i++) add({ type: 'spend', amount: 6000, date: D.addDays('2026-08-12', i * 7), accountId: 'sha', categoryId: 'food.groceries', shop: 'Tesco' });
add({ type: 'spend', amount: 4000, date: '2026-10-28', accountId: 'card', categoryId: 'shopping.household', shop: 'Amazon' });
const B = [
  { id: 'rent', name: 'Rent', kind: 'bill', amount: 90000, freq: 'monthly', dueDay: 1, accountId: 'sha', shop: 'Landlord' },
  { id: 'energy', name: 'Octopus', kind: 'bill', amount: 8000, varies: true, freq: 'monthly', dueDay: 15, accountId: 'sree', shop: 'Octopus' },
  { id: 'loanrep', name: 'Car loan', kind: 'repayment', amount: 15000, freq: 'monthly', dueDay: 10, accountId: 'sha', toAccountId: 'loan' },
  { id: 'cardrep', name: 'Amex', kind: 'repayment', amount: 5000, freq: 'monthly', dueDay: 20, accountId: 'sha', toAccountId: 'card' },
  { id: 'carins', name: 'Car insurance', kind: 'bill', amount: 60000, freq: 'yearly', dueMonth: 11, dueDay: 20, accountId: 'sha', shop: 'Admiral' },
];
const pbal = (id) => D.balanceOf(P.find((a) => a.id === id), ptx);
assert.equal(pbal('sha'), 128000);
assert.equal(pbal('sree'), 254200);
assert.equal(pbal('loan'), -470000);

// Bills: expected amounts, paid status, price change, renewals
assert.equal(D.billExpected(B[1], ptx), 8600, 'varies: average of last 3');
assert.equal(D.billExpected(B[0], ptx), 90000);
const wb = D.billsForWindow(B, ptx, win, '2026-11-03');
assert.deepEqual(wb.map((x) => [x.bill.id, x.due, x.status]), [
  ['rent', '2026-11-01', 'paid'], ['loanrep', '2026-11-10', 'due'], ['energy', '2026-11-15', 'due'],
  ['cardrep', '2026-11-20', 'due'], ['carins', '2026-11-20', 'due'],
]);
assert.equal(D.billPriceChange(B[0], ptx), null);
assert.deepEqual(D.billPriceChange({ ...B[0], amount: 85000 }, ptx), { from: 85000, to: 90000, diff: 5000, date: '2026-11-01' });
assert.equal(D.billPriceChange(B[1], ptx), null, 'varying bills never flag');
assert.deepEqual(D.renewalsSoon(B, '2026-11-03').map((r) => [r.bill.id, r.days]), [['carins', 17]]);
assert.deepEqual(D.renewalsSoon(B, '2026-12-01'), []);
assert.equal(D.matchesBill({ type: 'spend', shop: 'tesco', billId: 'rent' }, B[0]), true, 'a linked entry pays its bill');
assert.equal(D.matchesBill({ type: 'spend', shop: 'Landlord', billId: 'other' }, B[0]), false);

// Detection of regular charges
const found = D.detectBills(ptx, [], '2026-11-03');
assert.deepEqual(found.map((x) => [x.name, x.amount, x.varies, x.dueDay]), [['Landlord', 90000, false, 1], ['Octopus', 8600, true, 15]]);
assert.deepEqual(D.detectBills(ptx, B, '2026-11-03'), [], 'existing bills are not suggested again');
assert.deepEqual(D.detectBills(ptx, [], '2026-11-03', ['landlord']).map((x) => x.name), ['Octopus'], 'dismissed ones stay hidden');

// Income: Sree's varying pay is estimated from recent money months
assert.deepEqual(D.incomeIn(ptx, P, win), { sree: 40000, sha: 150000, joint: 0 });
assert.deepEqual(D.expectedIncome(ptx, P, win), { sree: 110000, sha: 150000, joint: 0, months: 2 });
assert.equal(D.weeklySpending(ptx, B, '2026-11-03'), 6333);

// Debts
assert.equal(D.monthsToClear(100000, 10000, 0), 10);
assert.equal(D.monthsToClear(100000, 10000, 12), 11);
assert.equal(D.monthsToClear(100000, 500, 12), null, 'payment below interest never clears');
const pdebts = D.debtsList(P, ptx, B);
assert.deepEqual(pdebts.map((d) => [d.account.id, d.owed, d.payment]), [['loan', 470000, 15000], ['card', 4000, 5000]]);

// The payday plan
const plan = D.paydayPlan({ txns: ptx, accounts: P, bills: B, today: '2026-11-03', payday: 25 });
assert.equal(plan.win.label, '2026-11');
assert.equal(plan.have, 382200, 'current accounts only');
assert.equal(plan.saved, 30000);
assert.equal(plan.coming, 70000, 'Sree: 110k expected − 40k received');
assert.equal(plan.billsDue, 83600, 'loan 150 + energy 86 + insurance 600; card repayment not double counted');
assert.equal(plan.cardsOwed, 4000);
assert.equal(plan.free, 364600);
assert.equal(plan.daysLeft, 22);
assert.deepEqual(plan.suggestions.map((s) => [s.kind, s.amount]), [['spend', 19904], ['emergency', 70000], ['debt', 137348], ['goals', 137348]]);
assert.equal(plan.safePerWeek, 6333);
assert.ok(plan.suggestions[2].monthsSooner > 0);
assert.equal(plan.emergencyTarget, 310800, '3 × monthly bills (rent 900 + energy 86 + insurance 50)');
assert.deepEqual(plan.guard.map((g) => [g.account.id, g.due, g.after, g.status]), [['sha', 80000, 48000, 'ok'], ['sree', 8600, 245600, 'ok']]);
// Override Sree's expected pay
assert.equal(D.paydayPlan({ txns: ptx, accounts: P, bills: B, today: '2026-11-03', incomeOverride: { sree: 60000 } }).coming, 20000);
// Short month: suggestions say so
const short = D.paydayPlan({ txns: ptx, accounts: P.map((a) => (a.id === 'sha' || a.id === 'sree' ? { ...a, openingBalance: a.openingBalance - 500000 } : a)), bills: B, today: '2026-11-03' });
assert.equal(short.suggestions[0].kind, 'short');
assert.equal(short.safePerWeek, 0);
assert.deepEqual(short.guard.map((g) => g.status), ['short', 'short']);
assert.equal(short.guard[0].shortDate, '2026-11-10');

// ======================= Phase 4 =======================
D.setCategories([]);
// needs and wants
assert.equal(D.isNeed('bills.rent'), true);
assert.equal(D.isNeed('bills.subs'), false, 'subscriptions are wants');
assert.equal(D.isNeed('food.groceries'), true);
assert.equal(D.isNeed('food.eatingout'), false);
D.setCategories([{ id: 'food.eatingout', need: true }, { id: 'bills.newsub-x1', kind: 'sub', parent: 'bills', name: 'Gym' }]);
assert.equal(D.isNeed('food.eatingout'), true, 'Sha can switch a sub to Needs');
assert.equal(D.isNeed('bills.newsub-x1'), true, 'new subs in Bills default to Needs');
D.setCategories([]);
assert.equal(D.monthsBetween('2026-11', '2026-11'), 1);
assert.equal(D.monthsBetween('2026-11', '2027-08'), 10);

// pots
const pots = [
  { id: 'us', name: 'US trip', target: 700000, byMonth: '2027-08' },
  { id: 'em', name: 'Emergency', target: 300000 },
  { id: 'car', name: 'Car', target: 50000, byMonth: '2026-10' },
  { id: 'tv', name: 'TV', target: 40000, byMonth: '2026-12', accountId: 'joint' },
];
const moves = [
  { potId: 'us', amount: 100000, date: '2026-10-28' },
  { potId: 'us', amount: 30000, date: '2026-11-02' },
  { potId: 'us', amount: -10000, date: '2026-11-05' },
  { potId: 'em', amount: 50000, date: '2026-09-01' },
  { potId: 'car', amount: 20000, date: '2026-09-01' },
  { potId: 'tv', amount: 40000, date: '2026-11-03' },
];
const us = D.potStatus(pots[0], moves, '2026-11-20');
assert.equal(us.saved, 120000);
assert.equal(us.thisMonth, 20000);
assert.equal(us.monthsLeft, 10);
assert.equal(us.monthly, 60000, '(7000 − 1000 at the start of Nov) ÷ 10 months');
assert.equal(us.state, 'behind');
assert.equal(D.potStatus(pots[1], moves, '2026-11-20').state, 'open');
assert.equal(D.potStatus(pots[2], moves, '2026-11-20').state, 'late');
assert.equal(D.potStatus(pots[3], moves, '2026-11-20').state, 'done');
assert.deepEqual(D.potMoves(pots[0], moves).map((m) => m.amount), [-10000, 30000, 100000]);
const pp = D.potsPlan(pots, moves, 25000, '2026-11-20');
assert.deepEqual(pp.map((x) => [x.pot.id, x.need, x.put]), [['us', 40000, 25000]]);
const pacc = D.potAccounts(pots, moves, accounts, txns);
assert.equal(pacc.length, 1);
assert.equal(pacc[0].inPots, 40000);
assert.equal(pacc[0].free, -2500 - 40000);

// reports
const rAcc = [
  { id: 'b', owner: 'sha', type: 'current', openingBalance: 100000, openingDate: '2026-01-01' },
  { id: 's', owner: 'sree', type: 'current', openingBalance: 0, openingDate: '2026-01-01' },
];
const rTx = [
  t({ id: 'r1', type: 'income', amount: 200000, date: '2026-10-25', accountId: 'b', categoryId: 'income.sha' }),
  t({ id: 'r2', type: 'spend', amount: 90000, date: '2026-10-01', accountId: 'b', categoryId: 'bills.rent', shop: 'Landlord' }),
  t({ id: 'r3', type: 'spend', amount: 10000, date: '2026-10-03', accountId: 'b', categoryId: 'food.eatingout', shop: 'Nandos' }),
  t({ id: 'r4', type: 'spend', amount: 5000, date: '2026-10-04', accountId: 's', categoryId: 'food.groceries', shop: 'Tesco' }),
  t({ id: 'r5', type: 'spend', amount: 3000, date: '2026-10-09', accountId: 's', categoryId: 'food.groceries', shop: 'tesco', tripId: 'th' }),
  t({ id: 'r6', type: 'spend', amount: 40000, date: '2026-09-10', accountId: 'b', categoryId: 'food.groceries' }),
  t({ id: 'r7', type: 'income', amount: 150000, date: '2026-09-25', accountId: 's', categoryId: 'income.sree' }),
  t({ id: 'r8', type: 'spend', amount: 20000, date: '2026-08-10', accountId: 'b', categoryId: 'food.groceries' }),
];
const rep = D.monthReport(rTx, rAcc, '2026-10', 'home', trips);
assert.equal(rep.income, 200000);
assert.equal(rep.spend, 108000);
assert.equal(rep.needs, 98000);
assert.equal(rep.wants, 10000);
assert.equal(rep.savedRate, 92000 / 200000);
assert.deepEqual(rep.prev, { income: 150000, spend: 40000, left: 110000 });
assert.equal(rep.avgByGroup.food, 30000, 'avg of Sep 40000 and Aug 20000');
assert.equal(rep.avgMonths, 2);
assert.deepEqual(rep.topShops.map((x) => [x.name, x.amount, x.count]), [['Landlord', 90000, 1], ['Nandos', 10000, 1], ['Tesco', 8000, 2]]);
assert.deepEqual(rep.byAccount.map((x) => [x.account.id, x.amount]), [['b', 100000], ['s', 8000]]);
assert.deepEqual(rep.trips.map((x) => [x.trip.id, x.amount]), [['th', 3000]]);
assert.equal(D.monthReport(rTx, rAcc, '2026-10', 'sree').spend, 8000);
const yr = D.yearReport(rTx, rAcc, 2026, 'home', trips);
assert.equal(yr.months.length, 12);
assert.equal(yr.months[9].spend, 108000);
assert.equal(yr.income, 350000);
assert.equal(yr.spend, 168000);
assert.equal(yr.activeMonths, 3);
assert.equal(yr.avgSpend, 56000);
assert.equal(yr.needs, 158000);
assert.equal(yr.byGroup.food, 78000);

// closing the month
const cAcc = [...rAcc, { id: 'cc', owner: 'sha', type: 'credit', openingBalance: -5000, openingDate: '2026-01-01' }];
const cTx = [...rTx, t({ id: 'r9', type: 'spend', amount: 700, date: '2026-10-20', accountId: 'b', categoryId: 'other.general' }),
  t({ id: 'r10', type: 'spend', amount: 800, date: '2026-10-21', accountId: 'b', categoryId: 'food.takeaway', flag: true, flagFor: 'sree' })];
const cBills = [
  { id: 'rent', name: 'Rent', kind: 'bill', amount: 90000, freq: 'monthly', dueDay: 1, accountId: 'b', shop: 'Landlord' },
  { id: 'gym', name: 'Gym', kind: 'bill', amount: 3000, freq: 'monthly', dueDay: 15, accountId: 'b', shop: 'Gym' },
  { id: 'car', name: 'Car insurance', kind: 'bill', amount: 40000, freq: 'yearly', dueMonth: 3, dueDay: 2, accountId: 'b' },
];
const cc = D.closeChecks({ month: '2026-10', txns: cTx, accounts: cAcc, bills: cBills, closing: { balanceChecks: { b: 100000 + 200000 - 90000 - 10000 - 700 - 800 - 40000 - 20000, cc: 4000 } } });
assert.equal(cc.accounts.length, 3);
assert.equal(cc.checked, 1);
assert.deepEqual(cc.mismatched.map((x) => [x.account.id, x.diff]), [['cc', -1000]], 'card checked as amount owed');
assert.deepEqual(cc.flagged.map((x) => x.id), ['r10']);
assert.deepEqual(cc.unsorted.map((x) => x.id), ['r9']);
assert.deepEqual(cc.unpaid.map((x) => x.bill.id), ['gym']);
assert.equal(D.isClosed({ '2026-10': { closed: true } }, '2026-10'), true);
assert.equal(D.isClosed({}, '2026-10'), false);

// ======================= Phase 5: bank statement import =======================
const CSV = await import('../js/bankcsv.js');
assert.deepEqual(CSV.parseCSV('a,"b, c","say ""hi"""\r\n1,2,3\n\n'), [['a', 'b, c', 'say "hi"'], ['1', '2', '3']]);
assert.deepEqual(CSV.parseCSV('Date;Amount\n01/11/2026;-1,50'), [['Date', 'Amount'], ['01/11/2026', '-1,50']]);
assert.equal(CSV.parseDate('02/11/2026'), '2026-11-02');
assert.equal(CSV.parseDate('11/02/2026', 'mdy'), '2026-11-02');
assert.equal(CSV.parseDate('02 Nov 2026'), '2026-11-02');
assert.equal(CSV.parseDate('2026-11-02T10:00:00Z'), '2026-11-02');
assert.equal(CSV.parseDate('31/02/2026'), null);
assert.equal(CSV.dateOrder(['11/25/2026', '11/02/2026']), 'mdy');
assert.equal(CSV.parseAmount('£1,234.56'), 123456);
assert.equal(CSV.parseAmount('(12.30)'), -1230);
assert.equal(CSV.parseAmount('12.30 DR'), -1230);
assert.equal(CSV.cleanShop('CARD PAYMENT TO TESCO STORES 3245 ON 02 NOV'), 'Tesco Stores');
assert.equal(CSV.cleanShop('FPO 12345678 20-32-06 SMITH J'), 'Smith J', 'account numbers and sort codes removed');
assert.ok(!/\d{6}/.test(CSV.cleanShop('TFR 40-11-62 71234567 SAVINGS')), 'no long numbers kept');
assert.equal(CSV.cleanShop('BP STAPLEHURST'), 'BP Staplehurst');
assert.ok(CSV.nameMatches('Tesco Stores', 'tesco'));
assert.ok(!CSV.nameMatches('Tescoville', 'tesco'));
assert.equal(CSV.hintCategory('Shell Staplehurst'), 'car.fuel');
assert.equal(CSV.hintCategory('EE Limited'), 'bills.phones');
assert.equal(CSV.hintCategory('Coffee Beans Ltd'), 'food.eatingout');
assert.equal(CSV.hintCategory('Peep Show'), null, 'short names only as whole words');

// Real-world layouts (made-up values): column detection and reading
const layouts = {
  monzo: ['Transaction ID,Date,Time,Type,Name,Emoji,Category,Amount,Currency,Local amount,Local currency,Notes and #tags,Address,Receipt,Description,Category split,Money Out,Money In',
    'tx_1,02/11/2026,10:01:00,Card payment,Tesco,🛒,Groceries,-12.50,GBP,-12.50,GBP,,,,TESCO STORES 3245,,-12.50,',
    'tx_2,03/11/2026,09:00:00,Faster payment,Sree,,Income,500.00,GBP,500.00,GBP,,,,SREERAG,,,500.00'],
  nationwide: ['"Account Name:","FlexDirect ****1234"', '"Account Balance:","£1,000.00"', '"Available Balance: ","£1,000.00"', '',
    '"Date","Transaction type","Description","Paid out","Paid in","Balance"',
    '"02 Nov 2026","Visa purchase","SHELL STAPLEHURST","£45.00","","£955.00"',
    '"25 Oct 2026","Bank credit","CARE HOME LTD SALARY","","£1,500.00","£1,000.00"'],
  lloyds: ['Transaction Date,Transaction Type,Sort Code,Account Number,Transaction Description,Debit Amount,Credit Amount,Balance',
    '02/11/2026,DEB,\'30-99-50,12345678,COSTA COFFEE 1234,3.40,,996.60',
    '01/11/2026,DD,\'30-99-50,12345678,OCTOPUS ENERGY,88.50,,1000.00'],
  barclays: ['Number,Date,Account,Amount,Subcategory,Memo', ',02/11/2026,20-32-06 12345678,-9.99,Direct Debit,NETFLIX.COM', ',03/11/2026,20-32-06 12345678,-250.00,Direct Debit,BLACK HORSE FINANCE'],
  amex: ['Date,Description,Amount', '02/11/2026,TESCO STORES 2345,30.00', '05/11/2026,PAYMENT RECEIVED - THANK YOU,-100.00', '06/11/2026,ARGOS LTD,15.00'],
  starling: ['Date,Counter Party,Reference,Type,Amount (GBP),Balance (GBP),Spending Category,Notes', '02/11/2026,Aldi,ALDI 123,CONTACTLESS,-20.00,980.00,GROCERIES,'],
  hsbc: ['02/11/2026,SAINSBURYS S/MKTS,-15.20', '03/11/2026,PAYPAL *EBAY,-8.00', '04/11/2026,MYSTERY SHOP 77,-2.00'],
  revolut: ['Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance', 'CARD_PAYMENT,Current,2026-11-01 10:00:00,2026-11-02 10:00:00,Uber,-12.00,0.00,GBP,COMPLETED,88.00'],
};
const readOf = (name, account = { id: 'x', type: 'current' }) => {
  const rows = CSV.parseCSV(layouts[name].join('\n'));
  const map = CSV.detectColumns(rows);
  return { map, ...CSV.readRows(rows, map, CSV.guessSpendSign(rows, map, account)) };
};
let rd = readOf('monzo');
assert.equal(rd.map.header[rd.map.desc], 'Name');
assert.deepEqual(rd.rows.map((r) => [r.date, r.desc, r.flow]), [['2026-11-02', 'Tesco', -1250], ['2026-11-03', 'Sree', 50000]]);
rd = readOf('nationwide');
assert.equal(rd.map.headerIndex, 3, 'blank lines are dropped, so the header is the 4th row');
assert.deepEqual(rd.rows.map((r) => [r.date, r.flow]), [['2026-11-02', -4500], ['2026-10-25', 150000]]);
rd = readOf('lloyds');
assert.equal(rd.map.header[rd.map.desc], 'Transaction Description');
assert.deepEqual(rd.rows.map((r) => r.flow), [-340, -8850]);
rd = readOf('barclays');
assert.equal(rd.map.header[rd.map.desc], 'Memo');
assert.deepEqual(rd.rows.map((r) => r.flow), [-999, -25000]);
rd = readOf('amex', { id: 'amex', type: 'credit' });
assert.deepEqual(rd.rows.map((r) => r.flow), [-3000, 10000, -1500], 'card statement: spending positive');
rd = readOf('starling');
assert.equal(rd.map.header[rd.map.desc], 'Counter Party');
assert.deepEqual(rd.rows.map((r) => r.flow), [-2000]);
rd = readOf('hsbc');
assert.equal(rd.map.headerIndex, -1);
assert.deepEqual(rd.rows.map((r) => [r.date, r.desc, r.flow]), [['2026-11-02', 'SAINSBURYS S/MKTS', -1520], ['2026-11-03', 'PAYPAL *EBAY', -800], ['2026-11-04', 'MYSTERY SHOP 77', -200]]);
rd = readOf('revolut');
assert.deepEqual(rd.rows.map((r) => [r.date, r.flow]), [['2026-11-02', -1200]]);

// Building the import: duplicates, bills, repayments, card payments, transfers, closed months
const iAcc = [
  { id: 'monzo', name: 'Monzo current', bank: 'Monzo', owner: 'sha', type: 'current' },
  { id: 'barc', name: 'Barclays', bank: 'Barclays', owner: 'sree', type: 'current' },
  { id: 'amex', name: 'Amex', bank: 'American Express', owner: 'sha', type: 'credit' },
  { id: 'loan', name: 'Car finance', bank: 'Black Horse', owner: 'sree', type: 'loan' },
];
const iTx = [
  t({ id: 'e1', type: 'spend', amount: 1520, date: '2026-11-01', accountId: 'monzo', categoryId: 'food.groceries', shop: 'Sainsburys' }),
  t({ id: 'e2', type: 'spend', amount: 4200, date: '2026-10-01', accountId: 'monzo', categoryId: 'car.fuel', shop: 'Shell' }),
];
const iBills = [{ id: 'oct', name: 'Octopus', kind: 'bill', amount: 8850, freq: 'monthly', dueDay: 1, accountId: 'monzo', shop: 'Octopus Energy', categoryId: 'bills.energy' },
  { id: 'cf', name: 'Car finance', kind: 'repayment', amount: 25000, freq: 'monthly', dueDay: 3, accountId: 'monzo', toAccountId: 'loan', shop: 'Black Horse' }];
const stmt = [
  { line: 2, date: '2026-11-02', desc: 'SAINSBURYS S/MKTS', flow: -1520 }, // duplicate of e1 (1 day apart)
  { line: 3, date: '2026-11-01', desc: 'DD OCTOPUS ENERGY LTD', flow: -9100 }, // bill
  { line: 4, date: '2026-11-03', desc: 'BLACK HORSE FINANCE 12345678', flow: -25000 }, // repayment bill → transfer to loan
  { line: 5, date: '2026-11-04', desc: 'AMERICAN EXPRESS', flow: -10000 }, // paying the card
  { line: 6, date: '2026-11-05', desc: 'SHELL STAPLEHURST', flow: -4000 }, // shop memory
  { line: 7, date: '2026-11-06', desc: 'NETFLIX.COM', flow: -999 }, // hint
  { line: 8, date: '2026-11-07', desc: 'MYSTERY SHOP 77', flow: -200 }, // needs a category
  { line: 9, date: '2026-11-08', desc: 'TFR TO SAVINGS 12345678', flow: -5000 }, // own transfer
  { line: 10, date: '2026-11-09', desc: 'SREERAG VINOD', flow: 30000 }, // from Sree: transfer
  { line: 11, date: '2026-10-25', desc: 'CARE HOME SALARY', flow: 150000 }, // closed month
  { line: 12, date: '2026-11-25', desc: 'CARE HOME SALARY', flow: 150000 }, // income
];
const items = CSV.buildImport({ rows: stmt }, { account: iAcc[0], accounts: iAcc, txns: iTx, bills: iBills, shopIdx: D.shopIndex(iTx), closedMonths: ['2026-10'], incomeCategory: 'income.sha' });
const brief = items.map((x) => [x.line, x.status, x.type, x.categoryId || x.toAccountId || '', x.billId || '', x.include]);
assert.deepEqual(brief, [
  [2, 'duplicate', 'spend', '', '', false],
  [3, 'ready', 'spend', 'bills.energy', 'oct', true],
  [4, 'ready', 'transfer', 'loan', 'cf', true],
  [5, 'ready', 'transfer', 'amex', '', true],
  [6, 'ready', 'spend', 'car.fuel', '', true],
  [7, 'ready', 'spend', 'bills.subs', '', true],
  [8, 'needs', 'spend', '', '', false],
  [9, 'transfer', 'transfer', '', '', false],
  [10, 'transfer', 'transfer', '', '', false],
  [11, 'closed', 'income', '', '', false],
  [12, 'ready', 'income', 'income.sha', '', true],
]);
assert.equal(items[1].shop, 'Octopus Energy', 'bill shop name used so it counts as paid');
assert.equal(items[4].shop, 'Shell', 'shop memory name used');
assert.ok(items.every((x) => !/\d{6}/.test(`${x.shop} ${x.note} ${x.raw}`)), 'no account numbers kept');
assert.equal(CSV.itemReady(items[6]), false);
assert.equal(CSV.itemReady({ ...items[6], categoryId: 'other.general' }), true);
assert.equal(CSV.itemReady({ ...items[8], fromAccountId: 'barc' }), true);
assert.deepEqual(CSV.itemToEntry({ ...items[8], fromAccountId: 'barc' }, 'monzo'), { date: '2026-11-09', month: '2026-11', calc: null, source: 'import', shop: '', tripId: null, flag: false, flagFor: null, flagNote: '', billId: null, note: 'Sreerag Vinod', type: 'transfer', amount: 30000, accountId: 'barc', toAccountId: 'monzo', categoryId: null });
assert.equal(CSV.itemToEntry(items[1], 'monzo').shop, 'Octopus Energy');
assert.equal(CSV.itemToEntry(items[1], 'monzo').amount, 9100);
// The bill then shows as paid
assert.ok(D.matchesBill({ ...CSV.itemToEntry(items[1], 'monzo') }, iBills[0]));
// Card statement: a refund becomes a + adjustment, the payment is a transfer to skip
const cardItems = CSV.buildImport({ rows: [{ line: 2, date: '2026-11-05', desc: 'PAYMENT RECEIVED - THANK YOU', flow: 10000 }, { line: 3, date: '2026-11-06', desc: 'ARGOS REFUND', flow: 1500 }, { line: 4, date: '2026-11-06', desc: 'ARGOS LTD', flow: -1500 }] },
  { account: iAcc[2], accounts: iAcc, txns: [], bills: [], shopIdx: new Map() });
assert.deepEqual(cardItems.map((x) => [x.status, x.type, x.categoryId]), [['transfer', 'transfer', ''], ['ready', 'adjust', ''], ['ready', 'spend', 'shopping.household']]);
assert.equal(CSV.itemToEntry(cardItems[1], 'amex').amount, 1500);

// import status per account
const impTx = [
  { id: 'i1', source: 'import', importAccount: 'hsbc', accountId: 'hsbc', date: '2026-10-30' },
  { id: 'i2', source: 'import', importAccount: 'hsbc', accountId: 'amex', toAccountId: 'amex', type: 'transfer', date: '2026-10-31' }, // from HSBC's file
  { id: 'i3', source: 'import', accountId: 'amex', date: '2026-10-20' }, // older import without importAccount
  { id: 'i4', accountId: 'amex', date: '2026-11-20' }, // typed by hand: doesn't count
];
assert.equal(D.importedTo({ id: 'hsbc' }, impTx), '2026-10-31');
assert.equal(D.importedTo({ id: 'amex' }, impTx), '2026-10-20');
assert.equal(D.importedTo({ id: 'amex', importedTo: '2026-10-28' }, impTx), '2026-10-28', 'stored date wins when later');
assert.equal(D.importedTo({ id: 'cash' }, impTx), null);
assert.equal(D.importDue({ id: 'hsbc' }, impTx, '2026-11-24'), false, 'October fully imported');
assert.equal(D.importDue({ id: 'amex' }, impTx, '2026-11-24'), true, 'October not finished');
assert.equal(D.importDue({ id: 'amex' }, impTx, '2026-11-01'), false, 'not nagged on the 1st');
assert.equal(D.importDue({ id: 'cash' }, impTx, '2026-11-24'), false, 'never imported: no nag');

// calendar-month bills: December's rent paid on 30 Nov counts for December, not twice
const calRent = { id: 'cr', name: 'Rent', kind: 'bill', amount: 90000, freq: 'monthly', dueDay: 1, accountId: 'b', shop: 'Landlord' };
const calTx = [t({ id: 'c1', type: 'spend', amount: 90000, date: '2026-11-30', accountId: 'b', categoryId: 'bills.rent', shop: 'Landlord' })];
const decRows = D.billsForWindow([calRent], calTx, D.calendarWindow('2026-12'), '2026-12-03');
assert.equal(decRows[0].status, 'paid', 'paid a day early still counts');
assert.equal(D.calendarWindow('2026-02').end, '2026-02-28');
const lateRent = { ...calRent, dueDay: 20 };
assert.equal(D.billsForWindow([lateRent], calTx, D.calendarWindow('2026-12'), '2026-12-25')[0].status, 'late', 'a payment weeks earlier does not count');
// pay from the payday onwards, for the report note
const payTx = [
  t({ id: 'p1', type: 'income', amount: 200000, date: '2026-11-25', accountId: 'b', categoryId: 'income.sha' }),
  t({ id: 'p2', type: 'income', amount: 30000, date: '2026-11-10', accountId: 's', categoryId: 'income.sree' }),
  t({ id: 'p3', type: 'income', amount: 40000, date: '2026-11-28', accountId: 's', categoryId: 'income.sree' }),
];
assert.deepEqual(D.payFromPayday(payTx, rAcc, '2026-11', 'home', 25), { amount: 240000, from: '2026-11-25' });
assert.equal(D.payFromPayday(payTx, rAcc, '2026-11', 'sree', 25).amount, 40000);
assert.equal(D.payFromPayday(payTx, rAcc, '2026-02', 'home', 31).from, '2026-02-28');

console.log('All data and calculator tests passed');
