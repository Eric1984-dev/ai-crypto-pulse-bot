# Phase 06 Candle Refresh: Root Cause and Architecture Report

## Scope and conclusion

This is a source-based diagnosis and production architecture proposal only. No application code, database schema, deployment configuration, or scheduler settings were changed.

The code-level cause of the timeout risk is that one synchronous `/api/market-refresh` invocation still refreshes market snapshots and evaluates candle work for every enabled, Bitvavo-valid watched market across all six intervals. Incremental range fetching reduces response size, but does not partition the work across invocations. The candle work is awaited before the endpoint responds.

The supplied observation that cron-job.org reports a timeout does not, by itself, establish whether cron-job.org stopped waiting first or Vercel terminated the function. Deployed invocation durations and the scheduler's configured timeout are needed to distinguish those cases.

## Market count and work per invocation

`config/markets.js` contains **102 default configured markets**. This is not necessarily the production refresh count: the runtime reads `AI_Crypto_Bot_Watched_Markets`, filters to enabled markets that are currently tradable on Bitvavo, and caps the database read at 2,000 rows. The exact runtime count is `candleRefresh.markets` in a successful response.

For `M` eligible markets:

- The service constructs exactly `6 × M` market/interval jobs for evaluation on each refresh.
- There are six latest-timestamp batch reads, one per candle interval, plus per-symbol fallback reads when a non-empty batch omitted a market.
- A provider candle request is made only when the interval is due, history is missing, and the per-instance cache does not suppress it.
- Every due candle job normally makes one Bitvavo GET and one Supabase upsert POST. The existing worker limit is four concurrent jobs.

`candleRefresh.providerRequests` reports the number of candle-provider requests started in a successful invocation. It does **not** report per-interval counts, batch-read requests, or database upserts. If the function is terminated before returning, this response metric is unavailable.

## Expected request cadence at a five-minute scheduler frequency

Assuming all 102 default markets are enabled and valid, all six intervals already have stored candles, the cache has expired, and each scheduled run is five minutes apart:

| Interval | Typical due frequency | Approximate Bitvavo candle requests per run |
|---|---:|---:|
| `1m` | Every run | 102 |
| `5m` | Every run | 102 |
| `15m` | Every third run | 0 or 102; average about 34 |
| `1h` | Every 12th run | 0 or 102; average about 8.5 |
| `4h` | Every 48th run | 0 or 102; average about 2.1 |
| `1d` | Every 288th run | 0 or 102; average about 0.4 |

That is approximately **249 candle-provider requests per run on average**, with about **204 on an ordinary run** and up to **612 when all intervals are due together**. These are workload estimates, not measured production counts. Actual counts change with the runtime market count, latest stored timestamps, missing histories, cache state, provider failures, and scheduler alignment.

If latest-candle records are missing for some markets, those pairs use the initial bootstrap path (up to 500 candles) rather than the incremental path. A table total of about 3,000 rows does not show whether all market/interval pairs have a latest timestamp: at 102 markets there are 612 pairs, so the average would be fewer than five rows per pair, with the actual distribution unknown.

## Which intervals consume the most work?

By request frequency, `1m` and `5m` dominate at a five-minute cadence: each is due for nearly every eligible market on every invocation. `1m` also usually returns more rows per request because it must catch up several one-minute candles between runs. The slower intervals are due less often, although coincident interval boundaries can make an individual invocation substantially heavier.

The current metrics do not measure duration by interval. `candleRefreshDurationMs` is an aggregate over selection, timestamp reads, provider calls, and writes. Therefore, the slowest interval in actual production cannot be identified from the current response shape alone; Bitvavo and Supabase latency can vary independently of interval size.

Also, `candlesUpserted` and `metrics.recordsProcessed.candles` count rows submitted for upsert, including the one-candle overlap. They are **not counts of newly inserted database rows**. The existing conflict key makes overlap updates duplicate-safe, and Bitvavo may omit intervals with no trades. Consequently, those counters cannot be used to explain the table's net row-count growth.

## Vercel Hobby runtime assessment

The route awaits the complete snapshot and candle refresh before sending HTTP success. The configured request timeout is eight seconds for Bitvavo and Supabase fetches; each due candle job performs its provider fetch and database upsert sequentially, with four workers.

Using those timeouts as a conservative bound, `N` due candle jobs can take approximately:

```text
ceil(N / 4) × (8s Bitvavo request + 8s Supabase write)
```

For 204 due jobs, this upper-bound estimate is **816 seconds**, before market-summary and latest-timestamp reads. This is a worst-case estimate, not the measured production duration; normal requests can be much faster, and systemic failures may stop queued work early.

Vercel currently documents a **300-second maximum duration for Hobby Functions** ([official limits](https://vercel.com/docs/functions/limitations#max-duration)). `vercel.json` does not set a route-specific duration. The workload is therefore capable of exceeding the Hobby limit under slow successful network calls. Whether the reported production runs actually reach that limit cannot be established without Vercel invocation logs. cron-job.org may also have a shorter request timeout than Vercel's function maximum.

## Architectural assessment

A five-minute cadence is reasonable for bulk market snapshots. It is not a good reason to make a single synchronous function process candle work for the whole market universe across six intervals. Incremental fetching makes each candle payload smaller, but the invocation still builds and evaluates `6 × M` jobs and may execute hundreds of sequential provider/write pairs.

## Recommended production architecture

1. **Keep the market snapshot job separate and frequent.** Retain `/api/market-refresh` for ticker snapshots and market synchronization at the desired five-minute cadence, but do not make snapshot freshness depend on completion of candle ingestion.
2. **Give candles a separate authenticated scheduled endpoint.** Use the same `CRON_SECRET`, existing watched-market and candle tables, public Bitvavo endpoints, and `(symbol, interval, timestamp)` upserts. A candle failure must not make the snapshot job time out.
3. **Bound each candle invocation by both interval and market batch.** Each invocation should receive one supported interval and one deterministic shard of markets, rather than evaluating all six intervals for all markets. Start with a conservative shard size (for example 10–15 markets), then increase only after observing production p95 duration. Every invocation should have a hard work cap and leave remaining work for later scheduled invocations.
4. **Schedule each interval at its natural cadence and rotate all shards within its freshness target.** A useful starting cadence is `1m` every minute, `5m` every five minutes, `15m` every 15 minutes, `1h` hourly, `4h` every four hours, and `1d` daily. Ensure the scheduler distributes shards across the interval window; if the scheduler cannot meet that coverage, lower the market universe or accept/document a longer freshness target rather than running an unbounded full-universe request.
5. **Observe actual work before increasing the batch.** Record per interval: eligible markets, due/skipped markets, provider requests, fetched/upserted rows, Bitvavo duration, Supabase duration, total invocation duration, and failure status. Compare Vercel duration with cron-job.org timeout records. Keep row-upsert counts distinct from new-row counts if insertion counts are later required.

This design keeps snapshots current, bounds each serverless invocation independently of the full market universe, and preserves candle ingestion and the AI Engine's existing data contract. It requires no new candle table or schema change.

## Information required to confirm the production incident

- The latest successful `/api/market-refresh` response, especially `candleRefresh.markets`, `providerRequests`, `unchanged`, `skipped`, and `metrics`.
- Vercel function logs for the timed-out invocation, including duration and termination reason.
- cron-job.org's configured timeout and the timestamp/result for the same invocation.
- The production count of enabled, Bitvavo-valid watched markets, plus the number of market/interval pairs with stored candles.

Without those observations, exact production market/request counts and exact per-interval runtimes cannot be truthfully reported from the repository alone.

## Phase boundary

This report proposes changes to Phase 06 scheduling only. No Phase 08 functionality was implemented or proposed.
