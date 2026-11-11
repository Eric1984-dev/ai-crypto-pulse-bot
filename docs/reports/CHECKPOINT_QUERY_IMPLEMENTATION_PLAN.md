# Candle Refresh Checkpoint Query Implementation Plan

**Status:** Approved optimization; implementation not started  
**Scope:** Plan only. No code, migration, database, scheduler, or deployment changes were made.

## Objective and recommendation

Replace the historical-row checkpoint read in `getLatestStoredCandles()` with a single read-only Supabase RPC that returns the latest saved candle timestamp for each requested symbol using a correlated `LATERAL` lookup:

```sql
ORDER BY candle."timestamp" DESC
LIMIT 1
```

The RPC will use the existing unique index on `(symbol, interval, timestamp)`. The refresh endpoint, market batches, interval selection, provider requests, upserts, AI reads, and scheduler jobs remain unchanged.

The production query-plan sample in the [optimization review](./CHECKPOINT_QUERY_OPTIMIZATION_REVIEW.md) returned five rows using five backward index probes. Under the scheduler/data snapshot in the [efficiency audit](./CANDLE_REFRESH_EFFICIENCY_AUDIT.md), checkpoint rows returned are estimated to decrease from about 19.36 million/day to 47,224/day (approximately 99.76% fewer). This is an estimate, not a deployment guarantee or billed Disk IO measurement.

## 1. Files and code locations

| Location | Planned change |
|---|---|
| `lib/market-data.mjs` | Replace the table GET and per-symbol fallback in `getLatestStoredCandles()` with one authenticated RPC request. Map returned `symbol` and `latest_timestamp` into the existing `symbol:interval` timestamp map. Preserve error propagation into the existing checkpoint-read failure handler. No changes to refresh-worker calculations. |
| `PostgreSQL/migrations/<timestamp>_candle_checkpoint_rpc.sql` | Add the versioned SQL function, restrict execution permissions, and wrap the migration in a transaction. The filename is illustrative; no migration is created in this plan. |
| `tests/market-data.test.mjs` | Extend the Supabase mock to recognize the RPC request and cover timestamp-map parity, missing history, large historical data, failures, and unchanged downstream provider arguments. |
| `tests/database-migrations.test.js` | Load and apply the new migration in the PGlite setup; assert function behavior, read-only permissions, and grant restrictions. |
| `README.md`, `ROADMAP.md`, `CHANGELOG.md`, `docs/DATABASE.md`, `docs/SCHEDULING.md`, and `docs/API.md` | Update only the directly related implementation/status and operational details after implementation. The candle-refresh URL and public API contract remain unchanged. |

### Locations that should not need changes

- `api/candle-refresh.mjs`: the existing endpoint continues to call `refreshScheduledCandleBatch()` and return its current response.
- `lib/ai-engine.mjs`: AI candle reads, freshness thresholds, and calculations are independent of this checkpoint lookup.
- `vercel.json` and cron-job.org: no new Vercel Function, endpoint, scheduler task, or schedule change.
- `scripts/validate-database.js`: it discovers and validates all SQL migration files automatically; verify this remains true, but no change is expected.

The existing RPC call style in `lib/paper-trading.mjs` and `api/dashboard-data.mjs`, plus the existing migration pattern in `PostgreSQL/migrations/20261102120000_trade_history_stats.sql`, should be followed.

## 2. RPC design

### Name and signature

```text
public."AI_Crypto_Bot_Get_Latest_Candle_Checkpoints"
```

Parameters:

| Parameter | Type | Meaning |
|---|---|---|
| `p_symbols` | `text[]` | Symbols in the already-selected refresh batch; normally no more than five. |
| `p_interval` | `text` | The single interval already validated by the candle-refresh endpoint. |

Return shape:

```text
TABLE (
  symbol text,
  latest_timestamp timestamptz
)
```

Return one row for each requested symbol that has candle history. Symbols without history are omitted, matching the current JavaScript map's absent-key behavior and preserving the bootstrap path. An empty symbol array returns zero rows. The caller maps each returned timestamp to the existing `symbol:interval` key.

### Query strategy

The function should deduplicate non-null requested symbols defensively and, for each one, perform an indexed latest-row lookup equivalent to:

```sql
SELECT candle."timestamp"
FROM public."AI_Crypto_Bot_Candles" AS candle
WHERE candle.symbol = requested.symbol
  AND candle."interval" = p_interval
ORDER BY candle."timestamp" DESC
LIMIT 1
```

Use `CROSS JOIN LATERAL` so symbols without candle history produce no result row. Validate `p_interval` against `1m`, `5m`, `15m`, `1h`, `4h`, and `1d`; invalid input must raise an error, not return an empty result that could be mistaken for missing history. Use ordinary parameterized SQL; do not construct dynamic SQL.

### Permissions and hardening

- `LANGUAGE plpgsql STABLE SECURITY INVOKER`.
- Pin `search_path` to the empty path (`SET search_path = ''`) and schema-qualify `public."AI_Crypto_Bot_Candles"` and `pg_catalog` objects.
- The function must contain only read operations. `STABLE` and a SQL body that performs only `SELECT`/`RETURN QUERY` prevent it from modifying database state.
- Revoke execution from `PUBLIC`, `anon`, and `authenticated`; grant execution only to `service_role`, which is already the checkpoint reader's caller.
- Do not use `SECURITY DEFINER`; no privilege escalation is needed.
- Do not log request credentials or include them in the function arguments.

## 3. Migration requirements

Create one new timestamped SQL migration; do not edit an already-applied migration. The migration should:

1. Use `BEGIN`/`COMMIT`.
2. Create the prefixed function with the signature and hardening above.
3. Explicitly revoke default/public execution and grant only `service_role`.
4. Avoid `IF NOT EXISTS`, consistent with the repository's migration rule that schema conflicts fail visibly.
5. Add no table, column, index, trigger, or Vercel Function. The existing unique candle index is sufficient for the lateral lookup.
6. Be exercised by the migration test setup and local build's database validation before deployment.

The database function is a Supabase RPC surface, not a new `/api` route. The existing API-function count remains unchanged.

## 4. API integration

In `lib/market-data.mjs`, replace the current checkpoint GET with a single POST to:

```text
/rest/v1/rpc/AI_Crypto_Bot_Get_Latest_Candle_Checkpoints
```

Send JSON parameters:

```json
{
  "p_symbols": ["BTC-EUR", "ETH-EUR"],
  "p_interval": "1m"
}
```

Use the existing service-role authorization headers, `cache: "no-store"`, and the repository's existing request timeout/error conventions. Validate that the response is an array of rows with a string symbol and parseable `latest_timestamp`. An invalid shape or timestamp must raise a storage error; it must not be treated as an empty map.

Keep the current call `getLatestStoredCandles(config, serviceRoleKey, selectedMarkets, [interval])`. The helper may be simplified to the one-interval caller shape, but do not change its behavior for an empty batch. Avoid adding fallback GETs: the RPC itself must return all available requested symbols.

If the RPC call fails, let it flow through the existing `refreshScheduledCandleBatch()` checkpoint-read catch. That path marks the result `storage-unavailable`, sets failure/skipped metrics, records the existing failure event where possible, and does not issue Bitvavo requests or candle writes. Preserve the endpoint's current HTTP/JSON contract; do not add a success-shaped empty-result fallback.

## 5. Behavior-preservation invariants

| Behavior | Invariant to preserve |
|---|---|
| Candle selection | Use the same enabled, Bitvavo-valid ordered markets, batch index, and interval. The RPC only replaces how the latest stored timestamp is found. |
| Freshness detection | Return the same maximum stored `timestamp` per symbol. Leave `now - latestTimestamp`, the interval-duration comparison, and all AI freshness limits unchanged. |
| Incremental catch-up | Leave the existing gap-sized `limit` formula and maximum candle limit unchanged. |
| Overlap protection | Continue passing the exact latest stored timestamp as provider `start`; do not increment it by one interval. The latest candle must remain eligible for provider correction. |
| Bootstrap behavior | A symbol with no checkpoint row must still enter the existing no-`start` bootstrap request with the existing maximum limit. |
| Scheduler behavior | Keep the same endpoint, query parameters, batch size, response shape, cadence, and job coverage. No scheduler changes are included. |
| Error handling | RPC transport, status, JSON, or schema failures must use the existing checkpoint storage-failure path and stop provider work for that batch. |
| AI inputs | Do not modify the candle table contents or AI Engine queries, 1,000-row cap, freshness rules, indicators, decisions, or confidence calculations. |

## 6. Required tests and validation

### Application parity tests — `tests/market-data.test.mjs`

1. **Parity:** Seed several timestamps for each of five symbols and assert the checkpoint map equals the per-symbol maximum from the legacy lookup.
2. **No history:** Cover a fully empty batch and a partially populated batch. Confirm symbols with no rows remain absent and use the existing bootstrap path.
3. **More than 2,000 rows:** Seed more than 2,000 rows across the requested symbols, including uneven history depths. Confirm each symbol's true latest timestamp is returned, including one whose history would have invoked the legacy missing-symbol fallback.
4. **Downstream request parity:** Compare provider `start` and computed `limit` for fresh, stale, and too-recent timestamps. Assert the latest-timestamp overlap remains unchanged.
5. **RPC failure:** Cover network rejection, non-2xx response, invalid JSON, malformed response rows, and invalid timestamp. Assert the result follows `storage-unavailable`, emits no Bitvavo candle request, and writes no candle rows.
6. **Single RPC:** Assert one checkpoint RPC call per interval/batch and no fallback table GETs.

### Migration tests — `tests/database-migrations.test.js`

- Apply the checkpoint migration after the base schema in the PGlite test setup.
- Verify latest-per-symbol results, empty/no-history behavior, interval rejection, and no side effects.
- Verify `service_role` can execute it while `anon`, `authenticated`, and `PUBLIC` cannot.
- Confirm function volatility/security/search-path settings where the test engine exposes them.

### Build, tests, and query plan

Run the focused market-data and migration tests, then `npm test` and `npm run build`. Against staging before production, run `EXPLAIN (ANALYZE, BUFFERS)` for the RPC body or equivalent lateral query over representative small and full five-market batches for all supported intervals. Confirm one bounded backward index probe per symbol, at most five returned rows, no full-history scan, and no material regression in duration or buffers.

At production rollout, smoke-test the RPC with the service-role caller using a known batch, verify returned checkpoints against a direct read-only per-symbol `ORDER BY timestamp DESC LIMIT 1` comparison, then confirm ordinary scheduled refreshes still return the expected status and candle counts. Do not treat HTTP 200 alone as proof that the refresh succeeded.

## 7. Rollout and rollback

### Rollout order

1. Review and test the additive migration locally.
2. Apply the migration to the target Supabase environment and verify the function signature, grants, and PostgREST RPC discovery/schema cache.
3. Run a read-only RPC smoke test with the service-role identity; verify the result against direct per-symbol indexed reads.
4. Deploy the application change to the existing `/api/candle-refresh` function.
5. Monitor checkpoint errors, `storage-unavailable` results, provider calls, batch coverage, `start`/`limit` behavior, candle advancement, and endpoint duration.
6. Do not change scheduler configuration during the rollout; this isolates the query change.

### Rollback strategy

If RPC calls fail or parity is in doubt, redeploy the previous application version that uses the table GET. Leave the new function in place during rollback: it is additive and unused by the restored code. Confirm the previous checkpoint read, incremental candles, and freshness behavior recover. Remove the function only later, if desired, with a separate reviewed migration after no deployed version calls it; do not edit or reverse an already-applied migration in place.

This sequence keeps rollback independent of candle data and scheduler configuration.

## 8. Risk estimates

| Risk area | Estimate | Basis and controls |
|---|---|---|
| Implementation risk | **Low to medium** | The map contract and downstream refresh logic are small and isolated. Main risks are RPC response parsing, missing-symbol handling, and error mapping; parity and failure tests address these. |
| Deployment risk | **Medium** | Requires migration availability, correct role grants, and PostgREST function discovery before code calls the RPC. Apply the migration first, smoke-test it, then deploy code; do not change cron cadence at the same time. |
| Rollback risk | **Low** | The change is additive. Reverting the application restores the old query without changing candles or schedules; retain the unused RPC until a separate cleanup decision. |
| Performance risk | **Low, subject to verification** | Live sample plans show bounded index probes and fewer buffers, but production plans/cache conditions can vary. Verify per interval and representative batch sizes before rollout. |

## Sources

- [Checkpoint implementation review](./CHECKPOINT_QUERY_OPTIMIZATION_REVIEW.md).
- [Candle refresh service](../../lib/market-data.mjs), [existing candle-refresh endpoint](../../api/candle-refresh.mjs), and [AI Engine candle reader](../../lib/ai-engine.mjs).
- [Existing service-role RPC call pattern](../../lib/paper-trading.mjs) and [existing `SECURITY INVOKER` migration pattern](../../PostgreSQL/migrations/20261102120000_trade_history_stats.sql).
- [Market-data tests](../../tests/market-data.test.mjs), [migration tests](../../tests/database-migrations.test.js), [database validation script](../../scripts/validate-database.js), [database docs](../DATABASE.md), and [scheduling docs](../SCHEDULING.md).
