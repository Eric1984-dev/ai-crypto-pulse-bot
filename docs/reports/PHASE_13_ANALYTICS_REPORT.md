# Phase 13 Analytics & Strategy Insights Report

## Executive Summary

Phase 13 adds a protected Analytics page that evaluates stored paper-trading, AI-decision, strategy, and portfolio history. Its production-loading follow-up adds rolling 30-, 90-, and 365-day ranges (30-day default), bounded concurrent page reads, and safe query-level diagnostics. It reads existing RLS-scoped tables, integrates four period-aligned CSV reports into the existing Exports page, and adds no database objects, trading behavior, API function, or Vercel serverless function.

The original Phase 13 validation passed 196 tests. The production-loading follow-up passed 202 tests, the build passed, and the `api/` directory remains at 12 JavaScript function files. Hosted Supabase and Vercel behavior has not been verified. Phase 14 has not started.

## Architecture

- Browser page: `analytics.html` and `js/analytics.js`; the page is protected by the existing authenticated page flow.
- Data service: `lib/analytics.mjs` reads `AI_Crypto_Bot_AI_Decisions`, `AI_Crypto_Bot_Trades`, `AI_Crypto_Bot_Positions`, `AI_Crypto_Bot_Portfolios`, and `AI_Crypto_Bot_Portfolio_Snapshots`.
- API integration: `GET /api/dashboard-data?view=analytics` uses the existing authenticated `api/dashboard-data.mjs` function and the caller's verified JWT. Existing Supabase RLS remains in force.
- Period selection: trades and AI decisions use a rolling `created_at` cutoff; snapshots use `captured_at`. Current positions, portfolio values, and all-time total P&L remain current account metrics.
- Export integration: `lib/analytics-exports.mjs`, `lib/exports.mjs`, `exports.html`, and `js/exports.js` add Analytics Summary, Trade Analytics, Portfolio Analytics, and AI Analytics reports to the existing export service.
- No migration or duplicate analytics storage was added. Analytics aggregates are derived when requested.

## Metrics Generated

- Trade: win/loss/breakeven counts and rates, average win/loss, profit factor, realized/unrealized/total P&L, best/worst trade, largest winner/loser, average hold time, and open/closed position counts.
- Market and strategy: closed-trade outcomes by symbol; decision outcomes grouped by confidence, BUY/SELL/HOLD/WAIT action, strategy, and symbol.
- Portfolio: current portfolio value and growth, equity curve, daily/weekly/monthly performance, maximum drawdown, and drawdown history.
- Data quality: unpaired BUY, unmatched SELL/decision, and open-trade-without-position counts.

## Calculation Methodology

- Win and loss rates use SELL trades within the selected period as the denominator. Breakeven trades count as closed but neither a win nor a loss. Average loss remains signed.
- Profit factor is gross positive realized P&L divided by the absolute value of gross negative realized P&L. It is unavailable when there are no realized losses.
- Realized P&L is the sum of stored SELL `realized_pnl` in the selected period; unrealized P&L is the sum of stored `unrealized_pnl` for current OPEN positions. Total P&L is the sum of current portfolio values less combined starting balances and remains an all-time metric.
- Average hold time is calculated from paired BUY/SELL timestamps; it is unavailable when there are no pairs.
- Confidence ranges are non-overlapping: `70 <= confidence < 75`, `75 <= confidence < 80`, `80 <= confidence < 85`, and `85 <= confidence <= 100`. Decisions below 70 are counted separately.
- BUY decisions are scored against a paired subsequent SELL result. SELL decisions use their stored realized P&L. HOLD decisions are scored only when an open position exists, using its subsequent realized result or current unrealized P&L if still open. Unattributable decisions remain unscored.
- AI outcome attribution is not a counterfactual analysis: it does not estimate what the market would have done if a different decision had been made.
- Portfolio period performance and drawdown use stored snapshots within the selected range. The first in-range snapshot establishes the period baseline; returned/rendered series remain bounded to 365 daily, 260 weekly, and 120 monthly points.

## Dashboard Integration

Analytics is a dedicated protected page and is separate from Dashboard, Scanner, Portfolio, and Trade History. It displays the requested trade KPIs, confidence/action/strategy/market analyses, portfolio performance tables, equity and drawdown charts, plus explicit empty, loading, error, and data-quality states. Currency display uses EUR formatting.

## Exports Integration

Four report types use the existing Exports page and authenticated dashboard-data function. All share the selected 30-, 90-, or 365-day window:

1. **Analytics Summary** — metric, value, unit, and calculation detail.
2. **Trade Analytics** — overall and per-symbol trade outcome metrics.
3. **Portfolio Analytics** — daily portfolio value, P&L, drawdown, and growth.
4. **AI Analytics** — confidence, action, strategy, and market outcome summaries.

Report counts represent generated CSV rows. Report counts and downloads use the same selected period. CSV responses reuse the existing streaming, UTF-8 BOM, quoting, and spreadsheet-formula neutralization utilities.

## Performance Considerations

- Source reads use exact RLS-visible counts and stable 500-row pages, prefetching at most four pages per source. Trade and AI-decision streams are merged in symbol/timestamp order, and portfolio snapshots are processed concurrently; source histories are not returned to the browser.
- The Analytics API returns aggregates and bounded time series, not the source histories. The full stored snapshot stream is processed to preserve correct maximum-drawdown calculation.
- A 100,001-row AI-decision and snapshot stress case plus 10,001 trades validates aggregation and bounded paging. A very large 365-day range can still take time; no hosted production latency benchmark was performed.

## Files Changed

- **Analytics UI:** `analytics.html`, `js/analytics.js`, `css/styles.css`.
- **Analytics and export services:** `lib/analytics.mjs`, `lib/analytics-exports.mjs`, `lib/exports.mjs`, `api/dashboard-data.mjs`, `exports.html`, `js/exports.js`.
- **Navigation and protection:** `index.html`, `dashboard.html`, `analytics.html`, `portfolio.html`, `scanner.html`, `history.html`, `exports.html`, `settings.html`, `admin.html`, `api/protected-page.mjs`, `js/auth.js`, `vercel.json`.
- **Validation:** `tests/analytics.test.mjs`, `tests/analytics-ui.test.js`, `tests/exports-ui.test.js`, `tests/project-setup.test.js`, `tests/auth.test.js`, `scripts/validate-project.js`.
- **Documentation:** `README.md`, `ROADMAP.md`, `docs/API.md`, `docs/DATABASE.md`, `docs/TESTING.MD`, `docs/CHANGELOG.md`, `docs/reports/PHASE_13_ANALYTICS_REPORT.md`, `docs/reports/PHASE_13_ANALYTICS_PRODUCTION_FIX_REPORT.md`.

## Tests Executed

- Original Phase 13 focused analytics, exports, authentication, protected-page, project-setup, and function-limit tests: **56 passed, 0 failed**.
- Production-loading Analytics/Exports regression suite: **31 passed, 0 failed**, including the 100,001-row decision/snapshot and 10,001-trade stress case.
- Latest full `npm.cmd test`: **202 passed, 0 failed**.
- `npm.cmd run build`: **passed** static project validation and database migration validation, including 16 prefixed tables, RLS coverage, and initial seed consistency.

## Validation Results

| Area | Result |
|---|---|
| Analytics calculations, empty data, and large paginated histories | PASS |
| Analytics UI and authenticated route integration | PASS |
| Four Analytics CSV report types and Exports integration | PASS |
| Latest full test suite | PASS — 202 tests |
| Static/database build validation | PASS |
| Database schema changes | None |
| Vercel function count | PASS — 12 |
| Hosted Supabase/Vercel behavior | Not verified |

## Vercel Function Count Verification

The `api/` directory contains exactly 12 function files, and `tests/project-setup.test.js` asserts that the 12-function limit remains unchanged. Analytics and its CSV reports are query modes on the existing `/api/dashboard-data` function; no new API function was added.

## Limitations and Status

Analytics depends on the accuracy and completeness of existing stored trades, decisions, positions, and snapshots. Decision outcome attribution does not establish causal decision quality, and very large 365-day ranges may increase response time. Local mocked tests and build checks do not verify hosted RLS configuration, production data quality, Vercel runtime limits, or deployment behavior.

Phase 13 implementation and local validation are complete. The original hosted 503's failing query is still unconfirmed until the updated deployment emits query-level diagnostics. No Phase 14 work has started.
