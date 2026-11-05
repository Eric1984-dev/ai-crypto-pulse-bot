# AI Candle RPC Compact Payload Assessment

## Result

A compact, additive RPC was implemented locally because representative fixture measurements showed meaningful response-size reduction while preserving every candle field and its ordering. The new function is `AI_Crypto_Bot_Get_Latest_AI_Candles_Compact`; the existing flat-row function remains available so the migration can be applied before the matching caller is deployed without breaking the currently deployed caller.

No production migration, deployment, scheduler change, market setting, trading threshold, database-data change, or live-trading change was made. Paper Trading behavior and `ENABLE_LIVE_TRADING` are unchanged.

## Production call and row metrics

The read-only Vercel runtime-log query was:

```text
vercel logs runtime --since 24h --environment production --query 'AI analysis completed' --limit 10000 --json --non-interactive
```

Records were filtered to production `/api/ai-analysis` completions, deduplicated by request ID and message, then grouped by deployment. In the latest deployment group, observed from `2026-11-05 12:21:13.976Z` through `2026-11-05 13:51:14.123Z`:

| Metric | Per successful run | 19-run total |
|---|---:|---:|
| Analyzed markets / decisions stored | 102 / 102 | 1,938 / 1,938 |
| Logical market-interval reads | 612 | 11,628 |
| Actual candle RPC queries | 156 | 2,964 |
| Candles loaded | 91,674 | 1,741,806 |
| Failed reads | 0 | 0 |

The 156 queries per run match `ceil(102 / 4) × 6`. The 91,674 loaded candles are below the 91,800 maximum (`102 × 6 × 150`) because some markets have fewer stored candles.

At `2026-11-05 13:47:51.703718 UTC`, the read-only `pg_stat_statements` query returned 2,808 calls and 2,808 rows for the normalized PostgREST RPC statement; the statistics had reset at `2026-11-03 20:54:18.859601 UTC`. The count matches 18 completed runs of 156 RPC calls by that observation time. `pg_stat_statements.rows` is the PostgREST wrapper's aggregate result-row count, not the number of candle rows or HTTP response bytes.

Read-only function metadata showed that the current database has the original `TABLE(symbol, interval, open, high, low, close, volume, timestamp)` RPC, configured as `SECURITY INVOKER` with an empty search path and executable by `service_role`, but not `anon` or `authenticated`. The compact RPC was not present. Vercel and Supabase project identity were not independently cross-checked, so the matching counters are consistency evidence, not proof of project identity.

The SQL used to obtain the statement counters was:

```sql
SELECT
  pg_catalog.clock_timestamp() AT TIME ZONE 'UTC' AS observed_at_utc,
  info.stats_reset AT TIME ZONE 'UTC' AS stats_reset_utc,
  stats.calls,
  stats.rows,
  stats.query
FROM extensions.pg_stat_statements AS stats
CROSS JOIN extensions.pg_stat_statements_info AS info
WHERE stats.query ILIKE '%AI_Crypto_Bot_Get_Latest_AI_Candles%'
ORDER BY stats.calls DESC
LIMIT 10;
```

The function metadata query was:

```sql
SELECT
  proc.proname,
  pg_catalog.pg_get_function_result(proc.oid) AS result_type,
  proc.prosecdef AS security_definer,
  proc.proconfig AS function_settings,
  pg_catalog.has_function_privilege('anon', proc.oid, 'EXECUTE') AS anon_can_execute,
  pg_catalog.has_function_privilege('authenticated', proc.oid, 'EXECUTE') AS authenticated_can_execute,
  pg_catalog.has_function_privilege('service_role', proc.oid, 'EXECUTE') AS service_role_can_execute
FROM pg_catalog.pg_proc AS proc
WHERE proc.pronamespace = 'public'::regnamespace
  AND proc.proname IN (
    'AI_Crypto_Bot_Get_Latest_AI_Candles',
    'AI_Crypto_Bot_Get_Latest_AI_Candles_Compact'
  )
ORDER BY proc.proname
LIMIT 5;
```

## Fixture response-size comparison

The local Node fixture contains four markets (`BTC-EUR`, `ETH-EUR`, `AAVE-EUR`, and `DOGE-EUR`), 150 candles per market for each of the six intervals, realistic timestamp spacing and varied OHLCV values. Each interval is serialized as its own response, matching the six production RPC calls for one four-market batch. Decoded sizes use UTF-8 `JSON.stringify` bytes. Gzip sizes use `node:zlib` `gzipSync` at level 6 on each response independently, then sum the six sizes.

| Payload shape | Decoded JSON bytes | Gzip bytes (level 6) | Decoded reduction | Gzip reduction |
|---|---:|---:|---:|---:|
| Current flat rows (`symbol`, `interval`, five OHLCV/time fields) | 740,238 | 166,799 | baseline | baseline |
| Flat objects without repeated `interval` | 682,038 | 167,221 | 7.86% | -0.25% |
| Explicit symbol groups with six-value candle tuples | 436,242 | 145,497 | 41.07% | 12.77% |
| Symbol-keyed object with six-value candle tuples | 435,738 | 145,231 | 41.14% | 12.93% |

The selected explicit-group shape is marginally larger than the symbol-keyed object, but makes market identity and group-order validation straightforward. A round-trip assertion compared all 3,600 candle records, including symbol, interval, timestamp, and every OHLCV value, with exact fixture equality and descending timestamp order.

These are local fixture byte counts, not measured production body bytes, billed egress, cost, or CPU savings. Production `Content-Encoding` and exact decoded/wire response sizes could not be obtained safely. No small production sample request was made because the configured service URL/service-role credential and the intended project identity were unavailable for a verified request. Neither `Content-Length` nor `Content-Range` was treated as response size.

## Local implementation and equivalence

The additive migration returns at most four top-level rows per interval, one per requested symbol. Each `candles` JSON array contains at most 150 newest-first tuples ordered as `[timestamp, open, high, low, close, volume]`; a symbol with no history receives an empty array. The caller already knows the symbols and interval, reconstructs the existing row shape, and fails closed on missing groups, wrong symbol order, invalid tuple width, excessive per-symbol history, or incomplete `Content-Range`.

The query keeps the existing per-symbol index lookup and `LIMIT 150`, validates the active watched-market contract, and remains `SECURITY INVOKER` with an empty search path. Execute permission is revoked from `PUBLIC`, `anon`, and `authenticated`, and granted only to `service_role`. The PGlite regression compares all candle fields against legacy selection across two distinguishable markets and all six intervals, tests empty histories and invalid/excessive inputs, and checks permissions for both RPCs. AI Engine tests verify compact decoding and fail-closed handling; decision fixtures continue to match the existing calculations.

No API route, dependency, table, or Vercel Function was added. The Vercel Function count remains 12. The compact response requires hosted PostgREST `max_rows >= 4`; keep the current `max_rows >= 600` prerequisite until all callers have moved off the original flat-row RPC. Do not lower or change the hosted setting as part of this work.

## Validation

| Command | Result |
|---|---|
| `node --test tests/ai-engine.test.mjs tests/database-migrations.test.js` | Passed: 50 tests, 0 failures |
| `npm.cmd test -- --test-reporter=dot` | Passed: full suite exited 0 |
| `npm.cmd run build` | Passed: static project and database migration validation |
| `git diff --check` | Passed |

## Rollout

1. Confirm the intended Supabase project identity and its hosted `max_rows`; do not change the setting.
2. Apply the additive compact-RPC migration first and verify the function's signature, security mode, empty search path, enabled-market checks, and service-role-only grants.
3. Deploy the matching caller only after the new RPC is available. The old RPC remains in place for compatibility during the sequence.
4. Keep `max_rows >= 600` until no deployed caller uses the legacy flat-row RPC. The compact RPC itself only needs at least four top-level rows.
5. Compare analysis success, `candleQueries`, and `candlesLoaded` after rollout; investigate any mismatch or incomplete-response error before proceeding.

Neither the migration nor deployment was performed during this assessment.
