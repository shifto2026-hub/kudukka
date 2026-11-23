// Browser smoke test: runs the real app against the in-memory Firebase mock.
import { createRequire } from 'node:module'; const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright');
import { readFileSync, mkdirSync } from 'node:fs';

const base = process.argv[2] || 'http://localhost:8765/';
const out = process.argv[3] || './shots';
mkdirSync(out, { recursive: true });
const mock = readFileSync(new URL('./mock-firebase.js', import.meta.url), 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
await page.route('https://www.gstatic.com/firebasejs/**', (r) => r.fulfill({ contentType: 'text/javascript', body: mock }));
await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));

// A simulated Face ID / Touch ID so the passkey unlock can be tested.
const cdp = await page.context().newCDPSession(page);
await cdp.send('WebAuthn.enable');
await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });

const shot = (n) => page.screenshot({ path: `${out}/${n}.png`, fullPage: true });
const click = (sel) => page.locator(sel).first().click();

await page.goto(base);
await page.waitForSelector('[data-act="signin"]');
await shot('01-signin');
await click('[data-act="signin"]');
await page.waitForSelector('.keypad');
for (const k of '12341234') await click(`[data-act="pin-key"][data-k="${k}"]`);
await page.waitForSelector('[data-act="role"]');
await shot('02-role');
await click('[data-act="role"][data-role="sha"]');
await page.waitForSelector('#main .welcome-card');
await shot('03-home-empty');

// add a bank account
await click('.welcome-card [data-act="add-account"]');
await page.fill('#a-name', 'Monzo current');
await page.fill('#a-bank', 'Monzo');
await page.fill('#a-open', '500');
await page.waitForTimeout(400); await shot('04-account-sheet');
await click('[data-act="save-account"]');
// Sree's account
await click('[data-act="nav"][data-v="accounts"]');
await click('#main [data-act="add-account"]');
await click('[data-act="acc-owner"][data-o="sree"]');
await page.fill('#a-name', 'Barclays');
await page.fill('#a-open', '1200');
await click('[data-act="save-account"]');
// a credit card
await click('#main [data-act="add-account"]');
await click('[data-act="acc-type"][data-t="credit"]');
await page.fill('#a-name', 'Amex');
await page.fill('#a-open', '100');
await page.fill('#a-limit', '3000');
await page.fill('#a-last4', '1004');
await page.fill('#a-due', '12');
await click('[data-act="save-account"]');
await page.waitForTimeout(150);

// spend with calculator on the card
await click('[data-act="add-entry"]');
await page.fill('#f-amount', '12.40 + 8.99 + 23');
await click('[data-act="pick-account"][data-field="accountId"]:has-text("Amex")');
await click('[data-act="pick-group"][data-id="food"]');
await click('[data-act="pick-cat"][data-id="food.groceries"]');
const calc = await page.textContent('#calc-result');
if (!calc.includes('44.39')) errors.push(`calc showed "${calc}"`);
await page.waitForTimeout(400); await shot('05-entry-sheet');
await click('[data-act="save-entry"]');
// validation check: empty save shows error
await click('[data-act="add-entry"]');
await click('[data-act="save-entry"]');
if (!(await page.locator('.sheet .err').count())) errors.push('no validation error shown');
await click('.sheet-head [data-act="sheet-close"]');
// income for Sree
await click('[data-act="add-entry"]');
await click('[data-act="entry-type"][data-t="income"]');
await page.fill('#f-amount', '2100');
await click('[data-act="pick-account"]:has-text("Barclays")');
await click('[data-act="save-entry"]');
// transfer Sree -> Sha
await click('[data-act="add-entry"]');
await click('[data-act="entry-type"][data-t="transfer"]');
await page.fill('#f-amount', '800');
await click('[data-act="pick-account"][data-field="accountId"]:has-text("Barclays")');
await click('[data-act="pick-account"][data-field="toAccountId"]:has-text("Monzo")');
await click('[data-act="save-entry"]');
// fuel on Sree
await click('[data-act="add-entry"]');
await page.fill('#f-amount', '55.20');
await click('[data-act="pick-account"][data-field="accountId"]:has-text("Barclays")');
await click('[data-act="pick-group"][data-id="car"]');
await click('[data-act="pick-cat"][data-id="car.fuel"]');
await page.fill('#f-note', 'Shell Staplehurst');
await click('[data-act="save-entry"]');
await page.waitForTimeout(200);

await click('[data-act="nav"][data-v="home"]');
await page.waitForTimeout(100);
await shot('06-home');
const big = await page.textContent('.hero .big');
await click('[data-act="person"][data-p="sree"]');
await shot('07-home-sree');
await click('[data-act="person"][data-p="home"]');
await click('[data-act="nav"][data-v="entries"]');
await shot('08-entries');
await click('[data-act="nav"][data-v="accounts"]');
await shot('09-accounts');
// check balance flow on Monzo
await click('[data-act="edit-account"]:has-text("Monzo")');
await page.fill('#a-check', '1300');
await page.waitForTimeout(400); await shot('10-check-balance');
await click('.sheet-head [data-act="sheet-close"]');
// month picker
await click('[data-act="nav"][data-v="home"]');
await click('[data-act="open-month"]');
await shot('11-month');
await click('.sheet-head [data-act="sheet-close"]');
await click('[data-act="nav"][data-v="more"]');
await page.waitForSelector('[data-act="bio-toggle"]');
await shot('12-more');
// turn on Face ID, lock, and check it unlocks without the PIN
await click('[data-act="bio-toggle"]');
await page.waitForSelector('[data-act="bio-toggle"] .switch.on');
await shot('13-more-bio-on');
await click('[data-act="lock"]');
await page.waitForSelector('.bio-btn', { timeout: 3000 }).catch(() => {});
try {
  await page.waitForSelector('#main .me', { timeout: 5000 });
  console.log('Face ID auto-unlock: OK');
} catch { errors.push('Face ID did not unlock'); await shot('14-bio-fail'); }
// tap path: lock again, wait for auto attempt, and use the button
await click('[data-act="lock"]');
await page.waitForSelector('#main .me', { timeout: 5000 }).catch(() => errors.push('second unlock failed'));
// turning it off removes the button from the lock screen
await click('[data-act="bio-toggle"]');
await page.waitForSelector('[data-act="bio-toggle"] .switch:not(.on)');
await click('[data-act="lock"]');
await page.waitForSelector('.keypad');
if (await page.locator('.bio-btn').count()) errors.push('bio button still shown after turning off');
for (const k of '1234') await click(`[data-act="pin-key"][data-k="${k}"]`);
await page.waitForSelector('#main .me', { timeout: 5000 }).catch(() => errors.push('PIN unlock after bio off failed'));

// ======================= Phase 2 =======================
const expect = (cond, msg) => { if (!cond) errors.push(msg); };
const isoShift = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const go = async (v) => { await click(`#nav [data-act="nav"][data-v="${v}"]`); await page.waitForTimeout(80); };

// 0. An old Phase 1-style entry (no shop, trip or flag fields) still shows and edits
await go('accounts');
const monzoId = await page.getAttribute('[data-act="edit-account"]:has-text("Monzo")', 'data-id');
await page.evaluate(async ({ acc, iso }) => {
  const fs = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
  await fs.setDoc(fs.doc(fs.collection({}, 'households', 'home', 'transactions'), 'oldEntry'),
    { type: 'spend', amount: 1234, date: iso, month: iso.slice(0, 7), accountId: acc, toAccountId: null, categoryId: 'food.takeaway', note: 'Old style', calc: null, createdBy: 'sha', updatedBy: 'sha' });
}, { acc: monzoId, iso: isoShift(0) });
await go('entries');
await page.waitForSelector('[data-act="edit-entry"][data-id="oldEntry"]');
await click('[data-act="edit-entry"][data-id="oldEntry"]');
expect((await page.inputValue('#f-shop')) === '', 'old entry: shop should be empty');
await click('[data-act="save-entry"]');
await page.waitForTimeout(100);

// 1. Categories: rename a default sub, add a sub, add a group, add an income source
await go('more');
await click('[data-act="nav"][data-v="categories"]');
await page.waitForSelector('[data-act="edit-group"][data-id="food"]');
await click('[data-act="edit-group"][data-id="food"]');
await page.fill('[name="sub:s2"]', 'Takeaways');
await page.fill('[name="newSub"]', 'Coffee');
await click('[data-act="g-add-sub"]');
await page.waitForTimeout(300); await shot('20-group-sheet');
await click('[data-act="save-group"]');
await page.waitForTimeout(150);
await click('[data-act="add-group"]');
await page.fill('#g-name', 'Pets');
await click('[data-act="g-icon"][data-i="pet"]');
await click('[data-act="g-color"][data-c="#7D5A6E"]');
await page.fill('[name="newSub"]', 'Pet food');
await click('[data-act="save-group"]');
await page.waitForTimeout(150);
await click('[data-act="add-income"]');
await page.fill('#i-name', "Sree's second job");
await click('[data-act="save-income"]');
await page.waitForTimeout(150);
await shot('21-categories');
expect(await page.locator('[data-act="edit-group"]:has-text("Pets")').count() === 1, 'new group not listed');
expect(await page.locator('[data-act="edit-income"]:has-text("second job")').count() === 1, 'new income source not listed');
await go('entries');
expect((await page.textContent('[data-act="edit-entry"][data-id="oldEntry"]')).includes('Takeaways'), 'renamed category not shown on old entry');

// 2. Trip covering today
await go('more');
await click('[data-act="nav"][data-v="trips"]');
await click('[data-act="add-trip"]');
await page.fill('#t-name', 'Thailand');
await page.fill('#t-start', isoShift(-1));
await page.fill('#t-end', isoShift(5));
await page.fill('#t-budget', '2000');
await click('[data-act="save-trip"]');
await page.waitForTimeout(150);
await go('home');
expect(await page.locator('.trip-card:has-text("Thailand")').count() === 1, 'trip card not on Home');

// 3. Spend with a shop, a trip suggestion, then shop memory on the next entry
await click('#nav [data-act="add-entry"]');
expect(await page.locator('.chip.quick').count() > 0, 'no quick repeat chips');
await page.fill('#f-amount', '30 + 14.39');
await page.fill('#f-shop', 'Tesco');
await click('[data-act="pick-account"][data-field="accountId"]:has-text("Amex")');
await click('[data-act="pick-group"][data-id="food"]');
expect(await page.locator('[data-act="pick-cat"]:has-text("Coffee")').count() === 1, 'new sub not offered');
await click('[data-act="pick-cat"][data-id="food.groceries"]');
expect(await page.locator('.chip.suggest:has-text("Thailand?")').count() === 1, 'trip suggestion missing');
await click('.chip.suggest');
await page.waitForTimeout(300); await shot('22-entry-trip');
await click('[data-act="save-entry"]');
await page.waitForTimeout(100);

await click('#nav [data-act="add-entry"]');
await click('[data-act="pick-account"][data-field="accountId"]:has-text("Monzo")');
await page.fill('#f-shop', 'tes');
await page.waitForSelector('[data-act="pick-shop"]');
await page.waitForTimeout(300); await shot('23-shop-memory');
await click('[data-act="pick-shop"]');
expect(await page.locator('[data-act="pick-cat"][data-id="food.groceries"].on').count() === 1, 'shop memory did not set category');
expect(await page.locator('[data-act="pick-account"][data-field="accountId"].on:has-text("Amex")').count() === 1, 'shop memory did not set account');
await page.fill('#f-amount', '10');
// 4. Ask Sree flag
await click('[data-act="toggle-flag"]');
await page.fill('[name="flagNote"]', 'What was this?');
await click('[data-act="save-entry"]');
await page.waitForTimeout(150);
await go('home');
await page.waitForSelector('.flag-card');
expect((await page.textContent('.flag-card')).includes('1 to check with Sree'), 'flag card text wrong');
await page.waitForTimeout(200); await shot('24-home-phase2');
await click('.flag-card');
await page.waitForTimeout(150);
expect(await page.locator('#results [data-act="edit-entry"]').count() === 1, 'flagged filter should show 1 entry');
expect((await page.textContent('#results')).includes('Ask Sree: What was this?'), 'flag note not shown in list');

// 5. Search and filters
await click('[data-act="clear-filters"]');
await page.fill('#q', 'tesco');
await page.waitForTimeout(300);
expect(await page.locator('#results [data-act="edit-entry"]').count() === 2, `search tesco: expected 2, got ${await page.locator('#results [data-act="edit-entry"]').count()}`);
expect(await page.evaluate(() => document.activeElement && document.activeElement.id === 'q'), 'search box lost focus');
await shot('25-search');
await page.fill('#q', '');
await page.waitForTimeout(200);
await click('[data-act="open-filters"]');
await click('[data-act="f-set"][data-k="type"][data-v="income"]');
await page.waitForTimeout(300); await shot('26-filters');
await click('.sheet-actions [data-act="sheet-close"]');
const incomeOnly = await page.locator('#results .entry-amt').allTextContents();
expect(incomeOnly.length > 0 && incomeOnly.every((x) => x.startsWith('+')), `income filter wrong: ${incomeOnly.join(' ')}`);
await click('[data-act="clear-filters"]');

// 6. Donut → tap a category
await go('home');
expect(await page.locator('.donut svg circle').count() >= 2, 'donut missing');
await click('.leg:has-text("Food")');
await page.waitForTimeout(150);
const foodChips = await page.locator('[data-act="clear-filter"][data-k="groupId"]').count();
expect(foodChips === 1, 'donut legend did not filter by Food');

// 7. Trip page
await go('more');
await click('[data-act="nav"][data-v="trips"]');
await click('[data-act="open-trip"]:has-text("Thailand")');
await page.waitForSelector('.subhead');
expect((await page.textContent('.hero .big')).includes('44.39'), 'trip total wrong');
await page.waitForTimeout(200); await shot('27-trip');

// 8. Repeat an entry
await click('[data-act="edit-entry"]');
await click('[data-act="repeat-entry"]');
await page.waitForTimeout(150);
expect((await page.textContent('#sheet-title')) === 'New entry', 'repeat did not open a new entry');
expect((await page.inputValue('#f-amount')) === '44.39', 'repeat did not copy the amount');
expect((await page.inputValue('#f-shop')) === 'Tesco', 'repeat did not copy the shop');
await click('.sheet-head [data-act="sheet-close"]');

// 9. Export
await go('more');
const dl = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
await click('[data-act="export"]');
const file = await dl;
expect(file && /kudukka-(entries|accounts)-\d{4}-\d{2}-\d{2}\.csv/.test(file.suggestedFilename()), 'export did not download a CSV');
if (file) { const p = await file.path(); const txt = (await import('node:fs')).readFileSync(p, 'utf8'); expect(txt.includes('Tesco') || txt.includes('Account'), 'export CSV looks empty'); }

console.log('Phase 2 checks done');

// ======================= Phase 3 =======================
try {
const txt = async (sel) => (await page.locator(sel).first().textContent()) || '';

// 1. A loan with an interest rate
await go('accounts');
await click('#main [data-act="add-account"]');
await click('[data-act="acc-type"][data-t="loan"]');
await page.fill('#a-name', 'Car finance');
await page.fill('#a-open', '5000');
await page.fill('#a-apr', '9.9');
await click('[data-act="save-account"]');
await page.waitForTimeout(150);
expect(await page.locator('[data-act="edit-account"]:has-text("Car finance")').count() === 1, 'loan not listed in accounts');
expect((await page.textContent('#main')).includes('9.9%'), 'loan APR not shown');
await shot('30-accounts-loan');

// 2. Past energy payments, so Kudukka can spot a regular bill
await page.evaluate(async ({ acc, d1, d2 }) => {
  const fs = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
  const col = fs.collection({}, 'households', 'home', 'transactions');
  const base = { type: 'spend', accountId: acc, toAccountId: null, categoryId: 'bills.energy', shop: 'Octopus Energy', note: '', calc: null, createdBy: 'sha', updatedBy: 'sha' };
  await fs.setDoc(fs.doc(col, 'oct1'), { ...base, amount: 8500, date: d1, month: d1.slice(0, 7) });
  await fs.setDoc(fs.doc(col, 'oct2'), { ...base, amount: 9200, date: d2, month: d2.slice(0, 7) });
}, { acc: monzoId, d1: isoShift(-35), d2: isoShift(-65) });

// 3. Bills page: empty, then add Rent
await go('more');
await click('[data-act="nav"][data-v="bills"]');
await page.waitForSelector('.win-nav');
expect(await page.locator('.suggest-card:has-text("Octopus Energy")').count() === 1, 'detected bill not suggested');
await shot('31-bills-suggest');
await click('[data-act="add-bill"]');
await page.fill('#b-name', 'Rent');
await page.fill('#b-amount', '1200');
await page.fill('#b-day', '1');
await click('[data-act="pick-account"][data-field="accountId"]:has-text("Monzo")');
await click('[data-act="pick-cat"][data-id="bills.rent"]');
await page.waitForTimeout(300); await shot('32-bill-sheet');
await click('[data-act="save-bill"]');
await page.waitForTimeout(150);
expect(await page.locator('.bill-li:has(.entry-title:text-is("Rent"))').count() === 1, 'rent bill not listed');

// validation: empty form shows errors
await click('[data-act="add-bill"]');
await click('[data-act="save-bill"]');
expect(await page.locator('.sheet .err').count() >= 2, 'bill form did not show errors');
// a repayment to the loan
await click('[data-act="bill-kind"][data-k="repayment"]');
await page.fill('#b-name', 'Car finance');
await page.fill('#b-amount', '250');
await page.fill('#b-day', '28');
await click('[data-act="pick-account"][data-field="accountId"]:has-text("Monzo")');
await click('[data-act="pick-account"][data-field="toAccountId"]:has-text("Car finance")');
await click('[data-act="save-bill"]');
await page.waitForTimeout(150);

// 4. Accept the suggested bill
await click('.suggest-card [data-act="add-detected"]');
await page.waitForTimeout(150);
expect((await page.inputValue('#b-name')) === 'Octopus Energy', 'suggested bill name not filled');
expect(await page.locator('[data-act="bill-varies"][aria-pressed="true"]').count() === 1, 'suggested bill should be marked as varying');
await click('[data-act="save-bill"]');
await page.waitForTimeout(150);
expect(await page.locator('.suggest-card:has-text("Octopus Energy")').count() === 0, 'suggestion still shown after adding');
await shot('33-bills-list');

// 5. Mark Rent as paid: opens a prefilled entry
await click('.bill-li:has(.entry-title:text-is("Rent")) [data-act="pay-bill"]');
await page.waitForTimeout(150);
expect(['1200', '1200.00'].includes(await page.inputValue('#f-amount')), `pay-bill amount: ${await page.inputValue('#f-amount')}`);
expect((await page.inputValue('#f-shop', { timeout: 3000 })) === 'Rent', 'pay-bill shop not filled');
await page.waitForTimeout(300); await shot('34-pay-bill');
await click('[data-act="save-entry"]');
await page.waitForTimeout(200);
expect(await page.locator('.bill-li.is-paid:has(.entry-title:text-is("Rent"))').count() === 1, 'rent not shown as paid');

// 6. Repayment paid: a transfer to the loan
await click('.bill-li:has-text("Car finance") [data-act="pay-bill"]');
await page.waitForTimeout(150);
expect(await page.locator('[data-act="entry-type"][data-t="transfer"].on').count() === 1, 'repayment did not open as a transfer');
expect(await page.locator('[data-act="pick-account"][data-field="toAccountId"].on:has-text("Car finance")').count() === 1, 'repayment did not pick the loan');
await click('[data-act="save-entry"]');
await page.waitForTimeout(200);
expect(await page.locator('.bill-li.is-paid:has-text("Car finance")').count() === 1, 'repayment not shown as paid');

// 7. Calendar view
await click('[data-act="bills-mode"][data-m="cal"]');
await page.waitForSelector('.cal-grid');
expect(await page.locator('.cal-cell.today').count() === 1, 'calendar has no today');
expect(await page.locator('.cal-dot.due, .cal-dot.warn, .cal-dot.ok').count() >= 3, 'calendar dots missing');
await click('.cal-cell:has(.cal-dot)');
await page.waitForTimeout(100);
expect(await page.locator('h3.day').count() === 1, 'calendar day not opened');
await shot('35-bills-calendar');
await click('[data-act="bills-mode"][data-m="list"]');
await click('[data-act="bills-win"][data-d="1"]');
expect((await txt('.win-title b')).includes("'s bills"), 'next window not shown');
await click('[data-act="bills-win"][data-d="-1"]');

// 8. Payday plan
await go('more');
await click('[data-act="nav"][data-v="plan"]');
await page.waitForSelector('.plan-head');
expect((await txt('.plan-head')).includes('Payday: 25th'), 'payday not shown as 25th');
expect(await page.locator('.tips .tip').count() >= 1, 'no suggestions');
expect(await page.locator('.guard-status').count() >= 1, 'direct debit guard missing');
expect((await page.textContent('#main')).includes('Debts, highest interest first'), 'debts list missing');
await shot('36-plan');
// payday change
await click('[data-act="open-payday"]');
await page.fill('#p-day', '28');
await page.waitForTimeout(100);
expect((await txt('#payday-preview')).includes('28 Oct'), 'payday preview missing');
await click('[data-act="save-payday"]');
await page.waitForTimeout(150);
expect((await txt('.plan-head')).includes('Payday: 28th'), 'payday did not change');
await click('[data-act="open-payday"]');
await page.fill('#p-day', '45');
await click('[data-act="save-payday"]');
expect(await page.locator('.sheet .err').count() === 1, 'bad payday accepted');
await page.fill('#p-day', '25');
await click('[data-act="save-payday"]');
await page.waitForTimeout(150);
// expected pay override
await click('[data-act="open-expected"]');
await page.fill('#x-sree', '3000');
await page.waitForTimeout(300); await shot('37-expected');
await click('[data-act="save-expected"]');
await page.waitForTimeout(150);
expect((await txt('.calc-list')).includes('~£3,000.00'), 'expected pay override not used');
await click('[data-act="open-expected"]');
await click('[data-act="reset-expected"]');
await click('[data-act="save-expected"]');
await page.waitForTimeout(150);
expect(!(await txt('.calc-list')).includes('~£3,000.00'), 'expected pay did not reset');

// 9. Home cards
await go('home');
await click('[data-act="person"][data-p="home"]');
await page.waitForTimeout(100);
expect(await page.locator('.link-card').count() === 2, 'plan cards missing on Home');
await page.waitForTimeout(200); await shot('38-home-phase3');
await click('.link-card[data-v="bills"]');
await page.waitForSelector('.win-nav');
await click('.subhead [data-act="nav"]');
await page.waitForTimeout(100);
expect(await page.locator('.link-card').count() === 2, 'back from bills did not return Home');

console.log('Phase 3 checks done');
} catch (e) { errors.push(`Phase 3 stopped: ${e.message.split('\n')[0]}`); await shot('99-fail'); }
console.log('Home "left" figure:', big.trim());
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'No errors');
await browser.close();
