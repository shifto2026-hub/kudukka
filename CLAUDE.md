# Kudukka

Household finance PWA for Sha and Sree. Tagline: *Neeyum Njanum, Oru Kudukka*.
Hosted on GitHub Pages at https://shifto2026-hub.github.io/kudukka (repo is public; no money data in code).

## Stack
- Plain HTML, CSS and ES modules. No build step: files are served as they are.
- Firebase 10.14.1 from the gstatic CDN: Google sign-in + Cloud Firestore (project `kudukka-6fcb4`, europe-west2).
- All data lives under `households/home/…` (`accounts`, `transactions`, `categories`, `trips`, `bills`, `plans`, `pots`, `potMoves`, `months`); the household doc holds `members` (uid → role `sha` | `sree`) and `settings` (`payday`, `dismissedBills`). Always save the whole `settings` object.
- `categories` docs hold only edits/additions on top of the defaults in `js/data.js`, keyed by the same ids (`food`, `food.groceries`, `income.sree`). Never delete default ids; hide them instead. Write with `fb.mergeDoc`.
- Transactions may carry `shop`, `tripId`, `flag`, `flagFor`, `flagNote` (Phase 2) and `billId` (Phase 3). Older entries lack them: always treat missing as empty/false.
- Bills: `{ name, kind: bill|repayment, amount, varies, freq: monthly|yearly, dueDay, dueMonth, accountId, toAccountId, categoryId, shop, archived }`. A payment matches a bill by `billId`, else a transfer to the repayment's account, else the shop name.
- Plans: `plans/{YYYY-MM}` holds `expected` pay per person (null = use the 3-month average).
- Pots (Phase 4, optional): `pots/{id}` `{ name, target, byMonth (YYYY-MM), accountId, preset, archived }`; money in/out is `potMoves/{id}` `{ potId, amount (signed pence), date, note }`. Pots are earmarks inside Kudukka, not bank movements.
- Months (Phase 4): `months/{YYYY-MM}` `{ closed, closedAt, closedBy, balanceChecks: { accountId: pence as the bank shows it (owed for cards/loans) }, reportSeen }`. Entries in a closed month can't be saved or deleted until it's reopened.
- Category subs may carry `need` (bool) for the 50/30/20 report; missing → `defaultNeed()` in `js/data.js`.
- Imported entries (Phase 5) carry `source: 'import'`. Import keeps only date, cleaned shop name and amount: `cleanShop()` strips sort codes and long numbers.
- Money month: pay on the payday covers the next month (payday 25 → '2026-11' runs 25 Oct–24 Nov). Account type `loan` is debt like `credit` (negative balance, optional `apr`).

## Files
- `js/data.js` — pure helpers (people, categories, money, dates, balances, month totals). Keep it free of Firebase so it stays testable.
- `js/bankcsv.js` — Phase 5 bank CSV import: parsing, column detection (Monzo, Starling, Nationwide, Lloyds/Halifax, Barclays, HSBC, Amex, Revolut…), shop cleaning, category hints, duplicate/transfer detection. Pure, no Firebase.
- `js/calc.js` — safe calculator for the amount box (no `eval`).
- `js/firebase.js` — Firebase init and thin wrappers.
- `js/app.js` — state, rendering (template strings), events (delegated `data-act`).
- `js/pin.js` — on-device 4-digit PIN lock.
- `sw.js` — service worker; bump `VERSION` whenever shipped files change.
- `firestore.rules` — template; the real emails are pasted only in the Firebase console, never committed.

## Rules of the road
- Money is stored as integer pence. Credit card balances are negative when money is owed.
- Entry types: `spend`, `income`, `transfer`, `adjust` (adjust amounts are signed). Transfers never count as spending.
- Every entry stores `date` (YYYY-MM-DD) and `month` (YYYY-MM). New entries default to the working month, never to today unless it is the working month.
- Joint accounts count only in the Home view; Sree and Sha views show their own accounts.
- Colours have fixed meanings: Sree `#225D65`, Sha `#D39932`, Joint/brand `#AE5238`, "all good" `#5C633E`.
- Do not commit personal email addresses or account numbers (only nickname + last 4 digits).

## Plan
Full plan: Claude Doc "Kudukka — app plan". Phase 1 = sign-in, PIN/Face ID, accounts and cards, entries, working month, Home summary.
Phase 2 (live) = editable categories and income sources, trips, shop memory and repeat, search and filters, Ask flags, donut, CSV export.
Phase 3 (live) = bills and repayments, bill spotting, calendar, loans with APR, payday plan (free to plan, safe to spend, savings and debt suggestions), direct debit guard.
Phase 4 (live) = optional pots (clay pots that fill, monthly share by a target month), reports (month and year, 50/30/20 needs/wants), close the month (balance checks, sort, bills, report, lock).
Phase 5 (live) = bank statement CSV import with review.
All five planned phases are built; next is fixing what Sha finds in real use.
Design: Kudukka has its own look (autumn palette, Cormorant for the name, Nunito for money). It shares only Shifto's tech approach.

## Testing
- `node tests/data.test.mjs`
- Browser: start the server and run in one command, e.g. `python3 -m http.server 8766 --directory . & node tests/smoke.mjs http://localhost:8766/ ./shots`. Push only when it prints `No errors`.
