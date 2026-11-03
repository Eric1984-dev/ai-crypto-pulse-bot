# Candle Freshness Protection Report

## Summary

Phase 07 AI analysis now checks candle freshness before indicator calculations. A timeframe is accepted only when its latest normalized candle is not future-dated and is no older than the interval-specific limit. An expired timeframe is excluded as a whole, while older historical candles remain available for indicator lookback when the latest candle is fresh.

If fewer than two timeframes remain with at least 26 valid candles each, the engine produces `WAIT` with the exact reason `STALE_CANDLE_DATA`. The independently configured 15-minute market-snapshot freshness check remains unchanged.

## Freshness limits

| Interval | Maximum age |
|---|---:|
| `1m` | 30 minutes |
| `5m` | 2 hours |
| `15m` | 6 hours |
| `1h` | 12 hours |
| `4h` | 24 hours |
| `1d` | 72 hours |

The maximum age is inclusive; a candle exactly at its limit is fresh. A future-dated latest candle is rejected.

## Behavior and scope

- Stale intervals do not contribute to indicators, market strength, confidence, or decisions.
- Fresh intervals retain the existing indicator formulas, decision rules, and confidence calculations.
- Output data quality reports stale intervals and the number of candle rows ignored; per-timeframe results expose raw, analyzed, and stale candle counts.
- No Paper Trading, Risk Management, database schema, API route, or scheduler behavior was changed.
- This safeguard does not refresh missing or stale candles. If scheduled ingestion remains incomplete, the AI Engine safely records `WAIT` when fewer than two sufficiently populated fresh intervals are available. Candle refresh coverage remains a separate operational issue.

## Verification

- Focused AI Engine tests: **20 passed, 0 failed**.
- Full test suite (`npm.cmd test`): **257 passed, 0 failed**.
- Build (`npm.cmd run build`): **passed**; static project and database migration validation succeeded.
- `git diff --check`: **passed**.

Tests cover all six interval boundaries, rejection one millisecond beyond each limit, latest-candle freshness while preserving older lookback rows, stale timeframe exclusion with sufficient fresh coverage, and the required `WAIT` reason when fresh coverage is insufficient.

No live Supabase, scheduler, or deployment validation was performed for this code change.
