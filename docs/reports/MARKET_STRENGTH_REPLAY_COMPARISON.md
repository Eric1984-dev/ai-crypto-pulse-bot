# Market Strength Replay Comparison

**Analysis window:** 2026-11-01 16:17–2026-11-09 09:33 UTC  
**Data source:** live Supabase production decisions, portfolio snapshots, trades, and candles  
**Scope:** read-only analysis. No code, thresholds, production records, or deployment settings were changed.

## Executive summary

The replay generated fewer BUY signals for each simplified model than for the current production model. After applying paper-trading limits, the models opened only five or six positions apiece. Models B–E had at most one closed trade each; their 100% win rates therefore represent one winner, not evidence of a repeatable advantage. Models C and E ended with the same four open positions and estimated marked equity, so their small-sample result does not distinguish them.

Model A's replay produced five entries and three exits, matching the live trade counts. It matched seven of the eight live trade decision IDs; the unmatched event was an earlier simulated WIN-EUR buy. Its simulated realized loss was close to, but did not reproduce, production's realized loss. This is a useful consistency check, **not an exact replay**: historical executor-time market snapshots, run/status history, and complete minute-by-minute candle coverage are unavailable.

**Conclusion:** the historical sample is insufficient to select a replacement model. C/E have the highest estimated ending equity, but they have only one closed winner and four open positions; drawdown and ending-equity estimates are also limited by sparse candle marks. Do not treat this report as evidence to change production thresholds.

## Production data and replay coverage

The production decision table contained 235,518 records in the period, including 3,745 stored BUY decisions. The replay aligned decisions to 2,190 distinct portfolio-snapshot times, from 2026-11-01 16:17 through 2026-11-09 09:33 UTC. The median time between snapshot timestamps was about five minutes.

The first available snapshot time is later than the earliest decision records. Decisions before 16:17 on November 1 are therefore not represented in this run-aligned replay. For each recorded run, the selected input was the newest decision no more than 15 minutes old for each currently enabled market. The current watched-market set contained 102 markets; historical enable/disable state was not retained.

### Model definitions

Model A uses the stored production decision and `marketStrength`. Candidate models reuse the confidence and data-quality fields stored with each decision and reconstruct their signed score from the stored indicator snapshot:

| Model | Signed score |
|---|---|
| A | Stored production Market Strength; use the stored BUY/SELL action |
| B | 1d EMA trend score |
| C | (2 × 1d EMA trend score + 1d RSI score) / 3 |
| D | (2 × 1d EMA trend score + 1h signed volume score) / 3 |
| E | (2 × 1d EMA trend score + 1d RSI score + 1h signed volume score) / 4 |

The component scores follow production scaling:

- EMA trend score = clamp(`1d percentSpread × 50`, −100, 100).
- RSI score = clamp(`(1d RSI14 − 50) × 2`, −100, 100).
- Volume score = the stored signed `1h volume.score`; a volume ratio alone has no bullish/bearish direction.

The production directional signal threshold is ±20 and its AI confidence threshold is 65. The live paper executor's BUY-entry confidence gate is 67; that live value was used for simulated entries. Candidate confidence was held fixed from the production decision; it was not recalculated.

### BUY signal counts

Counts are from the latest/fresh decision selected at each recorded run across the 102 currently enabled markets. “Run rows / distinct decisions” distinguishes repeated selections of a still-current decision from unique decision IDs.

| Model | Generated BUYs, confidence ≥65 (run rows / distinct decisions) | BUYs meeting executor confidence ≥67 (run rows / distinct decisions) |
|---|---:|---:|
| A | 3,649 / 3,611 | 1,774 / 1,754 |
| B | 1,743 / 1,720 | 891 / 878 |
| C | 1,627 / 1,608 | 872 / 860 |
| D | 1,655 / 1,635 | 867 / 855 |
| E | 1,578 / 1,559 | 860 / 848 |

At the signal threshold, B–E generated about 52–57% fewer BUY run rows than A. The 67 confidence gate reduced each model's potential entry decisions further, by roughly half relative to A.

## Replay method

The replay started with the live portfolio's €10,000 starting balance. It applied the paper executor's principal entry/exit mechanics:

- Up to five open positions, no duplicate open position per market, and a 15-minute per-market cooldown after an executed trade.
- Maximum entry notional of 10% of marked portfolio value, subject to available cash.
- 67 minimum confidence for BUY entries; SELL signals can close an existing position but cannot open a short.
- 5% daily and 15% portfolio drawdown entry blocks.
- 0.25% fees on each side and 0.10% adverse slippage on entry and exit.
- BUY positions close on the first qualifying SELL signal for that model and market.

BUY/SELL fills use the close of the latest completed 1-minute candle at or before the recorded run time, with a candle age no greater than 15 minutes. Open positions are marked at recorded run times when a candle no more than 15 minutes old is available; when one is not available, the previous mark is retained. The model scores use the persisted, rounded decision-time indicator snapshot rather than recomputing indicators from raw candles.

The candle table had 43,957 1-minute records for the 18 markets with candidate BUYs and usable candle prices in this replay. The series is sparse: many held-position/run combinations had no fresh minute candle. This limited mark availability and means the drawdown and ending-equity figures below are estimates, not complete continuous portfolio marks.

## Replay results

Trade win rate, profit factor, and average return use **closed trades only**. Average return is net realized P&L divided by entry cost basis, averaged across closed trades. “N/A” means no meaningful denominator or no closed trades; one winning trade with no losses does not establish a stable profit factor.

| Model | Simulated BUY entries | Closed trades | Win rate | Profit factor | Avg. net return / closed trade | Observed max drawdown* | End marked equity* | Open positions |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| A — Current | 5 | 3 | 0% | 0.000 | −9.17% | 4.84% | €9,750.54 (−2.49%) | 2 |
| B — 1d EMA | 6 | 1 | 100% | N/A (1 win, no losses) | +2.78% | 3.32% | €10,028.83 (+0.29%) | 5 |
| C — 1d EMA + RSI | 5 | 1 | 100% | N/A (1 win, no losses) | +2.78% | 2.76% | €10,131.71 (+1.32%) | 4 |
| D — 1d EMA + 1h volume | 6 | 1 | 100% | N/A (1 win, no losses) | +2.78% | 2.94% | €10,114.30 (+1.14%) | 5 |
| E — 1d EMA + RSI + 1h volume | 5 | 1 | 100% | N/A (1 win, no losses) | +2.78% | 2.76% | €10,131.71 (+1.32%) | 4 |

\* Drawdown and ending equity are based on available fresh candle marks and may understate risk or misstate open-position value. They are not directly comparable to the complete production snapshot series.

### What the results do and do not show

- **C and E have the highest estimated ending equity**, but both have only one closed winner and four open positions. Most of their apparent gain is unrealized and depends on sparse candle marks.
- **B and D each closed one profitable BEAM-EUR position** and ended with five open positions. Their 100% win rates and undefined profit factors are just one-trade outcomes.
- **A closed three losing positions.** Its replay average closed-trade return was −9.17%; the other models' +2.78% average comes from the same single BEAM-EUR winning trade, not a broader set of wins.
- All candidate models quickly used most or all of the five-position limit. Their BUY-signal reductions did not translate into a meaningful sample of additional closed trades.
- The replay's observed drawdowns range from 2.76% to 4.84%, but should not be read as evidence that B–E reduced risk. For comparison, the live portfolio's recorded snapshots show a 7.179% maximum drawdown in the same available period. The replay's missing candle marks explain why it can understate drawdown.

## Comparison with live Model A

| Measure | Live production | Model A replay |
|---|---:|---:|
| BUY entries | 5 | 5 |
| SELL exits / closed trades | 3 | 3 |
| Closed-trade win rate | 0% | 0% |
| Closed-trade profit factor | 0.000 | 0.000 |
| Average net closed-trade return | −9.213% | −9.165% |
| Realized P&L | −€270.5774 | approximately −€276.65 |
| Max drawdown | 7.179% from recorded portfolio snapshots | 4.84% from incomplete replay marks |
| Ending portfolio value | €9,741.95 live | €9,750.54 estimated replay |

The replay matches the source decision IDs for four of the five live BUYs and all three live SELLs. It instead enters WIN-EUR earlier than production and uses a different WIN-EUR decision ID. Its fill prices are candle-close proxies, so the realized P&L is not expected to match the live executor's market-data fills. This divergence confirms that matching trade counts is not the same as reproducing the production lifecycle.

## Limitations and confidence

1. **Not the entire decision interval:** run-aligned evidence starts at 16:17 UTC on November 1, while earlier decision rows exist. No executor run timestamps are available for that earlier interval.
2. **No historical execution-price snapshots:** production execution reads stored market-data prices, but those historical per-run values were not retained. Candle closes are a proxy, not the actual execution mark.
3. **Incomplete candle marks:** many open-position/run marks lack a fresh 1-minute candle. The last mark is retained for portfolio accounting, so drawdown and end value are incomplete.
4. **Indicator precision/history:** B–E use rounded values persisted in AI decisions. The full historical candle depth needed to independently reconstruct every production indicator was not available.
5. **Current rather than historical market universe and market-data state:** current enabled markets were used because historical watched-market changes were not retained. Historical market-snapshot freshness—including the executor's check that every open position has fresh market data—and status/emergency-stop history could not be reproduced from the retained data.
6. **Small realized samples:** each candidate closed zero or one position. Win rate, profit factor, and average return are not statistically useful for ranking these models.
7. **No walk-forward validation:** all models are evaluated on the same short, volatile period. These in-sample results do not establish future performance or causality.

## Verdict

This replay does **not** establish that any candidate model is superior to Model A. It shows that the EMA-centered variants generate fewer eligible BUYs and produced positive estimated portfolio marks in this short scenario, but that apparent benefit rests on one closed winner per candidate and largely open positions. The available production history cannot support a fully exact historical execution replay or a reliable comparative drawdown.

Before using this evidence to change a production model, retain per-run market prices, enabled-market state, agent/emergency state, and execution outcomes; then repeat a walk-forward replay with complete candle coverage and substantially more closed trades. This report makes no production recommendation to change thresholds or strategy.

## Sources

- [AI Engine](../../lib/ai-engine.mjs) — production score, confidence, and decision calculations.
- [Paper-trading migration](../../PostgreSQL/migrations/20261101154600_phase08_paper_trading.sql) — execution lifecycle, position limits, fees, slippage, and drawdown checks.
- [Confidence experiment migration](../../PostgreSQL/migrations/20261102140000_paper_trading_confidence_experiment.sql) — approved 67 BUY-entry confidence gate.
- [Risk management documentation](../RISK_MANAGEMENT.md) — documented production controls.

No code changes, production writes, deployments, or tests were performed; this was a read-only production-data investigation.
