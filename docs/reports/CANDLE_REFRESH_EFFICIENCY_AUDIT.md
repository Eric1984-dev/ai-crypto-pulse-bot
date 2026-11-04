# Candle Refresh Efficiency Audit

**Observation time:** 2026-11-04 08:17 UTC (live Supabase candle/decision/trade data)  
**Scheduler baseline:** The last verified cron-job.org configuration from 2026-11-03; the external scheduler could not be reauthenticated for a same-day inspection. Volume figures below are schedule-derived and assume that configuration has not changed.  
**Scope:** Read-only production and code analysis. No code, database, or scheduler settings were changed.

## Executive summary

The largest measured workload opportunity is **not another cadence reduction**. Each scheduled batch reads up to 2,000 historical candle rows from Supabase to find the newest timestamp for at most five markets. In the current database, the query returns approximately **19.36 million candle rows per day** under the verified schedule. A single query that returns just the latest timestamp per selected market would return about **47,224 rows/day**, a theoretical **99.76% reduction in rows returned for this checkpoint read**, without changing candle coverage or AI inputs.

The currently verified schedule produces approximately **9,722 candle-refresh invocations/day**, or about **463 scheduled market/interval refresh attempts per market/day** (the two markets in inactive daily batch 20 miss one daily interval). None of the configured cadences is faster than the corresponding candle interval. The cadence therefore does not obviously request data more often than a new interval candle can exist. Every refresh deliberately overlaps the latest stored candle, however, so it can submit a repeated row for upsert.

The seven-day decision history shows that 79 of 102 enabled markets had at least one BUY or SELL decision, while 23 had none; only BEAM-EUR and WIN-EUR have paper trades. This short history is not sufficient evidence to remove markets. Also, 18 markets currently have `1m` candles older than the AI freshness limit and three have stale `5m` candles. Further cadence reductions should wait until the cause and duration of those gaps are understood.

## 1. Current refresh volume

Each cron task targets one interval and one five-market batch. The 102 enabled markets therefore occupy 21 batches. These figures reflect the last verified schedules; they are not a same-day cron-job.org read.

| Interval | Active batch jobs | Verified cadence per job | Scheduled refreshes per market/day | Scheduled requests/day | Nominal new candle slots per request* | Candle rows timestamped in DB during trailing 24h** |
|---|---:|---|---:|---:|---:|---:|
| `1m` | 21 | Every 5 minutes | 288 | 6,048 | Up to 5 | 29,935 |
| `5m` | 21 | Every 15 minutes | 96 | 2,016 | Up to 3 | 13,165 |
| `15m` | 21 | Every 30 minutes | 48 | 1,008 | Up to 2 | 6,412 |
| `1h` | 21 | Hourly | 24 | 504 | Up to 1 | 2,160 |
| `4h` | 21 | Every 4 hours | 6 | 126 | Up to 1 | 503 |
| `1d` | 20 of 21 | Daily, batches staggered | 1 for 100 markets; 0 for 2 | 20 | Up to 1 | 0 |
| **Total** | **125** | — | **About 463 per covered market** | **9,722** | — | **52,175** |

\* The expected number of *new* time slots if trades produce candles continuously and the API returns the full requested range. The request starts at the latest saved timestamp and includes that timestamp again, so it also includes an overlap record.  
\** These are stored candle timestamps in the rolling time window, not a count of successful refreshes or database inserts. The latest stored daily timestamp was 2026-11-03 00:00 UTC; the prior daily candle timestamp therefore falls outside the trailing 24-hour window at observation time.

The scheduler-derived daily request total is:

```text
6,048 + 2,016 + 1,008 + 504 + 126 + 20 = 9,722 requests/day
```

Batch 20 of the daily interval was inactive in the last scheduler inventory. With 102 markets and five markets per batch, it contains the final two markets in the ordered universe. The configured daily jobs therefore do not cover those two markets.

### Observed candle coverage

The live database contained 102 enabled markets with stored candles for every interval. Using the AI Engine's configured freshness limits at observation time:

| Interval | Fresh enabled markets | Stale enabled markets | Oldest latest candle |
|---|---:|---:|---|
| `1m` | 84 / 102 | 18 | 04:03 UTC |
| `5m` | 99 / 102 | 3 | 04:00 UTC |
| `15m` | 102 / 102 | 0 | 02:30 UTC |
| `1h` | 102 / 102 | 0 | 02:00 UTC |
| `4h` | 102 / 102 | 0 | 00:00 UTC |
| `1d` | 102 / 102 | 0 | 2026-11-03 00:00 UTC |

These are freshness classifications, not proof of scheduler failure. Bitvavo documents that candle data is returned when trades occur; intervals with no trades produce gaps rather than zero-volume candles. Still, the 18 stale `1m` and three stale `5m` markets warrant investigation before reducing cadence further.

## 2. Candle generation versus scheduler cadence

The exchange interval defines the candle time bucket: 60 seconds, 5 minutes, 15 minutes, 1 hour, 4 hours, or 1 day. Bitvavo's public candle endpoint returns OHLCV data for the requested interval, and its documentation says a candle is returned when trades occur; no-trade periods appear as gaps. Consequently, the theoretical slot counts above are ceilings, not guaranteed record counts.

The stored timestamps corroborate the expected interval cadence in active periods:

| Interval | Expected candle spacing | Median observed stored-candle spacing*** | Scheduled refresh spacing |
|---|---:|---:|---:|
| `1m` | 60 sec | 120 sec | 300 sec |
| `5m` | 300 sec | 300 sec | 900 sec |
| `15m` | 900 sec | 900 sec | 1,800 sec |
| `1h` | 3,600 sec | 3,600 sec | 3,600 sec |
| `4h` | 14,400 sec | 14,400 sec | 14,400 sec |
| `1d` | 86,400 sec | 86,400 sec | 86,400 sec |

\*** Median gaps are calculated from stored timestamps over the preceding 14 days. Larger gaps can reflect either no trades or failed/delayed ingestion; timestamps alone cannot distinguish the two.

At the configured cadences, the endpoint can catch up several `1m`, `5m`, or `15m` candles in a call. It does not need one scheduler invocation for every exchange candle. For `1h`, `4h`, and `1d`, the job interval matches the candle interval.

## 3. Redundant refreshes and repeated rows

### Jobs more frequent than candle generation

**None were identified** in the last verified schedule. Every scheduler interval is equal to or longer than the corresponding candle duration. The `1m`, `5m`, and `15m` requests are less frequent than their possible candle creation cadence, not more frequent.

### Historical over-read on every refresh

The larger inefficiency is in the checkpoint query. For each scheduled invocation, `getLatestStoredCandles()` filters to the selected symbols and interval, orders by timestamp, and requests up to 2,000 rows. It then scans those rows in JavaScript to retain the latest timestamp per market. It does not ask the database for only one latest row per market.

The live data shows that most batches contain more than 2,000 historical rows for the interval. With the current market ordering and five-market batching, the query would return:

| Interval | Stored rows in all batches | Rows returned for one full scheduled pass | Current requests/day | Estimated checkpoint rows returned/day |
|---|---:|---:|---:|---:|
| `1m` | 108,351 | 42,000 | 6,048 | 12,096,000 |
| `5m` | 87,735 | 41,799 | 2,016 | 4,012,704 |
| `15m` | 69,779 | 41,369 | 1,008 | 1,985,712 |
| `1h` | 53,767 | 40,913 | 504 | 981,912 |
| `4h` | 52,350 | 40,961 | 126 | 245,766 |
| `1d` | 47,195 | 39,710**** | 20 | 39,710 |
| **Total** | **419,177** | **246,752** | **9,722** | **19,361,804** |

\**** Daily batch 20 is inactive, so the estimate excludes its 949 rows per pass.

The calculation uses the current stored row counts grouped by the same five-market batches and caps each batch's checkpoint result at 2,000, matching the REST query. It estimates rows returned/processed by the application, not physical disk blocks or billed Supabase Disk IO.

If a single database query returned only the latest timestamp for each selected market, the same schedule would return about **47,224 rows/day** (102 markets multiplied by scheduled refreshes for the five sub-daily intervals, plus 100 daily-covered markets). That is about **19.31 million fewer checkpoint rows/day**, or **99.76% fewer rows returned** for this query. An RPC or another single-query latest-per-symbol mechanism would avoid multiplying HTTP calls; five separate `limit=1` requests per batch would reduce returned rows but increase request count.

### Re-upserting the latest candle

For each populated market/interval, the request starts at the last stored timestamp and includes that timestamp again. This intentional overlap allows a recently formed candle to be revised. Under the configured cadence, the schedule permits up to **47,224 overlap-row submissions/day** across the covered markets and intervals. This is an upper-bound opportunity count, not a measured count of identical payloads: the latest OHLCV may change between calls, and Bitvavo may return no row during a no-trade period.

The code uses merge-duplicates upserts and does not compare the returned OHLCV values to the stored values before writing. A repeated row is therefore not necessarily an unchanged row.

## 4. Refresh success and data-change analysis

The candle table has no ingestion/refresh timestamp or per-refresh identifier. Its `timestamp` is the market candle's interval timestamp, not the time at which the row was fetched or written. A newer timestamp proves that a candle exists in storage; it does not identify which scheduled request created it. The table cannot reveal how often an identical payload was reloaded.

The endpoint logs response metrics, including status counts, provider request counts, and candle upsert counts, to Vercel function logs. Those per-run logs were not available for this audit. `AI_Crypto_Bot_Scanner_Events` records failures rather than a durable success record. In the trailing seven days, the live event table contained:

| Failure event type | Events |
|---|---:|
| `CANDLE_REFRESH_UNAVAILABLE` | 27 |
| `CANDLE_DATA_STORAGE_ERROR` | 15 |
| `PROVIDER_TIMEOUT` | 1 |
| `PROVIDER_UNAVAILABLE` | 1 |

These are logged event counts, **not counts of failed scheduler invocations**; one invocation can emit multiple events, and not every failure mode necessarily creates a database event. PostgreSQL table statistics available in the query did not expose a reset timestamp, so cumulative insert/update counters cannot be converted into a reliable seven-day refresh success rate or identical-row rate.

Therefore:

- Refresh success percentage: **not measurable from the available persisted data**.
- Percentage of refreshes that changed a candle: **not measurable**.
- Percentage of upserts whose values were identical: **not measurable**.
- Stored timestamp coverage and recorded failure events: **measurable**, as reported above.

## 5. Market utilization

The enabled universe contains 102 markets. During the seven days before the database observation:

- **79 / 102** markets generated at least one BUY or SELL decision.
- **23 / 102** generated no BUY or SELL decision:
  `ACU-EUR`, `ADX-EUR`, `ENJ-EUR`, `EURC-EUR`, `IKA-EUR`, `JASMY-EUR`, `LRC-EUR`, `LSK-EUR`, `MAGIC-EUR`, `MEGA-EUR`, `MIOTA-EUR`, `MLN-EUR`, `MORPHO-EUR`, `MOVR-EUR`, `OP-EUR`, `POL-EUR`, `SAND-EUR`, `STRAX-EUR`, `SXT-EUR`, `USDC-EUR`, `XRP-EUR`, `XYO-EUR`, and `ZIG-EUR`.
- The decision table contained **1,391 BUY** and **11,800 SELL** decisions in that period.
- Only **BEAM-EUR** and **WIN-EUR** had paper trades in the trade table at observation time.

“No actionable decision in seven days” is not evidence that a market never can produce a useful signal. The bot has only a short production history, and 79 markets did produce a BUY or SELL decision without necessarily producing a trade. Trade count alone should not be used as a market-removal criterion.

## 6. Resource impact scenarios

| Change | Estimated workload effect | Trading-quality and operational caveats |
|---|---|---|
| Return only latest timestamp per market in checkpoint lookup | Same scheduled requests and candle set; checkpoint response rows fall from about 19.36M/day to 47,224/day (−99.76%). | Preserves current selection and freshness behavior if implemented correctly. Prefer one aggregate/latest-per-symbol database read, not five extra HTTP reads per batch. |
| Remove the 23 markets with no BUY/SELL in the last seven days | Universe falls from 102 to 79; batch count falls from 21 to 16. If all affected scheduler jobs are intentionally removed, request count could fall by about 23.8% (from 9,722 to roughly 7,408/day); market-level candle work falls about 22.5%. | Risks excluding a future signal and reduces the AI market universe. Seven days is too short to justify removal. Extra configured batch jobs must not be left to call out-of-range batches. |
| Double `1m`, `5m`, and `15m` intervals again | Illustrative schedule: `1m` every 10m, `5m` every 30m, `15m` hourly. Requests fall from 9,722 to about 5,186/day (−4,536; −46.7%). Provider and candle-write work would generally fall as well. | Not validated for equivalent AI decisions. Current stale coverage (18 `1m`, 3 `5m`) makes further reductions inadvisable until refresh health is understood; replay all markets and multiple regimes first. |
| Stagger batches within their existing cadence | **0% fewer daily invocations or candle records**; lowers simultaneous bursts. For example, 21 jobs can be distributed through each interval window instead of starting together. | Can delay the last batch in a window. Preserve every batch and monitor coverage. This remains a proposal, not an implemented scheduler change. |
| Adaptive cadence by market activity or candle changes | No defensible percentage from the available logs. A policy that halved refreshes for the 23 no-action markets would save at most about 11% of market-level work; disabling all 23 gives the upper-bound scenario above. | Market inactivity, lack of trades, and lack of useful signals are different conditions. Requires a carefully tested policy and a fallback cadence to prevent stale data. |
| Skip unchanged overlap upserts | Up to 47,224 overlap-row submissions/day could be candidates for avoiding writes, depending on how often the latest candle is byte-identical. | Exact unchanged fraction is unknown. The latest candle can legitimately change; compare OHLCV and update only when different, preserving the overlap safeguard. |

Request reductions are schedule arithmetic, not measured reductions in CPU, provider rate-limit weight, Supabase reads/writes, or dollars. Provider requests may be skipped by the per-instance cache or stopped by failure handling; actual run logs are needed for measured resource attribution.

## 7. Ranked recommendations

### HIGH impact

1. **Replace the checkpoint over-read with a latest-per-symbol query.** This is the strongest measured opportunity: approximately 19.36M returned rows/day for a query whose output needs only about 47K latest timestamps/day. Keep the same market universe, interval, and candle-selection rules. Validate that all five selected symbols always receive their true latest stored timestamp, including stale markets.
2. **Resolve low-interval freshness and make per-run status observable before any further cadence change.** The current database has 18 stale `1m` and three stale `5m` markets, plus recorded provider/storage failure events. Persist or export per-run interval, batch, selected markets, status, provider requests, upsert count, and duration so coverage and failure rates can be reconciled.

### MEDIUM impact

3. **Measure and conditionally avoid unchanged overlap writes.** Retain the latest-candle overlap, but skip a database update only after verifying that OHLCV values are identical. First add/collect per-run comparison metrics; do not assume every repeated timestamp is redundant.
4. **Evaluate another cadence reduction only with a full-market replay.** Doubling the three faster cadences would save an estimated 4,536 scheduler requests/day, but the prior cadence replay covered a limited target sample, not all markets and market regimes. Re-run the actual JavaScript AI Engine across complete batches, compare decisions/confidence/strength, and measure added stale intervals before approval.
5. **Treat market pruning as an experiment, not an immediate optimization.** The 23 markets without a BUY/SELL over seven days could reduce request count by roughly 23.8% if removed and scheduler batches are rebuilt, but the evidence window is too short to preserve market coverage with confidence.

### LOW impact

6. **Stagger batch starts.** This reduces burst concurrency against Vercel, Supabase, and Bitvavo but does not reduce total requests, reads, or writes. The existing proposal is documented in [Scheduling](../SCHEDULING.md) and remains proposed, not implemented.

## Sources and limitations

- Live Supabase `AI_Crypto_Bot_Candles`, `AI_Crypto_Bot_Watched_Markets`, `AI_Crypto_Bot_AI_Decisions`, `AI_Crypto_Bot_Trades`, and `AI_Crypto_Bot_Scanner_Events` read-only aggregates, observed 2026-11-04 around 08:17 UTC.
- Last verified scheduler inventory and cadence update from 2026-11-03; not reverified during this audit. See [Scheduler Cadence Verification](./SCHEDULER_CADENCE_VERIFICATION.md) for the earlier inventory and [Refresh Frequency Impact Analysis](./REFRESH_FREQUENCY_IMPACT_REPORT.md) for the later recommended cadence.
- [Candle refresh implementation](../../lib/market-data.mjs): batch sizing, checkpoint query, elapsed-interval skip, overlap start timestamp, and merge-duplicates upsert.
- [Candle refresh endpoint](../../api/candle-refresh.mjs): per-invocation metrics are logged to function logs and are not persisted as a refresh-history table.
- [Scheduling documentation](../SCHEDULING.md): interval/batch endpoint contract and staggered scheduling proposal.
- [Bitvavo Get candlestick data documentation](https://docs.bitvavo.com/docs/rest-api/get-candlestick-data/): supported interval values and behavior when no trades occur.
- No code, database, or scheduler settings were modified. No tests were run because this is a read-only analysis report.
