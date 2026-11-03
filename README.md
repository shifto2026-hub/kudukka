# Kudukka

*Neeyum Njanum, Oru Kudukka* — you and me, one kudukka.

A household finance PWA for Sha and Sree: accounts and cards, entries with a calculator amount box,
a working month for catching up on last month, and a combined Home view with separate Sree and Sha views.

Live at https://shifto2026-hub.github.io/kudukka

## Tests
- `node tests/data.test.mjs` — calculator, balances and month totals
- `node tests/smoke.mjs <url> <out-dir>` — browser run-through against an in-memory Firebase mock (needs Playwright)
