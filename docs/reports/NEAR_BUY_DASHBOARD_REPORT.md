# Near Buy Dashboard Report

**Date:** 2026-11-18  
**Scope:** Read-only paper-trading signal visibility on the dashboard  
**Status:** Implemented and deployed to the Raspberry Pi, as reported by the operator.

## Result

The dashboard now has a compact **Near Buy** panel that lists only market symbols and the label “Near Buy”. It refreshes with the existing dashboard data request. When a market's latest decision no longer meets the signal filter, it disappears on the next refresh. Markets with an open position in the system paper portfolio are omitted.

The existing `GET /api/v1/dashboard-data` route now returns `nearBuyMarkets`. The Raspberry Pi API reads the latest decision per enabled watched market using the existing `(symbol, created_at DESC, id DESC)` index. The result is bounded to 500 markets, matching the configured analysis capacity. No new API route, Vercel function, table, migration, scheduler, or trade execution path was introduced.

## Near Buy definition

A market is included when its latest stored decision meets the existing AI signal/data requirements:

- The decision is `BUY`, or it is `HOLD` with Market Strength from **15 inclusive to 20 exclusive**.
- Directional alignment is true.
- `sufficientForDirectionalSignal` is true, which excludes insufficient or stale signal inputs as determined by the AI engine.
- Confidence is at least **65**, the deterministic AI signal floor.
- The latest decision is no more than **10 minutes old**; older or future-dated decisions are hidden so a missed scheduler cycle does not leave a stale signal listed.
- There is no currently open position for that market in the system paper portfolio.

The score range provides a five-point heads-up to the AI BUY boundary at Market Strength 20. The panel is a signal watchlist. It does not claim that a paper trade will execute: the paper executor additionally requires confidence of 70 and checks cooldown, market freshness, position limits, drawdown, emergency state, and other risk controls.

## Files changed

- `raspberry-pi/src/repositories/ai-decisions-repository.mjs` — bounded latest-decision lookup per enabled market.
- `raspberry-pi/src/api/data-routes.mjs` — near-buy filter and response property on the existing dashboard route.
- `dashboard.html`, `js/dashboard.js` — compact list and empty state.
- `tests/dashboard.test.js`, `raspberry-pi/tests/data-api.test.mjs`, `raspberry-pi/tests/auth-routes.test.mjs` — UI, API, and repository-contract coverage.
- `README.md`, `ROADMAP.md`, `docs/API.md`, `docs/ARCHITECTURE.md`, `docs/CHANGELOG.md` — synchronized documentation.

## Validation

- `node --test tests/dashboard.test.js`: 26 passed, 1 failed. Near Buy rendering, empty state, and panel assertions passed. The remaining unrelated offline-status assertion expected `Offline` but received `Unknown`.
- `node --test tests/data-api.test.mjs tests/auth-routes.test.mjs` from `raspberry-pi/`: 26 passed, 0 failed.
- No database migration was needed. The operator reports the Raspberry Pi deployment is complete; this report does not independently verify live production behavior or a Vercel deployment.

## Operational notes

The dashboard refresh interval remains unchanged. Removal is reflected on its next normal data refresh after a new AI decision is stored, or after the existing decision becomes more than 10 minutes old. A globally paused or blocked paper executor can still show a market whose AI signal meets the Near Buy definition; the panel deliberately presents signal proximity, not all execution gates.
