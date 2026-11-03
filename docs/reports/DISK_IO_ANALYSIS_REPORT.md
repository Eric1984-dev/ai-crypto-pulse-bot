# Disk IO Impact Analysis

**Observation time:** 2026-11-03 20:21 UTC  
**Scope:** Read-only Supabase and repository analysis. No code, data, or scheduler settings were changed.

## Executive finding

The expanded scheduler materially improved candle coverage, but the available counters do not prove that the Disk IO warning is temporary or establish the exact Supabase budget utilization. The first full catch-up can generate a substantial one-time write burst; ongoing refreshes and five-minute AI analysis also continue to generate load.

The strongest current CryptoPulse write signals are:

- Candle upserts: **65,747** statement calls, **~994 MB WAL**, and **116,206 shared blocks dirtied** since 2026-11-01 06:12 UTC.
- AI decision batches: **751** calls, **~789 MB WAL**, and **194,134 shared blocks dirtied** since 2026-11-01 05:57 UTC. The 751 batches correspond to 76,602 inserted decisions, or 102 per run.
- Recent candle coverage improved from 25 markets receiving recent `15m`/`1h` candles at 12:15 UTC to 102 markets receiving recent `1m` through `4h` candles by 20:21 UTC. The `1d` interval has **no candle timestamps in the last 24 hours**, despite 101/102 markets still being within its permissive 72-hour freshness limit.

**Conclusion:** Backfill likely contributed to the warning, but it is not safe to dismiss the warning as backfill-only. A schedule that refreshes all 21 batches at every interval’s natural cadence would mean about **38,955 endpoint invocations and 189,210 new candle rows per day**, before overlap updates and AI analysis reads. That is a high recurring workload. Whether the actual configuration is unsustainable depends on its external recurrence, overlap/staggering, and the Supabase budget window, none of which are available here.

## Data sources and limitations

- Live PostgreSQL counters: `pg_stat_user_tables`, `pg_statio_user_tables`, `pg_stat_statements`, `pg_stat_io`, and `pg_stat_wal`.
- Live candle-row counts and timestamps across 102 enabled markets.
- Earlier coverage snapshot in [CANDLE_REFRESH_COVERAGE_REPORT.md](./CANDLE_REFRESH_COVERAGE_REPORT.md), collected at 12:15 UTC on 2026-11-03.
- Scheduler and batching design in [SCHEDULING.md](../SCHEDULING.md), [PHASE_06_CANDLE_BATCHING_REPORT.md](./PHASE_06_CANDLE_BATCHING_REPORT.md), and [lib/market-data.mjs](../../lib/market-data.mjs).

Database-wide statistics were reset on 2026-08-25; `pg_stat_statements` was reset on 2026-09-07. The candle upsert statement counters began on Nov 1 and AI-decision inserts on Nov 1. They therefore span both pre-expansion activity and catch-up activity; there is no reset or retained time-series at the scheduler-expansion boundary. Candle rows have no ingestion timestamp, and the external cron task list/run history was not accessible. Endpoint attribution below is inferred from the SQL relation and the repository’s endpoint responsibilities, not from a recorded HTTP request ID.

`pg_stat_statements` also retains historical high-I/O query shapes against `public.asset_samples`, `public.asset_scores`, and `public.strategy_research_samples`. Those relations do not currently exist, so those cumulative entries are not evidence of current CryptoPulse activity. The Supabase Disk IO budget percentage and its exact accounting window are not exposed by these SQL views.

## Current table-level IO

Block counts use PostgreSQL’s 8 KiB relation blocks. `heap/index reads` are physical block reads recorded for the relation; `heap/index hits` are shared-buffer cache hits and **not** disk reads. Tuple counts are cumulative table operations since the table statistics were gathered, not a precise after-expansion delta.

| Table | Total size | Physical blocks read | Cache hits | Inserts / updates / deletes |
|---|---:|---:|---:|---:|
| `AI_Crypto_Bot_Candles` | 112 MiB | 11,374 (~88.8 MiB) | 55,517,253 (~423.5 GiB logical hits) | 394,167 / 1,454,799 / 2 |
| `AI_Crypto_Bot_AI_Decisions` | 149 MiB | 8,205 (~64.1 MiB) | 7,774,164 (~59.3 GiB logical hits) | 76,602 / 0 / 0 |
| `AI_Crypto_Bot_Market_Data` | 112 KiB | 3 (~24 KiB) | 1,062,670 (~8.1 GiB logical hits) | 102 / 89,454 / 0 |
| `AI_Crypto_Bot_Trades` | 96 KiB | 12 (~96 KiB) | 96,356 (~0.74 GiB logical hits) | 2 / 0 / 0 |
| `AI_Crypto_Bot_Positions` | 80 KiB | 7 (~56 KiB) | 34,987 (~0.27 GiB logical hits) | 2 / 963 / 0 |

Candles dominate current project-table reads and tuple mutations. AI Decisions are the second-largest physical reader and have substantial write amplification from storing full per-market indicator payloads. Market Data is updated frequently but is very small and has negligible physical reads.

### Write counters by project relation

The following are statement-level write proxies from matching `pg_stat_statements` query text. `shared_blks_dirtied` means a query modified shared-buffer pages; `shared_blks_written` counts writes attributed to those statements; WAL is generated log volume. These are not exact Supabase-billed disk bytes.

| Relation / inferred writer | Calls | Dirtied blocks | Written blocks | WAL generated | Counter start |
|---|---:|---:|---:|---:|---|
| Candles / `/api/candle-refresh` | 65,747 | 116,206 | 14,295 | 993.8 MB | Nov 1 06:12 UTC |
| AI Decisions / `/api/ai-analysis` | 751 | 194,134 | 18,928 | 789.3 MB | Nov 1 05:57 UTC |
| Market Data / `/api/market-refresh` | 879 | 5,532 | 9 | 44.2 MB | Nov 1 00:26 UTC |
| Trades / Positions / paper-trading RPC | Low-volume table changes | 30 / 26 | 9 / 1 | ~97 KB / ~72 KB | Cumulative query stats |

AI analysis also performs a large read workload: a verified 102-market run read **300,849 candle rows across 612 market/interval reads**. The production decision-insert counter averages close to one 102-market run every five minutes over its observation window, implying roughly **86.6 million candle rows scanned per day** at that cadence. This is an extrapolation from one verified run and observed decision batches, not a measured daily block-read total.

Database-wide `pg_stat_io` counters since Aug 25 report approximately **1.17 GiB of relation-read operations**, **34.3 GiB of relation write/extend page activity** (about 33.0 GiB attributed to the checkpointer), and `pg_stat_wal` reports **14.9 GB WAL generated**. These include all database activity and cannot be assigned to these five tables or treated as Supabase’s billable Disk IO total.

## Endpoint impact

1. **`/api/candle-refresh` — highest recurring candle-table writer.** One request handles one interval and up to five markets. It reads the latest stored timestamps and performs per-market candle upserts using the `(symbol, interval, timestamp)` conflict key. The measured candle upsert statement has the largest active CryptoPulse WAL total.
2. **`/api/ai-analysis` — major reader and decision writer.** Each run reads 612 market/interval series for 102 markets, then stores 102 decisions in a batch. It is likely the largest recurring candle reader; its optimization reduced latency but did not reduce the rows or six-interval analysis workload. See [AI_ANALYSIS_PRODUCTION_VERIFICATION_REPORT.md](./AI_ANALYSIS_PRODUCTION_VERIFICATION_REPORT.md).
3. **`/api/market-refresh` — frequent but comparatively small writer.** It updates 102 Market Data rows; the table remains about 112 KiB and its measured WAL is much lower than candle and decision writes.
4. **`/api/paper-trading` — low observed volume.** Current trade and position table changes are small relative to refresh and analysis activity.
5. **Dashboard/Analytics/Scanner endpoints — primarily readers.** Table-level counters show substantial cached access, especially to Candles and AI Decisions, but SQL statistics do not identify the originating HTTP endpoint. A one-call AI Decisions query in the statement view read 6,950 blocks; it cannot be confidently assigned to a specific API route.

## Before versus after scheduler expansion

The comparison uses the same “latest candle within 24 hours” criterion for both snapshots. The current snapshot is at 20:21 UTC; the earlier one is at 12:15 UTC.

| Interval | Before: markets with latest candle <24h old | Current: markets with latest candle <24h old | Current markets fresh under the AI Engine’s interval-specific limit |
|---|---:|---:|---:|
| `1m` | 0 / 102 | 102 / 102 | 89 / 102 |
| `5m` | 0 / 102 | 102 / 102 | 98 / 102 |
| `15m` | 25 / 102 | 102 / 102 | 101 / 102 |
| `1h` | 25 / 102 | 102 / 102 | 102 / 102 |
| `4h` | 0 / 102 | 102 / 102 | 102 / 102 |
| `1d` | 0 / 102 | 0 / 102 | 101 / 102 |

The interval-specific limits are 30 minutes, 2 hours, 6 hours, 12 hours, 24 hours, and 72 hours respectively. The `1d` result is a caution: its latest timestamps range from Oct 31 to Nov 1, so 101 markets happen to remain inside the 72-hour limit, but **no new daily candle timestamp appeared in the preceding 24 hours**. “Fresh by a generous age limit” is not proof that the daily scheduler is advancing bars.

Rows whose candle timestamp falls in the latest 24 hours total **46,713**: `1m` 25,354; `5m` 12,572; `15m` 6,224; `1h` 2,064; `4h` 499; `1d` 0. These are bar timestamps, not ingestion timestamps or exact upsert counts.

The database also recorded 27 `CANDLE_REFRESH_UNAVAILABLE` events from 16:00–17:01 UTC, 10 `1m` storage errors, additional 1h/15m/1d storage errors, and one 5m provider timeout. Their stored reason is that latest candle timestamps could not be loaded or candle storage failed. They indicate refresh failures during the expanded period, but do not expose the underlying Supabase error and do not prove that the Disk IO warning caused them.

## Per-interval daily workload estimate

The scheduler supports six intervals, five markets per request, and therefore **21 batch requests per complete 102-market pass for each interval**. The external recurrence for those requests was not available. The following comparison models a pass at every natural candle interval; it is a high-frequency scenario, not a claim about the configured cron cadence.

For the WAL estimate, the measured candle upsert WAL (~994 MB) divided by the cumulative candle insert/update tuple operations gives roughly **537 bytes per tuple operation**. The low estimate applies that factor once per new candle; the high estimate allows one overlapping prior-candle update per new candle, as the implementation deliberately requests an overlapping timestamp. This is a rough WAL model, not an actual disk-IO quota forecast.

| Interval | Natural cadence assumed | Batch endpoint calls/day | New candle rows/day at 102 markets | Rows timestamped in last 24h | Modeled WAL/day: one to two tuple ops per new row |
|---|---:|---:|---:|---:|---:|
| `1m` | Every minute | 30,240 | 146,880 | 25,354 | ~75–151 MiB |
| `5m` | Every 5 minutes | 6,048 | 29,376 | 12,572 | ~15–30 MiB |
| `15m` | Every 15 minutes | 2,016 | 9,792 | 6,224 | ~5–10 MiB |
| `1h` | Every hour | 504 | 2,448 | 2,064 | ~1.3–2.5 MiB |
| `4h` | Every 4 hours | 126 | 612 | 499 | ~0.3–0.6 MiB |
| `1d` | Every 24 hours | 21 | 102 | 0 | ~0.05–0.10 MiB |
| **Total** |  | **38,955** | **189,210** | **46,713** | **~97–194 MiB** |

The refresh service catches up from the latest stored timestamp, subject to a 500-candle request cap, so running less often does not necessarily reduce the number of unique candles ingested if the same history is ultimately retained. It can reduce scheduler invocations and repeated overlap writes. At a hypothetical freshness-oriented cadence of `1m` every 15 minutes, `5m` hourly, `15m` every 3 hours, `1h` every 6 hours, `4h` every 12 hours, and `1d` daily, the task fan-out would be about **2,835 endpoint calls/day**, rather than 38,955. This is an analytical comparison only; no scheduler change is proposed or performed.

## Are all six intervals necessary?

No single interval is strictly required for the engine to return an analysis. The current engine can analyze with at least two fresh intervals containing sufficient candle history. However, when fewer than four intervals are fresh it caps confidence at 64, while a directional signal requires confidence of at least 65. Thus **at least four fresh intervals are necessary, but not sufficient, for BUY/SELL decisions**. All six add multi-timeframe context and confidence coverage, but refreshing all six at every possible natural cadence is not required for directional operation.

The engine’s freshness and confidence behavior is implemented in [lib/ai-engine.mjs](../../lib/ai-engine.mjs). Interval weights are unequal, so removing intervals would change the normalized signal; any decision to reduce interval coverage should be evaluated as a strategy behavior change, not assumed to be output-neutral.

## Assessment and conclusion

- **Backfill likely caused a temporary component:** the candle endpoint bootstraps up to 500 records per market/interval. Across 102 markets and six intervals, the upper bound is about 306,000 initial rows, and current candle-table write counters include catch-up activity.
- **Ongoing work is material:** current upsert/analysis counters include ongoing operations; recent rows advanced across five intervals, and AI analysis continues to read hundreds of thousands of candles per five-minute run.
- **The maximum natural-cadence schedule is high-risk:** roughly 39,000 batch endpoint calls and 189,000 new rows/day, plus overlap updates and AI-analysis reads. The exact deployed recurrence was not verified, so it cannot be declared the actual ongoing rate.
- **The warning cannot be dismissed as temporary on this evidence.** The likely explanation is a combination of catch-up writes and recurring scheduled work. Current refresh/storage errors are consistent with pressure but are not enough to prove the warning caused them.
- **To distinguish temporary from sustained pressure**, compare the Supabase Disk IO budget chart across a complete post-backfill day, record its exact billing window, and correlate it with the external scheduler’s actual recurrence and run outcomes. Keep the per-interval success/failure and candle-advance evidence separate from HTTP 200 counts.

No code, database rows, migrations, or scheduler settings were changed.
