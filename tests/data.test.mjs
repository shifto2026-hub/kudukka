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

console.log('All data and calculator tests passed');
