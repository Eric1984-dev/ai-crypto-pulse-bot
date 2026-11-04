# AI Analysis Profiling Plan

**Date:** 2026-11-04  
**Scope:** Design-only instrumentation plan for `/api/ai-analysis`. No code, database, scheduler, or deployment changes were made.

## Objective

Attribute the AI Analysis workload to retrieval, parsing, calculations, decision generation, and persistence. The instrumentation must be diagnostic only: it must not change candle inputs, freshness checks, indicator formulas, confidence, decisions, persistence shape, or paper-trading behavior.

## Current evidence and measurement limits

- Current production context identifies `/api/ai-analysis` as the largest Vercel Active CPU consumer and `/api/candle-refresh` as second. This plan accepts that observation; it does not independently query Vercel.
- A verified 102-market run in the production verification report processed 300,849 candle rows. A later history-depth audit recorded 385,659 fetched rows for a separate 102-market run. Row volume varies; both establish that parsing and analysis handle hundreds of thousands of rows per run.
- The engine uses six candle intervals, queries up to four markets per candle request, paginates where required, and allows up to 24 concurrent candle requests. Logical market/interval reads must not be reported as actual HTTP request counts.
- Existing `timingMs.candleLoad` includes fetching and response decoding; `timingMs.decisionGeneration` wraps the full per-market `analyzeMarket` call. Neither currently separates the requested internal stages.
- `performance.now()` measures elapsed time, not CPU time. In particular, candle retrieval wall time includes network and Supabase waits. Stage elapsed time alone cannot be presented as Vercel Active CPU.

The 300,849-row sample is documented in [AI Analysis Production Verification](./AI_ANALYSIS_PRODUCTION_VERIFICATION_REPORT.md); the later 385,659-row sample and history distribution are in [AI History Depth Audit](./AI_HISTORY_DEPTH_AUDIT.md). The current broad timing boundaries and bounded query design are documented in [AI Analysis Runtime Optimization](./AI_ANALYSIS_RUNTIME_OPTIMIZATION_REPORT.md).

## Instrumentation design

Use the existing completion log as the single successful per-run profiling event. Measure stage durations with `performance.now()` and collect per-request or per-market samples in memory; emit aggregate counts, totals, averages, p95, and maxima rather than one log record per request, market, or interval. Calculate percentiles from the samples for that run using a documented nearest-rank method. Retain the current `runtimeMs` and broad timing fields for continuity, and add clearly named substage metrics rather than redefining existing fields silently.

Retrieval and parsing boundaries should be made explicit in the shared candle-read path: time the fetch and full response-body read as retrieval, then time JSON decoding separately. Separately time candle normalization, validation, deduplication, and ordering inside the analysis path. If an implementation keeps `response.json()`, the body transfer and JSON decoding remain inseparable and must be labeled as a combined metric rather than misrepresented as retrieval-only.

The calculation stages execute synchronously within each market analysis. Record per-stage elapsed samples around the existing calculation blocks. Also capture process CPU deltas around synchronous calculation blocks where the deployed Node runtime supports them, but label these as process-level estimates: they are not guaranteed to be invocation-attributable if a function instance performs concurrent work. Use Vercel's per-invocation Active CPU metric as the authoritative total where the deployment plan exposes it; do not infer Active CPU by subtracting retrieval wall time from total duration.

## Stage measurements

| Stage | Expected cost (hypothesis, not a measured breakdown) | Metrics to capture | Implementation location | Logging strategy |
|---|---|---|---|---|
| **1. Candle retrieval** | Likely the largest elapsed-time stage because it makes many Supabase REST reads with bounded concurrency. Network and database wait are expected to dominate this stage's wall time; this does not imply equivalent CPU use. | Total wall span for all candle retrieval; per-request elapsed samples (average, p95, max); request count; response-body bytes; page count; timeout/error count. Preserve both aggregate request time and overall wall span because requests overlap. | `fetchCandlesForMarkets` and the candle-specific request path in `fetchRows` in [`lib/ai-engine.mjs`](../../lib/ai-engine.mjs). Time request/response-body acquisition before JSON decoding. | Include `candleRetrieval` aggregates in the completion event. Do not log request URLs with credentials, candle contents, or a record per request. Include partial counters and elapsed times in the failure event. |
| **2. Candle parsing** | Expected to be a substantial CPU contributor because hundreds of thousands of rows may be decoded and normalized. Exact share is currently unknown. | JSON decode elapsed time; normalization/validation/deduplication/sort elapsed time; rows decoded, accepted, rejected, and deduplicated; bytes decoded. Keep JSON decoding distinct from domain normalization. | JSON decoding in the candle response path in `fetchRows`; domain parsing in `normalizeCandles` / `normalizeCandle` called by `analyzeMarket` in [`lib/ai-engine.mjs`](../../lib/ai-engine.mjs). | Emit per-run total/average/p95/max for per-response decode and per-market normalization samples, plus aggregate row counts. Avoid symbol-level logs. |
| **3. Indicator calculation** | Expected to be meaningful CPU work: each market evaluates up to six intervals, and EMA/MACD calculations traverse supplied candle histories. Cost is proportional to the valid rows processed; no stage-specific production timing is available. | Per-interval calculation elapsed samples and totals; number of markets/intervals evaluated; candles passed to indicator functions; optional synchronous process-CPU delta. | `analyzeTimeframe` and its indicator helpers (`calculateEma`, `calculateMacd`, RSI, momentum, volume, and volatility) in [`lib/ai-engine.mjs`](../../lib/ai-engine.mjs). Start after normalized, freshness-eligible candles are selected; stop after the per-timeframe indicator result and timeframe score are produced. | Emit aggregate interval/market distributions and total eligible candle count. Do not emit individual indicator values. |
| **4. Market Strength calculation** | Expected to be low relative to parsing and indicator work: it combines a small set of interval scores and market-snapshot values once per market. | Per-market elapsed samples and total; count of markets with valid timeframe scores and available snapshots; optional synchronous process-CPU delta. | The cross-timeframe and snapshot aggregation in `analyzeMarket`: `weightedTimeframeScore`, market-change/range context, and final combined `score` in [`lib/ai-engine.mjs`](../../lib/ai-engine.mjs). Keep per-timeframe feature-score work within the indicator stage so this boundary is unambiguous. | Emit aggregates only. Do not log market symbols, scores, or market-data values. |
| **5. Confidence calculation** | Expected to be low: coverage, depth, volatility penalty, and the confidence expression use small arrays and scalar operations per market. | Per-market elapsed samples and total; count of sufficient/insufficient inputs; optional synchronous process-CPU delta. | The confidence block in `analyzeMarket`, from candle coverage/depth and volatility penalty through confidence clamping and rounding in [`lib/ai-engine.mjs`](../../lib/ai-engine.mjs). | Emit aggregate timing and sufficient-input counts only; do not log individual confidence values or alter their calculation. |
| **6. Decision generation** | Expected to be low relative to candle work: the decision branch, reason selection, and result object are produced once per market after confidence. | Per-market decision-finalization elapsed samples and total; market count; generated decision counts by category. Keep counts already emitted by the current summary. | The final decision selection, reason construction, and result-object assembly in `analyzeMarket` in [`lib/ai-engine.mjs`](../../lib/ai-engine.mjs). Preserve existing `decisionGeneration` as the end-to-end analysis wall time or explicitly version its meaning; do not double-count nested substage totals as if they were independent wall time. | Aggregate decision-generation distributions and the existing decision counts into the same completion event. No per-market decision log is needed for profiling. |
| **7. Database persistence** | Expected low-to-moderate elapsed time for one batched decision write plus status updates; exact database/network contribution is not measured. The write volume is much smaller than the candle read volume. | Decision-write elapsed time; status-write elapsed times (initial and completion separately); response-body parse time if useful; decisions submitted/confirmed; serialized request bytes; write failure count. | `writeDecisions`, `writeDatabaseRows`, and the two status-update calls in `runAnalysis` in [`lib/ai-engine.mjs`](../../lib/ai-engine.mjs). Keep Supabase request/response elapsed time distinct from optional local serialization time. | Emit one decision-write and status-write summary per run. On failure, include the failed stage and partial timings without logging request bodies, secrets, or raw provider errors. |

## Log shape and interpretation

Add a versioned nested object such as `profilingVersion` and `profiling` to the existing `"AI analysis completed."` structured log. Each stage should have stable names and, where meaningful, fields for `count`, `totalMs`, `avgMs`, `p95Ms`, and `maxMs`; include request/row/market counts beside timings so runs with different workloads can be compared. Retain total engine `runtimeMs`, existing `timingMs`, and `candlesLoaded` during the transition.

Because candle requests overlap, the sum of per-request retrieval durations can exceed the candle-retrieval wall span. Report both, label them accurately, and do not add overlapping durations to estimate total runtime. Similarly, stage wall timings do not establish Active CPU. Compare them with Vercel invocation duration and invocation-level Active CPU when available; use the synchronous process-CPU deltas only as supplementary diagnostic estimates.

For failed runs, emit the stage reached, partial stage aggregates, row/request counters, and elapsed runtime. Do not log candle data, AI prompt/content, authorization headers, secrets, or unfiltered error objects. Keep the existing operational error/status behavior unchanged.

## Expected implementation footprint

- Instrument only the existing AI engine and its existing structured logs.
- No new API route or Vercel Function; the current 12-function Hobby limit remains unaffected.
- No database table, migration, decision field, scheduler change, external telemetry dependency, or dashboard change.
- No per-candle/per-market log events; only in-memory aggregate samples and one completion or failure summary per invocation.
- No changes to the AI outputs or execution path beyond timing and counters.

## Validation criteria for a future instrumentation change

1. For identical fixtures, persisted decisions remain deeply equal before and after instrumentation.
2. Candle retrieval request counts, row counts, freshness eligibility, and ordering remain unchanged.
3. Every successful run emits all seven stage aggregates, including zero/count-zero values where a stage is skipped; failed runs emit the available partial metrics.
4. Reported per-stage sample counts reconcile with markets, intervals, requests, and rows processed. Do not equate 612 logical market/interval combinations with actual HTTP request count.
5. Timing names and boundaries are documented, and overlapping retrieval durations are not summed as total wall time.
6. Confirm that instrumentation adds no per-row logging and does not materially change representative runtime or error rates. Use production Vercel Active CPU measurements where available; do not claim CPU attribution from wall-clock measurements alone.

## Conclusion

The most useful initial comparison is expected to be candle retrieval wall time versus candle parsing/normalization and indicator-calculation CPU or elapsed time. Market Strength, confidence, decision finalization, and database persistence should still be measured independently, but current evidence suggests they are smaller workloads. These are hypotheses to test, not measured allocations. The proposed boundaries provide the stage-level evidence needed to determine whether the remaining Active CPU comes primarily from JSON/domain parsing or synchronous analysis, while preserving the existing AI and paper-trading behavior.
