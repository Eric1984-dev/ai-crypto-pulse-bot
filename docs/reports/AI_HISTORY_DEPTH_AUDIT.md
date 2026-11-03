# AI History Depth Audit

**Observation:** 2026-11-03 20:31 UTC  
**Scope:** Read-only source review and live Supabase analysis. No code, database, or scheduler settings were changed.

## Executive summary

The AI Engine currently fetches up to **1,000 candles per market per interval**. The latest complete production run analyzed 102 markets and fetched **385,659 candle rows** across its six intervals. Candle freshness filtering meant **366,870 rows** were actually passed to indicator calculations; stale intervals were fetched but excluded.

Full stored history is not required for most indicators:

- RSI, momentum, volume, and volatility use finite recent windows of at most 21 candles.
- EMA and MACD are recursive. The implementation seeds them from the start of the supplied history, so every supplied candle has a mathematical influence, but the contribution of the initial seed decays exponentially.
- A **150-candle per-market, per-interval history cap** is a conservative candidate for near-identical indicator values. At 150 observations, the EMA-26 seed contribution is about **0.0072% of its initial discrepancy** after its 124 recursive updates. This is an analytical decay estimate, not a guarantee of identical decisions.

Using current live histories, a 150-candle cap would reduce the estimated read/response volume from about **385,659 to 91,365 rows per run**, or **76.31% fewer rows**. This is a row-volume proxy, not a measured reduction in Supabase-billed or physical Disk IO. No production cap change is recommended solely from this analysis; any future change should be validated against decision replay and production measurements.

## Production candle volume

The following values come from the 102 AI decisions written together at **2026-11-03 20:31:18.941 UTC**. `Fetched` is the sum of each decision's recorded `candleCount`; `Analyzed` is the sum of `analyzedCandleCount` after the engine's freshness filter.

| Interval | Fetched rows | Average fetched per market | Analyzed rows | Average analyzed per market |
|---|---:|---:|---:|---:|
| 1m | 86,825 | 851.2 | 71,362 | 699.6 |
| 5m | 80,391 | 788.1 | 78,083 | 765.5 |
| 15m | 66,747 | 654.4 | 66,229 | 649.3 |
| 1h | 52,656 | 516.2 | 52,656 | 516.2 |
| 4h | 52,050 | 510.3 | 52,050 | 510.3 |
| 1d | 46,990 | 460.7 | 46,490 | 455.8 |
| **Total** | **385,659** | **3,781.0** | **366,870** | **3,596.8** |

These are observed row counts for one complete run, not averages over a long production period. The current 1,000-row cap is reached by 47 markets on `1m` and 18 on `5m`; none of the other intervals currently reaches it. The live candle table contains 102 markets for each interval, with the shortest stored history being 53 daily candles.

Freshness exclusions account for the difference between fetched and analyzed totals. They are not history-depth savings: a shorter query would reduce rows fetched, while freshness checks continue to decide whether an interval is eligible for analysis.

## Indicator lookbacks in the implementation

The depths below describe the current calculations in [lib/ai-engine.mjs](../../lib/ai-engine.mjs). “All history” means a recursive calculation consumes the supplied series; it does not mean each old candle has equal influence.

| Indicator | Candles affecting the latest value | Finite or recursive? | Notes |
|---|---:|---|---|
| EMA trend (`EMA12`, `EMA26`) | All supplied closes | Recursive | Each EMA is seeded with the arithmetic mean of its first period, then updated recursively. Older observations persist only through the decaying prior EMA state. |
| RSI-14 | 15 closes / 14 changes | Finite | Uses only the final 14 close-to-close changes. |
| MACD (12, 26, 9) | All supplied closes | Recursive | Requires at least 34 closes to return a value. EMA-12 and EMA-26 feed the MACD line; the EMA-9 signal is calculated over the available MACD series. |
| Momentum | 6 closes for current return; up to 11 for acceleration/direction | Finite | The weighted momentum score uses the 5-interval return from `values[-6]` to the latest close. The additional 11-close window supports acceleration/direction output. |
| Volume | Up to 21 candles, plus the latest two closes | Finite | Latest volume is compared with the prior 20 volumes; the latest close change supplies the direction used in the volume score. |
| Volatility | Up to 15 candles | Finite | Uses the latest 14 true ranges and the mean close across the latest 15 candles. |

The per-interval lengths do not change these formulas: each valid, fresh interval runs the same indicator code against its own candle series. At least 26 candles are required for an interval to count toward analysis, and MACD itself needs 34. An analysis requires at least two sufficiently populated fresh intervals; directional signals additionally require four fresh intervals and the existing confidence gate.

## How much recursive history is useful?

For an EMA with period `p`, the multiplier on the previous EMA is `1 - 2/(p+1)`. After the initial seed, its contribution is multiplied by that factor on every subsequent observation. For EMA-26, the factor is `25/27`. A 150-candle input has 124 recursive updates after the 26-candle seed, leaving approximately:

```text
(25/27)^124 = 0.0000717
```

That is **0.00717% of the original seed discrepancy**. For comparison, a 100-candle input leaves about 0.336% after 74 updates. The EMA-12 seed decays faster. MACD's signal EMA-9 also decays quickly, while its long EMA inherits the EMA-26 convergence behavior.

This calculation quantifies decay of a seed discrepancy; it does not bound every market-regime effect or promise unchanged rounded values, scores, confidence, or decisions. Decision thresholds can make a small indicator change consequential for borderline cases. The engine's current initialization method also means that a shortened history can produce a slightly different EMA/MACD than the full series.

## Full history and candidate read reductions

The 1,000-candle cap is much larger than the finite windows used by RSI, momentum, volume, and volatility. A shorter cap can retain those exact recent inputs while reducing recursive-indicator seed sensitivity. The following estimates apply candidate caps to the **current live per-market histories**, then compare against the observed 385,659-row production run:

| Candidate cap per interval | Estimated rows per run | Fewer rows than observed run |
|---:|---:|---:|
| 50 | 30,600 | 92.07% |
| 100 | 61,153 | 84.14% |
| **150** | **91,365** | **76.31%** |
| 200 | 121,442 | 68.51% |
| 300 | 182,644 | 52.64% |

The 150-candle estimate uses the current stored histories, not a hypothetical 150 candles for every market. In particular, some daily histories are shorter than 150 and would remain unchanged. The live 150-cap query volume is 91,365 rows; the latest run had 11 more fetched rows than the current 1,000-cap live aggregate, a small timing difference between the decision snapshot and the candle-table count.

If the observed five-minute AI Analysis cadence continued for a full day (288 runs), the row-transfer proxy would be approximately:

| Scenario | Rows per run | Modeled rows per day |
|---|---:|---:|
| Observed current history | 385,659 | 111.1 million |
| 150-candle cap | 91,365 | 26.3 million |
| Difference | 294,294 | 84.8 million fewer |

This daily figure extrapolates one complete observed run and the six consecutive five-minute production decision batches visible around the observation time. It is not a measured full-day total.

## Disk IO interpretation

The existing query uses the composite `(symbol, interval, timestamp)` index. The live query-plan audit found bounded index scans and warm-cache hits for its tested candle pages; it did not demonstrate a missing-index or sequential-scan bottleneck. Reducing the history depth would reduce returned tuples, response payloads, and application-side candle processing. It may also reduce heap-page access, but database pages are shared by multiple rows and frequently served from cache.

Therefore, **76.31% fewer rows must not be reported as 76.31% less billed Disk IO**. PostgreSQL's available cumulative counters do not isolate this history-depth change, and the Supabase Disk IO budget metric is not exposed by the query evidence used here. A before/after production measurement would be required to quantify actual physical or billable IO.

## Conclusions

1. **Fetched per interval:** The latest complete run fetched 385,659 candles in total, with interval counts shown above.
2. **Indicator depth:** RSI needs 15 closes; current momentum needs 6, with up to 11 for ancillary output; volume uses up to 21 candles; volatility uses 15. EMA and MACD are recursive and consume the supplied history.
3. **Is full history required?** No. Finite indicators need only their recent windows. Older candles contribute to EMA/MACD only via recursive state, whose initial-condition effect decays.
4. **Near-identical history depth:** 150 observations is a conservative candidate: the EMA-26 seed component has decayed to about 0.0072% of its initial discrepancy. This remains an estimate; replay and production validation are needed to measure score/decision stability.
5. **Estimated IO opportunity:** A 150-candle cap implies 76.31% fewer candle rows per run in the current data. This estimates read/transfer volume, **not** actual Disk IO savings.
6. **Recommendation:** Treat 150 candles per interval as a candidate for a separately approved optimization, not as a strategy change or an already-verified improvement. Preserve the 26-candle timeframe sufficiency rule, the 34-candle MACD minimum, freshness checks, all existing indicator formulas, and paper-trading/risk behavior; compare full-history versus capped replay results before any implementation.

## Evidence and limitations

- Formula and fetch-limit source: [lib/ai-engine.mjs](../../lib/ai-engine.mjs)
- Production row-count source: live `AI_Crypto_Bot_AI_Decisions` records from the 102-symbol run at 2026-11-03 20:31:18.941 UTC.
- Current history distribution and cap simulations: live grouped counts from `AI_Crypto_Bot_Candles`, 102 symbols per interval.
- Query/index context: [CANDLE_QUERY_PLAN_REPORT.md](./CANDLE_QUERY_PLAN_REPORT.md).
- Earlier production-volume sample: [AI_ANALYSIS_PRODUCTION_VERIFICATION_REPORT.md](./AI_ANALYSIS_PRODUCTION_VERIFICATION_REPORT.md), which measured 300,849 rows on 2026-11-02. That earlier run differs from the later 385,659-row run and is not used as the current baseline.
- Workload caveat: the live table and decision metadata are snapshots; candle rows can change between the analysis run and cap-count query. No historical per-interval fetched-row time series or controlled before/after IO experiment was available.

This audit made no code, database, scheduler, or strategy changes. No tests were run because the deliverable is documentation only.
