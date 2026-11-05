# Shadow Exit Scenarios Implementation Report

## Summary

CryptoPulse now records and displays prospective, simulation-only position-level exit scenarios. The feature evaluates seven fixed, versioned candidate rules for each tracked paper position and compares hypothetical outcomes with actual closes. It does not activate or recommend an exit rule and does not change the existing AI SELL path, paper-trading executor, risk checks, positions, trades, balances, or portfolio metrics.

This is forward shadow tracking, not a backtest. The earlier strategy and candle-ingestion audits found incomplete historical candle coverage; no historical outcomes were reconstructed or used to trigger scenarios.

## Registered rule set

Every scenario uses rule version `1.0.0`. The grid is fixed and experimental:

| Scenario | Trigger condition |
|---|---|
| Fixed take-profit +5% | First eligible observed mark at or above 5% gain from fee-inclusive entry basis |
| Fixed take-profit +10% | First eligible observed mark at or above 10% gain |
| Fixed take-profit +15% | First eligible observed mark at or above 15% gain |
| Fixed take-profit +20% | First eligible observed mark at or above 20% gain |
| Trailing stop 5% | Arm after an observed gain of at least 5%; trigger at an observed mark at least 5% below the persisted high-water mark |
| Trailing stop 10% | Same activation; trigger at least 10% below the high-water mark |
| Trailing stop 15% | Same activation; trigger at least 15% below the high-water mark |

Each rule is an independent hypothetical strategy. No candidate is selected, tuned, or described as better based on its observed outcomes.

## Observation and fill assumptions

- Evaluation uses fresh, valid stored `AI_Crypto_Bot_Market_Data` marks. It does not use candle highs/lows or interpolate prices between observations.
- Fixed targets trigger only when an eligible observed mark satisfies the target. Trailing rules arm and update their high-water mark only from eligible observed marks, and trigger only when a later observed mark satisfies the configured drawdown.
- Stale, invalid, future-dated, regressive, or conflicting marks do not trigger an exit. The state preserves the last valid mark/high-water mark and reports a waiting or skipped data-quality state.
- Positions already open when tracking begins initialize at their first fresh observed mark. No scenario is backdated and no trigger is inferred from incomplete historical candles.
- A modeled exit applies 0.10% adverse slippage to the observed trigger mark and then a 0.25% exit fee. Net outcome is calculated against the stored fee-inclusive entry basis.
- Historical bid/ask spread is unavailable. The observed mark and modeled fill are estimates, not guaranteed executable prices. Results also depend on the cadence at which the existing paper-trading service evaluates the marks.
- On an actual SELL close, the scenario records the actual close timestamp, price, and net outcome for comparison; this does not rewrite the actual trade.

## Execution isolation and persistence

The shared paper-trading service calls the shadow evaluator independently before the actual run and, when trades execute, afterward. The post-run evaluation allows newly opened positions to initialize and actual SELLs to finalize their scenarios. Shadow failures are logged separately and do not fail a successful real paper-trading run.

The evaluator uses its own database advisory lock and idempotent scenario/event keys to protect retries and overlapping invocations. It has no call path to AI decision generation or paper-trade execution. It writes only:

- `AI_Crypto_Bot_Shadow_Exit_Scenarios`: compact per-position/per-rule state, including rule/version, tracking and evaluation times, last valid mark, trailing activation/high-water state, data quality, hypothetical trigger/fill estimate, and actual-close comparison.
- `AI_Crypto_Bot_Shadow_Exit_Events`: append-only meaningful transitions, including activation, hypothetical trigger, actual close, and relevant evaluation/data-quality failures.

The design writes seven state rows per tracked position and avoids a history row on every dashboard poll. Event volume therefore follows meaningful state changes and failures rather than dashboard refresh frequency. Both tables use the mandatory project prefix and RLS; authenticated users can read only state visible through their owned portfolios, while the evaluator is service-role-only.

## Dashboard and API

The existing authenticated, read-only `GET /api/dashboard-data` route includes scenario data for open positions and up to five recent closed-position groups. The dashboard adds a responsive, keyboard-accessible “Shadow Exit Scenarios” section that explicitly labels the values as simulations and keeps actual close comparisons and hypothetical outcomes distinct from actual P&L.

No API route, Vercel Function, scheduler job, package dependency, or live-trading capability was added. The existing actual portfolio and trading metrics continue to derive only from actual records.

## Database migration and deployment status

Added migration: `supabase/migrations/20261105104400_shadow_exit_scenarios.sql`.

The migration adds the two shadow tables, constraints, indexes, RLS policies, evaluator RPC, locking, idempotency, and event/state handling. It does not alter existing paper-trading functions or actual trading data.

The migration has **not** been applied to production. No deployment, scheduler change, production data change, or live-trading configuration change was made. `ENABLE_LIVE_TRADING=false` remains required.

## Validation

Executed successfully:

| Command | Result |
|---|---|
| `npm.cmd test -- --test-name-pattern=shadow tests/database-migrations.test.js` | Passed; 6 selected migration/evaluator tests |
| `npm.cmd test -- tests/paper-trading.test.mjs tests/dashboard.test.js` | Passed; 41 tests, 0 failures |
| `npm.cmd test` | Passed; 285 tests, 0 failures |
| `npm.cmd run build` | Passed; static project and database migration validation, including 18 prefixed tables and RLS coverage |

Coverage includes rule-grid/version validation, fixed and trailing transitions, persisted high-water state, first-fresh-mark initialization, stale/invalid input, retries, actual-close finalization, failure isolation, dashboard/API serialization, P&L separation, and migration naming/constraints/indexes/access policies.

These are local automated tests. They do not prove that the migration has been applied to a remote Supabase project or that a production deployment has succeeded.

## Known limitations

- Scenarios begin prospectively and do not repair or reinterpret the incomplete historical candle series documented in prior audits.
- No historical bid/ask spread or guaranteed fill data is available; modeled outcomes cannot establish executable fills.
- Trigger times and prices are limited to fresh marks observed at evaluator runs; intrarun peaks or crossings are not inferred.
- The candidate rules remain experimental and are not validated exit recommendations. More complete prospective history and a separately designed, reproducible evaluation are required before considering any production exit behavior.
- Actual position closure association relies on the stored position/SELL-trade data; missing or inconsistent actual-close records may prevent a comparison from being finalized.

## Files changed for this feature

- `supabase/migrations/20261105104400_shadow_exit_scenarios.sql`
- `lib/shadow-exits.mjs`
- `lib/paper-trading.mjs`
- `api/dashboard-data.mjs`
- `dashboard.html`
- `css/styles.css`
- `js/dashboard.js`
- `scripts/validate-database.js`
- `tests/database-migrations.test.js`
- `tests/paper-trading.test.mjs`
- `tests/dashboard.test.js`
- `README.md`
- `ROADMAP.md`
- `docs/API.md`
- `docs/DATABASE.md`
- `docs/ARCHITECTURE.md`
- `docs/RISK_MANAGEMENT.md`
- `docs/SCHEDULING.md`
- `docs/TESTING.MD`
- `docs/CHANGELOG.md`
- `docs/reports/SHADOW_EXIT_SCENARIOS_REPORT.md`
