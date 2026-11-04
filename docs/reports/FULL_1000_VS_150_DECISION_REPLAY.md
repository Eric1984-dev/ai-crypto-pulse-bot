# Full 1,000-vs-150 Decision Replay

**Replay date:** 2026-11-04  
**Production batch:** 2026-11-04 13:31:17.573 UTC  
**Markets:** 102  
**Scope:** Read-only replay using the existing AI engine. No code, database, scheduler, or production settings were changed.

## Verdict

**A. Safe for implementation review**

On this complete production batch, the 150-candle replay preserved the decision type for **102/102 markets (100%)**. Confidence and Market Strength matched to two-decimal precision for 97 and 96 markets respectively; every difference was at most **0.01**. All interval freshness outcomes and decision-relevant data-quality flags remained unchanged.

This verdict authorizes review of a controlled implementation proposal only. It is not approval to deploy. This is one batch, not a multi-regime validation, and the candles table does not retain historical row versions. Additional batch replays and a reviewed rollout plan are still appropriate before production activation.

## Method

1. Selected the latest complete production decision batch: exactly 102 decision rows with the same `created_at` timestamp.
2. Read the enabled markets' candle rows, limited to each market's latest 1,000 rows per interval and no candle timestamp later than the batch timestamp.
3. Reconstructed each market's analysis snapshot from the `marketData` values stored with that production decision.
4. Invoked the existing exported `analyzeMarket` implementation locally for every market at both 1,000 and 150 rows per interval. The 150-row input retained the newest 150 candles for each market/interval.
5. Compared the 1,000-row replay with the persisted production batch before interpreting the capped replay.

The 1,000-row replay reproduced the production batch's decision, confidence, and Market Strength for **all 102 markets**. It also matched persisted per-interval candle counts, analyzed counts, freshness booleans, stale-candle counts, and invalid-candle counts for all 102. This is a strong check that the batch inputs and analysis time were reconstructed consistently.

## Decision results

| Result | Count |
|---|---:|
| Markets replayed | 102 |
| Identical decision types | **102** |
| Changed decision types | **0** |
| Identical decisions | **100.00%** |
| Changed BUY decisions | 0 |
| Changed SELL decisions | 0 |
| Changed HOLD decisions | 0 |
| Changed WAIT decisions | 0 |

### Decision transition matrix

Rows are the 1,000-candle decisions; columns are the 150-candle decisions.

| 1,000 → 150 | BUY | SELL | HOLD | WAIT |
|---|---:|---:|---:|---:|
| BUY | 1 | 0 | 0 | 0 |
| SELL | 0 | 3 | 0 | 0 |
| HOLD | 0 | 0 | 98 | 0 |
| WAIT | 0 | 0 | 0 | 0 |

Both runs therefore produced 1 BUY, 3 SELL, 98 HOLD, and 0 WAIT decisions. No market changed decision class.

## Confidence and Market Strength deltas

Deltas are **150-candle value minus 1,000-candle value**. Values are evaluated at the engine's persisted two-decimal precision.

| Metric | Exact matches | Non-zero deltas | Mean signed delta | Mean absolute delta | 95th percentile absolute delta | Minimum / maximum |
|---|---:|---:|---:|---:|---:|---:|
| Confidence | 97 / 102 (95.10%) | 5 | +0.00010 | 0.00049 | 0.00 | -0.01 / +0.01 |
| Market Strength | 96 / 102 (94.12%) | 6 | +0.00020 | 0.00059 | 0.01 | -0.01 / +0.01 |

The 95th percentile confidence delta is zero because at least 97 of the 102 confidence values were unchanged. No confidence or strength difference changed a decision in this batch.

## Candle workload

| Interval | Rows at 1,000 cap | Rows at 150 cap | Rows analyzed at 1,000 | Rows analyzed at 150 | Stale markets (both runs) |
|---|---:|---:|---:|---:|---:|
| 1m | 89,860 | 15,300 | 77,506 | 12,600 | 18 |
| 5m | 84,995 | 15,300 | 83,003 | 14,850 | 3 |
| 15m | 71,325 | 15,300 | 71,325 | 15,300 | 0 |
| 1h | 54,216 | 15,300 | 54,216 | 15,300 | 0 |
| 4h | 52,450 | 15,300 | 52,450 | 15,300 | 0 |
| 1d | 47,195 | 15,171 | 47,195 | 15,171 | 0 |
| **Total** | **400,041** | **91,671** | **385,695** | **88,521** | **21 stale market/intervals** |

- Loaded rows decreased by **308,370 (77.08%)**.
- Rows passed to indicator analysis decreased by **297,174 (77.05%)**.
- The daily interval has 15,171 projected rows because three markets have fewer than 150 rows in that interval.

These are row-count reductions from this replay. They are not measurements of Supabase-billed Disk IO, Vercel duration, or Active CPU.

## Freshness and data-quality comparison

- The same **18 stale 1m** and **3 stale 5m** market/intervals remained stale at both depths.
- Freshness booleans matched for all **612 market/interval pairs**.
- Available interval lists, coverage, invalid-candle counts, market-snapshot availability, and `sufficientForDirectionalSignal` flags matched for all 102 markets.
- No new WAIT decisions or insufficient-history outcomes appeared.
- Candle and analyzed-candle counts decreased as expected. The numeric `staleCandleCount` also decreased for 18 stale 1m markets and 3 stale 5m markets because fewer stale rows were loaded; the stale/fresh classification itself did not change.

## Interpretation and limitations

The result is strongly favorable for this production batch: at the precision used by the engine, the candidate cap changed neither decisions nor freshness/data-quality eligibility, and its confidence and Market Strength deltas were no larger than 0.01.

EMA and MACD are recursive, so this one-batch result does not prove that a 150-row cap will always preserve their outputs or decisions across different market regimes. The 1,000-row and 150-row results are a paired replay of the same captured production window; only one complete batch was tested.

The candle table stores candle timestamps and OHLCV values but no row-version or `updated_at` timestamp. Candle refresh can upsert existing `(symbol, interval, timestamp)` rows. The replay filtered out candle timestamps later than the production batch and the 1,000-row output exactly matched persisted decisions and quality metadata, but the database cannot prove that every historical OHLCV value is byte-for-byte identical to what the live request originally returned.

This replay did not measure execution CPU, Active CPU, network time, or database billing. It therefore validates behavior for this batch and quantifies row reduction; it does not quantify production CPU savings.

## Conclusion

For the latest complete 102-market production batch, the 150-candle candidate preserved **100% of decision types**, all freshness and decision-relevant quality flags, and confidence/strength within **0.01** at persisted precision. It is **safe to proceed to implementation review**, with the stated multi-batch and source-version limitations. No confidence-threshold or trading-rule changes are recommended.

No code or production settings were changed. The replay used the existing analysis function locally; no automated test suite or production writes were run.

## Sources

- [AI Engine](../../lib/ai-engine.mjs)
- [History Depth Production Readiness Audit](./HISTORY_DEPTH_PRODUCTION_READINESS.md)
- [AI History Depth Audit](./AI_HISTORY_DEPTH_AUDIT.md)
- Read-only Supabase decision and candle rows for the production batch at 2026-11-04 13:31:17.573 UTC
