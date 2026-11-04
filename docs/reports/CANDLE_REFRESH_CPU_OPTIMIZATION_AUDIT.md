# Candle Refresh CPU Optimization Audit

**Observation window:** 2026-11-04, approximately 02:05–14:05 UTC for request logs and 13:35–14:05 UTC for runtime logs  
**Scope:** Read-only production and repository review. No code, database, scheduler, or production settings were changed.

## Executive summary

The current request rate is about **9,698 `/api/candle-refresh` invocations per day**, extrapolated from the Vercel logs available for the latest 12 hours. That is approximately **75.1% below** the historical 38,954/day schedule and within 0.3% of the later recommended cadence of about 9,723/day. The earlier scheduler reductions therefore appear to have taken effect, although the external scheduler configuration was not directly inspected.

The checkpoint RPC removed the prior large historical-row scan from the candle-refresh path. It materially reduced the checkpoint database query workload in the available before/after reports, but those short, unmatched samples do not establish an exact reduction in Vercel Active CPU.

The best remaining **invocation-count** opportunity is to raise the batch size from five to ten markets in the existing endpoint. At the current 102-market universe, that would reduce scheduled batch invocations from 21 to 11 per interval, or about **47.6%**. It would not halve Bitvavo market requests, candle rows, or per-market upserts. Its Active CPU benefit is consequently **unverified and likely smaller than the invocation reduction**.

Further schedule reductions are not recommended based on this evidence: the current latest-candle check found 24 markets with stale `1m` data and 8 with stale `5m` data. Staggering can smooth bursts but does not reduce daily requests or total work. Skipping unchanged overlap writes could reduce database writes, but neither the unchanged-row rate nor its Active CPU impact is currently measured.

**Verdict:** The largest scheduler reductions have already been realized. Batch-size expansion is the best remaining candidate for a controlled review, not a proven CPU fix. Current Vercel telemetry access is insufficient to confirm its CPU payoff or to attribute the candle endpoint's internal CPU cost.

## Evidence and limitations

### Current production observations

| Metric | Observation | Qualification |
|---|---:|---|
| Enabled markets | 102 | Current Supabase watched-market data |
| Stored candle rows | 433,493 | Current table count; not a per-day ingestion count |
| Candle-refresh requests | 4,849 in 12 hours; 404.08/hour | All observed requests returned HTTP 200 |
| Estimated daily invocations | 9,698/day | Simple 12-hour extrapolation, not a measured full day |
| Runtime completion logs | 210 in 30 minutes | Successful completion logs in the available sample |
| Parsed candle rows submitted for upsert | 2,214 in 30 minutes | About 10.54 per completion; simple extrapolation is about 106,272/day |
| Runtime duration | 2,191.6 ms average; 2,200 ms p50; 2,936 ms p95; 3,602 ms max | 30-minute sample; wall time is not Active CPU |
| Latest candles within freshness limits | 1m: 78/102; 5m: 94/102; 15m–1d: 102/102 | Snapshot at approximately 14:05 UTC; 24 markets are stale at 1m and 8 at 5m |

The available 12-hour request-log window is a Hobby-plan limit; older request logs were unavailable. Vercel's CPU metric query was denied for the current review because the required Observability Plus entitlement was unavailable. The most recent usable CPU baseline is a dashboard snapshot from earlier on Nov 4: 441 candle-refresh invocations and 29 seconds of cumulative Active CPU in one rolling hour, or approximately **65.8 ms per invocation**. Applying that historical per-invocation average to the current request-rate extrapolation gives approximately **5.3 CPU-hours per 30-day month** for this endpoint. This is a low-confidence projection, not a current measurement, a billable total, or proof that this endpoint alone exceeds the plan allowance.

Successful runtime logs record duration and parsed candle rows but omit interval, batch, selected/attempted markets, provider request count, raw provider rows, and per-stage timing. Although the API response includes `providerRequests`, it is not included in the observed successful runtime log fields. Consequently, raw provider rows fetched, the exact number of Bitvavo requests, and the number of materially changed versus duplicate-upserted rows cannot be calculated from the retained production evidence.

The candle table's `timestamp` is the candle-bucket time, not an ingestion timestamp. Counts of stored rows by candle timestamp therefore do not equal fetched rows or writes during that period.

### Baseline comparison

| Baseline | Invocation rate | What it establishes |
|---|---:|---|
| Earlier expanded schedule | 38,954/day | Historical schedule-derived workload |
| Later recommended reduced cadence | About 9,723/day | Target cadence: `1m` every 5m, `5m` every 15m, `15m` every 30m, `1h` hourly, `4h` every 4h, and `1d` daily |
| Current observed 12-hour rate, extrapolated | 9,698/day | About 75.1% below the earlier schedule and 0.3% below the recommended cadence |

This comparison strongly suggests the request reduction is reflected in current traffic. It does not prove which external scheduler jobs are configured, since the scheduler control panel and run history were not available during this review.

The checkpoint optimization replaced a scan of up to 2,000 historical candle rows per batch with a latest-timestamp RPC using the existing candle index. Prior reports measured approximately 25–29 ms mean statement time for the RPC versus 376.692 ms for the old REST query, and estimated a 99.76% reduction in checkpoint response workload. These are database-query comparisons from limited, unmatched samples; they should not be presented as an equivalent percentage reduction in endpoint Active CPU. The AI history-cap change is separate: it reduces AI-analysis reads and does not change candle-refresh scheduling, provider calls, or candle ingestion.

## Current workload and likely cost drivers

Each `/api/candle-refresh` invocation handles one interval and one zero-based batch. The current service selects at most five eligible markets, so 102 markets require 21 batches for complete coverage of one interval. The service reads the enabled market universe for selection, validates markets against the Bitvavo catalog, obtains latest stored timestamps through one checkpoint RPC for a nonempty batch, requests due candles from Bitvavo, validates/parses them, and upserts the resulting OHLCV rows. Provider work is bounded by four concurrent workers; the latest stored candle is intentionally overlapped so its values can be updated.

The previous large checkpoint scan was the clearest avoidable database-read cost and has already been addressed. The remaining repeated work is primarily:

1. One serverless invocation, market-list selection, and checkpoint RPC for each scheduled batch.
2. Per-market Bitvavo calls for markets with due candles.
3. Candle response parsing/validation and per-market upsert work.
4. Network and database latency, which contributes to wall duration but is not itself a measure of JavaScript CPU.

No available production trace attributes Active CPU among these stages. The 30-minute wall-time sample cannot identify the CPU-dominant stage.

## Optimization opportunities

| Opportunity | Workload impact | Active CPU potential | Rank | Assessment |
|---|---|---|---|---|
| Increase batch size from 5 to 10 | About 21 to 11 invocations per interval; about 9,723 to 5,093 scheduled invocations/day at the recommended cadence, a 47.6% reduction | Unmeasured. Reduces repeated per-invocation market selection and checkpoint calls, but not the per-market provider and upsert work. A naive request-linear estimate would be about 2.5 CPU-hours/month saved, but that assumes CPU per invocation does not increase when each request handles twice as many markets and is not a defensible forecast. | **MEDIUM** | Best remaining invocation-overhead candidate. Requires review of the existing batch-size limit and corresponding external scheduler coverage; it does not require a new API route. The batch would take up to three four-worker waves instead of two, so validate worst-case duration and partial-failure behavior before any change. |
| Skip unchanged overlap writes | Could reduce database writes for repeated latest-candle rows | Unknown; likely more direct benefit to database/WAL activity than to Vercel CPU. | **MEDIUM** | A prior efficiency audit estimated up to 47,224 overlap-row submissions/day under the recommended schedule. That is an upper-bound submission estimate, not the number of rows known to be unchanged. Compare OHLCV values and measure actual no-op frequency before designing conditional persistence; preserve updates when the provider revises the current candle. |
| Stagger batch schedules | Reduces synchronized bursts and may smooth provider/database concurrency | No reduction in total requests or total work by itself | **LOW** | Useful for burst control only. Keep the existing per-request concurrency bound and avoid interpreting smoother traffic as lower aggregate CPU. |
| Reduce refresh frequency further | Could reduce invocations, provider calls, and writes | Potentially material but not quantified | **LOW — not recommended now** | The current freshness snapshot already has stale `1m` and `5m` candles for 24 and 8 markets respectively. Further cadence cuts could increase stale-interval exclusions and affect AI freshness outcomes. Reassess only with interval-level freshness and decision-impact evidence. |
| Add stage and batch telemetry to existing logs | No direct workload reduction | None directly; improves attribution | **LOW for CPU reduction; HIGH for diagnostic value** | Record interval, batch, selected/attempted markets, provider request count, fetched/parsed/submitted row counts, status counts, and checkpoint/provider/upsert timings in existing logs. This avoids inferring per-stage cost from wall time and does not require a new endpoint. |

No remaining option is verified as a high-confidence reduction in total Active CPU. The batch-size option is rated MEDIUM because it has a clear invocation reduction but no measured CPU decomposition.

## Estimated impact

At 102 markets and the recommended interval frequencies:

- Five-market batching: `ceil(102 / 5) = 21` batches per interval, approximately **9,723 invocations/day** across all six intervals.
- Ten-market batching: `ceil(102 / 10) = 11` batches per interval, approximately **5,093 invocations/day**.
- Estimated endpoint-invocation reduction: **4,630/day (47.6%)**.
- Expected reductions: invocations, per-invocation market selection reads, and checkpoint RPC calls.
- Not expected to fall proportionally: per-market Bitvavo calls, candle rows fetched, per-market upserts, and total OHLCV data volume.
- Active CPU reduction: **not reliably estimable** from current evidence. The illustrative 2.5 CPU-hours/month request-linear scenario assumes unchanged CPU per request and should not be treated as an expected saving.
- Upsert submissions: approximately **106,272/day** if the 30-minute sample extrapolates uniformly; normalizing the per-invocation sample to the 12-hour request rate gives approximately **102,245/day**. Treat this as a rough range, not a measured daily total.
- Provider-request and raw-row reductions from batching: **none expected solely from changing the number of markets per invocation**, because the same due markets still need to be fetched.

Further cadence reductions have larger theoretical request-count leverage but are not justified by the present freshness observations. Staggering has no aggregate request, row, or CPU reduction absent some separate evidence of retry or contention overhead.

## Recommendations

1. Do not make additional cadence reductions based on the present evidence.
2. If reducing repeated invocation overhead remains a priority, evaluate a 10-market batch in the existing route and update the external scheduler to cover every batch for every required interval. Preserve incremental checkpointing, overlap behavior, validation, and error reporting.
3. Before any batch-size change, capture per-batch duration, provider requests, selected/attempted symbols, rows fetched/parsed/submitted, and status counts. Verify complete market/interval coverage and worst-case timeouts; compare Active CPU per full interval pass, not just per invocation.
4. Treat unchanged-write suppression as a separate database-write optimization. First establish how often overlap rows are byte-for-byte unchanged and ensure revised latest-candle values still persist.
5. Continue staggering if bursts are operationally problematic, but evaluate it as load smoothing rather than a CPU optimization.

## Source reports

- [Candle refresh efficiency audit](./CANDLE_REFRESH_EFFICIENCY_AUDIT.md)
- [Candle refresh coverage report](./CANDLE_REFRESH_COVERAGE_REPORT.md)
- [Phase 06 candle batching report](./PHASE_06_CANDLE_BATCHING_REPORT.md)
- [Disk IO analysis](./DISK_IO_ANALYSIS_REPORT.md)
- [Scheduler cadence verification](./SCHEDULER_CADENCE_VERIFICATION.md)
- [Scheduler simplification report](./SCHEDULER_SIMPLIFICATION_REPORT.md)
- [Refresh frequency impact report](./REFRESH_FREQUENCY_IMPACT_REPORT.md)
- [Staggered scheduling proposal](./STAGGERED_SCHEDULING_PROPOSAL.md)
- [Vercel CPU attribution report](./VERCEL_CPU_ATTRIBUTION_REPORT.md)
- [CPU attribution impact report](./CPU_ATTRIBUTION_IMPACT_REPORT.md)
- [Vercel CPU limit impact report](./VERCEL_CPU_LIMIT_IMPACT_REPORT.md)
- [Checkpoint query optimization review](./CHECKPOINT_QUERY_OPTIMIZATION_REVIEW.md)
- [Checkpoint RPC implementation report](./CHECKPOINT_QUERY_IMPLEMENTATION_REPORT.md)
- [Checkpoint RPC post-deployment report](./CHECKPOINT_RPC_POST_DEPLOYMENT_REPORT.md)
- [Checkpoint RPC 24-hour validation](./CHECKPOINT_RPC_24H_VALIDATION.md)
- [AI history-depth audit](./AI_HISTORY_DEPTH_AUDIT.md)
- [History-cap implementation report](./HISTORY_CAP_IMPLEMENTATION_REPORT.md)

No code, database, scheduler, or production changes were made for this audit.
