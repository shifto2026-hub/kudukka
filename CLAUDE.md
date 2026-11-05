# Kudukka

Household finance PWA for Sha and Sree. Tagline: *Neeyum Njanum, Oru Kudukka*.
Hosted on GitHub Pages at https://shifto2026-hub.github.io/kudukka (repo is public; no money data in code).

## Stack
- Plain HTML, CSS and ES modules. No build step: files are served as they are.
- Firebase 10.14.1 from the gstatic CDN: Google sign-in + Cloud Firestore (project `kudukka-6fcb4`, europe-west2).
- All data lives under `households/home/…` (`accounts`, `transactions`, `categories`, `trips`); the household doc holds `members` (uid → role `sha` | `sree`).
- `categories` docs hold only edits/additions on top of the defaults in `js/data.js`, keyed by the same ids (`food`, `food.groceries`, `income.sree`). Never delete default ids; hide them instead. Write with `fb.mergeDoc`.
- Transactions may carry `shop`, `tripId`, `flag`, `flagFor`, `flagNote` (Phase 2). Phase 1 entries lack them: always treat missing as empty/false.

## Files
- `js/data.js` — pure helpers (people, categories, money, dates, balances, month totals). Keep it free of Firebase so it stays testable.
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
Next: Phase 3 (bills, calendar, next month's prediction, direct debit guard), Phase 4 (light optional pots, plan, reports, close the month), Phase 5 (CSV import).
Design: Kudukka has its own look (autumn palette, Cormorant for the name, Nunito for money). It shares only Shifto's tech approach.

## Testing
- `node tests/data.test.mjs`
- Browser: start the server and run in one command, e.g. `python3 -m http.server 8766 --directory . & node tests/smoke.mjs http://localhost:8766/ ./shots`. Push only when it prints `No errors`.
