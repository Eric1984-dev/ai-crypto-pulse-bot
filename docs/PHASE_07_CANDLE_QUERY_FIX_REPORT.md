# Phase 07 Candle Query Fix Report

## Summary

Fixed AI Engine candle retrieval so all six supported intervals can reach analysis even when the PostgREST response is subject to a 1,000-row cap. The fix preserves the existing decision logic, confidence model, and database schema. No Phase 08 functionality was started.

## Root cause

The engine previously queried all candle intervals for a market together, sorted the combined rows by interval and timestamp, and applied one limit to that combined response. The effective PostgREST cap was 1,000 rows, so intervals later in sort order were omitted once earlier intervals filled the response. In the reported BTC-EUR result, `15m` contributed 518 rows and `1d` contributed the remaining 482; the other four intervals were not available to the analysis despite existing in the database.

## Implementation

- Candle reads now filter by both market and a single supported interval.
- Each interval has its own 1,000-row limit and descending timestamp order.
- Existing query concurrency remains bounded at eight.
- Candle validation, indicator calculation, decision generation, and persistence behavior are unchanged.
- Missing candles are still treated as missing: no synthetic data or schema changes were introduced.

## Regression test

Added a PostgREST-cap regression fixture using the reported candle counts:

| Interval | Stored candles |
|---|---:|
| `1m` | 549 |
| `5m` | 510 |
| `15m` | 518 |
| `1h` | 501 |
| `4h` | 500 |
| `1d` | 500 |

The test verifies all six intervals are available in the persisted AI decision indicators rather than being truncated by a combined query limit.

## Files changed

- `lib/ai-engine.mjs` — interval-scoped candle queries.
- `tests/ai-engine.test.mjs` — capped-response regression coverage.
- `README.md`, `ROADMAP.md`, and `docs/CHANGELOG.md` — feature status and change history.
- `docs/API.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, and `docs/TESTING.md` — behavior, data access, and validation details.
- `docs/PHASE_07_COMPLETION_REPORT.md` — follow-up implementation note.
- `docs/PHASE_07_CANDLE_QUERY_FIX_REPORT.md` — this report.

## Validation

| Command | Result |
|---|---|
| `node --test tests/ai-engine.test.mjs` | Passed: 14 tests |
| `npm.cmd test` | Passed: 103 tests, 0 failures |
| `npm.cmd run build` | Passed: static project validation and database migration validation (16 prefixed tables, RLS coverage, initial seed consistency) |

The tests use deterministic PostgREST fixtures. No live Supabase, production endpoint, or deployment smoke test was performed.

## Limitations and phase boundary

The per-interval query limit remains 1,000 candles; deeper history requires a separate design if a future analysis needs it. Splitting a combined query into interval-scoped requests increases the number of database requests, while existing bounded concurrency limits simultaneous requests. This change only restores access to the already-stored intervals and does not add trading, order execution, portfolio mutations, or paper trading. Phase 08 has not been started.
