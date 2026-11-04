# History Cap Implementation Report

**Status:** Implemented and locally validated; not deployed  
**Date:** 2026-11-04

## Summary

Separated the AI Engine's per-market candle-history cap from its PostgREST request page size:

- Latest history retained per market and interval: **150 candles**
- PostgREST page size: **1,000 rows**

Latest-candle ordering and freshness classification are covered by regression tests. Indicator formulas, confidence formulas, decision rules, thresholds, risk controls, and scheduler behavior were not changed. No database schema, API endpoint, or production setting was changed.

The prior [final history-cap validation](./FINAL_HISTORY_CAP_DEPLOYMENT_REPORT.md) found that only the latest batch was a valid controlled replay and recommended against production deployment until comparable historical inputs are available across multiple periods. This implementation report records a local code change and test results; it is **not production deployment approval**.

## Files changed

- `lib/ai-engine.mjs`
- `tests/ai-engine.test.mjs`
- `README.md`
- `ROADMAP.md`
- `docs/ARCHITECTURE.md`
- `docs/SCHEDULING.md`
- `docs/CHANGELOG.md`
- `docs/reports/PHASE_07_COMPLETION_REPORT.md`
- `docs/reports/HISTORY_CAP_IMPLEMENTATION_REPORT.md` (this report)

## Tests added or updated

In `tests/ai-engine.test.mjs`:

- Updated the batched pagination regression to assert a 1,000-row request page, correct continuation offset, and no more than 150 retained candles per market.
- Updated the per-market cap regression to verify that analysis uses the newest 150 rows even when the source has more than 150, while markets with fewer candles retain all available rows.
- Added a freshness regression comparing full-history and capped analysis: the latest candle's stale/fresh classification and available-interval set remain the same, and the capped decision matches analysis of the expected latest 150 rows.
- Updated the single-market interval-read regression to expect at most 150 retained candles per interval.

No indicator or decision behavior was changed to satisfy these tests.

## Validation results

| Command | Result |
|---|---|
| `node --test tests/ai-engine.test.mjs` | Passed: 21 tests, 0 failures |
| `npm.cmd test` | Passed: 267 tests, 0 failures |
| `npm.cmd run build` | Passed: static project validation and database migration validation (16 prefixed tables, RLS coverage, initial seed consistency) |

These are local automated checks. No production deployment, live Supabase validation, or Active CPU measurement was performed.

## Rollback instructions

To restore the previous 1,000-candle analysis history:

1. In `lib/ai-engine.mjs`, set `MAX_CANDLES_PER_INTERVAL` back to `1000`.
2. Keep `CANDLE_QUERY_PAGE_SIZE` at `1000`; do not merge the two limits again.
3. Restore the corresponding test expectations and update the history-depth documentation and changelog.
4. Run `node --test tests/ai-engine.test.mjs`, `npm.cmd test`, and `npm.cmd run build`.
5. If this change has been deployed separately, use the normal release process to deploy the rollback and verify a complete analysis run.

No rollback was performed as part of this implementation.
