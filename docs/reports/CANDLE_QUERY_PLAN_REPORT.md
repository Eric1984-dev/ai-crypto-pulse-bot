# Candle Query Plan Audit

**Scope:** Read-only live Supabase query-plan analysis. No index or other database change was made.

## Executive finding

The AI Analysis candle query uses the existing unique B-tree index on `(symbol, interval, timestamp)`. Across representative four-market requests for all six intervals, PostgreSQL selected an **Index Scan** and, where needed, a bounded **Incremental Sort**. It did not choose a Bitmap Index Scan or Sequential Scan.

For a first page limited to 1,000 rows, the index scan emitted **1,001–1,501 tuples** to the sort/limit node, which returned **1,000 rows**. The one-symbol plan read and returned 1,000 rows using a backward scan of the same index with no sort. The observed plans were warm-cache plans: buffer counts showed shared hits and no shared disk reads.

**No additional index is recommended.** The current index efficiently narrows by symbol and interval. The remaining incremental sort is small; an additional descending or covering index would duplicate substantial index storage and add write/maintenance cost to a frequently upserted table. The larger cost is the volume and fan-out of the analysis reads, not a table scan or missing lookup index.

## Query examined

The query mirrors [the AI Analysis candle read](../../lib/ai-engine.mjs#L728): selected OHLCV fields, a set of up to four symbols, one interval, `symbol ASC, timestamp DESC`, and a 1,000-row page. For example:

```sql
SELECT symbol, interval, open, high, low, close, volume, timestamp
FROM public."AI_Crypto_Bot_Candles"
WHERE symbol IN ('BTC-EUR', 'ETH-EUR', 'SOL-EUR', 'XRP-EUR')
  AND interval = '1m'
ORDER BY symbol ASC, timestamp DESC
LIMIT 1000 OFFSET 0;
```

`EXPLAIN (ANALYZE, BUFFERS, VERBOSE)` was run against this shape for each supported interval. The one-symbol comparison used `symbol = 'BTC-EUR'` and `1m`.

## Live plan results

The “index scan rows” column is the actual row count emitted by the Index Scan node before the sort and limit. “Returned” is the Limit node’s actual row count for that first page.

| Interval | Plan | Index scan rows | Returned | Scan-node shared buffers | Execution time |
|---|---|---:|---:|---:|---:|
| `1m` | Index Scan + Incremental Sort | 1,469 | 1,000 | 371 hits | 198.1 ms |
| `5m` | Index Scan + Incremental Sort | 1,096 | 1,000 | 146 hits | 111.7 ms |
| `15m` | Index Scan + Incremental Sort | 1,501 | 1,000 | 502 hits | 330.3 ms |
| `1h` | Index Scan + Incremental Sort | 1,125 | 1,000 | 174 hits | 123.3 ms |
| `4h` | Index Scan + Incremental Sort | 1,031 | 1,000 | 48 hits | 50.9 ms |
| `1d` | Index Scan + Incremental Sort | 1,001 | 1,000 | 51 hits | 49.9 ms |
| `1m`, one symbol | Backward Index Scan; no sort | 1,000 | 1,000 | 362 hits | 140.7 ms |

These are individual live plan executions, not a sustained benchmark. The buffer results indicate cache hits for the tested pages; they do not prove all production queries will remain cache-resident. Execution time varied across runs, so it should not be extrapolated as a guaranteed per-request latency.

The multi-symbol plan’s `Incremental Sort` uses the index’s presorted `symbol` key and sorts within symbol groups by descending timestamp. It used approximately 33–243 KiB in the reported plans, with no disk spill. For one symbol, PostgreSQL scans the ascending timestamp key backward, satisfying descending timestamp order directly.

## Index verification and effectiveness

The live database has:

```text
AI_Crypto_Bot_Candles_symbol_interval_timestamp_key
  UNIQUE BTREE (symbol, interval, timestamp)
```

This is the same key created by the original schema migration ([migration definition](../../PostgreSQL/migrations/20261031190000_create_agent_tables.sql#L106)). It is also the candle upsert conflict key.

Live index statistics showed:

- **2,631,709** scans on the composite index
- **397,888,911** index tuples read and **361,622,506** heap tuples fetched (cumulative PostgreSQL statistics)
- Composite index size: **26 MiB**
- Candle table total size: **112 MiB**, with approximately **394,000** current rows

The EXPLAIN plans show both equality filters in the index condition. The scan does not walk the whole 394k-row table; it visits a small selected range for the requested symbols/interval and stops after the page can be produced.

## Would another index help?

No material improvement is demonstrated by these plans.

- A second index with `timestamp DESC` might remove the small per-symbol incremental sort for multi-symbol requests. The existing index already provides the selective lookup and presorted symbol order, and the sort is in memory with low memory use.
- A covering index including all selected OHLCV columns could reduce some heap access, but would substantially enlarge the index and increase write amplification for the ongoing candle upserts.
- A duplicate or overlapping index would add storage, cache pressure, and maintenance work to every refresh without addressing the number of rows transferred or requests made.

The index is used effectively for the query’s filtering. No additional index is justified by the measured plans.

## Actual workload and likely bottleneck

The query is paginated: the engine groups up to four markets per interval and limits each REST page to 1,000 rows. The plans above describe only one page; if the group contains more rows, the engine issues further pages and may narrow the active symbol list as symbols reach their 1,000-row cap.

The production verification report measured **612 logical market/interval reads and 300,849 candle rows loaded** for one 102-market analysis run. That is a large amount of data and REST response processing even though each database page uses the index. The engine allows up to 24 candle reads concurrently. The code-level runtime optimization reduced waiting between reads but did not reduce the number of histories or rows analyzed ([runtime optimization report](./AI_ANALYSIS_RUNTIME_OPTIMIZATION_REPORT.md)).

The most likely bottleneck is therefore **aggregate read workload and request/data-transfer overhead**: hundreds of market/interval reads, additional pagination where needed, and parsing/processing roughly 300k candle rows per run. It is not a Sequential Scan caused by the missing index. The measured plan timings also include a warm-cache sample and do not isolate network, PostgREST, or application-side JSON processing.

## Answers

1. **Scan type:** Index Scan for every four-symbol plan; the single-symbol query uses Index Scan Backward. Multi-symbol requests use Incremental Sort. No Bitmap Index Scan or Sequential Scan appeared.
2. **Rows scanned:** 1,001–1,501 at the Index Scan node for the tested first pages; 1,000 for the one-symbol first page.
3. **Rows returned:** 1,000 per tested first page, bounded by the query limit.
4. **Existing index:** Yes. Both symbol and interval appear in the Index Cond; cumulative index statistics show extensive use.
5. **Additional index:** No additional index is justified. Any possible sort reduction is small relative to index/write/storage overhead.
6. **Real bottleneck:** Total query fan-out, pagination, and candle-row transfer/processing across 612 logical market/interval reads—not a full-table scan.

The query-plan audit was read-only. No tests were run because no code changed, and no index was created.
