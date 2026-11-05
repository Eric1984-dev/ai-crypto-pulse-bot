# Candle Ingestion Gap Audit

**Status:** Read-only investigation<br>
**Observation time:** 2026-11-05 10:21:42 UTC (11:21:42 Europe/Brussels); public API comparisons completed during the same audit, by approximately 10:23 UTC.<br>
**Scope:** 1-minute candles for the six position episodes and exact UTC windows listed below. No code, data, schema, deployment, environment, or scheduler settings were changed. No tests were run.

## Executive finding

The missing 1-minute slots are not all no-trade intervals:

- For **WIN-EUR, ARX-EUR, MEGA-EUR, POL-EUR, and SXT-EUR**, the Bitvavo historical candle timestamps match Supabase for every UTC day in the audited windows. The missing minute slots are therefore consistent with Bitvavo's documented behavior of omitting intervals with no trades.
- For **BEAM-EUR**, Bitvavo returned **997 candle timestamps that are absent from Supabase**: 278 on November 1 and 719 on November 2. This is a **likely historical ingestion gap**, not an expected no-trade gap. The comparison establishes a provider-versus-database discrepancy, but does not establish why or when the rows were missed.
- The recent complete-minute sample checked on November 5 matched between Bitvavo and Supabase for five markets. WIN-EUR had no traded 1-minute candle after 09:18 UTC, which Bitvavo also confirmed. This is evidence that the recent stream was behaving consistently at the observation time, but it does not erase the historical BEAM gap or prove that every scheduled execution succeeded.

## Position windows and coverage

The episode boundaries are preserved from [PRODUCTION_HISTORY_CAP_AND_POSITION_EXIT_SIMULATION.md](./PRODUCTION_HISTORY_CAP_AND_POSITION_EXIT_SIMULATION.md). The window begins with the first 1-minute candle timestamp strictly after entry and ends at the candle timestamp at or before the recorded exit/cutoff.

| Market | Entry (UTC) | Exit or cutoff (UTC) | Minute slots | Bitvavo candles | Supabase candles | Likely ingestion gap | Provider-absent slots |
|---|---|---|---:|---:|---:|---:|---:|
| BEAM-EUR | 2026-11-01 18:08:12.319890 | 2026-11-04 01:48:12.325485 (SELL) | 3,340 | 1,791 | 794 | 997 | 1,549 |
| WIN-EUR | 2026-11-02 14:13:09.130145 | 2026-11-05 09:50:58.139746 (cutoff) | 4,057 | 242 | 242 | 0 | 3,815 |
| ARX-EUR | 2026-11-04 11:03:10.131389 | 2026-11-05 09:50:58.139746 (cutoff) | 1,367 | 498 | 498 | 0 | 869 |
| MEGA-EUR | 2026-11-04 11:03:10.131389 | 2026-11-05 09:50:58.139746 (cutoff) | 1,367 | 204 | 204 | 0 | 1,163 |
| POL-EUR | 2026-11-04 11:03:10.131389 | 2026-11-05 09:50:58.139746 (cutoff) | 1,367 | 207 | 207 | 0 | 1,160 |
| SXT-EUR | 2026-11-04 14:48:11.863757 | 2026-11-05 09:50:58.139746 (cutoff) | 1,142 | 283 | 283 | 0 | 859 |
| **Total** |  |  | **12,640** | **3,225** | **2,228** | **997** | **9,415** |

“Provider-absent slots” means no candle was returned by Bitvavo for that minute at audit time. Bitvavo's [public candle endpoint documentation](https://docs.bitvavo.com/docs/rest-api/get-candlestick-data/) says candles are returned only for intervals with trades; these absent slots are therefore classified as **expected no-trade gaps**, subject to the historical-data limitations below.

### BEAM-EUR discrepancy

The provider/database timestamp-set comparison found:

- **November 1:** Bitvavo returned 278 candles from 18:09 through 23:59 UTC; Supabase had no 1-minute candles in the episode window for that day.
- **November 2:** Bitvavo returned 882 candles; Supabase had 163. Supabase had no rows from 00:00 through 17:59 UTC, while Bitvavo returned 697 candles in those hours. During 18:00–18:59, Bitvavo returned 47 candles and Supabase stored 25. The 25 stored timestamps are a subset of the provider timestamps; the 22 missing provider timestamps include 18:00, 18:02, 18:04–18:09, 18:12–18:15, 18:17–18:25, and 18:27 UTC. The hourly timestamp sets matched from 19:00 through 23:00.
- **November 3 and 4:** Provider and Supabase daily counts and ordered-timestamp hashes matched.

Thus 278 + 697 + 22 = **997 provider-returned candles missing from Supabase**. The first stored BEAM candle in the episode window is 2026-11-02 18:28 UTC. The discrepancy is directly verified against the provider's current historical response; its original ingestion cause is unresolved.

### Other markets and representative no-trade gaps

For each of the other five markets, Supabase and Bitvavo daily candle counts and ordered-timestamp hashes matched for all days in the episode windows. For example, the previously observed WIN-EUR gap from 2026-11-04 23:15 to 2026-11-05 06:18 UTC had no provider candles in those slots either. It is consistent with a no-trade interval, not a missing database write.

## Current-stream spot check

For the complete-minute window **2026-11-05 09:21–10:21 UTC**, Bitvavo and Supabase timestamp counts and hashes matched:

| Market | Bitvavo / Supabase candles | First–last timestamp (UTC) | Result |
|---|---:|---|---|
| BEAM-EUR | 35 / 35 | 09:21–10:17 | Exact timestamp-set match |
| WIN-EUR | 0 / 0 | No candles in the window | Bitvavo confirmed no trades after the 09:18 candle |
| ARX-EUR | 33 / 33 | 09:21–10:20 | Exact timestamp-set match |
| MEGA-EUR | 6 / 6 | 09:27–10:17 | Exact timestamp-set match |
| POL-EUR | 12 / 12 | 09:22–10:17 | Exact timestamp-set match |
| SXT-EUR | 8 / 8 | 09:25–10:20 | Exact timestamp-set match |

WIN-EUR's latest stored candle at 09:18 UTC was about 64 minutes old at the Supabase observation time. Bitvavo returned only that 09:18 candle for the wider 09:18–10:21 UTC query. The 1-minute interval is therefore stale by the AI Engine's 30-minute threshold, but this evidence indicates no trades rather than an ingestion failure. The AI Engine excludes stale intervals; whether the remaining intervals were sufficient for an analysis at that time was not checked in this candle-only audit.

## Data-quality checks

Across the 2,228 stored rows in the six historical windows:

- Stored row counts equaled distinct timestamp counts for every market.
- No timestamps were non-minute-aligned or future-dated.
- No invalid OHLCV rows were found under the repository's basic OHLC consistency checks.

These checks do not compare stored OHLCV values with the provider's historical values; the reconciliation was specifically for candle timestamps and presence.

## Refresh behavior and older-gap recovery

The current scheduled refresh path in [market-data.mjs](../../lib/market-data.mjs):

1. Reads the latest stored timestamp for each selected market/interval.
2. Uses that timestamp as the provider `start`; if no checkpoint exists, it requests a bounded bootstrap.
3. Caps a request at 500 candles and does not paginate backward through time or search for holes before the latest stored timestamp.
4. Upserts returned candles using the `(symbol, interval, timestamp)` conflict key.

The public API comparison observed Bitvavo returning candles newest-first. A start-only request with an old start and `limit=5` returned the five latest candles, not the earliest candles after `start`. Consequently, if a catch-up range contains more than the 500-candle cap, an invocation can receive recent candles while older candles in that range are omitted. Once a newer checkpoint is stored, the refresh path will not discover an older hole on a later invocation. This is a **verified limitation of the current request pattern**, but it is not proof that this mechanism caused the BEAM discrepancy.

The code writes `CANDLE_REFRESH_UNAVAILABLE` when the scheduled checkpoint read fails. The Supabase event query found one matching event, at **2026-11-03 17:00:56 UTC**, with a reason stating that latest stored candle timestamps could not be loaded. It occurred after the BEAM missing segment. The code associates this batch-level checkpoint-read event with the first selected market, so its BEAM symbol does not prove a BEAM-specific failure or explain the earlier gap.

## Operational logs and access limitations

- The cron-job.org console required authentication; execution history for the relevant times was not available in the connected session.
- The Vercel project Logs page opened, but no historical runtime-log rows or usable historical query results were available in the session. Therefore no `/api/candle-refresh` invocation result, response body, per-market outcome, or function failure can be tied to the missing BEAM timestamps.
- Candle rows do not record their ingestion time. The database cannot show when the missing candles were requested, returned, or skipped.
- The Bitvavo comparison used successful public historical GET responses at audit time, not archived provider responses from the original refresh times. It confirms the provider currently has those historical candle timestamps, but cannot prove they were available to a particular past function invocation.
- No other candle intervals were queried for this report. The prior [open-position strategy and data audit](./OPEN_POSITION_STRATEGY_AND_DATA_AUDIT.md) found fresh candles and market snapshots at ARX's key decision times; that earlier result is not a freshness audit for every market and decision.

## Impact assessment

### Decision-time freshness

The AI Engine checks the newest candle timestamp per interval and excludes an interval if that newest candle is too old. It does not mark a whole history stale merely because older rows are missing. Thus a historical hole can coexist with a fresh latest candle; conversely, WIN-EUR's verified no-trade interval leaves its 1-minute interval stale until a new trade produces a candle. The previously audited ARX decision-time freshness result remains valid for those specific decision times, but this comparison does not reconstruct freshness for every historical decision.

### Indicator interpretation

The AI Engine sorts and deduplicates returned candles, then passes close-price arrays into RSI, EMA, MACD, and momentum calculations. It does not resample missing minutes or insert synthetic no-trade candles. The 150-candle history cap is therefore a row-count cap, not a fixed clock-duration window. When trade-produced candles are sparse or ingestion gaps exist, adjacent indicator observations can be separated by unequal amounts of clock time; indicators operate over observed rows, not evenly spaced minutes.

### Historical exit simulations

The 997 missing provider-returned BEAM candles make the price path incomplete for the affected portion of that episode. A simulation cannot reliably infer every local drawdown, stop trigger, or possible fill there. The other five windows have complete timestamp parity with Bitvavo for candles that the provider currently returns, but provider-absent intervals still do not supply a trade price or guaranteed executable fill. This audit does not rerun or recommend exit rules.

## Conclusion and follow-up

The recent 1-minute stream appears consistent with Bitvavo for the six checked markets, including an independently verified no-trade period for WIN-EUR. That is sufficient evidence to continue collecting **paper** data while existing freshness and risk controls remain active; it is not evidence that historical candle coverage is complete or that all scheduled jobs succeeded. No live-trading conclusion is implied.

Recommended follow-up:

1. Obtain cron-job.org execution history and Vercel runtime logs for the BEAM missing period before assigning a root cause.
2. Monitor provider-versus-database timestamp gaps and alert when a historical provider candle is absent from storage, rather than treating every missing minute as a failure.
3. Review the 500-row, newest-first catch-up behavior and consider time-window pagination/backfill that cannot advance the checkpoint past unpersisted earlier candles. Any implementation should be tested for bounded requests, idempotency, and preservation of latest-forming-candle updates.
4. Keep historical exit simulations involving BEAM marked incomplete until the gap is reconciled or explicitly excluded.

## Reproducibility and evidence

The Supabase checks were read-only. For the historical comparison, the query grouped by market and UTC date and computed count, minimum/maximum timestamp, and an MD5 of ordered epoch-millisecond timestamps:

```sql
WITH windows(symbol, entry_at, end_at) AS (
  VALUES
    ('BEAM-EUR', timestamptz '2026-11-01 18:08:12.319890+00', timestamptz '2026-11-04 01:48:12.325485+00'),
    ('WIN-EUR',  timestamptz '2026-11-02 14:13:09.130145+00', timestamptz '2026-11-05 09:50:58.139746+00'),
    ('ARX-EUR',  timestamptz '2026-11-04 11:03:10.131389+00', timestamptz '2026-11-05 09:50:58.139746+00'),
    ('MEGA-EUR', timestamptz '2026-11-04 11:03:10.131389+00', timestamptz '2026-11-05 09:50:58.139746+00'),
    ('POL-EUR',  timestamptz '2026-11-04 11:03:10.131389+00', timestamptz '2026-11-05 09:50:58.139746+00'),
    ('SXT-EUR',  timestamptz '2026-11-04 14:48:11.863757+00', timestamptz '2026-11-05 09:50:58.139746+00')
)
SELECT w.symbol,
       (c.timestamp AT TIME ZONE 'UTC')::date AS utc_day,
       count(*) AS stored_candles,
       min(c.timestamp) AS first_stored,
       max(c.timestamp) AS last_stored,
       md5(string_agg(
         (extract(epoch FROM c.timestamp) * 1000)::bigint::text,
         ',' ORDER BY c.timestamp
       )) AS timestamp_md5
FROM windows w
JOIN public."AI_Crypto_Bot_Candles" c
  ON c.symbol = w.symbol
 AND c.interval = '1m'
 AND c.timestamp > w.entry_at
 AND c.timestamp <= w.end_at
GROUP BY w.symbol, (c.timestamp AT TIME ZONE 'UTC')::date
ORDER BY w.symbol, utc_day;
```

Bitvavo requests used the public endpoint
`GET /v2/{market}/candles?interval=1m&start=...&end=...&limit=1440`.
The 12,640-minute comparison used 10 aligned pages, each no larger than 1,440 minute slots; requests were sequential with at least 1.5 seconds between calls. All 10 returned HTTP 200. Provider timestamps were sorted locally before daily count/hash comparison. A separate exact-hour timestamp comparison was used for BEAM-EUR on November 2, 18:00–18:59 UTC. The current-stream spot check used a 60-minute aligned window and the same count/hash comparison.

The report's prior context and repeated analyses are documented in [CANDLE_REFRESH_COVERAGE_REPORT.md](./CANDLE_REFRESH_COVERAGE_REPORT.md), [CANDLE_REFRESH_EFFICIENCY_AUDIT.md](./CANDLE_REFRESH_EFFICIENCY_AUDIT.md), [OPEN_POSITION_STRATEGY_AND_DATA_AUDIT.md](./OPEN_POSITION_STRATEGY_AND_DATA_AUDIT.md), and [PRODUCTION_HISTORY_CAP_AND_POSITION_EXIT_SIMULATION.md](./PRODUCTION_HISTORY_CAP_AND_POSITION_EXIT_SIMULATION.md). This report adds the direct historical Bitvavo-to-Supabase timestamp reconciliation and the start-only catch-up ordering check.
