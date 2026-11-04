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

console.log('Home "left" figure:', big.trim());
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'No errors');
await browser.close();
