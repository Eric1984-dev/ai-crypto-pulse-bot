# AI Analysis Runtime Optimization Report

**Date:** 2026-11-02  
**Scope:** Reduce AI Analysis runtime without changing indicator calculations, confidence, decision rules, paper-trading behavior, or database schema.

## Executive Summary

The largest identified runtime cost was candle retrieval: for 102 markets and six intervals, the engine issued 612 separate Supabase reads in 77 barriered batches of eight. Each batch waited for its slowest request before the next batch began.

The engine now uses a bounded worker queue with up to 24 concurrent candle reads. It keeps the existing one-query-per-market/interval filters, descending timestamp order, 1,000-row cap, and request timeout. Results are collected back in their original job order before analysis. Runtime and stage timings are included in completion logs; caught analysis failures include elapsed time.

This changes query scheduling only. The AI calculations, confidence calculations, `BUY`/`SELL`/`HOLD`/`WAIT` logic, and persisted decision records are unchanged. No API endpoint, database object, external service, or Vercel Function was added.

**Performance target status:** The projected runtime is below 15 seconds under similar request latency, but this target has **not** been verified in production. No deployment was performed.

## Bottlenecks and Findings

| Area | Finding |
|---|---|
| Candle retrieval | 612 REST calls per 102-market run. The old concurrency of eight imposed 77 sequential wait barriers. |
| Duplicate database reads | None found in the successful analysis path: status, watched markets, and snapshots are each read once; each symbol/interval is fetched once. |
| Market/snapshot reads | Both are single reads. They are small relative to the candle fan-out and were not duplicated. |
| Supabase query shape | Each candle request is already filtered by both symbol and interval and limited to the newest 1,000 rows. Combining all symbols into one ordinary PostgREST query with a global limit could omit rows for some markets, changing decisions. |
| Decision persistence | Already batched into one write for all analyzed markets. No per-market decision writes were found. |
| Bitvavo | Not called by AI Analysis; the engine reads stored market data only. |
| Decision calculation | Synchronous per-market analysis over retrieved candles. No calculation or indicator logic was changed. The prior production evidence did not include CPU-stage timing, so this is not identified as the primary bottleneck. |

## Changes Implemented

### Bounded worker queue

- Replaced batches of eight with a continuous worker queue capped at **24 concurrent requests**.
- The queue starts another read as soon as a worker completes instead of waiting for all requests in an eight-request batch.
- It stops dispatching queued reads after the first read failure, waits for already-running workers, then surfaces the original error.
- Candle results are reassembled in their original market/interval order before analysis.
- The exact Supabase filters, selected columns, order, row limit, and 8-second per-request timeout are preserved.

For 612 reads, the old design had 77 barriers. At equal request latency, the new cap requires approximately 26 waves of worker capacity, a **66% reduction in wave count**. The design remains bounded; it does not launch all 612 requests at once.

### Runtime telemetry

Successful completion logs now include total engine `runtimeMs`, `candleQueries`, `candlesLoaded`, and stage timings for status reads/writes, market and snapshot loading, candle loading, decision generation, and decision persistence. Caught analysis failures include elapsed runtime to the point the error is logged.

This telemetry is intended to verify the production target after deployment and identify whether Supabase reads, CPU work, or writes remain dominant.

## Decision-Output Preservation

The engine still calls the same `analyzeMarket` implementation with the same market snapshot and candle rows. Query semantics remain per symbol and interval with descending timestamp order and a 1,000-row limit. No thresholds, weights, formulas, freshness checks, confidence rules, AI decisions, or persistence fields changed.

A regression test runs 102 markets across all six intervals, verifies all **612 unique reads** complete with no more than 24 in flight, and compares every persisted decision with direct `analyzeMarket` output for the same data. The test also verifies that completion telemetry reports the correct request and candle counts.

## Runtime Estimate and Limitations

The previous production investigation measured six successful 102-market runs at an average of **26.47 seconds** from the engine's start log to completion, with a longest observed interval of **29.60 seconds**. The user also reported at least five timeouts on the investigation day; those failures were not independently re-counted here.

If the measured workload were dominated by the 77 candle-query barriers and elapsed time scaled proportionally with the reduction to 26 worker waves, the illustrative estimate is:

`26.47 seconds × 26 / 77 ≈ 8.94 seconds`

This is a projection, **not a measured production result**. Snapshot loading, decision generation, Supabase/network variability, JSON transfer/parsing, writes, and logging do not necessarily scale with the number of waves. The new 24-request concurrency also increases peak Supabase load; monitor 429/5xx responses and the existing per-request timeout errors after deployment.

The regression test uses a mock Supabase response with a 2 ms delay per candle request to validate bounded concurrency and output equivalence. Mock timings do not represent production latency. The Vercel project was not deployed or load-tested as part of this task, so the **average-below-15-second target and timeout headroom remain unverified in production**.

## Validation

| Check | Result |
|---|---|
| `node --test tests/ai-engine.test.mjs` | Passed: 15 tests |
| `npm.cmd test` | Passed: 229 tests, 0 failures |
| `npm.cmd run build` | Passed: static project validation and database migration validation (16 prefixed tables, RLS coverage, initial seed consistency) |
| `git diff --check` | Passed |
| API function count | 12 deployable source files; unchanged |
| Production deployment/runtime measurement | Not performed |

## Files Changed

- `lib/ai-engine.mjs`
- `tests/ai-engine.test.mjs`
- `README.md`
- `docs/SCHEDULING.md`
- `docs/CHANGELOG.md`
- `docs/reports/PHASE_07_COMPLETION_REPORT.md`
- `docs/reports/AI_ANALYSIS_RUNTIME_OPTIMIZATION_REPORT.md`

## Follow-up

Deploy the change and compare the new `runtimeMs` and stage timings across a representative production sample. Confirm the average is below 15 seconds, check the maximum and timeout/error rate, and monitor Supabase load at the 24-request ceiling. If Supabase errors rise, reduce the concurrency cap rather than removing per-symbol/interval limits or changing AI decision inputs.
