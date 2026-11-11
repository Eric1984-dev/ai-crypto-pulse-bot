# Post-Scheduler Opportunity Analysis

- **Window:** 2026-11-03 13:19:53.876–21:19:53.876 UTC (last eight hours at request time)
- **Source:** Live Supabase AI decisions, positions, trades, portfolio state, and active paper-trading function definition
- **Scope:** Diagnosis only. No code, database data, or production settings were changed.

## Executive conclusion

**No new position was opened because there were no BUY decisions in the requested eight-hour window.** This was not a Paper Trading rejection, open-position cap, allocation limit, emergency stop, or drawdown block.

The analysis scheduler produced **96 complete batches of 102 markets**. In the same window, the AI generated 8,866 HOLD, 907 SELL, and 19 WAIT decisions, but **zero BUYs**. There were 81 records with Market Strength at or above +20, but all had confidence below the AI Engine's 65-point directional-signal threshold; they were stored as HOLD, not submitted to the Paper Trading executor as BUYs. The strongest such record was MAGIC-EUR at +29.03 Market Strength and 62.93 confidence.

The active database executor BUY-confidence threshold is 67. Because there were no BUY decisions, **zero BUY decisions were rejected by Paper Trading** and no executor-side BUY filter was reached. The observed cause is therefore **no qualifying BUY signals, with confidence below the AI signal gate among the strongest positive-strength cases**.

## Decision activity

There were 9,792 stored decisions in the period: 96 complete batches × 102 markets. Batches ran about every five minutes, from 13:21:17 through 21:16:17 UTC; every batch included all 102 markets.

| Decision | Count | Share | Markets represented |
|---|---:|---:|---:|
| BUY | **0** | **0.00%** | 0 |
| HOLD | 8,866 | 90.54% | 102 |
| SELL | 907 | 9.26% | 22 |
| WAIT | 19 | 0.19% | 1 |

All 19 WAIT records had reason `STALE_CANDLE_DATA` and were for XYO-EUR early in the window. The other decisions were not recorded as stale-candle WAITs.

### BUY decisions and Paper Trading rejections

| Measure | Count |
|---|---:|
| BUY decisions generated in the eight-hour window | **0** |
| BUY decisions rejected by Paper Trading | **0** |
| BUY decisions with confidence below the executor's 67 gate | **0** |
| Trades recorded in the window | **0** |

There are no BUY rows to list with symbol, confidence, or Market Strength, and no rejected-BUY rows or rejection reasons for this window. This does not mean that 81 HOLD records were rejected by Paper Trading: they were not BUY decisions and never reached its entry gate.

## Why positive Market Strength did not create BUYs

The AI Engine requires confidence of at least **65** and Market Strength of at least **+20** for a BUY signal. During this window:

- 81 decisions had Market Strength ≥ +20.
- All 81 had confidence below 65; the maximum was 64.70.
- Zero decisions simultaneously met the positive-strength and confidence conditions.
- These records remained HOLD decisions. They were blocked at the **AI decision-generation gate**, not rejected by Paper Trading.

The 81 positive-strength HOLD records were:

| Symbol | Records | Highest confidence | Highest Market Strength |
|---|---:|---:|---:|
| UNI-EUR | 35 | 64.70 | 26.40 |
| MAGIC-EUR | 16 | 63.33 | 29.03 |
| DRIFT-EUR | 10 | 64.66 | 28.06 |
| STRK-EUR | 8 | 63.14 | 27.47 |
| WIN-EUR | 4 | 58.76 | 25.68 |
| ACU-EUR | 3 | 63.48 | 21.45 |
| MORPHO-EUR | 3 | 64.03 | 24.63 |
| MOVR-EUR | 1 | 61.84 | 21.94 |
| POL-EUR | 1 | 63.37 | 21.16 |

## Top 20 highest-confidence decisions

Every entry below was a SELL, not a BUY. Timestamps are UTC.

| # | Symbol | Timestamp | Decision | Confidence | Market Strength |
|---:|---|---|---|---:|---:|
| 1 | JTO-EUR | 2026-11-03 16:41:16 | SELL | 72.71 | -45.72 |
| 2 | JTO-EUR | 2026-11-03 17:01:28 | SELL | 72.54 | -43.53 |
| 3 | JTO-EUR | 2026-11-03 16:46:21 | SELL | 72.45 | -45.04 |
| 4 | JTO-EUR | 2026-11-03 15:06:25 | SELL | 72.38 | -44.87 |
| 5 | JTO-EUR | 2026-11-03 15:21:32 | SELL | 72.33 | -44.72 |
| 6 | JTO-EUR | 2026-11-03 15:26:20 | SELL | 72.31 | -44.68 |
| 7 | JTO-EUR | 2026-11-03 16:51:20 | SELL | 72.29 | -42.88 |
| 8 | JTO-EUR | 2026-11-03 16:31:18 | SELL | 72.12 | -44.18 |
| 9 | JTO-EUR | 2026-11-03 15:11:16 | SELL | 72.00 | -43.85 |
| 10 | JTO-EUR | 2026-11-03 16:36:23 | SELL | 71.97 | -43.78 |
| 11 | JTO-EUR | 2026-11-03 17:11:26 | SELL | 71.85 | -41.70 |
| 12 | JTO-EUR | 2026-11-03 17:06:25 | SELL | 71.85 | -41.70 |
| 13 | CRV-EUR | 2026-11-03 21:06:18 | SELL | 71.76 | -39.73 |
| 14 | CRV-EUR | 2026-11-03 21:01:15 | SELL | 71.73 | -39.64 |
| 15 | JTO-EUR | 2026-11-03 15:16:24 | SELL | 71.62 | -42.85 |
| 16 | JTO-EUR | 2026-11-03 17:16:19 | SELL | 71.56 | -40.94 |
| 17 | CRV-EUR | 2026-11-03 21:16:17 | SELL | 71.51 | -39.06 |
| 18 | JTO-EUR | 2026-11-03 16:56:19 | SELL | 71.43 | -42.37 |
| 19 | CRV-EUR | 2026-11-03 21:11:15 | SELL | 71.42 | -38.83 |
| 20 | JTO-EUR | 2026-11-03 17:21:16 | SELL | 71.41 | -40.55 |

## Top 20 highest Market Strength decisions

These are positive-strength HOLD decisions. Their confidence remained below the AI Engine's 65-point directional threshold.

| # | Symbol | Timestamp | Decision | Confidence | Market Strength |
|---:|---|---|---|---:|---:|
| 1 | MAGIC-EUR | 2026-11-03 14:56:20 | HOLD | 62.93 | 29.03 |
| 2 | DRIFT-EUR | 2026-11-03 15:01:14 | HOLD | 64.66 | 28.06 |
| 3 | STRK-EUR | 2026-11-03 13:46:18 | HOLD | 63.14 | 27.47 |
| 4 | DRIFT-EUR | 2026-11-03 14:46:20 | HOLD | 62.96 | 26.99 |
| 5 | DRIFT-EUR | 2026-11-03 14:51:15 | HOLD | 62.91 | 26.86 |
| 6 | UNI-EUR | 2026-11-03 15:46:21 | HOLD | 64.70 | 26.40 |
| 7 | UNI-EUR | 2026-11-03 15:51:18 | HOLD | 64.57 | 26.07 |
| 8 | MAGIC-EUR | 2026-11-03 14:41:18 | HOLD | 62.47 | 25.72 |
| 9 | MAGIC-EUR | 2026-11-03 14:36:17 | HOLD | 62.47 | 25.72 |
| 10 | WIN-EUR | 2026-11-03 13:41:15 | HOLD | 58.76 | 25.68 |
| 11 | WIN-EUR | 2026-11-03 13:36:17 | HOLD | 58.71 | 25.56 |
| 12 | WIN-EUR | 2026-11-03 13:31:24 | HOLD | 58.71 | 25.56 |
| 13 | STRK-EUR | 2026-11-03 14:01:15 | HOLD | 62.34 | 25.36 |
| 14 | MAGIC-EUR | 2026-11-03 14:51:15 | HOLD | 62.25 | 25.14 |
| 15 | MAGIC-EUR | 2026-11-03 14:46:20 | HOLD | 62.25 | 25.14 |
| 16 | MAGIC-EUR | 2026-11-03 14:31:18 | HOLD | 62.99 | 24.98 |
| 17 | UNI-EUR | 2026-11-03 15:56:24 | HOLD | 64.11 | 24.86 |
| 18 | STRK-EUR | 2026-11-03 13:51:14 | HOLD | 62.11 | 24.76 |
| 19 | DRIFT-EUR | 2026-11-03 14:31:18 | HOLD | 62.07 | 24.67 |
| 20 | MORPHO-EUR | 2026-11-03 19:01:15 | HOLD | 64.03 | 24.63 |

## Executor thresholds, limits, and observed state

The active production database function was inspected directly. Its BUY confidence condition is `< 67`; the previous 70-point condition is not active.

| Control | Current setting or observed value |
|---|---|
| AI Engine directional signal confidence | Minimum 65 |
| Paper Trading BUY confidence | Minimum 67 |
| Maximum open positions | 5 |
| Currently open positions | 2 (BEAM-EUR and WIN-EUR) |
| Maximum entry notional | 10% of portfolio value, also limited by available balance |
| Per-market entry cooldown | 15 minutes |
| Decision and market-snapshot freshness | 15 minutes; timestamps over one minute in the future are rejected |
| Daily drawdown entry stop | 5% |
| Maximum portfolio drawdown entry stop | 15% |
| Emergency stop | 20% drawdown from peak |
| Paper fee / slippage | 0.25% / 0.10% |
| Agent status at validation query | ACTIVE |
| Emergency state at validation query | NORMAL |
| Portfolio value / available balance | €9,782.78 / €7,998.76 |
| Return from UTC-day starting snapshot | -1.07% |
| Drawdown from stored peak | -3.51% |

The observed open-position count was below the five-position cap. The current daily and peak drawdowns were below their 5% and 15% entry-stop thresholds, and there was no active emergency state. These controls therefore do not explain the lack of new positions; in any case, no BUY reached them.

## Counts of potential trades blocked by controls

| Gate or condition | Count in requested window | Interpretation |
|---|---:|---|
| AI confidence gate (<65) among positive-strength records (strength ≥20) | 81 HOLD records | Suppressed before BUY generation; not Paper Trading rejections |
| Paper executor confidence gate (<67) | 0 BUY decisions | No BUY reached the executor |
| Maximum open-position limit | 0 BUY attempts | Two positions were open, below the limit of five |
| Portfolio allocation / 10% notional cap | 0 rejected BUYs | This is a position-size cap, not an observed rejection |
| Drawdown, emergency, pause, or other risk rejection | 0 observed BUY attempts | Agent was ACTIVE and emergency state NORMAL |
| Existing same-symbol position | 0 BUY attempts in this window | BEAM-EUR and WIN-EUR each had 96 HOLD decisions during the window |
| Stale-candle WAIT | 19 WAIT decisions | Upstream analysis safeguard; not an executor rejection |

For comparison, the preceding eight-hour window contained 209 BUY decisions across BEAM-EUR, UNI-EUR, and WIN-EUR: 138 were below the active executor threshold of 67, and the 71 at or above 67 were all WIN-EUR while a WIN-EUR position was already open. The stored positions predate that comparison window. This is historical context, not a count of post-fix rejections.

## Did scheduler recovery change the decision distribution?

The observed distribution changed substantially between adjacent eight-hour windows. Each contained 9,792 decisions (96 full-market batches), so the counts are directly comparable.

| Decision | Preceding eight hours | Post-scheduler eight hours | Change |
|---|---:|---:|---:|
| BUY | 209 (2.13%) | **0 (0.00%)** | -209 |
| HOLD | 7,828 (79.94%) | 8,866 (90.54%) | +1,038 |
| SELL | 1,213 (12.39%) | 907 (9.26%) | -306 |
| WAIT | 542 (5.54%) | 19 (0.19%) | -523 |

Thus, the stored decision distribution changed after the scheduler/freshness work: stale-data WAITs fell sharply, while BUY decisions fell to zero. The timing is consistent with the system evaluating improved data, but these adjacent windows alone cannot prove that scheduler recovery caused the directional change; market conditions also changed. The evidence does show that the recovered analysis jobs were completing full 102-market batches, while the remaining WAITs were explicitly identified as stale-candle results.

## Answer: Why were no new trades opened?

**Primary cause: no qualifying BUY opportunities were generated in the requested window.** The strongest positive Market Strength values belonged to HOLD decisions, and all 81 records with strength ≥20 had confidence below 65. The AI Engine's confidence gate stopped them before the Paper Trading executor; the executor's separate threshold of 67, position limit, allocation sizing, and risk controls did not cause the zero-trade result.

The two existing positions also received HOLD, not SELL, throughout the window, so no position-close trades were indicated for BEAM-EUR or WIN-EUR either.

## Evidence limits

- The AI decisions, trades, positions, active RPC threshold, and current portfolio state were queried from Supabase.
- Paper-trading rejections are not stored as per-decision records. The database run function returns aggregate `tradesExecuted`, `duplicates`, and `skipped` counters and does not retain each skipped status. The persisted data therefore cannot provide a rejection-reason ledger.
- With zero BUY decisions in the requested window, there were no BUY decisions available to reject. This conclusion is independent of whether an executor invocation log exists.
- The database does not retain a paper-trading invocation history; this analysis verifies full AI decision batches and stored trades, not that the paper-trading endpoint was invoked after every batch.
- No tests were run because this was a read-only diagnosis and report-only change.

## Sources

- [AI Engine](../../lib/ai-engine.mjs)
- [Paper-trading migration](../../PostgreSQL/migrations/20261101154600_phase08_paper_trading.sql)
- [Active confidence-threshold migration](../../PostgreSQL/migrations/20261102140000_paper_trading_confidence_experiment.sql)
- [Risk Management](../RISK_MANAGEMENT.md)
- [Scheduling](../SCHEDULING.md)

## Supplement: Confidence threshold analysis

### Confidence components and scheduler-period comparison

The AI Engine's confidence formula for sufficient data is:

`round(clamp(35 + abs(Market Strength) × 0.38 + candle coverage × 15 + average candle depth × 10 − volatility penalty, 0, 95))`

The volatility penalty averages 12 points for each high-volatility timeframe and 4 for each medium-volatility timeframe (low volatility adds zero). Confidence is capped at 64 when fewer than four timeframes are valid. At least two valid timeframes and a usable market snapshot are required for the sufficient-data formula.

The confidence formula did not change between the compared periods. Both persisted batches report strategy version `1.0.0`; repository history for the scheduler-related candle-batching and freshness changes shows retrieval/freshness changes, not confidence-formula changes. The scheduler recovery changed which data reached the engine, while market conditions also changed.

| Component, among positive-strength records with sufficient data | Pre-recovery 05:19–13:19 UTC (265 records) | Post-recovery 13:19–21:19 UTC (81 records) | Effect on post-recovery confidence |
|---|---:|---:|---|
| Base | 35.00 | 35.00 | No change |
| Average Market Strength | +35.35 | +23.03 | Lower by 12.32 strength points |
| Strength contribution (`abs(strength) × 0.38`) | +13.43 | +8.75 | **−4.68 confidence points** |
| Candle coverage bonus | +14.88 | +13.12 | **−1.76 points**; fewer valid intervals on average |
| Candle depth bonus | +10.00 | +10.00 | No reduction |
| Average volatility penalty | −7.33 | −4.96 | **2.37 points less penalty** after recovery |
| Average stored confidence | **65.98** | **61.91** | **−4.07 points overall** |
| Confidence ≥65 | 209 of 265 sufficient-data records | 0 of 81 | No post-recovery positive signal cleared the directional gate |

These are adjacent observation windows, not a controlled experiment. In the pre-recovery period, 281 records had Market Strength ≥20; 265 had sufficient data, 209 cleared confidence 65, and 16 did not meet the two-timeframe sufficiency requirement. In the post-recovery period all 81 such records had sufficient data, but none reached 65; only one had fewer than four valid timeframes and was subject to the 64-point cap. Thus, incomplete coverage contributed, but it does not explain the 80 other misses. The dominant difference was weaker positive Market Strength; lower volatility penalties partly offset it.

### Which indicator groups constrained the bullish readings?

Trend, momentum, RSI, MACD, and volume do **not** have separate deductions in the confidence formula. They make up each timeframe score with weights of 30%, 25%, 15%, 15%, and 15%, respectively. Their combined effect changes Market Strength, which contributes `0.38 × abs(Market Strength)` confidence points. Mixed or opposing readings temper that contribution when they offset otherwise bullish readings.

Across the 102 valid timeframe observations represented by the top 20 strongest positive signals:

| Indicator reading | Positive / bullish | Negative / bearish |
|---|---:|---:|
| Trend spread | 73 | 29 |
| Momentum change | 86 | 15 |
| RSI relative to 50 | 85 | 16 |
| MACD histogram | 10 | 1 |
| Volume score | 46 | 39 |

These are timeframe observations, not unique-market counts; zero or neutral values are not included in either side. The top signals were generally bullish on trend, momentum, RSI, and MACD. Volume was the most mixed group, and bearish readings in some timeframes tempered the combined strength. The direct confidence deductions visible in these records were instead **volatility** (4.00–6.00 points for the top 20) and **incomplete interval coverage** where fewer than six intervals were valid. All top 20 had the full 10-point depth bonus.

### Confidence build-up for the top 20 positive-strength signals

Coverage loss is measured against the full 15-point bonus for six intervals: one missing interval costs 2.50 points and two missing intervals cost 5.00. Each row uses the recorded, rounded Market Strength and Confidence; the fixed base is 35 points and all 20 received the full 10-point depth bonus.

| # | Symbol | Timestamp (UTC) | Strength | Strength contribution | Coverage loss | Volatility deduction | Confidence | Gap to 65 |
|---:|---|---|---:|---:|---:|---:|---:|---:|
| 1 | MAGIC-EUR | 2026-11-03 14:56:20 | 29.03 | +11.03 | −2.50 | −5.60 | 62.93 | 2.07 |
| 2 | DRIFT-EUR | 2026-11-03 15:01:14 | 28.06 | +10.66 | 0.00 | −6.00 | 64.66 | 0.34 |
| 3 | STRK-EUR | 2026-11-03 13:46:18 | 27.47 | +10.44 | −2.50 | −4.80 | 63.14 | 1.86 |
| 4 | DRIFT-EUR | 2026-11-03 14:46:20 | 26.99 | +10.26 | −2.50 | −4.80 | 62.96 | 2.04 |
| 5 | DRIFT-EUR | 2026-11-03 14:51:15 | 26.86 | +10.21 | −2.50 | −4.80 | 62.91 | 2.09 |
| 6 | UNI-EUR | 2026-11-03 15:46:21 | 26.40 | +10.03 | 0.00 | −5.33 | 64.70 | 0.30 |
| 7 | UNI-EUR | 2026-11-03 15:51:18 | 26.07 | +9.91 | 0.00 | −5.33 | 64.57 | 0.43 |
| 8 | MAGIC-EUR | 2026-11-03 14:41:18 | 25.72 | +9.77 | −2.50 | −4.80 | 62.47 | 2.53 |
| 9 | MAGIC-EUR | 2026-11-03 14:36:17 | 25.72 | +9.77 | −2.50 | −4.80 | 62.47 | 2.53 |
| 10 | WIN-EUR | 2026-11-03 13:41:15 | 25.68 | +9.76 | −5.00 | −6.00 | 58.76 | 6.24 |
| 11 | WIN-EUR | 2026-11-03 13:36:17 | 25.56 | +9.71 | −5.00 | −6.00 | 58.71 | 6.29 |
| 12 | WIN-EUR | 2026-11-03 13:31:24 | 25.56 | +9.71 | −5.00 | −6.00 | 58.71 | 6.29 |
| 13 | STRK-EUR | 2026-11-03 14:01:15 | 25.36 | +9.64 | −2.50 | −4.80 | 62.34 | 2.66 |
| 14 | MAGIC-EUR | 2026-11-03 14:51:15 | 25.14 | +9.55 | −2.50 | −4.80 | 62.25 | 2.75 |
| 15 | MAGIC-EUR | 2026-11-03 14:46:20 | 25.14 | +9.55 | −2.50 | −4.80 | 62.25 | 2.75 |
| 16 | MAGIC-EUR | 2026-11-03 14:31:18 | 24.98 | +9.49 | −2.50 | −4.00 | 62.99 | 2.01 |
| 17 | UNI-EUR | 2026-11-03 15:56:24 | 24.86 | +9.45 | 0.00 | −5.33 | 64.11 | 0.89 |
| 18 | STRK-EUR | 2026-11-03 13:51:14 | 24.76 | +9.41 | −2.50 | −4.80 | 62.11 | 2.89 |
| 19 | DRIFT-EUR | 2026-11-03 14:31:18 | 24.67 | +9.37 | −2.50 | −4.80 | 62.07 | 2.93 |
| 20 | MORPHO-EUR | 2026-11-03 19:01:15 | 24.63 | +9.36 | 0.00 | −5.33 | 64.03 | 0.97 |

The closest case was UNI-EUR at 64.70, only 0.30 points below the gate; DRIFT-EUR at 64.66 and UNI-EUR at 64.57 were also close. The strongest signals were therefore not uniformly far below threshold, but their recorded Market Strength added only about 9–11 confidence points, while volatility removed about 4–6 points. The existing formula consequently left every one below 65.
