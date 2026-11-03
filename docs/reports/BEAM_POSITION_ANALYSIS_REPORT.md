# BEAM-EUR Position Forensic Analysis

## Executive finding

The position remaining open is consistent with the currently implemented paper-trading rules: the executor closes a position only when a fresh stored `SELL` decision is available, and it has no take-profit, trailing-stop, or break-even exit. The live history contains no `SELL` decisions after entry.

However, this loss is not strong evidence of a healthy trend-following hold. All 502 post-entry decisions said `BUY`, and all six reported timeframe trends remained bullish while BEAM fell. Those technical indicators were calculated from candles that stopped updating before the position opened. The latest stored market snapshot showed a 17.60% 24-hour decline and BEAM near the bottom of its daily range. This points to a material candle-freshness/data-quality concern, in addition to the absence of protective position-management exits.

No code, strategy, or live position was changed. The rule simulations below are counterfactual analyses only.

## Scope and data sources

Read-only inspection of the live Supabase database was performed at approximately **2026-11-03 11:58 UTC**. The report uses:

- `AI_Crypto_Bot_Trades` and `AI_Crypto_Bot_Positions` for the entry, open position, and current unrealized P&L.
- `AI_Crypto_Bot_AI_Decisions` for every post-entry decision and its stored market price, strength, confidence, and timeframe indicators.
- `AI_Crypto_Bot_Market_Data` for the latest price, capture time, daily change, and 24-hour range.
- `AI_Crypto_Bot_Candles` to check the recency of each analyzed timeframe.
- `AI_Crypto_Bot_Portfolio_Snapshots` and the existing Analytics calculation semantics as cross-checks. Snapshots are portfolio-level, not position-level.

All timestamps below are UTC. P&L reconstructed from decision-time market prices is a sampled mark-to-market estimate; it cannot reveal unobserved intraperiod price extremes.

## Entry and P&L

| Metric | Value |
|---|---:|
| Entry decision | `BUY`, 70.10 confidence, market strength 54.66 at 2026-11-01 18:06:36 |
| Paper trade opened | 2026-11-01 18:08:12 |
| Executed BUY price | â‚¬0.0045282237 |
| Fee-inclusive position cost basis | â‚¬0.004539544259 per BEAM |
| Quantity | 220,837.1463627117 BEAM |
| Entry fee | â‚¬2.50 |
| Highest sampled unrealized P&L | **+â‚¬138.96** at 2026-11-01 22:16:34, sampled price â‚¬0.0051688 |
| Lowest sampled unrealized P&L | **-â‚¬226.90** at 2026-11-03 11:01:13, sampled price â‚¬0.0035121 |
| Current stored unrealized P&L | **-â‚¬202.16**, position updated 2026-11-03 11:58:12 |
| Current mark used | â‚¬0.0036241, latest market snapshot captured 2026-11-03 11:55:14 |

Unrealized P&L is calculated as `(sampled market price - fee-inclusive entry price) Ã— amount`. The high also agrees with the portfolio snapshot peak of â‚¬10,138.96 while BEAM was the only open position. Later portfolio snapshots include another open position and cannot independently isolate BEAM's P&L.

The latest market snapshot reported a **-17.5966% 24-hour change**, a â‚¬0.0035049â€“â‚¬0.0045401 daily range, and a range position of **11.51%**. The current unrealized value excludes hypothetical exit fees and slippage; closing immediately at the latest mark would be approximately **-â‚¬204.96 net** using the current 0.10% slippage and 0.25% exit fee.

## AI decisions after entry

There are **502** stored BEAM-EUR decisions after the position opened, from 2026-11-01 18:11:35 through 2026-11-03 11:56:16:

- `BUY`: 502
- `SELL`: 0
- `HOLD` / `WAIT`: 0
- Confidence range: 66.42â€“73.28 (mean 68.47)
- Market-strength range: +44.96 to +63.02 (mean +50.36)

No SELL was generated, so none was close to being executed. In the implemented AI decision rule, directional signals require confidence of at least 65 and absolute market strength of at least 20; a negative qualifying score produces `SELL`. The weakest recorded BEAM strength was still +44.96, **64.96 points above** the -20 SELL boundary. Confidence was not the reason SELLs were absent.

The live Supabase paper-trading function uses the current BUY-entry confidence gate of 67. Of the post-entry BUY recommendations, 240 were below that entry gate; this gate governs opening positions, not closing an already-open position. The latest decision was `BUY`, confidence 66.68, strength +45.65.

### Was BEAM technically bullish during the decline?

**According to the stored indicator output, yes:** each of the six timeframes (`1m`, `5m`, `15m`, `1h`, `4h`, and `1d`) was reported bullish in all 502 post-entry decisions. But those directions were not based on current candles:

| Interval | Newest stored candle (UTC) | Approx. age at latest decision |
|---|---|---:|
| 1m | 2026-11-01 07:01 | 52h 55m |
| 5m | 2026-11-01 07:00 | 52h 56m |
| 15m | 2026-11-01 07:00 | 52h 56m |
| 1h | 2026-11-01 07:00 | 52h 56m |
| 4h | 2026-11-01 04:00 | 55h 56m |
| 1d | 2026-11-01 00:00 | 59h 56m |

The latest market snapshot itself was fresh, but the analyzer validates candle shape and timestamp parseability without rejecting old candles. It continued to reuse the stale candle history while the live market snapshot moved sharply lower. Consequently, the repeated bullish readings should not be treated as confirmation that BEAM remained bullish in real time.

## Is the current hold consistent with the implemented strategy?

**Mechanically, yes.** The paper executor processes the latest stored decision; `BUY` does not close an existing long, while `HOLD` and `WAIT` do nothing. A fresh `SELL` is the signal that closes the position. The position has no independent take-profit, trailing-stop, or break-even exit, and the AI engine is not an order-management strategy that automatically sells after a drawdown.

Therefore, under the current implementation, remaining open while the latest decision is `BUY` is expected. But this specific BUY stream is materially compromised by stale candle inputs, so the resulting hold should not be described as a reliably informed trend-following decision.

Analytics/history context: BEAM has one recorded BUY trade and no SELL trade, so there is no realized BEAM trade outcome. Analytics can show the current open-position unrealized P&L, but it does not persist a historical BEAM P&L series. The historical extrema above are reconstructed from the market prices embedded in the decision history, not from a per-position P&L audit log.

## Counterfactual position-management simulations

These are independent rule scenarios evaluated against the stored decision-time prices. The cost basis includes entry execution effects; modeled exits apply 0.10% adverse slippage and a 0.25% fee. A stop is considered triggered at the first stored sample crossing its level, and the modeled fill uses that sampled price. Actual stop fills, intraperiod peaks, and exchange execution are not available.

| Hypothetical rule | Assumption and observed trigger | Estimated result |
|---|---|---:|
| 10% take profit | Trigger at +10% over fee-inclusive cost basis. First qualifying sample: 2026-11-01 20:46:34 at â‚¬0.0050286. | **+â‚¬108.00 gross; +â‚¬104.12 after modeled exit costs.** |
| 10% trailing stop | Trail 10% below the highest post-entry sampled price (â‚¬0.0051688); stop level â‚¬0.00465192. First sample below it: 2026-11-02 05:16:36 at â‚¬0.0046064. | **+â‚¬14.76 gross; +â‚¬11.21 after modeled exit costs.** |
| Break-even protection | Assumed to arm after the position first reached +10% unrealized P&L. Stop set to the fee/slippage-adjusted break-even mark (â‚¬0.00455548). First later sample below it: 2026-11-02 05:31:31 at â‚¬0.0045089. | **-â‚¬6.77 gross; -â‚¬10.25 after modeled exit costs.** An exact stop-level fill would be approximately flat net; the sampled quote had already gapped below it. |

If all three rules were enabled together with the take-profit rule taking precedence, the first observed take-profit crossing would have closed the position before the later trailing-stop or break-even scenarios applied. The break-even activation point is an explicit simulation assumption because no activation threshold was specified.

## Conclusion and future evaluation

The current loss is **expected under the executor's present rules**, because no SELL decision or protective exit was produced. It is **not adequately explained as ordinary trend-following behavior**, however: the AI repeatedly signaled BUY from candle data that was already stale at entry and remained stale for roughly 53â€“60 hours during the reported decline.

The evidence supports future evaluation of both:

1. Candle freshness/ingestion safeguards, so old technical data cannot continue to generate directional decisions as though current.
2. Position-management alternatives such as take-profit, trailing-stop, and break-even protection, using explicit activation/fill assumptions and backtesting before any strategy change.

This report recommends evaluation only; it does not change the live strategy or prescribe an action on the current paper position.

## Complete post-entry AI decision history

Confidence and strength are the exact stored values rounded to two decimals for display. Every post-entry BEAM-EUR decision is listed.

| Timestamp (UTC) | Decision | Confidence | Market strength |
|---|---|---:|---:|
| 2026-11-01 18:11:35 UTC | BUY | 69.90 | 54.11 |
| 2026-11-01 18:16:32 UTC | BUY | 69.82 | 53.92 |
| 2026-11-01 18:21:33 UTC | BUY | 69.88 | 54.08 |
| 2026-11-01 18:26:35 UTC | BUY | 70.12 | 54.70 |
| 2026-11-01 18:31:31 UTC | BUY | 69.85 | 53.99 |
| 2026-11-01 18:36:36 UTC | BUY | 70.29 | 55.15 |
| 2026-11-01 18:41:33 UTC | BUY | 70.25 | 55.04 |
| 2026-11-01 18:46:35 UTC | BUY | 70.31 | 55.20 |
| 2026-11-01 18:51:32 UTC | BUY | 70.28 | 55.13 |
| 2026-11-01 18:56:35 UTC | BUY | 70.35 | 55.30 |
| 2026-11-01 19:01:32 UTC | BUY | 70.62 | 56.02 |
| 2026-11-01 19:06:35 UTC | BUY | 71.31 | 57.83 |
| 2026-11-01 19:11:33 UTC | BUY | 71.11 | 57.31 |
| 2026-11-01 19:16:39 UTC | BUY | 70.67 | 56.16 |
| 2026-11-01 19:21:31 UTC | BUY | 70.99 | 57.00 |
| 2026-11-01 19:26:32 UTC | BUY | 71.23 | 57.63 |
| 2026-11-01 19:31:30 UTC | BUY | 71.47 | 58.25 |
| 2026-11-01 19:36:30 UTC | BUY | 71.45 | 58.19 |
| 2026-11-01 19:41:34 UTC | BUY | 71.05 | 57.15 |
| 2026-11-01 19:46:32 UTC | BUY | 71.48 | 58.29 |
| 2026-11-01 19:51:31 UTC | BUY | 71.46 | 58.22 |
| 2026-11-01 19:56:36 UTC | BUY | 71.50 | 58.33 |
| 2026-11-01 20:01:33 UTC | BUY | 71.66 | 58.76 |
| 2026-11-01 20:06:35 UTC | BUY | 72.30 | 60.43 |
| 2026-11-01 20:11:34 UTC | BUY | 72.54 | 61.06 |
| 2026-11-01 20:16:34 UTC | BUY | 72.62 | 61.28 |
| 2026-11-01 20:21:31 UTC | BUY | 72.73 | 61.58 |
| 2026-11-01 20:26:34 UTC | BUY | 72.68 | 61.44 |
| 2026-11-01 20:31:36 UTC | BUY | 72.54 | 61.06 |
| 2026-11-01 20:36:35 UTC | BUY | 72.87 | 61.94 |
| 2026-11-01 20:41:38 UTC | BUY | 72.71 | 61.51 |
| 2026-11-01 20:46:34 UTC | BUY | 73.07 | 62.47 |
| 2026-11-01 20:51:33 UTC | BUY | 73.07 | 62.46 |
| 2026-11-01 20:56:30 UTC | BUY | 72.30 | 60.43 |
| 2026-11-01 21:01:32 UTC | BUY | 72.37 | 60.61 |
| 2026-11-01 21:06:40 UTC | BUY | 71.72 | 58.91 |
| 2026-11-01 21:11:32 UTC | BUY | 72.13 | 60.00 |
| 2026-11-01 21:16:32 UTC | BUY | 71.23 | 57.61 |
| 2026-11-01 21:21:33 UTC | BUY | 72.26 | 60.33 |
| 2026-11-01 21:26:38 UTC | BUY | 72.25 | 60.32 |
| 2026-11-01 21:31:34 UTC | BUY | 72.50 | 60.97 |
| 2026-11-01 21:36:35 UTC | BUY | 72.60 | 61.23 |
| 2026-11-01 21:41:34 UTC | BUY | 72.84 | 61.85 |
| 2026-11-01 21:46:34 UTC | BUY | 72.74 | 61.59 |
| 2026-11-01 21:51:39 UTC | BUY | 73.03 | 62.37 |
| 2026-11-01 21:56:37 UTC | BUY | 73.03 | 62.36 |
| 2026-11-01 22:01:33 UTC | BUY | 73.13 | 62.62 |
| 2026-11-01 22:06:36 UTC | BUY | 72.95 | 62.15 |
| 2026-11-01 22:11:32 UTC | BUY | 72.96 | 62.17 |
| 2026-11-01 22:16:34 UTC | BUY | 73.28 | 63.02 |
| 2026-11-01 22:21:34 UTC | BUY | 73.24 | 62.90 |
| 2026-11-01 22:26:36 UTC | BUY | 73.14 | 62.65 |
| 2026-11-01 22:31:37 UTC | BUY | 72.73 | 61.57 |
| 2026-11-01 22:36:35 UTC | BUY | 72.39 | 60.68 |
| 2026-11-01 22:41:33 UTC | BUY | 71.81 | 59.15 |
| 2026-11-01 22:46:32 UTC | BUY | 71.50 | 58.34 |
| 2026-11-01 22:51:32 UTC | BUY | 71.93 | 59.46 |
| 2026-11-01 22:56:36 UTC | BUY | 72.23 | 60.26 |
| 2026-11-01 23:01:37 UTC | BUY | 72.40 | 60.71 |
| 2026-11-01 23:06:33 UTC | BUY | 71.76 | 59.01 |
| 2026-11-01 23:11:33 UTC | BUY | 71.87 | 59.31 |
| 2026-11-01 23:16:31 UTC | BUY | 72.05 | 59.78 |
| 2026-11-01 23:21:35 UTC | BUY | 71.84 | 59.23 |
| 2026-11-01 23:26:35 UTC | BUY | 72.10 | 59.92 |
| 2026-11-01 23:31:34 UTC | BUY | 71.67 | 58.79 |
| 2026-11-01 23:36:36 UTC | BUY | 71.77 | 59.04 |
| 2026-11-01 23:41:32 UTC | BUY | 71.70 | 58.86 |
| 2026-11-01 23:46:35 UTC | BUY | 71.86 | 59.27 |
| 2026-11-01 23:51:33 UTC | BUY | 71.60 | 58.59 |
| 2026-11-01 23:56:34 UTC | BUY | 71.97 | 59.58 |
| 2026-11-02 00:01:32 UTC | BUY | 71.89 | 59.35 |
| 2026-11-02 00:06:32 UTC | BUY | 71.74 | 58.97 |
| 2026-11-02 00:11:33 UTC | BUY | 72.71 | 61.51 |
| 2026-11-02 00:16:36 UTC | BUY | 72.05 | 59.79 |
| 2026-11-02 00:21:35 UTC | BUY | 72.33 | 60.52 |
| 2026-11-02 00:26:34 UTC | BUY | 71.86 | 59.27 |
| 2026-11-02 00:31:37 UTC | BUY | 71.56 | 58.49 |
| 2026-11-02 00:36:34 UTC | BUY | 71.73 | 58.95 |
| 2026-11-02 00:41:30 UTC | BUY | 71.70 | 58.85 |
| 2026-11-02 00:46:33 UTC | BUY | 71.53 | 58.40 |
| 2026-11-02 00:51:31 UTC | BUY | 71.88 | 59.33 |
| 2026-11-02 00:56:31 UTC | BUY | 72.06 | 59.81 |
| 2026-11-02 01:01:33 UTC | BUY | 72.18 | 60.12 |
| 2026-11-02 01:06:34 UTC | BUY | 72.28 | 60.39 |
| 2026-11-02 01:11:36 UTC | BUY | 72.19 | 60.15 |
| 2026-11-02 01:16:30 UTC | BUY | 71.84 | 59.22 |
| 2026-11-02 01:21:34 UTC | BUY | 71.89 | 59.37 |
| 2026-11-02 01:26:30 UTC | BUY | 72.27 | 60.37 |
| 2026-11-02 01:31:33 UTC | BUY | 72.28 | 60.39 |
| 2026-11-02 01:36:38 UTC | BUY | 72.75 | 61.61 |
| 2026-11-02 01:41:33 UTC | BUY | 72.65 | 61.35 |
| 2026-11-02 01:46:35 UTC | BUY | 72.67 | 61.41 |
| 2026-11-02 01:51:35 UTC | BUY | 72.11 | 59.94 |
| 2026-11-02 01:56:36 UTC | BUY | 71.94 | 59.49 |
| 2026-11-02 02:01:33 UTC | BUY | 72.22 | 60.23 |
| 2026-11-02 02:06:37 UTC | BUY | 71.84 | 59.24 |
| 2026-11-02 02:11:35 UTC | BUY | 71.51 | 58.35 |
| 2026-11-02 02:16:35 UTC | BUY | 71.23 | 57.61 |
| 2026-11-02 02:21:31 UTC | BUY | 71.11 | 57.32 |
| 2026-11-02 02:26:34 UTC | BUY | 71.39 | 58.04 |
| 2026-11-02 02:31:31 UTC | BUY | 71.78 | 59.08 |
| 2026-11-02 02:36:36 UTC | BUY | 71.54 | 58.43 |
| 2026-11-02 02:41:28 UTC | BUY | 71.48 | 58.27 |
| 2026-11-02 02:46:30 UTC | BUY | 71.09 | 57.25 |
| 2026-11-02 02:51:33 UTC | BUY | 71.15 | 57.40 |
| 2026-11-02 02:56:37 UTC | BUY | 71.37 | 57.98 |
| 2026-11-02 03:01:34 UTC | BUY | 71.44 | 58.17 |
| 2026-11-02 03:06:37 UTC | BUY | 71.63 | 58.68 |
| 2026-11-02 03:11:32 UTC | BUY | 71.24 | 57.64 |
| 2026-11-02 03:16:33 UTC | BUY | 71.35 | 57.94 |
| 2026-11-02 03:21:34 UTC | BUY | 71.11 | 57.32 |
| 2026-11-02 03:26:34 UTC | BUY | 71.21 | 57.58 |
| 2026-11-02 03:31:33 UTC | BUY | 71.39 | 58.05 |
| 2026-11-02 03:36:33 UTC | BUY | 71.53 | 58.40 |
| 2026-11-02 03:41:37 UTC | BUY | 71.20 | 57.55 |
| 2026-11-02 03:46:34 UTC | BUY | 71.18 | 57.48 |
| 2026-11-02 03:51:32 UTC | BUY | 71.49 | 58.32 |
| 2026-11-02 03:56:35 UTC | BUY | 71.88 | 59.34 |
| 2026-11-02 04:01:34 UTC | BUY | 71.96 | 59.55 |
| 2026-11-02 04:06:34 UTC | BUY | 71.89 | 59.35 |
| 2026-11-02 04:11:34 UTC | BUY | 72.44 | 60.82 |
| 2026-11-02 04:16:35 UTC | BUY | 72.30 | 60.43 |
| 2026-11-02 04:21:34 UTC | BUY | 71.54 | 58.45 |
| 2026-11-02 04:26:31 UTC | BUY | 71.48 | 58.28 |
| 2026-11-02 04:31:30 UTC | BUY | 71.07 | 57.21 |
| 2026-11-02 04:36:32 UTC | BUY | 70.80 | 56.50 |
| 2026-11-02 04:41:28 UTC | BUY | 71.15 | 57.40 |
| 2026-11-02 04:46:36 UTC | BUY | 71.01 | 57.04 |
| 2026-11-02 04:51:33 UTC | BUY | 70.86 | 56.65 |
| 2026-11-02 04:56:34 UTC | BUY | 71.02 | 57.07 |
| 2026-11-02 05:01:32 UTC | BUY | 70.54 | 55.81 |
| 2026-11-02 05:06:36 UTC | BUY | 70.54 | 55.81 |
| 2026-11-02 05:11:34 UTC | BUY | 70.64 | 56.08 |
| 2026-11-02 05:16:36 UTC | BUY | 69.86 | 54.02 |
| 2026-11-02 05:21:34 UTC | BUY | 69.66 | 53.50 |
| 2026-11-02 05:26:34 UTC | BUY | 69.66 | 53.49 |
| 2026-11-02 05:31:31 UTC | BUY | 69.03 | 51.84 |
| 2026-11-02 05:36:34 UTC | BUY | 69.09 | 51.98 |
| 2026-11-02 05:41:36 UTC | BUY | 68.37 | 50.09 |
| 2026-11-02 05:46:32 UTC | BUY | 67.80 | 48.60 |
| 2026-11-02 05:51:31 UTC | BUY | 67.87 | 48.78 |
| 2026-11-02 05:56:35 UTC | BUY | 67.70 | 48.33 |
| 2026-11-02 06:01:31 UTC | BUY | 67.91 | 48.89 |
| 2026-11-02 06:06:36 UTC | BUY | 67.53 | 47.88 |
| 2026-11-02 06:11:35 UTC | BUY | 67.06 | 46.66 |
| 2026-11-02 06:16:34 UTC | BUY | 66.85 | 46.10 |
| 2026-11-02 06:21:36 UTC | BUY | 66.92 | 46.27 |
| 2026-11-02 06:26:34 UTC | BUY | 66.98 | 46.43 |
| 2026-11-02 06:31:33 UTC | BUY | 66.94 | 46.34 |
| 2026-11-02 06:36:31 UTC | BUY | 66.86 | 46.11 |
| 2026-11-02 06:41:31 UTC | BUY | 66.85 | 46.10 |
| 2026-11-02 06:46:31 UTC | BUY | 67.06 | 46.66 |
| 2026-11-02 06:51:34 UTC | BUY | 67.37 | 47.47 |
| 2026-11-02 06:56:35 UTC | BUY | 66.98 | 46.44 |
| 2026-11-02 07:01:33 UTC | BUY | 66.85 | 46.09 |
| 2026-11-02 07:06:37 UTC | BUY | 66.82 | 46.01 |
| 2026-11-02 07:11:32 UTC | BUY | 66.73 | 45.77 |
| 2026-11-02 07:16:34 UTC | BUY | 66.73 | 45.77 |
| 2026-11-02 07:21:35 UTC | BUY | 66.77 | 45.89 |
| 2026-11-02 07:26:33 UTC | BUY | 66.76 | 45.86 |
| 2026-11-02 07:31:42 UTC | BUY | 66.79 | 45.95 |
| 2026-11-02 07:36:36 UTC | BUY | 66.78 | 45.91 |
| 2026-11-02 07:41:54 UTC | BUY | 66.88 | 46.18 |
| 2026-11-02 07:46:35 UTC | BUY | 67.03 | 46.57 |
| 2026-11-02 07:51:34 UTC | BUY | 66.98 | 46.44 |
| 2026-11-02 07:56:33 UTC | BUY | 66.97 | 46.42 |
| 2026-11-02 08:01:33 UTC | BUY | 66.96 | 46.39 |
| 2026-11-02 08:06:33 UTC | BUY | 67.05 | 46.61 |
| 2026-11-02 08:11:33 UTC | BUY | 67.01 | 46.52 |
| 2026-11-02 08:16:36 UTC | BUY | 66.98 | 46.45 |
| 2026-11-02 08:21:35 UTC | BUY | 66.95 | 46.36 |
| 2026-11-02 08:26:36 UTC | BUY | 66.93 | 46.31 |
| 2026-11-02 08:31:32 UTC | BUY | 66.86 | 46.11 |
| 2026-11-02 08:36:35 UTC | BUY | 66.81 | 45.99 |
| 2026-11-02 08:41:34 UTC | BUY | 66.73 | 45.79 |
| 2026-11-02 08:46:34 UTC | BUY | 66.70 | 45.71 |
| 2026-11-02 08:51:33 UTC | BUY | 66.74 | 45.80 |
| 2026-11-02 08:56:36 UTC | BUY | 66.70 | 45.69 |
| 2026-11-02 09:01:35 UTC | BUY | 66.65 | 45.57 |
| 2026-11-02 09:06:36 UTC | BUY | 66.70 | 45.70 |
| 2026-11-02 09:11:34 UTC | BUY | 66.72 | 45.76 |
| 2026-11-02 09:16:37 UTC | BUY | 66.70 | 45.70 |
| 2026-11-02 09:21:36 UTC | BUY | 66.98 | 46.43 |
| 2026-11-02 09:26:31 UTC | BUY | 67.29 | 47.26 |
| 2026-11-02 09:31:32 UTC | BUY | 67.13 | 46.84 |
| 2026-11-02 09:36:36 UTC | BUY | 67.17 | 46.93 |
| 2026-11-02 09:41:29 UTC | BUY | 67.35 | 47.40 |
| 2026-11-02 09:46:37 UTC | BUY | 67.44 | 47.64 |
| 2026-11-02 09:51:33 UTC | BUY | 67.05 | 46.63 |
| 2026-11-02 09:56:36 UTC | BUY | 67.10 | 46.76 |
| 2026-11-02 10:01:33 UTC | BUY | 67.43 | 47.62 |
| 2026-11-02 10:06:35 UTC | BUY | 67.70 | 48.34 |
| 2026-11-02 10:11:32 UTC | BUY | 67.68 | 48.29 |
| 2026-11-02 10:16:34 UTC | BUY | 67.79 | 48.57 |
| 2026-11-02 10:21:30 UTC | BUY | 67.43 | 47.63 |
| 2026-11-02 10:26:35 UTC | BUY | 67.44 | 47.64 |
| 2026-11-02 10:31:33 UTC | BUY | 67.04 | 46.59 |
| 2026-11-02 10:36:34 UTC | BUY | 67.08 | 46.71 |
| 2026-11-02 10:41:33 UTC | BUY | 67.69 | 48.30 |
| 2026-11-02 10:46:35 UTC | BUY | 67.70 | 48.34 |
| 2026-11-02 10:51:32 UTC | BUY | 67.93 | 48.94 |
| 2026-11-02 10:56:35 UTC | BUY | 68.11 | 49.40 |
| 2026-11-02 11:01:32 UTC | BUY | 68.38 | 50.13 |
| 2026-11-02 11:06:36 UTC | BUY | 68.63 | 50.78 |
| 2026-11-02 11:11:34 UTC | BUY | 68.94 | 51.59 |
| 2026-11-02 11:16:32 UTC | BUY | 68.45 | 50.30 |
| 2026-11-02 11:21:32 UTC | BUY | 68.35 | 50.05 |
| 2026-11-02 11:26:35 UTC | BUY | 68.50 | 50.43 |
| 2026-11-02 11:31:33 UTC | BUY | 68.49 | 50.42 |
| 2026-11-02 11:36:32 UTC | BUY | 68.19 | 49.61 |
| 2026-11-02 11:41:32 UTC | BUY | 68.41 | 50.20 |
| 2026-11-02 11:46:31 UTC | BUY | 68.36 | 50.06 |
| 2026-11-02 11:51:34 UTC | BUY | 68.69 | 50.94 |
| 2026-11-02 11:56:34 UTC | BUY | 69.04 | 51.86 |
| 2026-11-02 12:01:36 UTC | BUY | 68.50 | 50.44 |
| 2026-11-02 12:06:40 UTC | BUY | 68.77 | 51.14 |
| 2026-11-02 12:11:29 UTC | BUY | 68.86 | 51.39 |
| 2026-11-02 12:16:36 UTC | BUY | 68.97 | 51.67 |
| 2026-11-02 12:21:34 UTC | BUY | 68.96 | 51.65 |
| 2026-11-02 12:26:37 UTC | BUY | 68.77 | 51.14 |
| 2026-11-02 12:31:35 UTC | BUY | 68.69 | 50.93 |
| 2026-11-02 12:36:31 UTC | BUY | 68.64 | 50.81 |
| 2026-11-02 12:41:33 UTC | BUY | 68.63 | 50.78 |
| 2026-11-02 12:46:32 UTC | BUY | 68.79 | 51.20 |
| 2026-11-02 12:51:35 UTC | BUY | 68.93 | 51.57 |
| 2026-11-02 12:56:37 UTC | BUY | 69.11 | 52.04 |
| 2026-11-02 13:01:31 UTC | BUY | 69.36 | 52.69 |
| 2026-11-02 13:06:32 UTC | BUY | 69.47 | 52.98 |
| 2026-11-02 13:11:29 UTC | BUY | 69.82 | 53.90 |
| 2026-11-02 13:16:35 UTC | BUY | 69.44 | 52.90 |
| 2026-11-02 13:21:33 UTC | BUY | 69.33 | 52.62 |
| 2026-11-02 13:26:34 UTC | BUY | 69.21 | 52.30 |
| 2026-11-02 13:31:16 UTC | BUY | 69.42 | 52.85 |
| 2026-11-02 13:36:17 UTC | BUY | 69.49 | 53.05 |
| 2026-11-02 13:37:26 UTC | BUY | 69.49 | 53.05 |
| 2026-11-02 13:41:14 UTC | BUY | 69.32 | 52.59 |
| 2026-11-02 13:46:17 UTC | BUY | 68.90 | 51.50 |
| 2026-11-02 13:51:14 UTC | BUY | 68.91 | 51.51 |
| 2026-11-02 13:56:16 UTC | BUY | 68.83 | 51.31 |
| 2026-11-02 14:01:29 UTC | BUY | 68.97 | 51.67 |
| 2026-11-02 14:06:17 UTC | BUY | 69.25 | 52.41 |
| 2026-11-02 14:11:15 UTC | BUY | 69.13 | 52.10 |
| 2026-11-02 14:16:18 UTC | BUY | 69.24 | 52.39 |
| 2026-11-02 14:21:15 UTC | BUY | 69.49 | 53.05 |
| 2026-11-02 14:26:15 UTC | BUY | 69.46 | 52.97 |
| 2026-11-02 14:31:15 UTC | BUY | 69.35 | 52.67 |
| 2026-11-02 14:36:17 UTC | BUY | 69.49 | 53.05 |
| 2026-11-02 14:41:14 UTC | BUY | 69.67 | 53.51 |
| 2026-11-02 14:46:18 UTC | BUY | 69.71 | 53.63 |
| 2026-11-02 14:51:14 UTC | BUY | 69.59 | 53.30 |
| 2026-11-02 14:56:16 UTC | BUY | 69.52 | 53.13 |
| 2026-11-02 15:01:15 UTC | BUY | 69.81 | 53.88 |
| 2026-11-02 15:06:16 UTC | BUY | 69.83 | 53.95 |
| 2026-11-02 15:11:15 UTC | BUY | 69.75 | 53.72 |
| 2026-11-02 15:16:16 UTC | BUY | 69.94 | 54.22 |
| 2026-11-02 15:21:15 UTC | BUY | 70.88 | 56.69 |
| 2026-11-02 15:26:17 UTC | BUY | 71.18 | 57.48 |
| 2026-11-02 15:31:14 UTC | BUY | 71.38 | 58.02 |
| 2026-11-02 15:36:17 UTC | BUY | 71.37 | 58.00 |
| 2026-11-02 15:41:14 UTC | BUY | 71.00 | 57.02 |
| 2026-11-02 15:46:16 UTC | BUY | 70.63 | 56.04 |
| 2026-11-02 15:51:15 UTC | BUY | 70.81 | 56.51 |
| 2026-11-02 15:56:18 UTC | BUY | 70.58 | 55.91 |
| 2026-11-02 16:01:15 UTC | BUY | 70.25 | 55.04 |
| 2026-11-02 16:06:18 UTC | BUY | 70.16 | 54.80 |
| 2026-11-02 16:11:14 UTC | BUY | 69.91 | 54.16 |
| 2026-11-02 16:16:17 UTC | BUY | 69.62 | 53.39 |
| 2026-11-02 16:21:26 UTC | BUY | 69.58 | 53.28 |
| 2026-11-02 16:26:16 UTC | BUY | 69.61 | 53.37 |
| 2026-11-02 16:31:15 UTC | BUY | 69.64 | 53.43 |
| 2026-11-02 16:36:16 UTC | BUY | 68.95 | 51.61 |
| 2026-11-02 16:41:14 UTC | BUY | 68.83 | 51.31 |
| 2026-11-02 16:46:17 UTC | BUY | 69.37 | 52.72 |
| 2026-11-02 16:51:15 UTC | BUY | 69.05 | 51.88 |
| 2026-11-02 16:56:18 UTC | BUY | 68.89 | 51.46 |
| 2026-11-02 17:01:16 UTC | BUY | 68.74 | 51.07 |
| 2026-11-02 17:06:17 UTC | BUY | 68.62 | 50.75 |
| 2026-11-02 17:11:16 UTC | BUY | 68.39 | 50.15 |
| 2026-11-02 17:16:17 UTC | BUY | 68.33 | 50.00 |
| 2026-11-02 17:21:15 UTC | BUY | 68.68 | 50.90 |
| 2026-11-02 17:26:17 UTC | BUY | 68.47 | 50.35 |
| 2026-11-02 17:31:16 UTC | BUY | 67.66 | 48.24 |
| 2026-11-02 17:36:18 UTC | BUY | 68.13 | 49.47 |
| 2026-11-02 17:41:14 UTC | BUY | 67.65 | 48.21 |
| 2026-11-02 17:46:16 UTC | BUY | 67.83 | 48.67 |
| 2026-11-02 17:51:15 UTC | BUY | 67.69 | 48.31 |
| 2026-11-02 17:56:17 UTC | BUY | 67.73 | 48.42 |
| 2026-11-02 18:01:18 UTC | BUY | 67.59 | 48.04 |
| 2026-11-02 18:06:18 UTC | BUY | 67.43 | 47.61 |
| 2026-11-02 18:11:15 UTC | BUY | 67.53 | 47.88 |
| 2026-11-02 18:16:16 UTC | BUY | 67.40 | 47.55 |
| 2026-11-02 18:21:15 UTC | BUY | 67.18 | 46.96 |
| 2026-11-02 18:26:17 UTC | BUY | 67.27 | 47.21 |
| 2026-11-02 18:31:15 UTC | BUY | 67.36 | 47.44 |
| 2026-11-02 18:36:16 UTC | BUY | 67.06 | 46.66 |
| 2026-11-02 18:41:15 UTC | BUY | 66.98 | 46.43 |
| 2026-11-02 18:46:17 UTC | BUY | 66.83 | 46.04 |
| 2026-11-02 18:51:16 UTC | BUY | 66.84 | 46.08 |
| 2026-11-02 18:56:17 UTC | BUY | 66.70 | 45.70 |
| 2026-11-02 19:01:16 UTC | BUY | 66.48 | 45.12 |
| 2026-11-02 19:06:17 UTC | BUY | 66.47 | 45.10 |
| 2026-11-02 19:11:16 UTC | BUY | 66.43 | 44.98 |
| 2026-11-02 19:16:17 UTC | BUY | 66.42 | 44.96 |
| 2026-11-02 19:21:16 UTC | BUY | 66.43 | 44.99 |
| 2026-11-02 19:26:18 UTC | BUY | 66.53 | 45.26 |
| 2026-11-02 19:31:16 UTC | BUY | 66.46 | 45.06 |
| 2026-11-02 19:36:16 UTC | BUY | 66.46 | 45.07 |
| 2026-11-02 19:41:17 UTC | BUY | 66.43 | 44.98 |
| 2026-11-02 19:46:20 UTC | BUY | 66.52 | 45.23 |
| 2026-11-02 19:51:15 UTC | BUY | 66.49 | 45.14 |
| 2026-11-02 19:56:19 UTC | BUY | 66.48 | 45.11 |
| 2026-11-02 20:01:16 UTC | BUY | 66.50 | 45.18 |
| 2026-11-02 20:06:23 UTC | BUY | 66.51 | 45.20 |
| 2026-11-02 20:11:18 UTC | BUY | 66.48 | 45.11 |
| 2026-11-02 20:16:16 UTC | BUY | 66.45 | 45.04 |
| 2026-11-02 20:21:17 UTC | BUY | 66.42 | 44.97 |
| 2026-11-02 20:26:21 UTC | BUY | 66.44 | 45.01 |
| 2026-11-02 20:31:17 UTC | BUY | 66.44 | 45.01 |
| 2026-11-02 20:36:17 UTC | BUY | 66.42 | 44.96 |
| 2026-11-02 20:41:17 UTC | BUY | 66.43 | 45.00 |
| 2026-11-02 20:46:17 UTC | BUY | 66.42 | 44.96 |
| 2026-11-02 20:56:17 UTC | BUY | 66.45 | 45.05 |
| 2026-11-02 21:01:16 UTC | BUY | 66.43 | 44.98 |
| 2026-11-02 21:06:17 UTC | BUY | 66.42 | 44.96 |
| 2026-11-02 21:16:16 UTC | BUY | 66.47 | 45.10 |
| 2026-11-02 21:21:17 UTC | BUY | 66.52 | 45.22 |
| 2026-11-02 21:26:16 UTC | BUY | 66.59 | 45.41 |
| 2026-11-02 21:31:17 UTC | BUY | 66.57 | 45.37 |
| 2026-11-02 21:36:22 UTC | BUY | 66.58 | 45.38 |
| 2026-11-02 21:41:20 UTC | BUY | 66.52 | 45.22 |
| 2026-11-02 21:46:18 UTC | BUY | 66.49 | 45.14 |
| 2026-11-02 21:48:52 UTC | BUY | 66.49 | 45.14 |
| 2026-11-02 21:51:28 UTC | BUY | 66.49 | 45.15 |
| 2026-11-02 21:56:19 UTC | BUY | 66.51 | 45.21 |
| 2026-11-02 22:01:14 UTC | BUY | 66.51 | 45.21 |
| 2026-11-02 22:06:17 UTC | BUY | 66.51 | 45.21 |
| 2026-11-02 22:11:16 UTC | BUY | 66.54 | 45.27 |
| 2026-11-02 22:16:16 UTC | BUY | 66.54 | 45.28 |
| 2026-11-02 22:21:15 UTC | BUY | 66.50 | 45.18 |
| 2026-11-02 22:26:18 UTC | BUY | 66.56 | 45.33 |
| 2026-11-02 22:31:17 UTC | BUY | 66.54 | 45.28 |
| 2026-11-02 22:36:19 UTC | BUY | 66.54 | 45.28 |
| 2026-11-02 22:41:16 UTC | BUY | 66.62 | 45.49 |
| 2026-11-02 22:46:16 UTC | BUY | 66.58 | 45.38 |
| 2026-11-02 22:51:14 UTC | BUY | 66.57 | 45.37 |
| 2026-11-02 22:56:17 UTC | BUY | 66.63 | 45.53 |
| 2026-11-02 23:01:29 UTC | BUY | 66.67 | 45.62 |
| 2026-11-02 23:06:18 UTC | BUY | 66.66 | 45.60 |
| 2026-11-02 23:11:15 UTC | BUY | 66.67 | 45.62 |
| 2026-11-02 23:16:17 UTC | BUY | 66.64 | 45.55 |
| 2026-11-02 23:21:15 UTC | BUY | 66.64 | 45.55 |
| 2026-11-02 23:26:18 UTC | BUY | 66.70 | 45.70 |
| 2026-11-02 23:31:15 UTC | BUY | 66.65 | 45.56 |
| 2026-11-02 23:36:18 UTC | BUY | 66.65 | 45.56 |
| 2026-11-02 23:41:16 UTC | BUY | 66.54 | 45.29 |
| 2026-11-02 23:46:17 UTC | BUY | 66.52 | 45.24 |
| 2026-11-02 23:51:16 UTC | BUY | 66.54 | 45.28 |
| 2026-11-02 23:56:19 UTC | BUY | 66.55 | 45.32 |
| 2026-11-03 00:01:14 UTC | BUY | 66.57 | 45.36 |
| 2026-11-03 00:06:19 UTC | BUY | 66.58 | 45.38 |
| 2026-11-03 00:11:16 UTC | BUY | 66.55 | 45.32 |
| 2026-11-03 00:16:16 UTC | BUY | 66.59 | 45.40 |
| 2026-11-03 00:21:16 UTC | BUY | 66.59 | 45.40 |
| 2026-11-03 00:26:19 UTC | BUY | 66.44 | 45.02 |
| 2026-11-03 00:31:17 UTC | BUY | 66.51 | 45.21 |
| 2026-11-03 00:36:18 UTC | BUY | 66.48 | 45.13 |
| 2026-11-03 00:41:16 UTC | BUY | 66.45 | 45.05 |
| 2026-11-03 00:46:16 UTC | BUY | 66.49 | 45.16 |
| 2026-11-03 00:51:32 UTC | BUY | 66.46 | 45.07 |
| 2026-11-03 00:56:18 UTC | BUY | 66.46 | 45.08 |
| 2026-11-03 01:01:14 UTC | BUY | 66.49 | 45.15 |
| 2026-11-03 01:06:18 UTC | BUY | 66.50 | 45.17 |
| 2026-11-03 01:11:15 UTC | BUY | 66.49 | 45.15 |
| 2026-11-03 01:16:16 UTC | BUY | 66.52 | 45.24 |
| 2026-11-03 01:21:15 UTC | BUY | 66.52 | 45.24 |
| 2026-11-03 01:26:19 UTC | BUY | 66.50 | 45.18 |
| 2026-11-03 01:31:14 UTC | BUY | 66.44 | 45.01 |
| 2026-11-03 01:36:17 UTC | BUY | 66.50 | 45.17 |
| 2026-11-03 01:41:15 UTC | BUY | 66.43 | 44.98 |
| 2026-11-03 01:46:16 UTC | BUY | 66.42 | 44.96 |
| 2026-11-03 01:51:15 UTC | BUY | 66.45 | 45.04 |
| 2026-11-03 01:56:17 UTC | BUY | 66.49 | 45.16 |
| 2026-11-03 02:01:15 UTC | BUY | 66.54 | 45.27 |
| 2026-11-03 02:06:18 UTC | BUY | 66.47 | 45.10 |
| 2026-11-03 02:11:15 UTC | BUY | 66.47 | 45.10 |
| 2026-11-03 02:16:15 UTC | BUY | 66.50 | 45.17 |
| 2026-11-03 02:21:16 UTC | BUY | 66.45 | 45.04 |
| 2026-11-03 02:26:17 UTC | BUY | 66.43 | 44.98 |
| 2026-11-03 02:31:27 UTC | BUY | 66.42 | 44.96 |
| 2026-11-03 02:36:18 UTC | BUY | 66.43 | 44.98 |
| 2026-11-03 02:41:15 UTC | BUY | 66.43 | 44.98 |
| 2026-11-03 02:46:15 UTC | BUY | 66.43 | 45.00 |
| 2026-11-03 02:51:15 UTC | BUY | 66.42 | 44.97 |
| 2026-11-03 02:56:17 UTC | BUY | 66.42 | 44.97 |
| 2026-11-03 03:01:13 UTC | BUY | 66.42 | 44.96 |
| 2026-11-03 03:06:17 UTC | BUY | 66.43 | 45.00 |
| 2026-11-03 03:11:15 UTC | BUY | 66.43 | 45.00 |
| 2026-11-03 03:16:16 UTC | BUY | 66.42 | 44.96 |
| 2026-11-03 03:21:15 UTC | BUY | 66.42 | 44.96 |
| 2026-11-03 03:26:18 UTC | BUY | 66.42 | 44.96 |
| 2026-11-03 03:31:14 UTC | BUY | 66.42 | 44.96 |
| 2026-11-03 03:36:18 UTC | BUY | 66.46 | 45.08 |
| 2026-11-03 03:41:15 UTC | BUY | 66.49 | 45.15 |
| 2026-11-03 03:46:15 UTC | BUY | 66.52 | 45.23 |
| 2026-11-03 03:51:16 UTC | BUY | 66.55 | 45.31 |
| 2026-11-03 03:56:19 UTC | BUY | 66.55 | 45.31 |
| 2026-11-03 04:01:14 UTC | BUY | 66.55 | 45.32 |
| 2026-11-03 04:06:17 UTC | BUY | 66.55 | 45.32 |
| 2026-11-03 04:11:15 UTC | BUY | 66.51 | 45.20 |
| 2026-11-03 04:16:16 UTC | BUY | 66.63 | 45.52 |
| 2026-11-03 04:21:15 UTC | BUY | 66.57 | 45.35 |
| 2026-11-03 04:26:19 UTC | BUY | 66.57 | 45.36 |
| 2026-11-03 04:31:14 UTC | BUY | 66.57 | 45.36 |
| 2026-11-03 04:36:17 UTC | BUY | 66.59 | 45.42 |
| 2026-11-03 04:41:16 UTC | BUY | 66.66 | 45.59 |
| 2026-11-03 04:46:16 UTC | BUY | 66.51 | 45.20 |
| 2026-11-03 04:51:15 UTC | BUY | 66.51 | 45.21 |
| 2026-11-03 04:56:19 UTC | BUY | 66.51 | 45.19 |
| 2026-11-03 05:01:13 UTC | BUY | 66.52 | 45.23 |
| 2026-11-03 05:06:19 UTC | BUY | 66.55 | 45.32 |
| 2026-11-03 05:11:15 UTC | BUY | 66.56 | 45.33 |
| 2026-11-03 05:16:17 UTC | BUY | 66.53 | 45.25 |
| 2026-11-03 05:21:16 UTC | BUY | 66.52 | 45.23 |
| 2026-11-03 05:26:17 UTC | BUY | 66.50 | 45.18 |
| 2026-11-03 05:31:13 UTC | BUY | 66.42 | 44.97 |
| 2026-11-03 05:36:17 UTC | BUY | 66.49 | 45.15 |
| 2026-11-03 05:41:15 UTC | BUY | 66.48 | 45.12 |
| 2026-11-03 05:46:16 UTC | BUY | 66.44 | 45.02 |
| 2026-11-03 05:51:17 UTC | BUY | 66.44 | 45.02 |
| 2026-11-03 05:56:17 UTC | BUY | 66.53 | 45.25 |
| 2026-11-03 06:01:15 UTC | BUY | 66.48 | 45.11 |
| 2026-11-03 06:06:17 UTC | BUY | 66.42 | 44.96 |
| 2026-11-03 06:11:15 UTC | BUY | 66.42 | 44.96 |
| 2026-11-03 06:16:16 UTC | BUY | 66.43 | 45.00 |
| 2026-11-03 06:21:16 UTC | BUY | 66.43 | 44.99 |
| 2026-11-03 06:26:18 UTC | BUY | 66.42 | 44.96 |
| 2026-11-03 06:31:13 UTC | BUY | 66.44 | 45.02 |
| 2026-11-03 06:36:18 UTC | BUY | 66.46 | 45.07 |
| 2026-11-03 06:41:16 UTC | BUY | 66.43 | 45.00 |
| 2026-11-03 06:46:16 UTC | BUY | 66.42 | 44.96 |
| 2026-11-03 06:51:16 UTC | BUY | 66.43 | 44.98 |
| 2026-11-03 06:56:18 UTC | BUY | 66.42 | 44.97 |
| 2026-11-03 07:01:13 UTC | BUY | 66.45 | 45.04 |
| 2026-11-03 07:06:19 UTC | BUY | 66.43 | 44.99 |
| 2026-11-03 07:11:15 UTC | BUY | 66.49 | 45.16 |
| 2026-11-03 07:16:17 UTC | BUY | 66.55 | 45.30 |
| 2026-11-03 07:21:15 UTC | BUY | 66.49 | 45.16 |
| 2026-11-03 07:26:17 UTC | BUY | 66.57 | 45.36 |
| 2026-11-03 07:31:14 UTC | BUY | 66.59 | 45.40 |
| 2026-11-03 07:36:18 UTC | BUY | 66.54 | 45.27 |
| 2026-11-03 07:41:15 UTC | BUY | 66.56 | 45.34 |
| 2026-11-03 07:46:16 UTC | BUY | 66.58 | 45.38 |
| 2026-11-03 07:51:25 UTC | BUY | 66.58 | 45.38 |
| 2026-11-03 07:56:18 UTC | BUY | 66.47 | 45.10 |
| 2026-11-03 08:01:19 UTC | BUY | 66.45 | 45.04 |
| 2026-11-03 08:06:18 UTC | BUY | 66.55 | 45.32 |
| 2026-11-03 08:11:15 UTC | BUY | 66.55 | 45.32 |
| 2026-11-03 08:16:16 UTC | BUY | 66.55 | 45.31 |
| 2026-11-03 08:21:15 UTC | BUY | 66.50 | 45.18 |
| 2026-11-03 08:26:17 UTC | BUY | 66.55 | 45.32 |
| 2026-11-03 08:31:16 UTC | BUY | 66.43 | 44.99 |
| 2026-11-03 08:36:18 UTC | BUY | 66.43 | 44.98 |
| 2026-11-03 08:41:15 UTC | BUY | 66.43 | 44.99 |
| 2026-11-03 08:46:16 UTC | BUY | 66.54 | 45.27 |
| 2026-11-03 08:51:14 UTC | BUY | 66.44 | 45.03 |
| 2026-11-03 08:56:17 UTC | BUY | 66.48 | 45.11 |
| 2026-11-03 09:01:14 UTC | BUY | 66.47 | 45.10 |
| 2026-11-03 09:06:17 UTC | BUY | 66.47 | 45.10 |
| 2026-11-03 09:11:15 UTC | BUY | 66.43 | 44.98 |
| 2026-11-03 09:16:16 UTC | BUY | 66.43 | 44.99 |
| 2026-11-03 09:21:24 UTC | BUY | 66.44 | 45.02 |
| 2026-11-03 09:26:17 UTC | BUY | 66.42 | 44.96 |
| 2026-11-03 09:31:15 UTC | BUY | 66.44 | 45.02 |
| 2026-11-03 09:36:17 UTC | BUY | 66.42 | 44.97 |
| 2026-11-03 09:41:15 UTC | BUY | 66.42 | 44.97 |
| 2026-11-03 09:46:15 UTC | BUY | 66.44 | 45.02 |
| 2026-11-03 09:51:16 UTC | BUY | 66.46 | 45.06 |
| 2026-11-03 09:56:17 UTC | BUY | 66.43 | 44.99 |
| 2026-11-03 10:01:14 UTC | BUY | 66.48 | 45.12 |
| 2026-11-03 10:06:18 UTC | BUY | 66.43 | 44.98 |
| 2026-11-03 10:11:16 UTC | BUY | 66.42 | 44.97 |
| 2026-11-03 10:16:16 UTC | BUY | 66.47 | 45.10 |
| 2026-11-03 10:21:16 UTC | BUY | 66.44 | 45.03 |
| 2026-11-03 10:26:18 UTC | BUY | 66.47 | 45.09 |
| 2026-11-03 10:31:15 UTC | BUY | 66.47 | 45.09 |
| 2026-11-03 10:36:16 UTC | BUY | 66.42 | 44.97 |
| 2026-11-03 10:41:15 UTC | BUY | 66.42 | 44.97 |
| 2026-11-03 10:46:16 UTC | BUY | 66.49 | 45.14 |
| 2026-11-03 10:51:15 UTC | BUY | 66.44 | 45.02 |
| 2026-11-03 10:56:18 UTC | BUY | 66.43 | 44.98 |
| 2026-11-03 11:01:13 UTC | BUY | 66.42 | 44.97 |
| 2026-11-03 11:06:17 UTC | BUY | 66.44 | 45.01 |
| 2026-11-03 11:11:15 UTC | BUY | 66.47 | 45.10 |
| 2026-11-03 11:16:16 UTC | BUY | 66.47 | 45.10 |
| 2026-11-03 11:21:22 UTC | BUY | 66.46 | 45.08 |
| 2026-11-03 11:26:17 UTC | BUY | 66.54 | 45.28 |
| 2026-11-03 11:31:16 UTC | BUY | 66.52 | 45.24 |
| 2026-11-03 11:36:18 UTC | BUY | 66.62 | 45.50 |
| 2026-11-03 11:41:15 UTC | BUY | 66.59 | 45.40 |
| 2026-11-03 11:46:16 UTC | BUY | 66.57 | 45.37 |
| 2026-11-03 11:51:31 UTC | BUY | 66.68 | 45.64 |
| 2026-11-03 11:56:16 UTC | BUY | 66.68 | 45.65 |

