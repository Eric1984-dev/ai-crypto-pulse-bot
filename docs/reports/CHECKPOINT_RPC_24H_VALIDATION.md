# Checkpoint RPC 24-Hour Validation

**Validation captured:** 2026-11-04 08:56:02 UTC

**Production deployment:** Commit `d4fce8c` became Ready at 2026-11-04 08:42:29 UTC.

**Elapsed post-deployment observation:** Approximately 13 minutes 33 seconds.
**Scope:** Read-only production validation. No code, database, scheduler, or deployment settings were changed.

## Executive result

**Status: PENDING — not enough evidence to declare “Production Successful / No Regression Detected.”**

A 24-hour post-deployment window has not elapsed; it will end no earlier than **2026-11-05 08:42:29 UTC**. In addition, no archived pre-deployment quality and infrastructure snapshots exist at matched timestamps for this validation. The available earlier freshness snapshot was taken at 08:17 UTC, which is not a matched comparison with the current 08:56 UTC snapshot. It is intentionally excluded from before/after trend calculations.

The interim evidence is encouraging but not conclusive: the RPC has successful database calls, recent low-interval candles advanced, all 102 enabled markets have candle coverage across all six intervals, and no relevant post-deployment storage/provider events were recorded. However, persisted event data is not a complete request ledger, database statement statistics do not count failed calls or expose p95, and the available Vercel metrics cover a rolling window that includes pre-deployment traffic.

## Comparison rules and evidence limitations

This report applies the requested comparison constraints:

- Compare only observations at matched timestamps.
- Use the same freshness thresholds for the same intervals.
- Do not infer historical freshness from current candle timestamps. The candle table stores candle-bucket time, not ingestion time, so it cannot reconstruct when a candle became available.
- Do not treat cumulative database statistics or rolling Vercel dashboards as isolated before/after windows.

No timestamp-matched before/after pair was available at capture time. Therefore, the tables below report the current snapshot and clearly label historical or rolling observations as context, not as a valid comparison.

## 1. Candle freshness and coverage

Freshness thresholds are unchanged: `1m` 30 minutes, `5m` 2 hours, `15m` 6 hours, `1h` 12 hours, `4h` 24 hours, and `1d` 72 hours.

| Interval | Enabled markets with candles | Fresh at 08:56:02 UTC | Stale | Latest candle timestamp | Markets whose latest timestamp advanced after deployment |
|---|---:|---:|---:|---|---:|
| `1m` | 102/102 | 82 | 20 | 08:55 UTC | 62 |
| `5m` | 102/102 | 97 | 5 | 08:45 UTC | 13 |
| `15m` | 102/102 | 102 | 0 | 08:30 UTC | 0 |
| `1h` | 102/102 | 102 | 0 | 08:00 UTC | 0 |
| `4h` | 102/102 | 102 | 0 | 04:00 UTC | 0 |
| `1d` | 102/102 | 102 | 0 | 2026-11-03 00:00 UTC | 0 |

**Interpretation:** Current coverage is 102/102 markets for each interval. Advancement is observed for 62 `1m` and 13 `5m` market checkpoints. This does not establish uninterrupted advancement over a full day. No advancement in longer intervals is not by itself a failure in this short observation window; their latest candle timestamps remain within the configured freshness thresholds.

**Trend verdict:** Not measurable under the matched-timestamp requirement. The prior 08:17 UTC snapshot is not used to calculate a delta against this 08:56 UTC snapshot.

## 2. Checkpoint database performance and errors

The production RPC is callable and `pg_stat_statements` contained the following successful statement totals at capture time:

| Query series | Calls / rows | Mean statement time | Maximum | p95 |
|---|---:|---:|---:|---|
| Checkpoint RPC | 84 / 84 | 24.927 ms | 160.592 ms | Not available |
| Legacy REST checkpoint query | 6,638 / 6,638 | 376.692 ms | 3,973.160 ms | Not available |

These are PostgreSQL statement timings, not Supabase REST round-trip latency. The statistics reset at 2026-11-03 20:54:18 UTC; the RPC and legacy query counts are not timestamped per call and do not form matched 24-hour samples. They are directional context only, not a controlled before/after benchmark.

- **Supabase response time:** Not separately measured.
- **RPC error count/rate:** Not available from `pg_stat_statements`, which does not provide failed-request counts.
- **Database statement p95:** Not available from the collected statistics.
- **Persisted checkpoint-specific error events:** No complete RPC-specific error ledger was available.

## 3. Operational events and refresh failures

The scanner-event query covered the available rolling 24-hour lookback as of 08:56 UTC, split at the deployment time. These counts are unequal-duration windows: approximately 23 hours 46 minutes before cutover and 13 minutes 33 seconds after it.

| Event category | Before deployment in lookback | After deployment |
|---|---:|---:|
| `CANDLE_REFRESH_UNAVAILABLE` | 27 | 0 |
| `CANDLE_DATA_STORAGE_ERROR` | 11 | 0 |
| `PROVIDER_TIMEOUT` | 1 | 0 |
| `PROVIDER_UNAVAILABLE` | 1 | 0 |

No matching persisted events were recorded after deployment at capture time. This does **not** establish zero refresh failures: event persistence is not a complete endpoint-request ledger, and the post-deployment sample is very short. A complete refresh-failure rate and provider-failure rate cannot be calculated from these records.

## 4. Vercel infrastructure

The available Vercel Observability snapshot was viewed around 08:48 UTC with a rolling one-hour window that straddled deployment:

- `/api/candle-refresh`: 441 invocations, 29 seconds cumulative Active CPU, 0% route error rate.
- Overall functions: approximately 447 invocations, 0.9% error rate, 0% timeout rate, and 964 ms P75 Active CPU.
- Route-level average, p95, and maximum wall duration were not available.

These values cannot be attributed to the deployed RPC because the window includes substantial pre-deployment traffic. Active CPU is not wall-clock duration. There is no matched pre-deployment CPU/request-volume snapshot and no isolated post-deployment Vercel duration distribution; consequently, CPU, function-duration, request-volume, and error-rate trends remain **unverified**.

## 5. Candle advancement continuity

Latest candle timestamps advanced after the deployment for 62 markets at `1m` and 13 markets at `5m`. The current database snapshot has full market coverage at all six intervals. This demonstrates interim advancement and coverage, but not continuous advancement by every scheduled batch or across a full 24-hour cycle.

The scheduler contract processes one interval and at most five markets per invocation. A full-cycle verification must account for every scheduled batch and interval, and inspect response-level metrics such as `candleRefreshDurationMs`, status, batch, provider requests, and candles processed. Those per-invocation response histories were not available for this report.

| Verification criterion | Interim result |
|---|---|
| All enabled markets have candle rows for all intervals | **Observed:** 102/102 for each of six intervals |
| `1m` and `5m` timestamps advanced after deployment | **Observed:** 62 `1m`, 13 `5m` |
| Freshness trend without regression | **Not determined:** no matched-time baseline |
| Coverage trend without regression | **Not determined:** no matched-time baseline |
| Continuous advancement across all intervals/batches | **Not determined:** less than 14 minutes observed; no complete batch history |

## Conclusion and follow-up

The optimization has a positive interim signal, but the evidence does not meet the requested 24-hour matched-comparison criteria. **Do not formally mark this deployment “Production Successful / No Regression Detected” yet.**

Reassess after **2026-11-05 08:42:29 UTC**, provided matched pre- and post-deployment snapshots or equivalent time-series data are available. At minimum, compare freshness with the same six thresholds and enabled-market universe, verify coverage and candle advancement by interval and batch, and collect isolated Vercel request/Active CPU/duration metrics plus refresh response and failure records. If historical matched snapshots cannot be recovered, state that limitation explicitly rather than substituting unmatched observations.

## Sources

- Read-only Supabase queries captured at 2026-11-04 08:56:02 UTC against `AI_Crypto_Bot_Watched_Markets`, `AI_Crypto_Bot_Candles`, `AI_Crypto_Bot_Scanner_Events`, and `pg_stat_statements`.
- Prior preliminary production snapshot and Vercel observations: [Checkpoint RPC post-deployment validation](./CHECKPOINT_RPC_POST_DEPLOYMENT_REPORT.md).
- [Candle refresh scheduling contract](../SCHEDULING.md#phase-06-candle-refresh).
- [Checkpoint RPC migration](../../PostgreSQL/migrations/20261102150000_candle_checkpoint_rpc.sql).
