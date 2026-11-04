# History Depth Production Readiness Audit

**Audit date:** 2026-11-04  
**Latest production decision batch reviewed:** 2026-11-04 13:21:17.757 UTC  
**Scope:** Read-only production and prior-report review. No code, database, scheduler, or trading settings were changed.

## Verdict

**B. More validation required**

A 150-candle cap is the strongest quantified AI Analysis workload-reduction candidate in the reviewed evidence: it is projected to reduce loaded candle rows by about **77%** and paginated Supabase candle reads by about **68%** for the current 102-market universe. This establishes a substantial row and request-volume opportunity, not a measured reduction in Vercel Active CPU.

It is **not yet established as the highest-value remaining CPU optimization**. The requested [AI Analysis Profiling Plan](./AI_ANALYSIS_PROFILING_PLAN.md) documents that parsing, indicator calculation, and other internal CPU costs have not been attributed. More importantly, the previous [AI History Depth Audit](./AI_HISTORY_DEPTH_AUDIT.md) made an analytical EMA-seed estimate and row-volume projection, but did **not** run a 1,000-versus-150 decision replay. EMA/MACD and downstream Market Strength, confidence, and decisions therefore remain unvalidated at the candidate depth.

## Review scope and source availability

Reviewed:

- [AI History Depth Audit](./AI_HISTORY_DEPTH_AUDIT.md)
- [Post-Fix Trade Generation Audit](./POST_FIX_TRADE_GENERATION_AUDIT.md)
- [Post-Fix Confidence Cluster Analysis](./POST_FIX_CONFIDENCE_CLUSTER_ANALYSIS.md)
- [AI Analysis Profiling Plan](./AI_ANALYSIS_PROFILING_PLAN.md)
- [AI Engine source](../../lib/ai-engine.mjs), [Phase 07 prompt](../../prompts/07_AI_ENGINE.md), [README](../../README.md), [ROADMAP](../../ROADMAP.md), and [AGENTS.md](../../AGENTS.md)
- The requested `CRYPTO_BOT_MASTER_DOCUMENT.md` was not present in the workspace. The available [00_MASTER_SPEC.md](../../prompts/00_MASTER_SPEC.md) was reviewed as the closest project master specification; it is not treated as a substitute document with identical contents.

The latest candle-row and decision-input counts below were queried read-only from Supabase. They are derived from the latest complete 102-market decision batch, not from Vercel CPU telemetry.

## Current AI workload

The latest complete batch contains 102 markets and all six intervals. Stored decision metadata records **399,802 rows loaded** and **382,215 rows passed to analysis** after freshness filtering.

| Interval | Loaded at current 1,000 cap | Average per market | Projected at 150 | Projected average per market | Rows saved |
|---|---:|---:|---:|---:|---:|
| 1m | 89,827 | 880.66 | 15,300 | 150.00 | 74,527 |
| 5m | 84,930 | 832.65 | 15,300 | 150.00 | 69,630 |
| 15m | 71,184 | 697.88 | 15,300 | 150.00 | 55,884 |
| 1h | 54,216 | 531.53 | 15,300 | 150.00 | 38,916 |
| 4h | 52,450 | 514.22 | 15,300 | 150.00 | 37,150 |
| 1d | 47,195 | 462.70 | 15,171 | 148.74 | 32,024 |
| **Total** | **399,802** | **3,919.63** | **91,671** | **898.74** | **308,131** |

The projection uses the newest 150 rows per market and interval from the current stored histories. It is not a production run executed with a 150-row cap. The projected loaded-row reduction is **77.07%**.

Freshness filtering reduced the observed batch from 399,802 loaded rows to 382,215 analyzed rows. Twenty 1m intervals and five 5m intervals were not analyzed in that batch; the other interval groups were analyzed for all 102 markets. If the same interval eligibility is retained and the newest rows are kept, the projected analyzed volume is **87,921 rows**, or **76.99% fewer** than the observed analyzed volume.

## Previous 1,000-versus-150 evidence

The prior history-depth report established:

- The engine's current maximum is 1,000 rows per market and interval.
- RSI, momentum, volume, and volatility rely on finite recent windows; at 150 rows their recent inputs remain available.
- EMA and MACD are recursive and consume the supplied history. Their output can change when the initial history is shortened.
- For EMA-26, the report estimated the 150-row input reduces the initial seed discrepancy to about **0.0072% of its initial value** after recursive updates. This is a decay calculation, not a bound on output, confidence, or decision changes.
- On the Nov. 3 data snapshot, the 150-row scenario projected 91,365 rows instead of 385,659 (76.31% fewer).

The current Nov. 4 snapshot gives a similar, slightly larger row reduction (399,802 to 91,671; 77.07%). Neither report supplies an actual historical replay comparing 1,000-row and 150-row indicator values, Market Strength, confidence, or decision outputs. There is consequently no measured decision-equivalence rate or BUY/SELL change count.

## Supabase read-volume estimate

The engine groups up to four markets per interval and paginates candle REST responses. For the current enabled-market ordering and candle counts, the estimated pages required to return the current 1,000-capped rows are:

| Measure | Current 1,000 cap | 150 cap projection | Estimated reduction |
|---|---:|---:|---:|
| Candle rows returned | 399,802 | 91,671 | 308,131 (77.07%) |
| Paginated candle GET pages | 484 | 156 | 328 (67.77%) |
| Logical market/interval combinations | 612 | 612 | 0 |

The 150-cap projection needs one page for each of the 26 four-market batches at each of six intervals: each response would contain at most 600 rows, under the 1,000-row page limit. The current page count is calculated from live stored counts grouped in the engine's market batches; it is an estimate, **not an observed Vercel or Supabase request log count**. The logical market/interval workload remains 102 × 6; the reduction is in returned rows and pagination requests, not in the number of logical analyses.

These are row-transfer and request-count proxies. They must not be presented as the same percentage of Supabase-billed or physical Disk IO. The prior history-depth report explicitly found that the available database counters do not isolate the effect of this cap.

## Risk assessment

### Confidence and Market Strength

- The confidence formula's depth bonus is `min(candleCount / 100, 1)` averaged over valid intervals. In the current stored data, all markets have at least 150 rows in the first five intervals; daily histories range from 55 to 503, with only one daily history below 100. A cap of 150 therefore does not reduce the depth bonus: histories above 150 remain above the 100-row saturation point, while shorter daily histories are retained unchanged.
- Confidence can still change because shortened EMA/MACD histories can change indicator results, timeframe scores, Market Strength, volatility classification, and thus confidence. The prior reports did not measure these changes under a 150 cap.
- The post-fix BUY sample is especially threshold-sensitive: its 32 BUYs averaged 65.80 confidence and ranged from 65.10 to 66.61; the live paper-entry gate in that audit was 67. The confidence-cluster report attributes the historical cluster to moderate Market Strength and volatility interaction. A history cap could change outcomes near existing gates; no threshold change is recommended or assessed here.

### BUY/SELL decisions

- Finite-window indicators retain their newest inputs at 150 rows, but recursive EMA/MACD values are not guaranteed to match.
- Since Market Strength and confidence depend on indicator output, BUY, SELL, HOLD, and WAIT counts may change. The reviewed post-fix reports do not replay decisions at a 150 cap, and the confidence-cluster report focuses on observed BUY components rather than capped-history outcomes.
- The magnitude and direction of changes are unknown. No BUY/SELL stability claim can be made from EMA seed decay alone.

### Freshness and minimum history

- The engine determines freshness from the latest normalized candle and applies per-interval age limits. Keeping the newest 150 rows preserves the latest timestamp, so a row cap alone should not change freshness classification.
- Current table history minima are 531 (`1m`), 526 (`5m`), 524 (`15m`), 274 (`1h`), 330 (`4h`), and 55 (`1d`). All remain above the 26-candle timeframe minimum and the 34-candle MACD minimum after a 150 cap.
- Thus, based on the verified current stored history, the cap should not create new insufficient-history intervals. Existing stale intervals would remain stale; the latest run's 20 stale 1m and five stale 5m intervals are not evidence of a cap-induced freshness regression.
- This reasoning assumes the cap retains the newest rows and does not change timestamps, ordering, or freshness code. A replay should confirm the exact data selection and `WAIT` outcomes.

## Potential Active CPU reduction

The projected 77% reduction applies to candle rows loaded, while the 76.99% reduction applies to rows analyzed after freshness filtering. JSON decoding, row normalization, sorting/deduplication, and EMA/MACD work are expected to decrease as these row counts decrease. The effect on total invocation CPU will be smaller if fixed work, request overhead, confidence/decision work, or other stages account for a material share.

No defensible numeric Active CPU saving can be calculated from the reviewed evidence:

- Existing `candleLoad` timing combines retrieval and response decoding; existing `decisionGeneration` wraps the full market analysis.
- Those measurements are elapsed time, not stage-specific Active CPU.
- Vercel endpoint-level CPU reports and the reviewed profiling plan do not attribute CPU among parsing, indicators, strength, confidence, decisions, and persistence.
- Fewer rows do not imply an equal percentage reduction in Active CPU or billed database IO.

Therefore, history depth is a high-leverage **workload** candidate and a plausible CPU optimization, but it cannot yet be ranked as the highest-value **measured CPU** optimization.

## Validation required before implementation review

1. Replay identical saved market snapshots and candle inputs through the unchanged 1,000-row and candidate 150-row paths, preserving newest-row ordering and all current formulas.
2. Compare per-market/per-interval indicator values, Market Strength, confidence, and BUY/SELL/HOLD/WAIT outputs. Report exact changes and changes around the existing signal and executor gates; do not tune those thresholds.
3. Verify identical latest-candle timestamps, freshness classifications, valid-interval counts, and stale-data WAIT behavior.
4. Include varied market conditions and histories with daily data below 100, stale 1m/5m intervals, and decisions near current confidence boundaries.
5. Use the [AI Analysis Profiling Plan](./AI_ANALYSIS_PROFILING_PLAN.md) to measure retrieval, parsing, and indicator stages before claiming Active CPU savings. Compare production CPU only after any separately approved controlled rollout; this audit does not authorize implementation or deployment.

## Conclusion

The latest production evidence confirms a large, repeatable row-volume opportunity: the 150-row candidate projects roughly **308,000 fewer rows per AI run**, about **77% fewer returned rows**, and an estimated **68% fewer paginated candle reads**. The latest-candle freshness gates and minimum input lengths appear structurally preserved by retaining the newest 150 rows.

However, the 150-row depth has not been validated by decision replay, and internal Active CPU remains unattributed. Because EMA/MACD are recursive and recent BUY confidence is clustered near existing gates, deciding that this is the highest-value CPU optimization—or that it is production-ready—would exceed the evidence. **Verdict: B. More validation required.**

No confidence thresholds or trading rules are recommended for change. No code, database, scheduler, or production settings were modified. Tests were not run because this was a read-only audit and documentation deliverable.
