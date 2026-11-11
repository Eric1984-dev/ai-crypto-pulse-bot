# Portfolio Snapshot Repeated-Value Analysis

**Production data observed:** 2026-11-04 09:08–09:10 UTC
**Scope:** Read-only comparison of three consecutive 100-snapshot windows, relevant database/source-code review, and candle-price proxy analysis. No code, database, or scheduler settings were changed.

## Executive summary

The repeat rate increased sharply across the three windows: 2.0% of adjacent snapshot pairs in the oldest window, 32.3% in the middle window, and 78.8% in the latest window. The earlier Portfolio History audit reported 77.8%; the latest 100-point window advanced by one snapshot before this analysis, moving the observed rate to 78.8%.

The clearest operational change is a SELL at 2026-11-04 01:48:12 UTC. The first subsequent snapshot, at 01:53 UTC, records one open position instead of two. The latest 100 snapshots contain one open position in 89 points and two in 11 points; both earlier windows contain two positions throughout.

The remaining position's candle history supports a substantial flat interval: the longest same-value portfolio run covers 30 snapshots over 145.04 minutes, from 01:53 to 04:18 UTC. Only one 1-minute candle and one 5-minute candle are recorded for that position's market during the interval, both with the same close at 04:16 UTC. This is consistent with no recorded traded-price movement during most of the plateau, but missing candle records cannot be distinguished from absent trades using the available evidence.

This is not a complete explanation for all repeated values. In the latest window, 5-minute candle closes changed during 13 snapshot intervals, including eight intervals where the portfolio snapshot value nevertheless stayed the same. Historical ticker values consumed by each portfolio refresh are not retained, so the exact cause of those cases—and whether the same `Market_Data` price was reused—cannot be proven.

## Three-window comparison

Each window is a separate, consecutive block of the latest 300 snapshots for the observed portfolio. “Repeated” counts adjacent pairs with exactly equal stored portfolio values, so each 100-point window has 99 comparable pairs.

| Window | Snapshot timestamp range (UTC) | Distinct portfolio values | Repeated adjacent pairs | Open-position counts | Distinct available-balance values |
|---|---|---:|---:|---|---:|
| Latest 100 | 2026-11-04 00:58:12–09:08:11 | 21 | 78/99 (78.8%) | 89 with 1; 11 with 2 | 2 |
| Previous 100 | 2026-11-03 16:38:13–2026-11-04 00:53:09 | 68 | 32/99 (32.3%) | 100 with 2 | 1 |
| Older 100 | 2026-11-03 08:18:12–16:33:10 | 98 | 2/99 (2.0%) | 100 with 2 | 1 |

No window included a snapshot with zero open positions. In the latest window, the count changed from two to one immediately after the SELL at 01:48:12 UTC. There was no later BUY in the observed period to restore the second position.

## Price and snapshot correlation

The current remaining position existed throughout all three windows. Its stored 5-minute candle closes provide a market-price proxy, not the exact ticker-price series used by the portfolio refresh.

| Window | Adjacent snapshot pairs with a 5m candle row | Pairs with a changed 5m close | Portfolio unchanged despite a changed close | Portfolio unchanged with no 5m candle row | Portfolio changed with a changed close |
|---|---:|---:|---:|---:|---:|
| Latest 100 | 16/99 | 13/99 | 8 | 68 | 5 |
| Previous 100 | 15/99 | 15/99 | 3 | 29 | 12 |
| Older 100 | 22/99 | 21/99 | 0 | 2 | 21 |

For the longest latest-window plateau:

- **Portfolio snapshots:** 30 consecutive equal values, 2026-11-04 01:53:09–04:18:12 UTC (145.04 minutes).
- **Held-market candle records in that span:** one 1-minute candle and one 5-minute candle, both timestamped 04:16 UTC.
- **Recorded candle-close changes:** none.

The candle evidence supports a quiet or unobserved market-price interval for the remaining position. It does not distinguish an interval without trades from a candle-collection gap. Later in the latest window, candle closes do change; however, a candle close is not necessarily the ticker value used by a particular paper-trading refresh, and the snapshots may be sampled at a different point in time.

## Snapshot, valuation, and market-data mechanics

1. **Snapshots are periodic persisted marks, not continuous valuations.** `AI_Crypto_Bot_Run_Paper_Trading` refreshes each portfolio before processing decisions. The refresh inserts a snapshot on success; an executed trade can also insert a post-trade snapshot. The documented five-minute paper-trading cadence is a suitable example, and the observed snapshot gaps in the earlier chart audit were approximately five minutes.
2. **Valuation uses stored market-data marks.** The refresh updates an open position from `AI_Crypto_Bot_Market_Data` only when the matching row is no more than 15 minutes old (with a one-minute future-time allowance). It then calculates portfolio value as available balance plus the value of all open positions and rounds the result to 12 decimal places.
3. **Only one position usually contributed in the latest window.** After the SELL, the portfolio's open-position valuation was driven by the one remaining position rather than two. This is strongly associated in time with the repeat-rate increase, but the comparison alone cannot establish that the SELL caused the repeats.
4. **Market-data history is not available for a historical run-by-run comparison.** `AI_Crypto_Bot_Market_Data` has one latest row per symbol; ticker refreshes upsert on `symbol`, replacing the prior row. At approximately 09:10 UTC, 102 symbols had rows sharing the 09:05:17 UTC capture time. The ticker response also has an in-process 60-second cache, and the portfolio refresh permits use of a market-data row up to 15 minutes old. Therefore reuse of a still-eligible value is possible, but historical reuse cannot be confirmed.
5. **Storage precision is not cent-level rounding.** The valuation formula rounds to 12 decimal places and snapshot columns use `numeric(28,12)`. This makes ordinary changes unlikely to disappear due to storage precision, though extremely small changes below the final 1e-12 precision can be rounded away. The exact repeated values in the database show that the result is not merely the chart's two-decimal currency formatting.

No adjacent pair in these windows had an unchanged total portfolio value while available balance changed. This is consistent with the repetitions arising in the portfolio mark rather than a balance movement offsetting a position-value change.

## Provider-event context

Two provider-related scanner events were present in the combined 300-snapshot period: one provider-timeout event in the older window and one provider-unavailable event in the previous window. Neither fell in the latest 100-snapshot window or the 01:53–04:18 plateau. The events do not establish which market was affected or whether the ticker row for the held position was stale. They therefore do not explain the latest plateau.

## Assessment

The evidence points to a **combination of reduced exposure and little recorded candle activity in the remaining position's market during the longest plateau**, with snapshot sampling and latest-only market-data storage limiting attribution. The SELL/open-position transition is clear, and the candle proxy is flat during the 145-minute run. Yet later candle-close changes coexist with unchanged portfolio snapshots, so it would be inaccurate to claim that all 78 repeated pairs resulted from an unchanged market price or stale quote reuse.

To confirm the exact per-snapshot cause, future diagnostics would need to retain a valuation input trace (for example, the market-data price and `captured_at` used for each open position at each refresh). That is a recommendation for observability only; this read-only analysis made no implementation or schema changes.

## Sources

- Production read-only aggregates from `AI_Crypto_Bot_Portfolio_Snapshots`, `AI_Crypto_Bot_Positions`, `AI_Crypto_Bot_Trades`, `AI_Crypto_Bot_Candles`, `AI_Crypto_Bot_Market_Data`, and scanner events, observed 2026-11-04 09:08–09:10 UTC. Queries returned aggregate counts and timestamps, not portfolio values or market identifiers.
- [Portfolio refresh valuation and 15-minute market-data eligibility](../../PostgreSQL/migrations/20261101154600_phase08_paper_trading.sql#L81), [snapshot insertion](../../PostgreSQL/migrations/20261101154600_phase08_paper_trading.sql#L135), [post-trade snapshot insertion](../../PostgreSQL/migrations/20261101154600_phase08_paper_trading.sql#L555), and [scheduled paper-trading refresh flow](../../PostgreSQL/migrations/20261101154600_phase08_paper_trading.sql#L582).
- [Market-data refresh check and symbol upsert](../../lib/market-data.mjs#L96), [60-second ticker cache](../../lib/market-data.mjs#L694), [ticker-price parsing and capture timestamp](../../lib/market-data.mjs#L780), and [60-second freshness threshold](../../lib/market-data.mjs#L1152).
- [Market-data and candle schema](../../PostgreSQL/migrations/20261031190000_create_agent_tables.sql#L73) and [snapshot numeric precision](../../PostgreSQL/migrations/20261031190000_create_agent_tables.sql#L208).
- [Database documentation: latest market snapshot per symbol](../DATABASE.md#agent-market-and-strategy-tables) and [paper-trading execution cadence and behavior](../SCHEDULING.md#phase-08-paper-trading-execution).
- [Portfolio History chart audit](./PORTFOLIO_HISTORY_AUDIT.md) for the persisted-snapshot chart behavior and observed cadence.
