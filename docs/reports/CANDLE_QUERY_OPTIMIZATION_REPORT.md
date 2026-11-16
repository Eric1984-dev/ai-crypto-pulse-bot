# Candle Query Optimization Report

**Status:** Local implementation and focused validation complete; Raspberry Pi rollout and production verification pending.

**Date:** 2026-11-16

## Scope

This change optimizes only two PostgreSQL read paths in the Raspberry Pi runtime:

1. The Market Scanner's per-market daily and hourly candle windows.
2. Candle-ingestion checkpoints used to resume each symbol/interval.

It does not change candle contents, scanner ranking calculations, ingestion cadence, AI analysis, paper-trading behavior, API contracts, or risk controls. It adds no API route, database object, permission, dependency, or migration.

## Findings and implementation

The scanner previously ranked all stored candles for each requested interval with `ROW_NUMBER()` and then returned only 35 daily or 12 hourly rows per market. The replacement performs a descending, limited index lookup for each enabled requested market and restores the existing symbol-ascending/timestamp-ascending response order.

Ingestion previously computed `MAX(timestamp)` grouped by symbol for every requested batch and interval. The replacement performs a descending, `LIMIT 1` lookup per requested symbol. Markets without stored candles still produce no checkpoint, preserving the existing bootstrap behavior.

Both paths reuse the existing unique candle key/index `(symbol, interval, timestamp)`.

## Pre-rollout query evidence

Read-only production `EXPLAIN ANALYZE` comparisons from the preceding audit used warm-cache data. They compared the existing query forms with semantically equivalent bounded lateral lookups; the replacement SQL was not deployed to production.

| Read path | Existing query | Equivalent bounded lookup |
|---|---:|---:|
| Scanner, `1d`, 101 enabled markets, 35 candles each | 15,110 rows read; 3,535 returned; 199.4 ms | 3,535 returned; 53.4 ms |
| Scanner, `1h`, 101 enabled markets, 12 candles each | 18,490 rows read; 1,212 returned; 217.9 ms | 1,212 returned; 28.5 ms |
| `1m` checkpoint, first five active markets | 14,401 rows read; 5 returned; 52.9 ms | 5 index lookups; 5 returned; 2.0 ms |

The planner underestimated scanner rows by roughly an order of magnitude in these plans. Timings are individual warm-cache observations, not cold-cache measurements or a guarantee of production performance after rollout.

## Validation

Focused PGlite regressions verify:

- Latest-N candle results and the existing ascending output order.
- Per-market limits, sparse candle histories, and interval isolation.
- Enabled-market filtering and duplicate requested symbols.
- Latest checkpoint selection, interval isolation, and absent-history behavior.
- Existing API market-summary behavior through the targeted data-route tests.

The targeted command executed after implementation:

```powershell
node --test raspberry-pi/tests/market-data-repository.test.mjs raspberry-pi/tests/market-ingestion-repository.test.mjs raspberry-pi/tests/data-api.test.mjs
```

Result: **29 tests passed, 0 failed.** These are local tests and do not connect to the Pi database.

## Risks and follow-up

- The lateral lookups depend on the existing composite candle index for their expected performance. No schema change is proposed; production schema and index state must continue to be verified through the operator-managed database process.
- The PGlite tests establish result semantics but do not validate PostgreSQL's production planner, Pi I/O, or concurrent runtime behavior.
- The measured plans and timings predate the code rollout. The Pi runtime has not been updated or restarted by this task.
- After operator-managed rollout, verify scanner rankings and candle counts, inspect representative read-only query plans, and monitor scanner response time, runtime cycle health, CPU, and query-timeout/error events. Compare under representative load rather than treating the warm-cache samples as an acceptance threshold.
