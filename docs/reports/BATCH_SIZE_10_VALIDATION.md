# 5-to-10 Market Batch Expansion Validation

**Review date:** 2026-11-04  
**Scope:** Read-only code, test, scheduler-documentation, and available production-evidence review. No code, database, scheduler, or production settings were changed.

## Verdict

**B. More validation required**

Changing the batch size to 10 is mechanically capable of covering all 102 markets without changing candle selection, checkpoint semantics, freshness rules, or upsert keys, provided every interval is scheduled for batch indices `0` through `10`. It would reduce the number of scheduled batch invocations by about **47.6%**.

The current four-worker pool and 8-second network timeouts make ordinary request duration appear comfortably below the documented 90-second external-scheduler timeout. However, the production runtime sample and tests cover the existing five-market batch only. A conservative success-path timeout envelope is approximately 64 seconds before error-event writes and other overhead, and the worker pool's global stop flags are set only after an awaited error-log write. This makes timeout and failure fan-out insufficiently proven for approval without a 10-market controlled test.

## Current implementation and coverage

The existing service in [market-data.mjs](../../lib/market-data.mjs) uses a five-market batch size and four concurrent workers. For each request, it orders enabled, Bitvavo-valid watched markets by priority and symbol, computes `batchCount` from the eligible set, slices the requested batch, and handles one interval.

For 102 markets:

| Batch size | Batches per interval | Batch indices | Markets covered |
|---:|---:|---|---:|
| 5 (current) | 21 | 0–20 | 102 |
| 10 (candidate) | 11 | 0–10 | 102 |

With size 10, indices 0–9 select ten markets apiece and index 10 selects the remaining two. The deterministic slice has no gaps or duplicate market membership within a full pass. The API rejects an index outside the newly calculated range with HTTP 400, so external scheduler tasks for indices 11–20 must be removed and the new 0–10 set enabled for all six intervals. A partial scheduler edit could leave markets unrefreshed or retain unnecessary failing requests.

## Invocation and provider workload

At the recommended interval cadence, there are 463 interval passes per day:

`288 (1m) + 96 (5m) + 48 (15m) + 24 (1h) + 6 (4h) + 1 (1d)`

| Workload measure | Batch size 5 | Batch size 10 | Change |
|---|---:|---:|---:|
| Endpoint invocations per interval pass | 21 | 11 | 10 fewer |
| Endpoint invocations per day across intervals | 9,723 | 5,093 | 4,630 fewer (47.6%) |
| Potential per-market provider calls per day | Up to 47,226 | Up to 47,226 | No expected reduction |
| Checkpoint RPC calls per full interval pass | 21 | 11 | 10 fewer (47.6%) |
| Candle upserts per full interval pass | Up to 102 per-market writes | Up to 102 per-market writes | No expected reduction |

The provider-call estimate assumes all markets are due and the per-instance candle cache misses. Actual provider requests can be lower because the service skips markets with no completed candle due and may use its 60-second instance-local cache. The available production runtime logs do not record `providerRequests`, so actual provider request volume is unknown.

Changing batch size reduces repeated endpoint setup, watched-market reads, and checkpoint RPC calls. It does **not** eliminate the per-market Bitvavo fetch, candle parsing, or per-market upsert needed for the same market/interval coverage.

The service's concurrency limit is four **per function invocation**, not a global four-request limit. If all interval batch tasks launch together, the theoretical initial provider concurrency falls from up to 21 × 4 = 84 to 11 × 4 = 44, subject to jobs being due and serverless scheduling. This can reduce the burst peak, while each invocation runs longer.

## Checkpoint RPC behavior

For each nonempty batch, the service makes one call to `AI_Crypto_Bot_Get_Latest_Candle_Checkpoints` with the selected symbols and requested interval. The SQL function deduplicates the supplied symbols, unnests the array, and uses a lateral latest-row lookup per symbol. It contains no five-symbol cap. Moving to ten markets therefore doubles the RPC's symbol input and returned checkpoint rows per invocation, while reducing the number of RPC calls per full interval pass from 21 to 11. A complete pass still performs up to 102 indexed per-symbol lookups.

This preserves the latest-candle checkpoint behavior and avoids restoring the previous historical-row scan. The RPC itself has not been measured with a ten-symbol input in production; its slightly larger request/response payload and per-call query time remain unverified.

## Upsert behavior and idempotency

Each market is fetched and processed by a worker before that worker takes another market. Valid candles are submitted through a per-market Supabase upsert using the existing conflict key `(symbol, interval, timestamp)` and `resolution=merge-duplicates`. The request limit remains at most 500 candles per market; the latest stored candle is intentionally overlapped so updated values can be persisted.

The larger batch does not combine ten markets into one upsert payload. At most four market jobs are active inside one invocation, so the change does not cause ten market candle arrays to be processed concurrently by a single worker pool. Upsert request count and row volume for a complete pass remain approximately the same. Previously completed per-market writes are not rolled back if a later market fails; retries remain duplicate-safe through the existing conflict key.

## Duration and timeout assessment

The latest available production baseline is the 30-minute sample documented in the [Candle Refresh CPU Optimization Audit](./CANDLE_REFRESH_CPU_OPTIMIZATION_AUDIT.md): approximately 2.19 seconds average, 2.94 seconds p95, and 3.60 seconds maximum per existing five-market invocation. These are wall-clock durations, not Active CPU measurements. They are not a controlled all-markets-due benchmark.

With four workers, five equal-duration jobs can require up to two waves (four plus one); ten can require up to three (four plus four plus two). If all variable market work scaled with the wave count, a rough 1.5× projection would be about 3.3 seconds average and 4.4 seconds p95. Actual total duration should be lower than that proportional estimate when fixed market-selection and checkpoint overhead dominate, but may be higher if the larger request has additional data to parse or write. No 10-market timing result is available.

The outbound Bitvavo, Supabase read, checkpoint, and upsert requests each use an 8-second timeout. A conservative, simplified success-path envelope for a ten-market invocation with no cache hits is:

- Market-list and catalog reads, in parallel: up to about 8 seconds.
- Checkpoint RPC: up to about 8 seconds.
- Three worker waves, each potentially doing an 8-second provider call followed by an 8-second upsert: up to about 48 seconds.
- **Simplified total: about 64 seconds**, before serialization, response parsing, cold-start and other overhead.

This is not a hard end-to-end bound. Failure handling can perform additional scanner-event writes, and there is no batch-level deadline. The existing external scheduler timeout recommendation is at least 90 seconds, leaving only about 26 seconds beyond the simplified success-path estimate. Vercel's current [Function limits documentation](https://vercel.com/docs/functions/limitations) lists a 300-second default and maximum duration for Hobby; the repository's [vercel.json](../../vercel.json) does not configure a lower per-function `maxDuration`. Thus, the 90-second external scheduler timeout, not the Vercel Hobby function limit, is the nearer timeout constraint.

**Timeout risk:** Low for ordinary operation based on the observed five-market durations; **medium and unverified for worst-case ten-market operation**, especially during slow provider/database responses or error logging. Existing telemetry cannot establish the tail latency of a ten-market batch.

## Failure isolation and reliability

Per-market invalid-market failures are recorded without stopping the other jobs. Broader provider failures such as timeouts, rate limits, and provider-unavailable responses, and any `StorageError`, cause workers to stop taking new jobs after the failure is recorded. Failed symbols are logged to scanner events; earlier successful per-market writes remain stored and can be safely revisited on a later pass.

There is an important failure-path timing detail: the worker awaits `writeScannerEvents` before setting the shared `providerUnavailable` or `storageUnavailable` flag. While that log write is pending, other workers can finish and claim additional jobs. Because the event write also has an 8-second request timeout, a provider/database outage may allow more jobs to be attempted before the pool stops. With ten markets, the number of markets exposed to a batch-level outage is larger, and the additional attempted work during the stop delay has not been measured.

This is not a data-integrity or duplicate-write issue: the upsert key remains idempotent. It is a larger partial-batch/failure domain and potentially more wasted provider/database work during an outage. A provider failure may leave more markets in that interval pass unrefreshed until the next scheduled batch run.

## Freshness impact

The batch size does not change candle interval selection, due-time checks, the latest timestamp, incremental request limits, overlap, cache TTL, or any AI freshness rule. If the scheduler runs every new batch index at the existing cadence and all batches complete, every eligible market remains covered once per interval pass.

The ten-market request has an extra worker wave for a fully due batch, so its last markets finish later within the pass. Conversely, there are fewer scheduled batch functions and a lower potential synchronized provider burst. No freshness loss is inherent in the code change, but delayed or missing scheduler jobs and longer tail duration could delay the last markets. The latest available production freshness snapshot from approximately 14:05 UTC showed 24 of 102 markets stale at `1m` and 8 stale at `5m`; it predates this validation and is not evidence about a ten-market rollout.

## Risk assessment

| Area | Risk | Reason |
|---|---|---|
| Coverage | Low if scheduler indices are updated correctly; medium during rollout | Dynamic slicing covers all 102 markets, but obsolete or missing scheduler indices can produce 400s or coverage gaps. |
| Provider request volume | Low for total volume; medium for burst/failure behavior | Total due market calls remain similar; aligned batch jobs may produce fewer, longer bursts. |
| Checkpoint RPC | Low | One RPC per nonempty batch remains; input grows from five to ten symbols and has no current per-call benchmark. |
| Upsert/idempotency | Low | Same per-market upsert, conflict key, overlap, and validation; no transactional rollback across markets. |
| Timeout | Medium, unverified | Typical duration is small; modeled timeout-limited success path is about 64 seconds against the 90-second external timeout and is not a hard bound. |
| Failure isolation | Medium | Larger batch failure domain; the global stop signal is delayed until after awaited event logging. |
| Freshness | Low if the same cadence and full coverage are maintained; medium if batch tasks are delayed or omitted | Freshness logic is unchanged, but each batch takes longer and the final two-market batch must run each cycle. |

## Validation required before implementation approval

1. Add or run a controlled ten-market service test that confirms indices 0–10 cover 102 deterministic markets exactly once, with the final batch containing two.
2. Verify one checkpoint RPC call receives ten symbols, and compare the latest timestamp and due/unchanged decisions against five-market processing for the same fixtures.
3. Verify ten independent per-market provider/upsert jobs, at most four concurrent, with the existing 500-row per-market limit and conflict key.
4. Inject a single invalid market, provider timeout/rate limit, and storage failure. Record how many markets are attempted, skipped, and successfully persisted, including the time spent writing scanner-event diagnostics.
5. Measure normal and failure-path end-to-end duration with cold and warm caches, including full 500-row catch-up/bootstrap cases. Require a comfortable margin below the external scheduler's 90-second timeout.
6. Confirm the external scheduler has exactly batch indices 0–10 enabled for all required intervals, preserves each interval cadence, and disables indices 11–20. Monitor every batch status, completion duration, and stale-market counts through at least a complete interval cycle before declaring the change safe.

## Conclusion

Ten-market batching preserves complete market coverage by construction and is expected to reduce invocations and checkpoint calls by **47.6%**, without reducing per-market candle/provider/upsert work. Routine duration is likely to remain well below the scheduler timeout, but this has not been demonstrated under worst-case data volume or failure conditions. The larger partial-failure domain and delayed worker-stop signal make a controlled failure-path validation necessary.

**Final verdict: B. More validation required.** No production deployment or scheduler change is approved by this read-only report.
