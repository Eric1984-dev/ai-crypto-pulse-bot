# Checkpoint RPC Post-Deployment Validation

**Validation captured:** 2026-11-04 08:51 UTC  
**Production deployment:** Vercel deployment for commit `d4fce8c` became Ready at 2026-11-04 09:42:29 Europe/Brussels (08:42:29 UTC). A documentation-only deployment for `d4d0cbd` became Ready at 09:43:18 Europe/Brussels.  
**Scope:** Read-only production validation. No code, database, scheduler, or deployment settings were changed.

## Executive result

The production deployment is serving the checkpoint RPC implementation. The RPC exists in Supabase, and `pg_stat_statements` recorded 63 successful PostgREST RPC calls by 08:51 UTC. Those calls averaged **29.291 ms** in PostgreSQL, with a **160.592 ms maximum**. The pre-change REST checkpoint query had a cumulative mean of **376.692 ms** and maximum of **3,973.160 ms** in the same statistics collection period. These are database statement timings, not end-to-end Supabase response times; the statistics do not expose p95.

The latest candle timestamps advanced after the Vercel deployment for 55 markets at `1m` and 13 at `5m`; all 102 enabled markets still have stored candles for every interval. No candle/storage/provider events were recorded after deployment in the scanner-event table, and the scheduler console showed 130 enabled jobs, zero failed jobs, and recent successful HTTP 200 executions.

**This is an early positive signal, not a complete no-regression sign-off.** The post-deployment window is only about nine minutes. The current `1m` freshness count matches the earlier snapshot, while `5m` has two fewer fresh markets. The available evidence cannot establish statistically meaningful candle-refresh duration percentiles or confirm that every batch and interval remains healthy over a full schedule cycle.

## Comparison window and evidence

| Period | Window / evidence |
|---|---|
| Before | `pg_stat_statements` old checkpoint REST query accumulated after its statistics reset at 2026-11-03 20:54:18 UTC and before/through the production cutover. The most recent comparable candle-quality snapshot was the 2026-11-04 08:17 UTC efficiency audit. |
| Deployment | `d4fce8c` Ready at 08:42:29 UTC. |
| After | Supabase and scheduler observations through 08:51 UTC; Vercel Functions dashboard viewed around 08:48 UTC with a rolling one-hour window. The Vercel one-hour window includes substantial pre-deployment time. |

The Vercel deployment list showed the checkpoint commit as **Ready** in the **Production** environment. The database migration is present, and the RPC is callable via PostgREST as `service_role`. A read-only SQL-console attempt to execute the RPC directly was denied, consistent with the function's restricted grants; no access controls were changed.

## 1. Candle refresh execution time

| Metric | Before | After | Assessment |
|---|---:|---:|---|
| Candle-refresh average wall duration | Not available | Not available | Successful endpoint durations are response metrics; the scheduler history did not expose per-run duration and the Vercel route table had no usable duration value. |
| p95 wall duration | Not available | Not available | No per-invocation duration distribution was available. |
| Maximum wall duration | Not available | Not available | No per-invocation duration series was available. |
| Checkpoint database statement mean | 376.692 ms, 6,638 calls, legacy REST query | 29.291 ms, 63 calls, RPC query | About 92% lower mean statement time; pre/post sample sizes and query shapes differ. |
| Checkpoint database statement maximum | 3,973.160 ms | 160.592 ms | Lower observed maximum; not a controlled latency benchmark. |
| Checkpoint database p95 | Not available | Not available | `pg_stat_statements` exposes mean and maximum, not p95. |

The `pg_stat_statements` reset time was 2026-11-03 20:54:18 UTC. The RPC's 63 calls accumulated after deployment; the old REST query's 6,638 calls are the pre-change query series. The Postgres statement timings include database execution/JSON result construction but exclude the client-to-Supabase network path. A single `EXPLAIN ANALYZE` comparison of the old capped query and equivalent lateral lookup also showed 134.931 ms versus 4.072 ms, respectively; this is one sample per shape and should not be treated as an average or service-level guarantee.

## 2. Database query performance and errors

- The new RPC is present and uses the existing `(symbol, interval, timestamp)` unique index for a backward latest-row lookup.
- `pg_stat_statements` recorded **63 calls / 63 rows** for the RPC by 08:51 UTC; mean **29.291 ms**, max **160.592 ms**.
- The legacy REST checkpoint query recorded **6,638 calls / 6,638 rows**; mean **376.692 ms**, max **3,973.160 ms**.
- Supabase REST round-trip latency is not separately available from the database statement statistics.
- No checkpoint-query error rate can be reliably calculated from the database counters: failed requests are not represented in these successful-call counts, and per-invocation error logs were not available for a matching interval.
- The scanner-event table recorded **zero candle/storage/provider events after deployment**. This is supporting evidence, not proof of zero failed requests, because not every failure is guaranteed to persist as an event.

## 3. Refresh quality

Freshness limits used here are `1m` 30 minutes, `5m` 2 hours, `15m` 6 hours, `1h` 12 hours, `4h` 24 hours, and `1d` 72 hours.

| Interval | Pre fresh / 102 (08:17 UTC) | After fresh / 102 (08:51 UTC) | After stale | Latest stored candle after deployment |
|---|---:|---:|---:|---|
| `1m` | 84 | 84 | 18 | 55 markets advanced; newest 08:50 UTC |
| `5m` | 99 | 97 | 5 | 13 markets advanced; newest 08:45 UTC |
| `15m` | 102 | 102 | 0 | No new latest timestamp observed; newest 08:30 UTC |
| `1h` | 102 | 102 | 0 | No new latest timestamp observed; newest 08:00 UTC |
| `4h` | 102 | 102 | 0 | No new latest timestamp observed; newest 04:00 UTC |
| `1d` | 102 | 102 | 0 | No new latest timestamp observed; newest Nov 3 00:00 UTC |

Coverage remains **102/102 enabled markets for each of the six intervals**. In the short post-deployment window, the latest stored timestamp advanced for 55 `1m` and 13 `5m` markets. No advancement in longer intervals is expected to be established from a window under ten minutes; their current stored candles remain within the configured freshness limits.

The `1m` stale count is unchanged from the earlier audit. The `5m` stale count is two higher (3 to 5). This does not establish a regression caused by the RPC: the baseline was observed about 25 minutes before deployment, and trade/candle availability varies by market. It does mean the requested “no freshness regression” criterion is **not yet conclusively verified**.

## 4. Operational impact

| Evidence | Before deployment | After deployment |
|---|---:|---:|
| Persisted candle/storage/provider events in the observed 24-hour query | 40 events, all before deployment: 27 `CANDLE_REFRESH_UNAVAILABLE`, 11 `CANDLE_DATA_STORAGE_ERROR`, 1 `PROVIDER_TIMEOUT`, 1 `PROVIDER_UNAVAILABLE` | 0 persisted events after 08:42:29 UTC |
| Cron-job.org dashboard | — | 130 enabled jobs, 0 disabled, 130 marked successful, 0 marked failed at observation |
| Recent scheduler responses | — | Recent candle-refresh jobs shown as `Successful (200 OK)`; AI-analysis also showed `Successful (200 OK)` |
| Refresh failure rate | Not measurable from durable records | Not measurable over the post-deploy window; the dashboard summary is not a time-bounded per-invocation failure rate |

HTTP 200 alone does not guarantee a complete candle refresh: the handler may return partial or unavailable statuses in its response body. The task history evidence confirms successful HTTP responses, but does not provide their response bodies or per-batch processed counts.

## 5. Infrastructure impact

Vercel Observability was viewed around 08:48 UTC with a **rolling one-hour** production window, which straddles the 08:42:29 UTC deployment:

- `/api/candle-refresh`: **441 invocations**, **29 seconds cumulative Active CPU**, **0% route error rate**.
- Overall functions dashboard: approximately **447 invocations**, **0.9% error rate**, **0% timeout rate**, **P75 Active CPU 964 ms**.
- Vercel showed no usable candle-refresh duration percentile in the route table. Active CPU is not wall-clock duration.
- The 441 route invocations and cumulative CPU are useful volume/compute observations, but cannot be attributed solely to the post-deployment build because most of the selected one-hour window predates deployment.
- The request volume is consistent with the active scheduled workload; this short observation does not establish a pre/post request-volume change.

Vercel did not expose route-level average, p95, or max duration in the accessible view. Those values must not be inferred from Active CPU or the one-hour aggregate.

## 6. Regression verification

| Check | Result |
|---|---|
| RPC deployed and being called | **Pass, preliminary:** production deployment is Ready; RPC exists; 63 successful calls observed. |
| Candle coverage | **Pass:** 102 enabled markets have stored candles for all six intervals. |
| Candle advancement | **Pass, preliminary:** 55 `1m` and 13 `5m` market latest-timestamps advanced after deployment. |
| Freshness | **Inconclusive:** `1m` matches the pre-deployment snapshot; `5m` has two additional stale markets. Short, non-identical windows prevent attributing this to the change. |
| Provider/storage failures | **No post-deployment persisted events observed**, but durable events are not a complete request ledger. |
| Function duration / p95 / max | **Not verified:** no per-invocation duration distribution available. |
| Full interval/batch-cycle health | **Not verified:** observation window is much shorter than a full schedule cycle. |

## Conclusion and follow-up

The database-side checkpoint query has a strong early performance signal: the successful RPC statements are substantially faster on average than the legacy REST checkpoint statement series, while returning only one checkpoint per selected market. Candle coverage is intact, and new low-interval candle timestamps are appearing. No post-deployment persisted storage/provider error events or failed scheduled jobs were observed.

Do **not** close the validation as a definitive “no regression” result yet. Continue read-only monitoring for at least 24 hours and include a complete schedule cycle. For a conclusive report, capture the candle-refresh response metrics or Vercel logs per invocation (including `candleRefreshDurationMs`, status, interval, batch, provider request count, and candles processed), then calculate average/p95/max and failure rates separately for pre- and post-deployment windows. Recheck stale-market counts and per-market candle advancement at matched times and thresholds.

## Sources

- Vercel Production deployment list: `d4fce8c` Ready at 2026-11-04 09:42:29 Europe/Brussels.
- Vercel Observability, Functions, rolling one-hour view captured around 08:48 UTC.
- cron-job.org dashboard and recent execution history captured around 09:48 Europe/Brussels.
- Read-only Supabase queries against `AI_Crypto_Bot_Candles`, `AI_Crypto_Bot_Watched_Markets`, `AI_Crypto_Bot_Scanner_Events`, `pg_stat_statements`, and `pg_stat_statements_info`.
- [Candle refresh scheduling contract](../SCHEDULING.md#phase-06-candle-refresh), [checkpoint RPC migration](../../supabase/migrations/20261102150000_candle_checkpoint_rpc.sql), and [checkpoint implementation report](./CHECKPOINT_QUERY_IMPLEMENTATION_REPORT.md).
- Baseline freshness and checkpoint-query context: [Candle Refresh Efficiency Audit](./CANDLE_REFRESH_EFFICIENCY_AUDIT.md) and [Candle Checkpoint Query Optimization Review](./CHECKPOINT_QUERY_OPTIMIZATION_REVIEW.md).
