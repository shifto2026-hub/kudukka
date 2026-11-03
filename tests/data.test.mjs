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

console.log('All data and calculator tests passed');
