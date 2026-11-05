# Supabase External API Request Audit

**Review date:** 2026-11-05<br>
**Scope:** Read-only repository and production-data review. Only this report was created; no code, database, migration, Vercel, or scheduler settings were changed. Tests were not run.

## Executive summary

The reported **approximately 96K Supabase requests cannot be assigned to a measurement period or verified against Vercel data in this review**. The supplied counts have no start/end time, and no Vercel Observability export containing hostname, path, method, and calling function was available. Code review identifies the likely callers, but it does not establish how many of the reported requests each function made.

The strongest request-count opportunity is to **combine the successful per-market candle upserts made by one existing `/api/candle-refresh` invocation into a single bulk POST**. If the reported 26K candle POSTs and 5.3K checkpoint RPC calls are from the same window and nearly every batch writes five markets, this would reduce candle POSTs by up to about **20.7K (79.6%)**, without changing candle rows or adding a Vercel Function. It widens the write-failure domain from one market to one batch, so it requires failure-isolation and retry validation before implementation.

An AI candle RPC could reduce request count too, but requires a database migration and careful per-symbol latest-150 selection. A five-to-ten market refresh batch would reduce only batch-level calls—not candle GETs or per-market candle POSTs—and remains a separate, previously unapproved change.

## Evidence and limits

### Measurement period and attribution

The 96K total and endpoint counts in the task are treated as **user-provided estimates**, not independently verified measurements. The period is unknown. The available repository reports contain Vercel samples from different windows; none can be joined to the 96K counts. Those samples must not be added together or used as if they were the same window.

No same-window Vercel data was available to confirm:

- The exact Supabase hostname and requests by hostname, endpoint, and method.
- The measurement period and whether the endpoint figures sum to the 96K total.
- The calling Vercel Function for each request.
- Per-function request counts, retries, or failed requests.

The code-path mapping below is therefore verified from repository source; the count attribution is not. Supabase REST paths identify the table/RPC, but the project hostname cannot be confirmed from the accessible evidence.

### Production snapshot available during review

Read-only Supabase checks at **2026-11-05 09:11–09:13 UTC** confirmed:

| Observation | Result | What it establishes |
|---|---:|---|
| Enabled watched markets | 102 | Current market-universe size at query time |
| Candle rows | 475,567 | Current table size, not rows fetched or written during the reported request window |
| Latest complete AI-decision batch | 102 markets / 612 timeframe records | Production decisions existed for all six intervals and all enabled markets |
| Recorded candle input count | 91,674 total; 150 maximum per market/interval; 56 minimum | The 150-candle cap was active for this production decision batch |
| Checkpoint RPC | Present | The deployed database contains `AI_Crypto_Bot_Get_Latest_Candle_Checkpoints` |

The 91,674 figure is summed from persisted per-decision `indicators.timeframes[*].candleCount`. It is **not** a Supabase HTTP response-row counter and does not establish network bytes or database rows scanned. The `pg_stat_statements` views were not accessible through the available SQL interface, so no time-bounded SQL execution counts were obtained.

## Endpoint-to-code-path mapping

| Supabase request | Likely Vercel Function / code path | Traffic type and evidence |
|---|---|---|
| `GET /rest/v1/AI_Crypto_Bot_Candles` | `POST /api/ai-analysis` → `lib/ai-engine.mjs` → `fetchCandlesForMarkets()` | Scheduled AI-analysis traffic. Current code groups four markets per interval, uses a 1,000-row REST page size, retains the newest 150 per market/interval, and can issue additional pages for uneven/deep histories. For 102 markets and six intervals, the base is 26 groups × 6 = **156 GETs per complete run**, before extra pages. Other candle readers also contribute. |
| `GET /rest/v1/AI_Crypto_Bot_Candles` | `GET /api/market-summary` and `GET /api/market` → scanner or market detail reads in `lib/market-data.mjs` | Dashboard/scanner and on-demand market traffic. Scanner queries can page historical candles; market detail reads the requested interval. Their shares of the reported 57K are unknown. |
| `POST /rest/v1/AI_Crypto_Bot_Candles` | `/api/candle-refresh` → `lib/market-data.mjs` `refreshCandles()` → `writeDatabaseRows()` | Scheduled ingestion. Current code upserts each successfully refreshed market separately using conflict key `(symbol, interval, timestamp)`. The latest stored candle is deliberately overlapped so a forming candle can be updated. |
| `POST /rest/v1/AI_Crypto_Bot_Candles` | `GET /api/market` → selected-interval refresh/upsert in `lib/market-data.mjs` | Occasional authenticated, on-demand market detail traffic; not scheduled candle-refresh traffic. |
| `GET /rest/v1/AI_Crypto_Bot_Watched_Markets` | `/api/candle-refresh`, `/api/ai-analysis`, `/api/market-refresh`, dashboard-data and market endpoints | Mixed scheduled and user-driven traffic. Candle refresh reads the universe for each batch invocation; AI analysis reads it per run; dashboard and market functions also use it. The 5.8K cannot be split among these callers from available evidence. |
| `POST /rest/v1/rpc/AI_Crypto_Bot_Get_Latest_Candle_Checkpoints` | `/api/candle-refresh` → `getLatestStoredCandles()` | Scheduled candle-refresh checkpoint lookup. One RPC call is made for a non-empty batch. It replaces the prior historical candle-row scan; it does not replace or combine the subsequent per-market upserts. |

Relevant entry points are [`api/candle-refresh.mjs`](../../api/candle-refresh.mjs), [`api/ai-analysis.mjs`](../../api/ai-analysis.mjs), [`api/market-refresh.mjs`](../../api/market-refresh.mjs), [`api/dashboard-data.mjs`](../../api/dashboard-data.mjs), [`api/market-summary.mjs`](../../api/market-summary.mjs), and [`api/market.mjs`](../../api/market.mjs). Shared request behavior is in [`lib/market-data.mjs`](../../lib/market-data.mjs) and [`lib/ai-engine.mjs`](../../lib/ai-engine.mjs).

## Optimizations already active or previously evaluated

| Area | Current evidence/status |
|---|---|
| Candle-refresh cadence | The latest available Vercel sample in [`CANDLE_REFRESH_CPU_OPTIMIZATION_AUDIT.md`](./CANDLE_REFRESH_CPU_OPTIMIZATION_AUDIT.md) observed 4,849 invocations in 12 hours, extrapolated to about 9,698/day. The recommended reduced cadence was about 9,723/day. This suggests earlier scheduler reductions took effect; the external scheduler configuration was not inspected in this review. |
| Checkpoint lookup | The checkpoint RPC is present in production and used by the current refresh path. It reduces checkpoint response rows and replaces the old up-to-2,000-row REST scan per batch. It does not reduce candle writes. See [`CHECKPOINT_RPC_POST_DEPLOYMENT_REPORT.md`](./CHECKPOINT_RPC_POST_DEPLOYMENT_REPORT.md). |
| AI history / batching | Current code and the 09:11 UTC production decision batch confirm a 150-candle cap. Current code groups four markets per interval and has a 1,000-row REST page size; these are separate controls. The 150 cap does not imply the server returns only 150 rows per HTTP request. |
| Candle-refresh market batch size | Current repository code uses five markets per invocation. At 102 markets this is 21 batches per interval. The expansion to ten was assessed as **B: more validation required** in [`BATCH_SIZE_10_VALIDATION.md`](./BATCH_SIZE_10_VALIDATION.md); it was not implemented by this audit. |
| Upserts and pagination | Refresh writes are idempotent upserts by `(symbol, interval, timestamp)`, one POST per successfully refreshed market. AI candle queries use a 1,000-row page and per-symbol/interval ordering; scanner reads have separate pagination. No same-window production count of pages or rows is available. |
| Function count | The candidate approaches below reuse existing Vercel endpoints. An AI RPC would be a database function/migration, not a new Vercel API route. Do not add a new `/api` route for this work. |

The historical AI runtime report [`AI_ANALYSIS_RUNTIME_OPTIMIZATION_REPORT.md`](./AI_ANALYSIS_RUNTIME_OPTIMIZATION_REPORT.md) describes the earlier 612-per-market/interval request shape. It predates the current four-market grouping; **156 is the current base-query estimate**, not 612.

## Candidate comparison

Estimates below are conditional. The 96K endpoint counts have no confirmed time window. Request reduction is kept separate from row volume, database work, latency, Active CPU, and cost.

| Candidate | Current call source | Estimated Supabase request reduction | Candle/AI data impact | Risk | Evidence |
|---|---|---|---|---|---|
| **Bulk candle upsert per refresh invocation** | `/api/candle-refresh`; currently up to one candle-table POST for each refreshed market | Up to **80%** of refresh candle POSTs if five market writes become one batch POST. If the reported 26K POSTs and 5.3K checkpoint calls share one window and represent nearly full five-market batches: approximately **26K → 5.3K**, saving **20.7K (79.6%)**. | Same validated candle rows, conflict key, and OHLCV values. No expected reduction in rows submitted or database upsert work; request payloads grow. | One invalid/transient batch write can delay all successful markets in that batch rather than one market. Retry, per-market event/status accounting, request payload, and partial-refresh behavior need validation. | **High** for current per-market write pattern; **medium** for realized savings because refreshed-market count and same-window counts are unknown. |
| **AI candle batch RPC** | `/api/ai-analysis`; current base is 156 GETs per 102-market run | A table-valued RPC returning at most 150 rows for each of six markets would need 17 calls/interval × 6 = **102 RPC calls/run**, saving **54 requests/run (34.6%)** versus the 156 base. At an assumed 5-minute cadence: about **15,552 fewer calls/day** (54 × 288), before extra current pagination. | Preserve all 91,674 recorded candle inputs for the observed batch. A correctly implemented per-symbol top-150 query could also avoid REST overfetch, but row bytes and database work are not measured. | Requires a new prefixed database function and migration. Must preserve per-market latest ordering, interval/symbol isolation, freshness evaluation, validation, stable result shape, and bounded payload. A large aggregate response or global limit risks omitted markets or excess DB memory/CPU. | **High** for current query grouping and observed cap; **low/medium** for projected RPC behavior until SQL, payload, and production query plans are validated. |
| **Increase candle-refresh batch size 5→10** | `/api/candle-refresh` market-universe selection and checkpoint lookup | Batch count 21→11 per interval: **47.6% fewer** invocations, watched-market reads associated with refresh, and checkpoint RPC calls. If the 5.3K RPC count is from the same period, estimated RPCs become ~2.78K, saving ~2.52K. If those calls account for 5.3K of the 5.8K watched-market reads, the combined watched-market total would fall illustratively to ~3.28K, not 2.78K. | No expected change to candle rows, per-market provider requests, or per-market POST count. AI candle GETs are unchanged. | Scheduler must switch every interval to indices 0–10; larger invocation/failure scope and timeout tail are unvalidated. | **High** for arithmetic/source pattern; **low** for 96K-window attribution. Prior validation verdict remains B. |
| **Skip unchanged overlap writes** | Candle refresh deliberately starts at latest saved timestamp and upserts overlapping candles | No reliable reduction in HTTP requests established. Skipping database updates alone reduces DB writes, not necessarily POST count. Skipping the whole POST needs a comparison or conditional-write mechanism; a separate comparison read can erase request savings. | Must still write a changed forming candle and any legitimate provider correction. Compare all OHLCV fields, not just timestamp. | `ignore-duplicates` would discard valid changes to a forming candle. Current checkpoint RPC returns timestamps, not prior OHLCV values. | **High** for overlap behavior; **low** for unchanged frequency and request savings. |
| **Further cadence reduction / staggering** | External scheduler → existing refresh function | Staggering changes peak concurrency, **not** total request count. A cadence reduction would lower refresh invocations but also delays data updates; no same-window request-to-freshness relationship is available. | Could increase candle staleness and delay new/changed candle ingestion. | Candle freshness impacts and scheduler configuration are not revalidated for this request. | **Low** for request savings without unacceptable freshness impact. |
| **Cache or combine watched-market reads** | Multiple scheduled and dashboard/market callers | No safe aggregate estimate. Removing one refresh market read per invocation could reduce only that source; a process cache is not shared reliably across serverless invocations. | Cache could serve a stale active market universe and violate the runtime source-of-truth contract. | Market additions/disables may not be observed promptly; consolidating reads couples unrelated endpoints. | **Low**; no production traffic split or invalidation evidence. |

## Candidate analysis

### 1. Bulk candle upserts

The current worker validates provider candles and calls the database writer once per successful market. A bulk write can reuse the existing table, conflict columns, and merge-duplicates behavior. It needs no new database object or Vercel route.

The estimate `26,000 - 5,300 = 20,700` assumes the two user-provided figures cover the same period, every counted checkpoint call corresponds to one non-empty refresh invocation, and each such invocation produces close to five candle POSTs. Those assumptions are plausible from the code shape but are not confirmed by the counts. With partial batches, fewer writes, retries, or endpoint traffic from market detail, actual savings differ.

Bulk payloads should include only validated rows from successful market jobs. Failure handling must be designed explicitly: a batch POST creates a wider failure domain, and should not be described as preserving per-market isolation without a demonstrated fallback/retry strategy. This is the best first implementation-review candidate because it has the largest estimated request reduction and does not require schema or scheduler changes.

### 2. AI candle RPC

The current AI reader uses four-market groups and a 1,000-row page size, then retains up to 150 newest candles per market/interval. The 150 cap is production-observed, but the REST page size still permits overfetch; actual response rows and additional page count were not available.

A safe first RPC design would return a **table-shaped, bounded result** for no more than six symbols and one interval per call, selecting each symbol's newest 150 rows inside PostgreSQL. That limits the returned set to 900 rows, below a 1,000-row response page, and avoids a new Vercel function. It must return every requested symbol independently; a global `LIMIT 900` without per-symbol ranking is not equivalent. A single unbounded JSON aggregate for all 102 markets is not recommended without measured response-size and database-memory tests.

This changes HTTP request count, not the underlying need to identify the same candle inputs. Exact rows scanned, query plan, RPC CPU, latency, and payload bytes require a migration test and a controlled production comparison.

### 3. Five-to-ten refresh batches

With 102 active markets, each interval changes from 21 to 11 batch invocations. The checkpoint RPC and watched-market selection are batch-level and should fall accordingly. Each market still needs its own provider fetch when due and currently its own upsert POST, so this does not explain or directly reduce the reported 26K candle POSTs. The earlier validation identifies scheduler completeness, larger error scope, and tail duration as unresolved.

### 4. Unchanged overlap writes

The latest candle is intentionally included in the provider range so its OHLCV can be updated while forming. Timestamp-only deduplication is therefore unsafe. Reliable suppression requires comparing the complete values or using a conditional database write. If done inside a database RPC, it could avoid unnecessary row updates, but unless it combines multiple markets it does not necessarily reduce external HTTP requests. The count of unchanged overlapping rows is unknown.

## Request estimates and interpretation

| Metric | Baseline / candidate estimate | What it does **not** establish |
|---|---|---|
| Candle refresh batches | 21→11 per interval; 47.6% fewer batch invocations | Does not reduce due-market Bitvavo requests or per-market POSTs |
| Bulk candle POSTs | Up to five POSTs→one per refresh invocation; 0–80% reduction depending on successful markets | Does not reduce rows submitted, database upsert work, Active CPU, or cost by the same percentage |
| AI candle GETs | 156 base GETs/run→102 bounded RPCs/run; 34.6% fewer base calls | Does not prove actual production request delta, row bytes, Postgres CPU, latency, or billed usage |
| AI recorded candle inputs | 91,674 in the latest observed 102-market batch | Does not equal wire rows received or rows scanned |
| Candle refresh invocations/day | Latest separate Vercel sample: ~9,698/day extrapolated from 12 hours | Cannot be reconciled to the 96K total or used as its period |

No Active CPU or cost savings are projected from request counts alone. Network request overhead may fall with fewer calls, but bulk payload size, retries, database work, and RPC query cost can change independently.

## Risks and required validation

Before any implementation:

1. Export a single fixed Vercel Observability window with project hostname, path, method, function, status, and request count; retain timestamps and timezone.
2. Verify whether the supplied endpoint counts all use that same window and whether they include failed/retried requests.
3. For bulk upsert, compare old/new payload row counts and values; test duplicate-key merge behavior, one-market failure, one invalid row, transient write failure, retries, metrics, and scanner-event attribution.
4. For an AI RPC, add a prefixed migration; verify latest-150 equivalence across all 102 markets and six intervals, uneven per-symbol history, empty/invalid rows, ordering, freshness, and the 1,000-row response bound. Compare query plans, function execution time, payload size, and errors before production rollout.
5. For batch-size expansion, update and verify all scheduled batch indices for every interval; measure invocation duration and partial-failure behavior before approval.
6. During rollout, compare request counts **and** row counts, freshness, retry rates, Active CPU, and database query work. Do not treat fewer Observability events as proof of less database work or lower cost.

All changes must keep `ENABLE_LIVE_TRADING=false` and remain within the current Paper Trading phase.

## Missing production data

- The start/end timestamp, timezone, and Vercel project/environment for the 96K observation.
- Same-window Vercel Observability export by hostname, endpoint, method, status, and calling Function.
- Request IDs or traces linking each Supabase call to its invoking Function.
- Per-function route invocation totals, retries, failures, and dashboard/market-detail traffic.
- AI Analysis completion logs with actual `candleQueries`, rows returned, and bytes per run.
- Candle-refresh interval/batch metrics, refreshed markets, per-market writes, response rows, and retry outcomes.
- Current scheduler job list and run history for all interval/batch combinations.
- Same-window Active CPU and any database-level query/row/IO metrics.
- The unchanged-overlap rate and frequency of forming-candle revisions.

## Conclusion

**Recommendation:** review a bulk candle upsert first, with explicit batch-wide failure handling. It is the strongest schema-free opportunity and has a conditional upper estimate of roughly 20.7K fewer candle POST events per reported window. Treat that figure as a hypothesis until same-window function attribution is available. An AI candle RPC may save additional read requests but needs migration-level validation; batch size 10 reduces only refresh setup/checkpoint calls and is not yet approved.
