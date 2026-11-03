# Scheduler Simplification Audit

**Date:** 2026-11-03  
**Scope:** Read-only implementation and scheduler-coverage analysis; no code or scheduler settings changed.

## Executive answer

**Update cron-job.org now to schedule every required batch for every interval. Do not wait for an implementation simplification.** The current endpoint accepts one interval and one batch, and it refreshes only that batch's five markets. With 102 eligible markets, full coverage requires 21 batch indexes (`0`–`20`) for each of six intervals: **126 recurring candle-refresh jobs**.

The current ten candle jobs cover only batches `0`–`4` for `15m` and `1h`. They cannot cover the remaining 77 markets or any of the other four intervals. Cron-job.org's FAQ says accounts have no configured job-count limit and jobs may run as often as once per minute, so the 126-job design is operationally possible there; its fair-use policy still applies.

A single request cannot currently sweep 102 markets or advance through remaining batches. Changing it to do so would create long-running, larger-blast-radius invocations without a measured runtime guarantee. Keep the existing five-market bound for immediate recovery, stagger the expanded schedule, and consider simplifying the endpoint only after a production-like benchmark.

## What the current implementation does

- The API requires both `interval` and a non-negative `batch` query parameter; it forwards exactly those values to the refresh service. See [`api/candle-refresh.mjs`](../../api/candle-refresh.mjs#L24).
- The service validates the interval, loads enabled Bitvavo-valid markets in priority/symbol order, calculates `batchCount`, and slices exactly five markets for the requested batch. It then creates jobs for that slice and that interval only. See [`lib/market-data.mjs`](../../lib/market-data.mjs#L386).
- The service uses at most four workers and an 8-second timeout for individual fetches. On certain provider/storage failures it stops assigning remaining jobs in that invocation. See [`lib/market-data.mjs`](../../lib/market-data.mjs#L13).
- The repository's scheduler documentation explicitly says to schedule every returned batch index for every desired interval and recommends a 90-second external HTTP timeout. See [`docs/SCHEDULING.md`](../SCHEDULING.md#L18).
- `vercel.json` declares no Vercel Cron jobs; candle refresh is externally scheduled.

Therefore:

1. **Are all batch indexes required?** Yes, if each interval is expected to cover all 102 markets in each refresh cycle. For fewer eligible markets, use the endpoint's returned `batchCount`.
2. **Can one current invocation process all markets for an interval?** No. It processes only the selected five-market batch.
3. **Can it automatically iterate over remaining batches?** No. The endpoint and service do not loop through other batch indexes. That would require a code change.

## Current versus complete schedule

The current configuration below is based on the stated cron-job.org inventory: `15m` batches `0`–`4` every 15 minutes, and `1h` batches `0`–`4` hourly.

| Interval | Current batch jobs and cadence | Required jobs for complete coverage | Current gap |
|---|---|---:|---|
| `1m` | None | 21 (`0`–`20`) | All 102 markets |
| `5m` | None | 21 (`0`–`20`) | All 102 markets |
| `15m` | `0`–`4`, every 15 minutes | 21 (`0`–`20`) | Batches `5`–`20` (77 markets) |
| `1h` | `0`–`4`, hourly | 21 (`0`–`20`) | Batches `5`–`20` (77 markets) |
| `4h` | None | 21 (`0`–`20`) | All 102 markets |
| `1d` | None | 21 (`0`–`20`) | All 102 markets |
| **Total** | **10 jobs** | **126 jobs** | **116 missing interval/batch jobs** |

This matches the observed coverage pattern: only the first 25 priority-ordered markets have recent `15m` and `1h` candles, while the other markets and intervals lack recent coverage. The pattern is consistent with the scheduler inventory; it is not evidence that a completed HTTP request necessarily stored fresh candles.

## Recommended cron-job.org configuration

Create one recurring job per interval/batch pair (21 jobs per interval), using the existing endpoint and protected authorization header. These are recommended operating cadences, not hard-coded application requirements. They are comfortably inside the AI Engine's per-interval maximum ages in [`lib/ai-engine.mjs`](../../lib/ai-engine.mjs#L18).

| Interval | Jobs | Recommended cadence per batch | Maximum age used by AI Engine | Invocations per hour, all batches |
|---|---:|---:|---:|---:|
| `1m` | 21 | Every 5 minutes | 30 minutes | 252 |
| `5m` | 21 | Every 15 minutes | 2 hours | 84 |
| `15m` | 21 | Every 30 minutes | 6 hours | 42 |
| `1h` | 21 | Hourly | 12 hours | 21 |
| `4h` | 21 | Every 4 hours | 24 hours | 5.25 |
| `1d` | 21 | Daily | 72 hours | 0.875 |
| **Total** | **126** | — | — | **about 405 invocations/hour** |

Stagger the 21 batch jobs within each interval's cadence rather than firing them all at once. For example, the 21 `1m` jobs can be distributed as four or five requests per minute over each five-minute cycle. Continue monitoring `candleRefreshDurationMs`, `providerRequests`, `batchCount`, `selectedMarkets`, and the internal response `status`. A successful HTTP `200` may still report `partial`, `provider-unavailable`, or `storage-unavailable`; HTTP status alone is not proof of complete refresh.

The recommended 1-minute cadence is deliberately slower than every candle close to reduce request volume while remaining well inside the 30-minute freshness limit. If downstream decisions require newer 1-minute data, increase that cadence and distribute the batch calls rather than launching a burst.

## Runtime and simplification trade-offs

The repository does not contain a measured production runtime distribution for candle-refresh requests. The endpoint reports `candleRefreshDurationMs`; use successful and partial deployed runs to establish actual p50/p95 before changing the work size. The existing operational guidance asks for a scheduler timeout of at least 90 seconds.

| Design | Scheduler jobs | Work in one request | Runtime assessment |
|---|---:|---|---|
| Current bounded design, fully scheduled | 126 | Up to 5 markets × 1 interval; 4 workers max | Preferred now. One batch has at most two waves of provider calls; the 8-second per-request timeout is not a measured runtime. Retain the documented 90-second external timeout and measure actual durations. |
| One invocation sweeps all 102 markets for one interval | 6 | 102 market/interval jobs; about 26 waves at concurrency 4 | Requires code changes and is **not proven safe**. At near-timeout successful provider latency, the provider-only portion could approach `ceil(102 / 4) × 8s = 208s`, before metadata reads and writes. This exceeds the documented 90-second scheduler timeout. |
| One invocation loops through all 21 batches sequentially | 6 | Same 102 markets per interval, keeping each batch's four-worker pool | Also requires code changes. Sequential batch overhead can be greater than the previous estimate; no bounded total-runtime guarantee exists. |
| One invocation refreshes all six intervals for one five-market batch | 21 | Up to 30 market/interval jobs, 4 workers max | A possible future compromise, but requires changes and benchmark coverage. At 8 seconds per provider wave, the provider-only estimate is about 64 seconds (`ceil(30 / 4) × 8s`), before database work; that is tight against a 90-second scheduler timeout. |

Vercel's current [Functions limits](https://vercel.com/docs/functions/limitations) list a 300-second Hobby maximum when Fluid Compute is enabled. That platform ceiling does not make the all-market request safe by itself: it is longer than the documented external scheduler timeout, and the repository does not configure a per-function `maxDuration` in [`vercel.json`](../../vercel.json).

Cron-job.org's [FAQ](https://cron-job.org/faq/) states that it does not limit the number of jobs per account and supports a minimum interval of one minute. Thus, there is no scheduler task-count reason to defer complete coverage. If reducing the 126 task definitions becomes desirable, a safer design to evaluate later is a bounded rotating-batch dispatcher—not one unbounded all-market request. That alternative would still need retry/cursor semantics, full-cycle freshness calculations, failure-continuation rules, and deployed runtime measurements.

## Recommendation

1. **Immediately add the missing 116 interval/batch jobs** (or recreate all 126 from the endpoint's current `batchCount`) in cron-job.org, with staggered starts and the recommended per-interval cadences above.
2. Keep the existing five-market request bound until real `candleRefreshDurationMs` and scheduler completion data show adequate headroom.
3. Treat internal response status and coverage—not HTTP `200`—as the success criteria.
4. Evaluate code simplification separately after full coverage is restored and measured. Do not block the immediate scheduler correction on a code redesign.

No code, database, deployment, or cron-job.org settings were changed while preparing this diagnosis.
