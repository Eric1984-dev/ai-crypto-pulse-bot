# Phase 06 Candle Refresh Coverage Investigation

## Executive finding

Live candle coverage is materially incomplete. At **2026-11-03 12:15:10 UTC**, the database contained 102 enabled watched markets, but 77 markets had no candle interval updated within the prior 24 hours. The other 25 had recent `15m` and `1h` candles only; their `1m`, `5m`, `4h`, and `1d` candles were also stale.

The 25 recently updated markets are exactly the first 25 markets in runtime priority order. This is consistent with only batch indexes `0` through `4` being refreshed for `15m` and `1h`; there is no corresponding recent candle evidence for batches `5` through `20`, or for any batch of the other four intervals. This is strong evidence of a coverage gap, but it does **not** prove which cron-job.org tasks are configured or whether unobserved tasks are missing, misparameterized, failing, or timing out.

The exact scheduler configuration could not be inspected: the repository has no Vercel Cron declaration, and the cron-job.org console required sign-in. No credentials were requested. The root cause is therefore **most likely incomplete or ineffective external scheduler coverage**, with the exact scheduler-side error unverified.

No application code, scheduler settings, strategy, or database data was changed.

## Live candle coverage

The query computed each market's latest stored candle timestamp per interval and compared it with the database query time. `Latest bar range` is the minimum-to-maximum of those per-market latest timestamps, not the full historical candle range.

| Interval | Latest bar range (UTC) | Markets with latest bar older than 24h |
|---|---|---:|
| `1m` | Oct 31 23:43 – Nov 1 07:01 | 102 / 102 |
| `5m` | Oct 31 23:40 – Nov 1 07:00 | 102 / 102 |
| `15m` | Oct 31 23:30 – Nov 3 12:00 | 77 / 102 |
| `1h` | Oct 31 23:00 – Nov 3 12:00 | 77 / 102 |
| `4h` | Oct 31 20:00 – Nov 1 04:00 | 102 / 102 |
| `1d` | Oct 31 00:00 – Nov 1 00:00 | 102 / 102 |

Coverage groups:

- **25 markets with exactly two intervals fresher than 24 hours:** `BTC, ETH, SOL, XRP, ADA, LTC, BCH, XLM, AVAX, DOT, ATOM, ALGO, HBAR, NEAR, XTZ, ICP, POL, ARB, OP, IMX, STRK, LINK, GRT, FIL, ENS` — all `-EUR`, and the fresh intervals are `15m` and `1h`.
- **77 markets with no interval fresher than 24 hours:** `1INCH, AAVE, ACU, ADX, ALICE, ARX, AUDIO, AXS, AZTEC, BEAM, BILL, BNT, CAP, CHR, CNPY, COMP, COTI, CRO, CRV, CTC, DRIFT, ENJ, ENSO, EURC, FUN, GALA, GLMR, GRASS, HEI, HNT, IKA, INJ, IQ, JASMY, JTO, LDO, LMWR, LRC, LSK, MAGIC, MASK, MEGA, MIOTA, MLN, MON, MORPHO, MOVR, NOM, OGN, ORCA, PHA, PIXEL, PTB, QNT, RENDER, RON, SAND, SEI, SKY, SLX, SNX, STRAX, SUI, SXT, SYN, TIA, TOWNS, TRAC, UNI, USDC, VELO, WIN, XAI, XDC, XPL, XYO, ZIG` — all `-EUR`.

The 25 recent markets occupy ranks 1–25 in the endpoint's priority/symbol ordering:

| Inferred batch | Markets |
|---:|---|
| `0` | BTC, ETH, SOL, XRP, ADA |
| `1` | LTC, BCH, XLM, AVAX, DOT |
| `2` | ATOM, ALGO, HBAR, NEAR, XTZ |
| `3` | ICP, POL, ARB, OP, IMX |
| `4` | STRK, LINK, GRT, FIL, ENS |

This rank-to-batch mapping is an inference from persisted coverage and the current batch algorithm, not a scheduler execution log. **BEAM-EUR is stale on all six intervals**; its latest bars are `1m` Nov 1 07:01, `5m`/`15m`/`1h` Nov 1 07:00, `4h` Nov 1 04:00, and `1d` Nov 1 00:00 UTC.

## Scheduler inventory and expected coverage

| Job type | Repository-defined endpoint | Scheduler configuration verified? |
|---|---|---|
| Market snapshots | `GET /api/market-refresh` | No |
| Candle refresh | `GET /api/candle-refresh?interval=<interval>&batch=<index>` | No |
| AI analysis | `POST /api/ai-analysis` | No |
| Paper-trading execution | `POST /api/paper-trading` | No |

The repository documents external scheduling for these jobs. `vercel.json` has no `crons` configuration, and the Supabase application schema does not retain external scheduler task definitions or successful candle-refresh run history. The latest stored market snapshot was captured at **2026-11-03 12:10:20 UTC** across 102 stored snapshot rows; that is snapshot data evidence, not proof of a particular scheduler invocation.

The candle endpoint accepts one interval and one zero-based batch per request, with batches of five markets. With 102 eligible markets, complete coverage requires **21 batch indexes (`0`–`20`) for each of six intervals**, or **126 distinct interval/batch combinations** per full coverage cycle. The exact eligible count is determined after Bitvavo catalog validation, so the endpoint's returned `batchCount` is authoritative for each run.

From the live data, the combinations with recent persisted candle evidence are consistent with:

- `15m`: batches `0`–`4` recently refreshed; batches `5`–`20` have no recent evidence.
- `1h`: batches `0`–`4` recently refreshed; batches `5`–`20` have no recent evidence.
- `1m`, `5m`, `4h`, and `1d`: no batch has recent candle evidence.

These are **observed-data inferences**, not a verified list of configured or executed jobs. The data cannot distinguish a missing task from a wrong query parameter, an obsolete URL, repeated failures, an upstream/storage issue, or a request that returned successfully without advancing the stored data.

## Refresh execution evidence

- **Last successful candle-refresh execution:** not determinable from Supabase. Candle rows store bar timestamps, not ingestion timestamps. No successful invocation ledger is persisted in the application tables.
- **Latest candle data evidence:** `15m` and `1h` bars reach Nov 3 12:00 UTC, but this timestamp is not an execution timestamp and does not prove that the configured batch cycle is still running.
- **Last market snapshot evidence:** latest stored `captured_at` is Nov 3 12:10:20 UTC. `/api/market-refresh` only refreshes snapshots; it does not refresh candles.
- **Persisted candle failures:** four scanner events were recorded around Nov 1 06:32 UTC: GALA `1m` and XDC `1h`, `4h`, and `1d` storage failures. These confirm some failed candle work at that time, but do not explain the subsequent widespread lack of coverage.

## Can HTTP 200 still leave candles stale?

**Yes.** The handler returns HTTP 200 whenever the service resolves, without requiring the returned internal status to be `refreshed`. The service can resolve with statuses such as `partial`, `provider-unavailable`, or `storage-unavailable`; the scheduler must inspect response data and failure counts, not only the HTTP code.

There is an additional freshness blind spot: the candle refresh marks a nonempty, valid parsed response as `refreshed` after upserting it, but does not check that the newest returned candle timestamp advances beyond the stored timestamp or meets an age limit. Re-upserting old but structurally valid bars can therefore produce an apparently successful result while leaving the market's latest candle stale.

The AI Engine likewise validates candle timestamps for parseability and validates OHLCV shape, but it does not reject candles based on age. Its freshness limit applies to market snapshots (15 minutes), not candle data. Fresh ticker snapshots therefore do not establish that the technical-analysis inputs are fresh.

## Answers and root-cause assessment

1. **Why do only 25 markets show recent candles?** Their priority ranks map exactly to five batches. Only these first five batches have recent `15m`/`1h` data; no other interval has recent coverage.
2. **Which scheduler jobs are configured?** The repository documents the four endpoint types above, but the live external task list is not available. The cron-job.org console required sign-in, and no scheduler configuration or run history was accessible.
3. **Which batch indexes are executing?** Persisted data is consistent with indexes `0`–`4` for `15m` and `1h`. No current execution can be asserted; there is no recent evidence for batches `5`–`20` or other intervals.
4. **Which interval jobs are missing?** Recent data is absent for all `1m`, `5m`, `4h`, and `1d` market/batch combinations, and for `15m`/`1h` outside the first 25 markets. Whether those tasks are missing or failing is unknown.
5. **Does cron-job.org cover every required combination?** This cannot be verified without its task list and run history. The observed data is inconsistent with complete successful coverage.
6. **Can HTTP 200 still leave candles stale?** Yes, through internal non-success statuses and through nonempty data that does not advance candle timestamps.
7. **Is there a scheduler configuration error?** An external coverage/configuration problem is the leading hypothesis, not a confirmed root cause. The precise error cannot be identified from database candle rows alone.

**Conclusion:** candle ingestion is demonstrably incomplete; the most plausible operational cause is missing or ineffective interval/batch scheduling, compounded by success reporting that is not a freshness guarantee. The specific cron-job.org configuration error remains unverified. Until all interval/batch combinations show advancing candle timestamps and scheduler response statuses are checked, recent AI decisions should not be considered trustworthy as current technical analysis merely because market snapshots or HTTP requests are fresh/successful.

## Evidence and source references

- Live Supabase: watched markets, latest candle timestamps by market/interval, latest market snapshot, and scanner error events. Snapshot query time: **2026-11-03 12:15:10 UTC**.
- [Scheduling requirements](../SCHEDULING.md#phase-06-candle-refresh) and [Phase 06 batching report](./PHASE_06_CANDLE_BATCHING_REPORT.md#scheduler-setup).
- [Batch ordering and selection](../../lib/market-data.mjs#L386), [batch count/slicing](../../lib/market-data.mjs#L455), and [candle fetch/upsert status](../../lib/market-data.mjs#L660).
- [Candle refresh HTTP response](../../api/candle-refresh.mjs#L65) and [success logging](../../api/candle-refresh.mjs#L102).
- [AI candle normalization and snapshot freshness](../../lib/ai-engine.mjs#L382).
- [Vercel configuration](../../vercel.json) contains no Cron declaration.
