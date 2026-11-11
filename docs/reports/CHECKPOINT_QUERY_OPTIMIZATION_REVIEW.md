# Candle Refresh Checkpoint Query Optimization Review

**Review date:** 2026-11-04  
**Status:** Review only; no code or database changes made  
**Production query-plan sample:** First five enabled markets, `1m` interval, read-only `EXPLAIN (ANALYZE, BUFFERS)`

## Executive verdict

The checkpoint can be moved to a database-side latest-per-symbol lookup without changing candle refresh behavior. The strongest option is **Option C: one read-only Supabase RPC implemented as a `LATERAL` lookup per requested symbol**, using the existing unique index on `(symbol, interval, timestamp)`.

The important distinction is that returning fewer rows is not by itself enough. On the live sample:

- The current query returned 2,000 rows to the application after scanning 10,491 matching index entries.
- `DISTINCT ON` and `GROUP BY MAX(timestamp)` each returned five rows, but still scanned the same 10,491 entries.
- The lateral per-symbol `ORDER BY timestamp DESC LIMIT 1` plan returned five rows using five backward index probes and touched 21 shared buffers, rather than about 2,736 execution buffers for the current/aggregate plans.

The prior efficiency audit's estimate of about **19.36 million checkpoint rows returned/day** can therefore be reduced to about **47,224 latest timestamps/day** under the same scheduler, a theoretical **99.76% reduction in rows returned**. The lateral plan also demonstrates a reduction in database-side scan work, not just network payload. This is a representative, warm-cache plan sample, not a production-wide latency guarantee.

## 1. Lookup location, callers, and related logic

### Direct call chain

There is one production caller of `getLatestStoredCandles()`:

1. `/api/candle-refresh` validates the request and calls `refreshScheduledCandleBatch()`.
2. `refreshScheduledCandleBatch()` selects the enabled, tradable-EUR markets for the requested batch.
3. It calls `getLatestStoredCandles(config, serviceRoleKey, selectedMarkets, [interval])`.
4. `getLatestStoredCandles()` builds a map keyed by `symbol:interval`; the refresh workers use the map to decide whether to skip or fetch an incremental range.

The function's default interval list is all supported intervals, but the only current caller explicitly supplies a one-element array. The implementation therefore makes one checkpoint query per scheduler invocation, for its requested interval only.

### Current Supabase checkpoint query

For up to five selected symbols, the function issues a PostgREST `GET` against `AI_Crypto_Bot_Candles` with:

```text
select=symbol,timestamp
symbol=in.(...)
interval=eq.<requested interval>
order=timestamp.desc
limit=2000
```

`DB_ROW_LIMIT` is 2,000. The response is not a one-row-per-market result: it may contain up to 2,000 historical rows for those symbols. The application parses each timestamp and retains the greatest valid timestamp in the map for each `symbol:interval`.

When the initial response contains rows, any selected symbol absent from the returned rows is queried separately with the same symbol and interval filters, descending timestamp order, and `limit=1`. This handles a symbol whose records fell beyond the shared 2,000-row cap. If the initial response is entirely empty, the function returns an empty map; the refresh workers then use the existing bootstrap path.

### Correctness of the current grouping

The candle table enforces uniqueness on `(symbol, interval, timestamp)`. Because the initial result is globally ordered by timestamp descending, if any row for a symbol appears before the 2,000-row limit, that symbol's newest row appears before its older rows and is therefore also in the response. If no row for a selected symbol appears, the missing-symbol fallback retrieves that symbol's latest row. Thus, for valid stored rows, the current combination of global ordering, per-symbol maximum, and fallback yields the actual latest timestamp for every symbol with data.

A database-side latest-per-symbol query returns the same map values directly. It also removes dependence on the 2,000-row response cap and fallback condition.

### Dependent freshness and AI reads

After lookup, `refreshScheduledCandleBatch()` applies the same timestamp-age check:

- If `now - latestTimestamp < intervalDuration`, it counts the symbol as `unchanged` and does not call Bitvavo.
- Otherwise it sets the provider request's `start` to the stored latest timestamp and computes the gap-sized `limit`, bounded by the existing maximum.
- Starting at the latest timestamp intentionally overlaps that candle so the provider can revise it.

The AI Engine is a separate consumer. It independently reads candle OHLCV rows, retains up to 1,000 per symbol/interval, and applies its own candle freshness thresholds before indicator analysis. It does not call `getLatestStoredCandles()`.

## 2. Existing index and live plan comparison

The table's unique constraint creates the existing B-tree index on `(symbol, interval, timestamp)`. No additional index is required for the recommended lookup: equality on `symbol` and `interval`, followed by descending timestamp with `LIMIT 1`, can use a backward scan of the existing index.

The following plans were executed read-only against the live database for the first five enabled symbols (`BTC-EUR`, `ETH-EUR`, `SOL-EUR`, `XRP-EUR`, `ADA-EUR`) at `1m`. Timings are one execution on a warm cache; buffer counts and actual rows are more useful here than elapsed time alone.

| Shape | Rows returned to SQL caller | Rows scanned/processed | Execution buffers | Observed execution time | Plan |
|---|---:|---:|---:|---:|---|
| Current ordered query, `LIMIT 2000` | 2,000 | 10,491 | 2,736 shared hits | 28.29 ms | Index Only Scan, then top-N Sort |
| A. `DISTINCT ON (symbol)` | 5 | 10,491 | 2,736 shared hits | 31.94 ms | Index Only Scan, Incremental Sort, Unique |
| B. `GROUP BY symbol, MAX(timestamp)` | 5 | 10,491 | 2,736 shared hits | 18.11 ms | Index Only Scan, GroupAggregate |
| C/D. Per-symbol lateral `LIMIT 1` | 5 | 5 index rows (5 loops) | 21 shared hits | 0.37 ms | Five backward Index Only Scans |

The current query does use the composite index for filtering, but it does not stop after finding each market's latest row. The `DISTINCT ON` and aggregate forms also use that index, yet still read every matching row in this sample. The lateral plan is the only tested form that stops at one index entry per symbol.

## 3. Alternative evaluation

### Option A — PostgreSQL `DISTINCT ON`

Representative SQL:

```sql
SELECT DISTINCT ON (symbol) symbol, "timestamp"
FROM public."AI_Crypto_Bot_Candles"
WHERE symbol = ANY (p_symbols)
  AND "interval" = p_interval
ORDER BY symbol, "timestamp" DESC;
```

- **Correctness:** Returns the latest row per symbol. Timestamp ties cannot occur for the same symbol/interval because of the unique constraint.
- **Index usage:** Uses the existing composite index for filtering and symbol ordering, but the live plan added an Incremental Sort and scanned all 10,491 matching entries.
- **Expected row reduction:** Five rows instead of as many as 2,000 per batch; about 99.76% fewer application-returned checkpoint rows at the audited daily volume. The measured plan did not reduce rows scanned or execution buffers.
- **Complexity:** Low SQL complexity; moderate integration complexity because PostgREST query parameters do not expose SQL `DISTINCT ON`. It would need an RPC or a database object.
- **Supabase compatibility:** Compatible inside a PostgreSQL function/RPC. Do not assume it can be expressed by the current `/rest/v1/<table>` request.
- **Behavior preservation:** Yes, if the result is translated to the same `symbol:interval` map and missing symbols remain absent.

### Option B — `GROUP BY symbol, MAX(timestamp)`

Representative SQL:

```sql
SELECT symbol, max("timestamp") AS "timestamp"
FROM public."AI_Crypto_Bot_Candles"
WHERE symbol = ANY (p_symbols)
  AND "interval" = p_interval
GROUP BY symbol;
```

- **Correctness:** Returns the same maximum timestamp for each symbol with stored rows.
- **Index usage:** The live plan used the existing index via Index Only Scan followed by GroupAggregate. It still processed all 10,491 matching entries; `MAX()` did not result in one index read per group.
- **Expected row reduction:** Five result rows and the same approximate 99.76% reduction in response rows. No meaningful scan/buffer reduction in the tested plan.
- **Complexity:** Simple SQL, but it still needs an RPC or a database-side aggregate facility enabled and supported by the Supabase/PostgREST deployment.
- **Supabase compatibility:** Straightforward in a PostgreSQL RPC. Direct aggregate syntax through PostgREST is configuration/version-dependent and should not be assumed.
- **Behavior preservation:** Yes, with identical null/missing-symbol handling.

### Option C — Supabase RPC

Recommended implementation shape: a read-only RPC accepting the selected symbols and interval, and using a `LATERAL` subquery for each requested symbol:

```sql
SELECT requested.symbol, latest."timestamp"
FROM unnest(p_symbols) AS requested(symbol)
LEFT JOIN LATERAL (
  SELECT c."timestamp"
  FROM public."AI_Crypto_Bot_Candles" AS c
  WHERE c.symbol = requested.symbol
    AND c."interval" = p_interval
  ORDER BY c."timestamp" DESC
  LIMIT 1
) AS latest ON true;
```

- **Correctness:** The lateral lookup returns the same latest timestamp per requested symbol. A null result must be omitted from the JavaScript map, matching the current no-history behavior.
- **Index usage:** The live plan used the existing composite index in a backward scan, one row per symbol, with five loops and 21 shared hits. No extra index is indicated by this lookup.
- **Expected row reduction:** At most one result per selected market; approximately 47,224 rows/day instead of 19.36 million at the audited cadence. The live sample also reduced scanned entries from 10,491 to five.
- **Complexity:** Moderate: requires a versioned database migration, function parameter/return types, API-side RPC call, grants, and tests. It adds no Vercel Function and requires no scheduler change.
- **Supabase compatibility:** Native PostgreSQL and callable through the Supabase RPC endpoint. The caller already uses the service-role key. A future function should use a pinned search path, fully qualified table names, read-only behavior, and narrowly scoped execution grants.
- **Behavior preservation:** Yes, if it returns timestamps only and maps null results to no checkpoint. This is the preferred option because it reduces both returned rows and measured database scan work.

### Option D — Existing indexed-query variation

Issue a separate PostgREST request for each selected symbol:

```text
select=symbol,timestamp
symbol=eq.<symbol>
interval=eq.<interval>
order=timestamp.desc
limit=1
```

- **Correctness:** Each request directly returns the latest timestamp for that symbol; an empty response means no stored history.
- **Index usage:** Equality on the leading index columns and descending timestamp can use the existing index backward. The live lateral plan demonstrates the expected index path.
- **Expected row reduction:** Same five returned rows and roughly 99.76% fewer returned rows. The query plan should examine only the latest index entry per market.
- **Complexity:** Low database complexity, but it changes one PostgREST checkpoint request per scheduler invocation into up to five requests.
- **Supabase compatibility:** Uses the existing table REST API and needs no migration.
- **Behavior preservation:** Yes, if every market is queried and empty results remain absent from the map.
- **Trade-off:** At the audited volume, it would increase checkpoint HTTP requests from about 9,722/day to as many as 48,610/day. That is an undesirable request-volume and latency trade unless the platform has a specific reason to avoid an RPC.

## 4. Explicit behavior-preservation checks

| Behavior | Preserved by a latest-per-symbol lookup? | Required invariant |
|---|---|---|
| Candle selection | **Yes** | Keep the same enabled/tradable market list, priority/symbol ordering, batch, and requested interval. |
| Freshness detection | **Yes** | Return the same maximum stored timestamp per symbol; leave the interval-duration comparison and AI freshness rules unchanged. |
| Incremental catch-up | **Yes** | Feed the same timestamp into the existing elapsed-time calculation and retain its limit formula and cap. |
| Overlap protection | **Yes** | Continue setting provider `start` to the latest stored timestamp, not timestamp plus interval. |
| Bootstrap behavior | **Yes** | A symbol with no candle rows must still have no checkpoint so the existing bootstrap request is selected. |
| AI inputs/calculations | **Yes** | Do not alter candle rows, AI queries, candle limits, freshness thresholds, or indicator calculations. |
| Scheduler behavior | **Yes** | Keep the same `/api/candle-refresh?interval=…&batch=…` contract, response shape, job cadence, and batch count. The RPC is internal to the existing Vercel Function. |
| Error behavior | **Yes, with parity handling** | RPC errors must flow through the existing checkpoint-read failure path and return the same `storage-unavailable` result; do not silently substitute an empty map. |

The RPC approach requires a database migration if implemented, but this review creates none. The migration and function must follow the project's prefixed naming and grant conventions.

## 5. Existing tests and validation needed before implementation

Existing market-data tests cover bounded batches, the incremental provider `start`/`limit`, the too-recent timestamp skip, bootstrap behavior, provider/storage failures, and the 60-second cache. They do not appear to explicitly cover a large multi-symbol checkpoint response crossing the 2,000-row limit or prove parity of the per-symbol fallback.

Before deploying an implementation, add/execute focused tests that:

1. Compare the old lookup result and RPC result for multiple historical timestamps across five symbols.
2. Cover a symbol with no history, a batch with no history at all, and a symbol omitted by the old global cap.
3. Verify identical provider `start` and `limit` values for every symbol before and after the lookup change.
4. Verify that too-recent checkpoints still skip Bitvavo, while stale checkpoints still use the same freshness and catch-up behavior.
5. Verify the RPC error is surfaced through the existing storage failure response and does not turn into bootstrap behavior.
6. Confirm the production query plan continues to use one bounded backward index probe per requested symbol after migration.

## Recommendation

**Proceed with Option C only after separate implementation approval:** a single, read-only, narrowly granted Supabase RPC using `LATERAL` plus `ORDER BY timestamp DESC LIMIT 1` per selected symbol. It best satisfies the objective because it preserves the current checkpoint values while avoiding the full-history scan shown by the production plan.

`DISTINCT ON` and `GROUP BY MAX` are correct but did not reduce index rows scanned in the live plan. Five per-symbol REST queries are correct and indexed, but would multiply Supabase HTTP requests. No code, migration, scheduler, or AI behavior was changed as part of this review. Tests were not run because this was a review-only task.

## Sources

- [Checkpoint and batch implementation](../../lib/market-data.mjs#L386), [checkpoint lookup](../../lib/market-data.mjs#L599), [incremental refresh and overlap](../../lib/market-data.mjs#L519), and [merge-duplicates upsert](../../lib/market-data.mjs#L689).
- [Existing candle-refresh API caller](../../api/candle-refresh.mjs#L67).
- [AI candle fetch and freshness rules](../../lib/ai-engine.mjs#L18), [freshness predicate](../../lib/ai-engine.mjs#L432), and [separate candle reader](../../lib/ai-engine.mjs#L698).
- [Candle uniqueness constraint](../../PostgreSQL/migrations/20261031190000_create_agent_tables.sql#L86).
- [Incremental-range test](../../tests/market-data.test.mjs#L987) and [too-recent checkpoint skip test](../../tests/market-data.test.mjs#L1031).
- [Candle Refresh Efficiency Audit](./CANDLE_REFRESH_EFFICIENCY_AUDIT.md) for the scheduler-derived daily row-volume estimate.
