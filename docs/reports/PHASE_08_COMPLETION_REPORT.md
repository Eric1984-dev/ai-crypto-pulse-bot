# Phase 08 Completion Report — Paper Trading

## Status

Phase 08 is implemented and locally validated. Phase 09 has not been started.

## Architecture

1. `/api/ai-analysis` stores decisions in `AI_Crypto_Bot_AI_Decisions`; it remains analysis-only.
2. An external scheduler calls `POST /api/paper-trading` after analysis succeeds.
3. The server validates the cron secret and requires `ENABLE_LIVE_TRADING=false`, then invokes the service-role-only `AI_Crypto_Bot_Run_Paper_Trading()` Supabase RPC.
4. PostgreSQL serializes overlapping scheduled runs, selects the newest stored decision for each enabled market, and applies the decision to each user's portfolio under row locks.
5. Valid trades, positions, updated balances/value, and portfolio snapshots are persisted transactionally. Trades retain a foreign-key reference to their source AI decision.
6. The authenticated dashboard and portfolio page read actual database data through the existing RLS-protected `/api/dashboard-data` endpoint.

The paper-trading service accesses no Bitvavo or exchange endpoint, private exchange account, exchange balance, or order API.

## Paper-trading workflow

- Profiles without a portfolio receive a simulated €10,000 starting balance and an initial stored snapshot. Existing portfolios are preserved.
- The executor reads the newest persisted decision and stored market snapshot; missing, stale (over 15 minutes), invalid, or superseded inputs fail closed.
- BUY opens a long position only when confidence is at least 70 and all risk checks pass.
- SELL closes all open positions for that market when the stored quote is fresh. It does not open a short position.
- HOLD and WAIT never create trades.
- A deterministic UUID derived from the portfolio and decision IDs, plus the database unique constraint, makes retries duplicate-safe.

## Database changes

Migration [`20261101154600_phase08_paper_trading.sql`](../../supabase/migrations/20261101154600_phase08_paper_trading.sql):

- Adds nullable `AI_Crypto_Bot_Trades.ai_decision_id` with a restrictive foreign key for audit traceability; legacy trade rows remain valid.
- Adds lookup indexes for latest decisions, trade cooldowns, and decision-linked trades.
- Provisions a €10,000 portfolio and initial snapshot for existing profiles without one and for newly created profiles.
- Adds service-role-only database functions for valuation, risk checks, execution, and scheduled processing.
- Adds no tables; all Phase 08 state uses the existing portfolio, position, trade, snapshot, decision, market-data, and status tables.

## Risk controls

- Maximum five open positions per portfolio.
- Entry notional capped at 10% of current portfolio value; fees must also fit the available balance.
- BUY confidence threshold: 70.
- 15-minute cooldown per market for new entries; SELL exits are not blocked by the entry cooldown.
- Fee: 0.25% on entry and exit. Slippage: 0.10% adverse to the stored market price on entry and exit.
- New entries stop at 5% daily drawdown or 15% peak portfolio drawdown.
- At 20% peak drawdown, the system appends `EMERGENCY_STOP` and sets Agent Status to `STOPPED`. Fresh SELL decisions may still reduce exposure.
- New buys are blocked during a pause/emergency and when an existing position has stale market data.

## Portfolio calculations

- **Available balance:** starting cash less BUY notional/fees plus SELL proceeds net of fees.
- **Portfolio value:** available balance plus the market value of open positions at stored prices.
- **Unrealized P&L:** current stored market value minus fee-inclusive entry cost basis.
- **Realized P&L:** net SELL proceeds minus the closed positions' fee-inclusive entry cost basis; entry and exit slippage are included in the simulated prices.
- **Total P&L:** portfolio value minus starting balance.
- **Daily P&L:** realized SELL P&L since 00:00 UTC, consistent with the existing dashboard contract.
- **Win rate:** profitable SELL trades divided by all SELL trades.
- Valuation and execution write actual portfolio snapshots. The dashboard returns `null` for realized/unrealized aggregates when bounded reads cannot include the complete set; it does not display partial sums.

## Files changed

- Application: [`api/paper-trading.mjs`](../../api/paper-trading.mjs), [`lib/paper-trading.mjs`](../../lib/paper-trading.mjs), [`api/dashboard-data.mjs`](../../api/dashboard-data.mjs), [`js/dashboard.js`](../../js/dashboard.js), [`dashboard.html`](../../dashboard.html), [`js/portfolio.js`](../../js/portfolio.js), [`portfolio.html`](../../portfolio.html)
- Database/validation: [`supabase/migrations/20261101154600_phase08_paper_trading.sql`](../../supabase/migrations/20261101154600_phase08_paper_trading.sql), [`scripts/validate-project.js`](../../scripts/validate-project.js)
- Tests: [`tests/database-migrations.test.js`](../../tests/database-migrations.test.js), [`tests/paper-trading.test.mjs`](../../tests/paper-trading.test.mjs), [`tests/portfolio.test.js`](../../tests/portfolio.test.js), [`tests/dashboard.test.js`](../../tests/dashboard.test.js)
- Documentation: [`README.md`](../../README.md), [`ROADMAP.md`](../../ROADMAP.md), [`docs/API.md`](../API.md), [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md), [`docs/DATABASE.md`](../DATABASE.md), [`docs/DEPLOYMENT.md`](../DEPLOYMENT.md), [`docs/KNOWN_ISSUES.md`](../KNOWN_ISSUES.md), [`docs/RISK_MANAGEMENT.md`](../RISK_MANAGEMENT.md), [`docs/SCHEDULING.md`](../SCHEDULING.md), [`docs/TESTING.MD`](../TESTING.MD), [`docs/CHANGELOG.md`](../CHANGELOG.md)

## Tests and validation

- `npm.cmd test` — passed: 118 tests, 0 failures.
- `npm.cmd run build` — passed: static project validation and database migration validation (16 prefixed tables, RLS coverage, seed consistency).
- Phase 08 database tests run the migrations in PGlite and cover portfolio provisioning, service-role-only RPC access, real stored-decision BUY/SELL execution, decision-linked/idempotent trades, fees, slippage, position sizing, insufficient funds, open-position limits, confidence, HOLD/WAIT, cooldown, valuation, drawdown limits, and emergency stop.
- API/UI tests cover cron authorization, mandatory paper-only configuration, server-side RPC behavior, safe failures, metrics, no-store reads, P&L rendering, and safe text rendering.

## Known limitations and deployment status

- No remote Supabase migration, Vercel deployment, or cron-job.org configuration was performed or verified in this environment.
- Production must apply the reviewed migration and schedule `POST /api/paper-trading` after successful `POST /api/ai-analysis`, using protected `CRON_SECRET` headers and server-only Supabase credentials.
- There is no manual trade/close control; positions close from eligible stored SELL decisions.
- Realized/unrealized aggregate values become unavailable rather than partial if their bounded dashboard queries exceed supported limits.
- Live trading is not implemented. `ENABLE_LIVE_TRADING=false` is required; any other or missing value makes the paper endpoint fail closed.

## Phase 09 readiness

Phase 08 acceptance criteria are implemented and covered by local tests/build validation. The project is ready to begin Phase 09 after the migration and external scheduler are configured and verified in the target environment. No Phase 09 functionality was added.
