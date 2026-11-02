# AI Analysis Timeout Investigation Report

**Investigation date:** 2026-11-02  
**Scope:** Production timing and execution-path diagnosis only. No AI or trading logic was changed.

## Executive Summary

The strongest evidence points to Supabase REST I/O fan-out as the primary timeout risk: each successful run currently makes 612 individual candle reads in 77 sequential batches, plus other database reads and writes. The reads within a batch run concurrently, but the next batch waits for the current batch.

The available production sample shows six successful runs during the retained 30-minute Vercel log window. Each analyzed and stored 102 decisions. The interval from the AI engine's “analysis started” log to its “analysis completed” log averaged **26.47 seconds**, with a longest observed interval of **29.60 seconds**. This is not the complete Vercel invocation duration: the start log is written after status and watched-market loading, and the completion log is written before the handler sends its response.

This evidence does **not** establish the exact cause of the earlier intermittent timeout reports. No failed run was present in the available log window, historical runtime logs were not retained, and the engine has no per-stage timers. Database query statistics show latency outliers but cannot associate them with a particular AI Analysis invocation.

**Likely cause:** a slow or timed-out Supabase request within the large, sequential candle-read fan-out, with total latency increasing linearly as active market count grows.  
**Not supported as the cause:** Bitvavo requests, AI decision logic, or the Vercel maximum duration for the observed runs.

## Production Evidence

### Vercel runtime sample

The available production runtime logs covered **2026-11-02 12:37:20–13:07:20 UTC**. The query returned 1,236 runtime records, including six complete AI Analysis start/completion pairs. All six completed successfully; no timeout or failure appeared in this window.

| Start (UTC) | Completion (UTC) | Start-to-completion |
|---|---|---:|
| 12:41:07.541 | 12:41:34.999 | 27.458 s |
| 12:46:09.270 | 12:46:33.369 | 24.099 s |
| 12:51:08.131 | 12:51:36.326 | 28.195 s |
| 12:56:08.762 | 12:56:38.358 | 29.596 s |
| 13:01:07.060 | 13:01:32.727 | 25.667 s |
| 13:06:09.373 | 13:06:33.179 | 23.806 s |
| **Average / longest** | | **26.470 s / 29.596 s** |

Each completion log reported **102 analyzed markets and 102 stored decisions**. Start times were approximately five minutes apart. Vercel Hobby runtime-log retention did not permit verification of the older failure periods, so these six successes are not evidence that timeouts never occur.

### Live database and query statistics

- The live database had **102 enabled markets** and corresponding market snapshots.
- Candle history existed across all six supported intervals. Current per-symbol interval counts were generally around 460–520 rows; extrapolating those counts across 102 symbols gives approximately **300,000 candle rows requested per full run**. This is an estimate from stored counts, not a per-invocation payload measurement.
- `pg_stat_statements` had reset at **2026-09-07 10:14:41 UTC**. Its most-called candle-read signature showed 190,944 calls, 21.6 ms mean database execution time, and 1,360.5 ms maximum. Matching candle query signatures collectively included a maximum of 7,118.6 ms.
- These are database statement statistics across application traffic since reset, not AI-run-specific timings. They exclude Vercel-to-Supabase network latency and do not provide request IDs, response-download time, or stage attribution. They are evidence of possible query-latency outliers, not proof that a particular AI Analysis run timed out.

## Timing Profile

The current engine does not time the individual stages. The following counts are derived from the implementation for a full run with 102 active markets.

| Stage | Work per full run | Timing evidence |
|---|---|---|
| Status preflight and transition | 1 status read and 1 status update before analysis | Before the “analysis started” log; not separately timed |
| Market loading | 1 enabled-market read; 102 markets | Completed before the “analysis started” log; not separately timed |
| Snapshot loading | 1 market-data read; up to 102 snapshots | Included in the measured start-to-completion interval; no stage timer |
| Candle loading | 102 markets × 6 intervals = **612 reads** | Included in the measured interval; no stage timer |
| Candle-query scheduling | 8 concurrent reads per batch; **77 sequential batch waves** (`ceil(612 / 8)`) | The most significant structural latency risk; per-request latency and batch duration are not logged |
| Indicator calculations and decisions | 102 synchronous market analyses, using the loaded candle sets | Included in the measured interval; CPU time is not separated from I/O |
| Persistence | 1 bulk decision write for 102 decisions and 1 final status update | Included in the measured interval; no write timer |
| **Database request total** | **615 reads + 3 writes = 618 requests** | Code-derived: status and market reads, 612 candle reads, one bulk decision write, and two status writes |

The logged interval starts after the status preflight, initial status update, and market-list read. It includes snapshot/candle loading, calculations, decision persistence, and the final status update. The complete Vercel invocation also includes request handling and response delivery; its total duration was not available in the runtime log records.

## Bottlenecks and Timeout Assessment

| Candidate cause | Assessment |
|---|---|
| **Supabase/database requests** | **Most likely risk, not proven as the historical trigger.** A full run makes 618 separate REST requests. Candle reads are especially latency-sensitive because all 77 batches must complete. Each individual request has an 8-second abort timeout. A slow request can fail the run even when the overall Vercel duration limit is not near. |
| **Sequential processing** | **Confirmed structural bottleneck.** Candle reads are parallel within batches of eight, but the batches themselves are awaited sequentially. A slow request delays its batch and subsequent waves. |
| **Bitvavo requests** | **Not the direct cause.** The AI Analysis engine reads stored snapshots and candles from Supabase; it makes no Bitvavo requests. Bitvavo ingestion is handled separately. |
| **Market count** | **A scaling multiplier, not excessive in the observed sample.** At 102 markets, six runs completed in about 24–30 seconds. Query count grows linearly as `6 × market count`; the code's 2,000-market guard would permit 12,000 candle reads and 1,500 sequential waves, which is not an evidenced safe operating capacity. |
| **Candle volume and processing** | **Material workload; exact CPU contribution unknown.** Current stored counts imply roughly 300,000 rows per run. Transfer, JSON parsing, validation, and indicator calculations all add work, but there are no measurements to separate them. |
| **Database writes** | **Unlikely to be the primary bottleneck based on request shape.** Decisions are persisted in one 102-row write rather than 102 individual writes; status uses two additional writes. No per-write timing is available. |
| **Vercel execution limit** | **Not indicated by the observed runs.** The current official Vercel duration documentation lists a 300-second Hobby maximum with Fluid Compute. The repository's `vercel.json` does not set an AI Analysis-specific `maxDuration`. Observed engine log spans are under 30 seconds, although these are not full invocation timings and do not rule out an unseen configuration override or a much slower run. |

The 8-second Supabase request timeout and Vercel's maximum function duration are separate limits. The former can cause an AI Analysis failure well before a function approaches the latter.

## Runtime Growth

For `N` enabled markets, the current design creates `6N` candle requests and approximately `ceil(6N / 8)` sequential batch waves. At the observed 102 markets, that is 612 requests and 77 waves. This means market-count growth increases both database request volume and the number of sequential wait barriers. The six-run sample is too small to establish a reliable runtime-versus-market-count curve.

## Root Cause Conclusion

The exact cause of the reported intermittent timeouts cannot be confirmed from available production evidence. The latest retained logs show successful runs only, historical logs are unavailable, and the implementation records no timings for database stages or individual batches.

The **most likely underlying risk** is the number and sequencing of Supabase REST candle reads. A single slow or aborted request can interrupt a run, while a larger market universe increases total requests and sequential waits. The evidence does not justify attributing the failures to Bitvavo, AI decision calculations, inefficient per-market writes, or the Vercel maximum duration.

## Estimated Optimization Savings

These are request-count/wave-count estimates, not measured runtime savings:

- Replacing 612 per-symbol/interval requests with a safe database-side batched query per interval would reduce candle REST calls to **6**, a **99.0% reduction**. The query must preserve the current per-symbol, per-interval descending order and 1,000-row cap; a single global `limit=1000` would change behavior.
- Raising concurrency from 8 to 16 would reduce the number of waves from 77 to 39 (**49% fewer waves**). At 32 concurrent requests, it would be 20 waves (**74% fewer**). These are theoretical reductions in sequential waits only; higher concurrency could increase Supabase load, and runtime savings may be smaller.
- Absolute runtime savings cannot be responsibly predicted until per-stage and per-batch timings are instrumented. The existing approximately 26.47-second logged span must not be scaled linearly as a promise.

## Recommended Fix

1. **Instrument before optimizing:** measure elapsed time for status, market, snapshot, candle batches, calculation, writes, and total handler duration. Log safe aggregate data such as market count, candle-query count, batch count, rows received, and error code; avoid credentials and raw sensitive data.
2. **Reduce candle request fan-out:** evaluate a database-side query/RPC that returns the same latest 1,000 candles for every requested symbol and interval. This would require a migration and load/regression testing; no new Vercel API endpoint is recommended.
3. **Tune concurrency only with measurements:** test a modest increase under representative production-scale load, monitoring Supabase response errors and throttling before adoption.
4. **Do not increase Vercel duration as the first fix:** the sampled runs are far below the documented Hobby ceiling. First identify whether failures are the per-request 8-second abort, Supabase latency, or a separately configured function limit.

## Limitations

- Vercel runtime logs were available only for the most recent 30-minute window; historical timeout counts and durations could not be verified.
- No production per-stage, per-batch, response-size, or full function-duration telemetry was available.
- `pg_stat_statements` aggregates database statement execution across application traffic and cannot attribute its query statistics to AI Analysis runs.
- The estimated candle-row total is derived from current stored counts and may vary by symbol and interval.
- No code, database schema, trading logic, or deployment configuration was changed. This report is diagnosis only.

## Sources

- `api/ai-analysis.mjs`
- `lib/ai-engine.mjs`
- `docs/SCHEDULING.md`
- `docs/reports/PHASE_07_COMPLETION_REPORT.md`
- `docs/reports/PHASE_07_CANDLE_QUERY_FIX_REPORT.md`
- Live Supabase query and `pg_stat_statements` results, 2026-11-02
- Vercel production runtime logs, 2026-11-02 12:37:20–13:07:20 UTC
- [Vercel Function duration limits](https://vercel.com/docs/functions/limitations#max-duration)
- [Configuring Vercel Function duration](https://vercel.com/docs/functions/configuring-functions/duration)
