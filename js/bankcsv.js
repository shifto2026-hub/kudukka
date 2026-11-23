// Phase 5: reading bank statement CSV files.
// Pure functions only (no Firebase), so they can be tested. Nothing here keeps sort codes or account numbers:
// only the date, a cleaned shop name and the amount become entries.
import { shopKey, categoryById, monthOf, isDebt, billKey } from './data.js';

// ---------- CSV ----------
export function parseCSV(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const first = src.split(/\r?\n/).find((l) => l.trim()) || '';
  const count = (ch) => first.split(ch).length - 1;
  const delim = count('\t') > count(',') && count('\t') > count(';') ? '\t' : count(';') > count(',') ? ';' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some((x) => x !== ''));
}

// ---------- dates and amounts ----------
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const p2 = (n) => String(n).padStart(2, '0');
const fullYear = (y) => (y < 100 ? 2000 + y : y);
function validISO(y, m, d) {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1990 && y <= 2100)) return null;
  const dt = new Date(y, m - 1, d);
  return dt.getMonth() === m - 1 ? `${y}-${p2(m)}-${p2(d)}` : null;
}

// UK order (day first) unless told 'mdy'. Accepts 02/11/2026, 2/11/26, 2026-11-02, 02 Nov 2026, 2-Nov-26, with a time after.
export function parseDate(s, order = 'dmy') {
  const t = String(s || '').trim().replace(/[T ]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?Z?$/, '').trim();
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return validISO(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) return order === 'mdy' ? validISO(fullYear(+m[3]), +m[1], +m[2]) : validISO(fullYear(+m[3]), +m[2], +m[1]);
  m = t.match(/^(\d{1,2})[-\s/]([A-Za-z]{3,9})[-\s/,]*(\d{2,4})$/);
  const mon = m && (MON[m[2].toLowerCase()] || MON[m[2].toLowerCase().slice(0, 3)]);
  return mon ? validISO(fullYear(+m[3]), mon, +m[1]) : null;
}

// Guess day-first or month-first from the values themselves (a first part over 12 means day-first).
export function dateOrder(values) {
  let dmy = 0;
  let mdy = 0;
  for (const v of values) {
    const m = String(v || '').trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/);
    if (!m) continue;
    if (+m[1] > 12) dmy++;
    if (+m[2] > 12) mdy++;
  }
  return mdy > dmy ? 'mdy' : 'dmy';
}

// Signed pence: "£1,234.56", "-12.30", "(12.30)", "12.30 DR", "12.30CR", "−5". Empty → null.
export function parseAmount(s) {
  let t = String(s ?? '').trim();
  if (!t) return null;
  let sign = 1;
  if (/\bDR\b|DR$/i.test(t)) { sign = -1; t = t.replace(/DR/i, ''); }
  t = t.replace(/CR/i, '');
  if (/^\(.*\)$/.test(t)) { sign = -sign; t = t.slice(1, -1); }
  t = t.replace(/[£$€\s,]|GBP/gi, '').replace(/[−–]/g, '-');
  if (t.endsWith('-')) { sign = -sign; t = t.slice(0, -1); }
  if (t.startsWith('+')) t = t.slice(1);
  if (!/^-?\d*\.?\d+$/.test(t)) return null;
  return sign * Math.round(parseFloat(t) * 100);
}

// ---------- columns ----------
const norm = (h) => String(h || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const NEVER = /balance|sort code|account number|account no|card number|iban|bic|local amount|local currency|exchange|fee|time|category|emoji|address|receipt|currency|status|state|type|tags|notes/;
const DATE_RANK = ['completed date', 'transaction date', 'date', 'posting date', 'value date', 'started date'];
const DESC_RANK = ['name', 'counter party', 'merchant', 'payee', 'description', 'transaction description', 'details', 'narrative', 'memo', 'reference', 'transaction details'];
const OUT_RE = /^(paid out|money out|debit|debit amount|debits|withdrawals?|out|spent|amount out)$/;
const IN_RE = /^(paid in|money in|credit|credit amount|credits|deposits?|in|received|amount in)$/;
const AMT_RE = /^(amount|amount gbp|value|transaction amount|amount in gbp|money|billing amount)$/;

const share = (rows, col, fn) => {
  const vals = rows.map((r) => r[col]).filter((v) => v !== undefined && v !== '');
  return vals.length ? vals.filter(fn).length / vals.length : 0;
};

// Find the header row (banks like Nationwide put a few lines of account details first).
export function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const h = rows[i].map(norm);
    const hasDate = h.some((x) => x.includes('date'));
    const hasMoney = h.some((x) => AMT_RE.test(x) || OUT_RE.test(x) || IN_RE.test(x) || x.startsWith('amount'));
    if (hasDate && hasMoney) return i;
  }
  return -1;
}

// Work out which column is which. Returns { headerIndex, header, date, desc, amount, out, in, order }.
export function detectColumns(rows) {
  const hi = findHeader(rows);
  const body = rows.slice(hi + 1, hi + 41);
  const width = Math.max(...rows.slice(Math.max(0, hi), hi + 41).map((r) => r.length), 0);
  const header = hi >= 0 ? rows[hi] : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
  const h = header.map(norm);
  const map = { headerIndex: hi, header, date: -1, desc: -1, amount: -1, out: -1, in: -1 };
  if (hi >= 0) {
    for (const want of DATE_RANK) { const i = h.indexOf(want); if (i >= 0) { map.date = i; break; } }
    if (map.date < 0) map.date = h.findIndex((x) => x.includes('date'));
    for (const want of DESC_RANK) {
      const i = h.indexOf(want);
      if (i >= 0 && share(body, i, (v) => /[a-z]/i.test(v)) > 0.5) { map.desc = i; break; }
    }
    map.out = h.findIndex((x) => OUT_RE.test(x));
    map.in = h.findIndex((x) => IN_RE.test(x));
    map.amount = h.findIndex((x) => AMT_RE.test(x));
    if (map.amount < 0) map.amount = h.findIndex((x) => x.startsWith('amount') && !NEVER.test(x));
    if (map.out >= 0 && map.in >= 0) map.amount = -1;
  }
  // No header (HSBC and some others): guess from the values.
  if (map.date < 0) map.date = [...Array(width).keys()].find((i) => share(body, i, (v) => !!parseDate(v)) > 0.8) ?? -1;
  if (map.desc < 0) {
    let best = -1;
    let bestLen = 0;
    for (let i = 0; i < width; i++) {
      if (i === map.date || (hi >= 0 && NEVER.test(h[i]))) continue;
      if (share(body, i, (v) => /[a-z]{2}/i.test(v)) < 0.6) continue;
      const len = body.reduce((n, r) => n + String(r[i] || '').length, 0);
      if (len > bestLen) { best = i; bestLen = len; }
    }
    map.desc = best;
  }
  if (map.amount < 0 && (map.out < 0 || map.in < 0)) {
    const money = [...Array(width).keys()].filter((i) => i !== map.date && i !== map.desc && (hi < 0 || !NEVER.test(h[i])) && share(body, i, (v) => parseAmount(v) !== null) > 0.8);
    map.amount = money.length ? money[0] : -1;
  }
  map.order = map.date >= 0 ? dateOrder(body.map((r) => r[map.date])) : 'dmy';
  return map;
}

// Rows → [{ line, date, desc, flow }] where flow is pence into the account (+) or out of it (−).
// spendSign: 'minus' when money out shows as negative (most banks), 'plus' when spending shows as positive (most card statements).
export function readRows(rows, map, spendSign = 'minus') {
  const out = [];
  const problems = [];
  rows.slice(map.headerIndex + 1).forEach((r, i) => {
    const line = map.headerIndex + 2 + i;
    const date = parseDate(r[map.date], map.order);
    const desc = map.desc >= 0 ? String(r[map.desc] || '').trim() : '';
    let flow = null;
    if (map.amount >= 0) {
      const v = parseAmount(r[map.amount]);
      if (v !== null) flow = spendSign === 'plus' ? -v : v;
    } else if (map.out >= 0 || map.in >= 0) {
      const o = map.out >= 0 ? parseAmount(r[map.out]) : null;
      const n = map.in >= 0 ? parseAmount(r[map.in]) : null;
      if (o !== null || n !== null) flow = Math.abs(n || 0) - Math.abs(o || 0);
    }
    if (!date || flow === null) { if (r.some((x) => x)) problems.push(line); return; }
    if (flow === 0) return;
    out.push({ line, date, desc, flow });
  });
  return { rows: out, problems };
}

// Card statements usually show spending as positive. Guess from the rows: payments to the card read like
// "payment received / thank you"; if those are negative, spending is positive.
export function guessSpendSign(rows, map, account) {
  if (!account || !isDebt(account) || map.amount < 0) return 'minus';
  const body = rows.slice(map.headerIndex + 1);
  let payNeg = 0;
  let payPos = 0;
  let pos = 0;
  let total = 0;
  for (const r of body) {
    const v = parseAmount(r[map.amount]);
    if (v === null) continue;
    total++;
    if (v > 0) pos++;
    if (/payment|thank you|direct debit|received/i.test(r[map.desc] || '')) { if (v < 0) payNeg++; else payPos++; }
  }
  if (payNeg || payPos) return payNeg >= payPos ? 'plus' : 'minus';
  return total && pos / total > 0.7 ? 'plus' : 'minus';
}

// ---------- shop names ----------
const SMALL = new Set(['and', 'of', 'the', 'to', 'at', 'on', 'in', 'for']);
const KEEP_UPPER = new Set(['bp', 'ee', 'bt', 'o2', 'tfl', 'kfc', 'dvla', 'hmrc', 'tv', 'uk', 'nhs', 'ikea', 'asda', 'ovo', 'sse', 'edf', 'ncp', 'lv', 'mot', 'atm']);
// Turn "CARD PAYMENT TO TESCO STORES 3245 ON 02 NOV" into "Tesco Stores". Long digit runs (card, account and
// reference numbers) and sort codes are removed so they never reach the database.
export function cleanShop(desc) {
  let t = String(desc || '');
  t = t.replace(/\b\d{2}-\d{2}-\d{2}\b/g, ' ') // sort codes
    .replace(/\d[\d\s-]{5,}\d/g, ' ') // long numbers (6+ digits, with spaces or dashes)
    .replace(/\*+\d+/g, ' ')
    .replace(/\*\s*(?=[a-z0-9]*\d)[a-z0-9]{4,}/gi, ' ')
    .replace(/^(card payment to|card payment|card purchase|contactless payment|contactless|purchase|pos|visa|debit card purchase|dd|d\/d|direct debit( to)?|s\/o|standing order( to)?|bgc|bill payment( to)?|faster payment( to)?|fpo|fpi|cd \d+)(?=[\s:-]|$)[\s:-]*/i, ' ')
    .replace(/\b(on|via)\s+\d{1,2}[\s/-]?[a-z]{3}\b.*$/i, ' ')
    .replace(/\b\d{1,2}\s?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b(\s?\d{2,4})?/ig, ' ')
    .replace(/\b(gbr|gb|ltd|limited|plc)\b\.?/ig, ' ')
    .replace(/\b\d{3,}\b/g, ' ')
    .replace(/[*#|_]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/^[-,.\s]+|[-,.\s]+$/g, '');
  if (!t) return '';
  const lettersUpper = t === t.toUpperCase();
  if (!lettersUpper) return t.slice(0, 40);
  return t.toLowerCase().split(' ').map((w, i) => {
    if (KEEP_UPPER.has(w.replace(/[^a-z0-9]/g, '')) || w.includes('&')) return w.toUpperCase();
    if (i > 0 && SMALL.has(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ').slice(0, 40);
}

// One name "matches" another when one starts the other at a word boundary ("tesco" ~ "tesco stores").
export function nameMatches(a, b) {
  const x = shopKey(a);
  const y = shopKey(b);
  if (!x || !y || Math.min(x.length, y.length) < 3) return false;
  return x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `) || x.replace(/ /g, '') === y.replace(/ /g, '');
}

// ---------- category hints ----------
// Common UK shops and billers → default category ids. Short names only match as whole words.
export const CATEGORY_HINTS = [
  [/\b(tesco|sainsbury'?s?|asda|morrisons|aldi|lidl|waitrose|co-?op|iceland|ocado|m&s food|marks & spencer simply food|farmfoods|spar|budgens|costcutter|one stop)\b/i, 'food.groceries'],
  [/\b(deliveroo|just eat|uber ?eats|dominos|domino's|papa john'?s)\b/i, 'food.takeaway'],
  [/\b(costa|starbucks|pret|caffe nero|mcdonald'?s|kfc|nando'?s|greggs|wagamama|pizza express|subway|burger king|five guys|toby carvery|harvester|restaurant|cafe|coffee)\b/i, 'food.eatingout'],
  [/\b(shell|bp|esso|texaco|jet|gulf|murco|petrol|fuel|applegreen)\b/i, 'car.fuel'],
  [/\b(ringgo|paybyphone|ncp|parking|justpark|apcoa)\b/i, 'car.parking'],
  [/\b(dart charge|dartford crossing|tfl|ulez|congestion charge|toll)\b/i, 'car.roadcharges'],
  [/\b(kwik fit|halfords|mot|garage|tyres?)\b/i, 'car.servicing'],
  [/\b(trainline|southeastern|national rail|stagecoach|arriva|uber|bolt|addison lee|megabus|national express)\b/i, 'travel.transport'],
  [/\b(ryanair|easyjet|british airways|jet2|wizz|emirates|qatar airways|air india|virgin atlantic)\b/i, 'travel.flights'],
  [/\b(booking\.com|airbnb|premier inn|travelodge|hotels?\.com|expedia|hilton|marriott)\b/i, 'travel.hotels'],
  [/\b(netflix|spotify|disney|amazon prime|prime video|apple\.com|apple music|icloud|youtube|google storage|now tv|audible|chatgpt|openai|claude)\b/i, 'bills.subs'],
  [/\b(octopus|british gas|edf|e\.?on|ovo|sse|scottish power|so energy|utility warehouse)\b/i, 'bills.energy'],
  [/\b(southern water|south east water|thames water|affinity water|water)\b/i, 'bills.water'],
  [/\b(council|borough|county council|council tax)\b/i, 'bills.council'],
  [/\b(bt|sky|virgin media|talktalk|plusnet|hyperoptic|community fibre|vodafone broadband|broadband)\b/i, 'bills.broadband'],
  [/\b(ee|vodafone|o2|three|giffgaff|lebara|lyca|lycamobile|voxi|id mobile|smarty|tesco mobile)\b/i, 'bills.phones'],
  [/\b(aviva|admiral|direct line|lv|hastings|churchill|axa|insurance)\b/i, 'bills.insurance'],
  [/\b(boots|superdrug|savers|barbers?|hair|salon)\b/i, 'shopping.personal'],
  [/\b(primark|next|h&m|zara|tk maxx|matalan|uniqlo|new look|river island|sports direct|jd sports|clothing)\b/i, 'shopping.clothes'],
  [/\b(amazon|argos|ikea|b&q|wilko|the range|dunelm|home bargains|b&m|poundland|currys|screwfix|homebase)\b/i, 'shopping.household'],
  [/\b(moonpig|card factory|interflora|clintons)\b/i, 'shopping.gifts'],
  [/\b(interest|overdraft fee|late fee|charge for|annual fee)\b/i, 'bills.interest'],
];
export function hintCategory(name) {
  for (const [re, id] of CATEGORY_HINTS) if (re.test(name)) return id;
  return null;
}

const TRANSFER_RE = /\b(transfer|tfr|trf|internal|between accounts|to pot|from pot|savings|save the change|round ?up|isa)\b/i;
const CARD_PAYMENT_RE = /\b(payment received|thank you|payment - thank|direct debit payment|dd payment|payment thank)\b/i;

// ---------- building the import ----------
// Each row becomes an item with a suggested type and category and a status:
//   ready      — complete, ticked to import
//   needs      — a spend that still needs a category
//   duplicate  — looks like an entry already in Kudukka (not ticked)
//   transfer   — looks like money between your own accounts (not ticked; choose the other account to add it)
//   closed     — dated in a closed month (not ticked)
export function buildImport(read, ctx) {
  const { account, accounts = [], txns = [], bills = [], shopIdx = new Map(), closedMonths = [], incomeCategory = 'income.other' } = ctx;
  const others = accounts.filter((a) => !a.archived && a.id !== account.id);
  const debts = others.filter(isDebt);
  // Existing entries that touch this account, each usable once as a duplicate match.
  const pool = txns.filter((t) => t.accountId === account.id || t.toAccountId === account.id).map((t) => {
    const into = t.toAccountId === account.id && t.type === 'transfer' ? 1
      : t.accountId === account.id ? (t.type === 'income' ? 1 : t.type === 'adjust' ? Math.sign(t.amount) : -1) : 0;
    return { t, flow: into * Math.abs(t.amount || 0), used: false };
  });
  const known = [...shopIdx.values()];
  const ownName = (d) => /\bsree/i.test(d) || /\bsha\b|\bshahna/i.test(d)
    || others.some((a) => nameMatches(d, a.name) || (a.bank && nameMatches(d, a.bank)));

  return read.rows.map((r, i) => {
    const shop = cleanShop(r.desc) || (r.flow > 0 ? 'Money in' : 'Money out');
    const amount = Math.abs(r.flow);
    const item = {
      key: `r${i}`, line: r.line, date: r.date, raw: cleanShop(r.desc), shop, amount, dir: r.flow > 0 ? 'in' : 'out',
      type: r.flow > 0 ? 'income' : 'spend', categoryId: '', toAccountId: '', fromAccountId: '', billId: '', note: '',
      status: 'ready', include: true, why: '',
    };
    // 1. already in Kudukka?
    const dup = pool.find((p) => !p.used && p.flow === r.flow && Math.abs((new Date(p.t.date) - new Date(r.date)) / 864e5) <= 3);
    if (dup) { dup.used = true; return { ...item, status: 'duplicate', include: false, why: 'Already in Kudukka', dupId: dup.t.id }; }
    if (closedMonths.includes(monthOf(r.date))) return { ...item, status: 'closed', include: false, why: 'Month is closed' };

    if (item.dir === 'out') {
      // 2. a bill or repayment you've set up
      const bill = bills.find((b) => !b.archived && b.accountId === account.id && (nameMatches(shop, billKey(b)) || nameMatches(shop, b.name)));
      if (bill && bill.kind === 'repayment') return { ...item, type: 'transfer', toAccountId: bill.toAccountId, billId: bill.id, shop: '', note: bill.name, why: `Repayment: ${bill.name}` };
      if (bill) return { ...item, shop: bill.shop || bill.name, categoryId: bill.categoryId || hintCategory(shop) || '', billId: bill.id, status: bill.categoryId || hintCategory(shop) ? 'ready' : 'needs', include: !!(bill.categoryId || hintCategory(shop)), why: `Bill: ${bill.name}` };
      // 3. paying off one of your cards or loans
      const debt = !isDebt(account) && debts.find((a) => nameMatches(shop, a.name) || (a.bank && nameMatches(shop, a.bank)));
      if (debt) return { ...item, type: 'transfer', toAccountId: debt.id, shop: '', why: `Paying ${debt.name}` };
      // 4. money to your own accounts
      if (TRANSFER_RE.test(r.desc) || ownName(r.desc)) return { ...item, type: 'transfer', shop: '', note: shop, status: 'transfer', include: false, why: 'Looks like a transfer' };
      // 5. a shop you've used before, then common shop names
      const seen = known.find((k) => k.type === 'spend' && k.categoryId && nameMatches(shop, k.shop));
      if (seen && categoryById(seen.categoryId) && !categoryById(seen.categoryId).hidden) return { ...item, shop: seen.shop, categoryId: seen.categoryId, why: 'You used this shop before' };
      const hint = hintCategory(shop);
      if (hint && categoryById(hint) && !categoryById(hint).hidden) return { ...item, categoryId: hint, why: 'Guessed from the name' };
      return { ...item, status: 'needs', include: false, why: 'Choose a category' };
    }
    // Money in
    if (isDebt(account)) {
      if (CARD_PAYMENT_RE.test(r.desc) || TRANSFER_RE.test(r.desc)) return { ...item, type: 'transfer', shop: '', note: 'Card payment', status: 'transfer', include: false, why: 'Card payment: usually entered from the bank side' };
      return { ...item, type: 'adjust', shop: '', note: `Refund · ${shop}`, why: 'Refund' };
    }
    if (TRANSFER_RE.test(r.desc) || ownName(r.desc)) return { ...item, type: 'transfer', shop: '', note: shop, status: 'transfer', include: false, why: 'Looks like a transfer' };
    return { ...item, categoryId: incomeCategory, note: shop, shop: '', why: 'Money in' };
  });
}

// Is an item complete enough to import?
export function itemReady(it) {
  if (it.status === 'skip') return false;
  if (it.type === 'spend') return !!it.categoryId;
  if (it.type === 'income') return !!it.categoryId;
  if (it.type === 'transfer') return it.dir === 'in' ? !!it.fromAccountId : !!it.toAccountId;
  return it.type === 'adjust';
}

// The entry an item becomes (without createdBy etc.).
export function itemToEntry(it, accountId) {
  const base = { date: it.date, month: monthOf(it.date), calc: null, source: 'import', shop: '', tripId: null, flag: false, flagFor: null, flagNote: '', billId: it.billId || null, note: (it.note || '').slice(0, 80) };
  if (it.type === 'transfer') {
    const into = it.dir === 'in';
    return { ...base, type: 'transfer', amount: it.amount, accountId: into ? it.fromAccountId : accountId, toAccountId: into ? accountId : it.toAccountId, categoryId: null };
  }
  if (it.type === 'adjust') return { ...base, type: 'adjust', amount: it.dir === 'in' ? it.amount : -it.amount, accountId, toAccountId: null, categoryId: null };
  if (it.type === 'income') return { ...base, type: 'income', amount: it.amount, accountId, toAccountId: null, categoryId: it.categoryId };
  return { ...base, type: 'spend', amount: it.amount, accountId, toAccountId: null, categoryId: it.categoryId, shop: (it.shop || '').slice(0, 40) };
}

// Who owns income in a given account, for the default income source.
export const incomeFor = (account) => (account && account.owner === 'sree' ? 'income.sree' : account && account.owner === 'sha' ? 'income.sha' : 'income.other');
