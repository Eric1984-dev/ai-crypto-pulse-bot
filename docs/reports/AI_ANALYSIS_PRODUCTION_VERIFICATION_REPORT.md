# AI Analysis Production Verification Report

**Verification date:** 2026-11-02  
**Environment:** Production Vercel logs and live Supabase  
**Latest observed optimized run:** 2026-11-02 13:31 UTC

## Executive Summary

The latest observed production run completed successfully after the runtime optimization. The engine analyzed all **102 enabled markets**, generated and stored **102 decisions**, and completed **612 candle reads**, loading **300,849 candle rows**. Supabase confirms every active market has a corresponding decision, and all 102 decision records contain all six candle intervals. No market was omitted.

The latest engine-reported runtime was **11,484 ms**. Its Vercel start-to-completion log span was **10.103 seconds**. The pre-optimization sample averaged **26.47 seconds** for the same log span, so this run is consistent with the reported improvement. Only one optimized run was present in the retained production log window; a sustained post-deployment average and timeout rate cannot yet be established.

## Latest Production Run

| Metric | Verified value | Evidence |
|---|---:|---|
| Enabled markets | 102 | Production start log and live watched-market table |
| Analyzed markets | 102 | Completion log and 102 `AI market analyzed` events |
| Generated decisions | 102 | 102 `AI decision generated` events |
| Decisions stored | 102 | Completion log and live Supabase decision rows |
| Candle reads | 612 | Completion telemetry (`102 × 6`); the successful run completed without a read failure |
| Candle rows loaded | 300,849 | Completion telemetry |
| Skipped markets | 0 | Derived as 102 active minus 102 analyzed |
| Failed reads | 0 | Inferred from successful completion and no read/timeout/error logs; the system does not emit a separate per-read failure counter |
| Enabled markets without a decision | 0 | Live Supabase set comparison |
| Decisions for disabled or unknown markets | 0 | Live Supabase set comparison |
| Decisions with all six intervals | 102 / 102 | `indicators.dataQuality.candleIntervalsAvailable` in live decision rows |
| Enabled markets missing a snapshot | 0 | Live Supabase query |
| Engine runtime | 11,484 ms | Completion telemetry |
| Vercel start-to-completion span | 10.103 s | 13:31:07.837–13:31:17.940 UTC |

The status singleton was `ACTIVE` with `last_run` at **13:31:17.744 UTC**. The 102 latest decisions were persisted at **13:31:16.752469 UTC**. The latest run's decision distribution was 2 `BUY`, 19 `SELL`, 81 `HOLD`, and 0 `WAIT`.

The run covers every enabled symbol: Supabase reported 102 enabled markets and 102 distinct decision symbols, with zero missing or extra symbols. Production logs contained no error-level records for `/api/ai-analysis` in the queried 30-minute window.

## Before vs. After

| Metric | Before optimization | Latest observed optimized run |
|---|---:|---:|
| Run timestamp | 13:26 UTC | 13:31 UTC |
| Start-to-completion log span | 26.922 s | 10.103 s |
| Engine-reported runtime | Not instrumented | 11.484 s |
| Enabled / analyzed markets | 102 / 102 | 102 / 102 |
| Generated / stored decisions | 102 / 102 | 102 / 102 |
| Candle reads | 612 by the pre-optimization six-interval query design | 612 reported by completion telemetry |
| Candle rows loaded | Not captured in the pre-optimization logs | 300,849 |
| All-six-interval decision coverage | 102 / 102 | 102 / 102 |
| Skipped / omitted markets | 0 / 0 | 0 / 0 |
| Stored decision distribution | 2 `BUY`, 19 `SELL`, 81 `HOLD`, 0 `WAIT` | 2 `BUY`, 19 `SELL`, 81 `HOLD`, 0 `WAIT` |
| Decision rows persisted | 102 | 102 |

The immediately preceding run's decision rows and the latest run's rows have identical symbol sets: zero symbols were lost or newly introduced between them. The live database also confirms that all 102 enabled symbols have snapshots.

The 10.103-second comparison uses the same Vercel start/completion log boundaries as the pre-optimization 26.47-second average. This is a **61.8% reduction** relative to that historical average. The new 11.484-second engine timer begins earlier than the old “analysis started” log, so it is not a like-for-like comparison with the old timing metric.

## Database Write Verification

For both runs, Supabase contains exactly 102 decision rows for 102 distinct symbols. The production completion log reports `decisionsStored: 102`. The engine's existing write path remains one batched decision POST plus the two status PATCH operations; the optimization changed candle-read scheduling, not database writes or persistence logic.

Supabase does not retain a per-run audit record of REST statement counts. Therefore, the persisted decision count is directly verified, while the exact count of HTTP write requests is established from the unchanged engine write path rather than a database request audit log.

## Conclusion

For the latest observed production run, the runtime reduction was achieved **without loss of market or candle-interval coverage**:

- all 102 enabled markets were analyzed;
- all 102 generated decisions were stored;
- all six intervals appear in each decision's coverage metadata;
- all 612 candle reads completed and returned 300,849 rows;
- there were no skipped or omitted markets and no reported failed reads.

The production result is below the 15-second target. This confirms the target for the observed run, but not yet as a sustained average: only one optimized run was available after deployment in the 30-minute log window. Continue monitoring `runtimeMs`, stage timings, timeout/error counts, and Supabase load across additional scheduled runs.

## Sources and Limitations

- Vercel production runtime logs, 2026-11-02 13:04:50–13:34:50 UTC.
- Live Supabase status, watched-market, snapshot, and AI-decision queries.
- The production `candleQueries` metric is derived from enabled-market count multiplied by the six supported intervals. Successful completion and the engine's fail-fast read path establish that the required reads completed; individual per-request success telemetry is not separately logged.
- The pre-optimization candle-row count was not captured, so the comparison verifies unchanged query design and interval coverage rather than an exact before/after row-count match.
