# Kudukka

Household finance PWA for Sha and Sree. Tagline: *Neeyum Njanum, Oru Kudukka*.
Hosted on GitHub Pages at https://shifto2026-hub.github.io/kudukka (repo is public; no money data in code).

## Stack
- Plain HTML, CSS and ES modules. No build step: files are served as they are.
- Firebase 10.14.1 from the gstatic CDN: Google sign-in + Cloud Firestore (project `kudukka-6fcb4`, europe-west2).
- All data lives under `households/home/…` (`accounts`, `transactions`); the household doc holds `members` (uid → role `sha` | `sree`).

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
Full plan: Claude Doc "Kudukka — app plan". Phase 1 = sign-in, PIN, accounts and cards, entries, working month, Home summary.
Next: Phase 2 (editable categories, trips, donut chart), Phase 3 (bills, direct debit guard), Phase 4 (pots, plan, reports, close the month), Phase 5 (CSV import).
