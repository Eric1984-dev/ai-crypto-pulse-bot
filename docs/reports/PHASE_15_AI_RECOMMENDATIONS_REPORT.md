# Phase 15 AI Recommendations Report

## Status

The advisory recommendations feature is implemented and passes local automated tests and static/database build validation. Production deployment, hosted Supabase behavior, and live Realtime delivery were not verified. Phase 16 has not started.

## Architecture

- `lib/recommendations.mjs` derives recommendations from the existing Analytics aggregates. It performs no database writes and stores no recommendation history.
- The protected Recommendations page requests `GET /api/dashboard-data?view=recommendations&period=<30d|90d|365d>`. This reuses the authenticated dashboard-data function, caller JWT, Supabase RLS, and existing bounded Analytics loader.
- A new protected HTML page and navigation item were added. There is no separate dashboard widget.
- The page refreshes on AI decision, trade, position, portfolio, and portfolio-snapshot Realtime events. The existing Realtime manager coalesces event bursts; a visible-page 30-second polling fallback remains active.
- All recommendations are informational. No strategies, confidence thresholds, watched markets, portfolio settings, risk controls, AI parameters, or trades are modified.

## Recommendation Categories and Logic

The service returns all five category groups, including empty groups:

- **AI Performance:** compares scored confidence-bucket outcomes at candidate minimum thresholds of 75%, 80%, and 85%. A suggestion is emitted only when both sides represent at least 10 distinct closed trades, the higher-confidence side has at least a 10 percentage-point win-rate advantage, and its average outcome P&L is better. The sample is a conservative bucket-level lower bound; outcome metrics retain Analytics' decision-outcome attribution.
- **Market Selection:** identifies up to three markets with at least 10 closed trades, negative realized P&L, and a lower win rate than the account-wide rate. It can also identify up to three profitable markets with a win rate at least 10 percentage points above the account-wide rate.
- **Portfolio Management:** recommends reviewing allocation when selected-period realized P&L is negative and at least 10 closed trades are available.
- **Risk Management:** recommends a manual review when selected-period maximum drawdown is at least 5%, there are at least 10 snapshots, and the overall 10-closed-trade minimum is met.
- **Strategy Quality:** identifies up to three strategies with at least 10 distinct closed trades represented, negative net P&L, and a win rate below the account-wide rate.

The recommendations display their rationale, supporting metrics, estimated impact, confidence tier, sample size and unit, selected analysis period, and generation timestamp. Confidence is Preliminary for 10–49 represented closed trades, Medium for 50–99, and High for 100 or more. Strategy groups count distinct closing-trade IDs; confidence comparisons use a conservative represented-trade lower bound for each side and display the scored-outcome counts separately. Fewer than 10 closed trades results in the exact notice **“Insufficient historical data.”** and no recommendations.

Impact statements are descriptive of historical outcomes or explicitly qualitative; they are not forecasts. Outcome attribution inherits the limitations documented by Analytics and is not a counterfactual simulation.

## Historical Ranges

The page and recommendation exports support rolling 30-, 90-, and 365-day ranges, defaulting to 30 days. The existing Analytics service filters historical trades, decisions, and snapshots by the selected period while retaining its current-state portfolio and position semantics.

## Export Integration

The Exports page adds:

- **Recommendation Export** (`recommendations`)
- **Recommendation History Export** (`recommendation-history`)

Both use the current generated results and existing Analytics CSV streaming, count, authentication, and formula-neutralization infrastructure. By user choice, recommendations remain ephemeral: the history export recomputes from stored Analytics inputs for the selected range and is explicitly not an archive of earlier recommendation generations.

## Performance and Vercel Function Count

- No API function, API endpoint, database object, migration, or dependency was added.
- The new API view extends the existing authenticated `/api/dashboard-data` handler.
- Analytics continues to use exact caller-visible counts, 500-row pages, and bounded concurrent prefetch. Existing regression tests exercise 100,001 AI decisions, 100,001 snapshots, and 10,001 trades; recommendation generation additionally bounds its output to three market and three strategy suggestions per category.
- Full test validation includes the existing 12-function Vercel limit check. The count remains **12**.

## Files Changed

- `AGENTS.md`, `ROADMAP.md`, `README.md`
- `docs/API.md`, `docs/CHANGELOG.md`, `docs/DATABASE.md`, `docs/KNOWN_ISSUES.md`, `docs/TESTING.MD`
- `docs/reports/PHASE_15_AI_RECOMMENDATIONS_REPORT.md`
- `recommendations.html`, `index.html`, `dashboard.html`, `portfolio.html`, `scanner.html`, `analytics.html`, `history.html`, `exports.html`, `settings.html`, `admin.html`
- `css/styles.css`
- `js/auth.js`, `js/exports.js`, `js/realtime.js`, `js/recommendations.js`
- `api/dashboard-data.mjs`, `api/protected-page.mjs`
- `lib/analytics-exports.mjs`, `lib/recommendations.mjs`
- `scripts/validate-project.js`
- `tests/analytics.test.mjs`, `tests/auth.test.js`, `tests/exports-ui.test.js`, `tests/project-setup.test.js`, `tests/realtime.test.js`, `tests/recommendations.test.mjs`, `tests/recommendations-ui.test.js`

## Tests Executed

- `npm.cmd test` — **227 passed, 0 failed**
- `npm.cmd run build` — **passed**
- Vercel function-count regression — **12 functions**
- Static project validation — **passed**
- Database migration validation — **passed** (16 prefixed tables, RLS coverage, initial seed consistency)

Tests use local fixtures, mocked Supabase/PostgREST responses, and the existing embedded database tests. They do not establish hosted production behavior.

## Documentation Updated

Updated README, roadmap, project instructions, API, database, testing, changelog, and known-issues documentation. The roadmap now places Backtesting in Phase 16; Phase 16 work has not started.

## Outstanding Issues

- Deploy and smoke-test the protected page, recommendations API view, and CSV downloads against the target Vercel and Supabase project.
- Verify hosted Realtime publication and automatic refresh delivery; polling remains the fallback.
- Physical-device, supported-browser, and production-performance checks remain outstanding.
- Recommendation-generation history is intentionally not persisted; the history export is recomputed for the chosen historical window.

## Acceptance Criteria Status

| Requirement | Status |
|---|---|
| Advisory recommendations use existing Analytics and paper-trading data | Implemented |
| Five recommendation categories and supporting metrics | Implemented |
| 30-, 90-, and 365-day ranges; 30-day default | Implemented |
| Minimum sample size and confidence levels | Implemented |
| Separate protected AI Recommendations page | Implemented |
| Automatic Realtime refresh plus fallback polling | Implemented |
| Recommendation and Recommendation History CSV exports | Implemented (recomputed; no archive) |
| No automated parameter changes or trade execution | Implemented |
| No new API endpoint, database object, migration, or dependency | Verified |
| Vercel function count remains at 12 | Verified by test |
| `npm test` and `npm run build` pass | Verified (227 tests; static/database validation passed) |
| Production deployment and hosted runtime validation | Outstanding |
| Phase 16 remains unstarted | Verified |
