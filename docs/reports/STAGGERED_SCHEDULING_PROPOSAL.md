# Staggered Batch Scheduling Proposal

**Status:** Proposed  
**Implementation status:** Not implemented  
**Scope:** Documentation and design proposal only. No code, database, or cron-job.org settings were changed.

## Problem statement

The candle-refresh endpoint handles one interval and one market batch per request. With 102 eligible markets and a maximum of five markets per batch, an interval requires 21 batch requests. When the jobs for an interval share the same scheduled time, those requests are dispatched in one burst. Bursts from different intervals can also overlap.

This concentrates traffic against Vercel, Supabase, and Bitvavo even though each batch is bounded. Staggering is intended to smooth the request rate while retaining candle coverage and the existing AI inputs. It does not, by itself, reduce the number of daily invocations or writes.

## Current scheduler architecture

- An external scheduler invokes `/api/candle-refresh`.
- Each request specifies one supported interval (`1m`, `5m`, `15m`, `1h`, `4h`, or `1d`) and one zero-based batch index.
- Each request processes at most five enabled, valid watched markets.
- A complete 102-market interval therefore uses 21 batches.
- Candle refresh is incremental and writes to the existing candle table. The AI Engine continues to read the same stored candles and apply its existing freshness checks and indicator calculations.
- High-frequency batch jobs currently use aligned due times, producing per-interval bursts. Existing per-batch offsets on other schedules, including the daily schedule, are exceptions to preserve unless reviewed.

## Options

### Option A: External cron staggering

Assign batch jobs different start offsets within their existing interval cadence. Keep every interval, batch index, endpoint, and request frequency unchanged. For example, the 21 `1m` batch jobs could be distributed across the five minute positions in each five-minute cycle, with the same pattern repeated on subsequent cycles.

This keeps orchestration outside the application and adds no endpoint or database state. The scheduler's supported cron syntax and saved next-execution times would need to be verified before and after each change.

### Option B: Internal batch coordinator

Have one scheduled invocation coordinate all batches for an interval, using bounded concurrency and controlled spacing. This could be considered within existing candle-refresh infrastructure, but it would change the current one-request/one-batch execution shape and require explicit safeguards for timeouts, retries, partial completion, and idempotency.

It must not introduce a new Vercel Function without separate approval and a function-count review. A coordinator would need to fit within the existing Vercel Hobby function limit and execution-time constraints.

### Option C: Adaptive dispatching

Dispatch batches according to observed backlog, provider limits, response failures, or candle age. A controller could slow dispatch during errors and prioritize batches whose data is closest to the AI Engine's freshness limits.

This requires a reliable source of dispatch state, retry and deduplication rules, observability, and careful handling of scheduler/controller failures. It is the most flexible option, but also the most complex.

## Comparison

| Option | Complexity | Maintainability | Reliability | Vercel impact | Supabase impact |
|---|---|---|---|---|---|
| A. External cron staggering | Low to medium | Moderate; many scheduler entries must remain consistent | Independent batch failures are isolated, but schedule syntax and enablement must be verified | No new function or application work; smooths timing but does not reduce invocation count | Smooths read/write bursts; total scheduled database work remains similar |
| B. Internal batch coordinator | High | Centralizes orchestration but increases application responsibility | A timeout or coordinator failure may affect multiple batches; bounded retries and partial-progress reporting are required | Fewer external triggers may mean longer or heavier function executions; must stay within existing function and runtime limits | Can control concurrency, but may still produce concentrated work and needs careful retry/idempotency handling |
| C. Adaptive dispatching | Very high | Most complex; requires dispatch policy, state, and operational monitoring | Can respond to load, but adds controller/state failure modes and more complex recovery | May require longer-running or repeated dispatch work; must not exceed the existing function limit | Can reduce peaks dynamically, but dispatch state, leases, or queue records may add reads and writes |

## Recommendation

Prefer **Option A: External cron staggering** for a future, explicitly approved rollout. It addresses synchronized bursts with the smallest application and infrastructure change, preserves the existing endpoint and batch boundaries, and does not add a Vercel Function or database schema.

Before rollout, confirm the scheduler can represent and persist the desired offsets, retain every required batch at its existing cadence, and validate actual candle advancement across the complete market universe. Monitor Vercel invocations and runtime, Supabase read/write activity, Bitvavo responses, partial failures, and stale-market counts. Roll back to the verified aligned schedules if coverage degrades or batches overlap.

No option is approved or implemented by this report. AI behavior, candle ingestion, scheduler settings, and production data remain unchanged.
