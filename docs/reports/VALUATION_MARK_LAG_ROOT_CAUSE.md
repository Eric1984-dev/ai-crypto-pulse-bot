# Valuation Mark Lag Root-Cause Analysis

**Production data observed:** 2026-11-04 09:39 UTC
**Scope:** Read-only trace of the Bitvavo ticker-to-position valuation path and production records around the 145-minute WIN-EUR mark plateau. No code, database, or scheduler settings were changed.

## Executive conclusion

The valuation mark originates from the `last` field in Bitvavo's public `/ticker/24h` response. The market refresh stores that value as `AI_Crypto_Bot_Market_Data.price`; the paper-portfolio refresh copies an eligible row into `AI_Crypto_Bot_Positions.current_price`; the snapshot then values open positions from the stored position price.

The **persisted-data cause** of the flat is proven: the position retained a mark of **€0.000059401**, so each snapshot reused the same quantity and mark and calculated the same portfolio value. The implementation explicitly allows that mark to carry forward when no eligible market-data row is joined: it does not clear or reject the old position price, and it still calculates and inserts a snapshot.

The **upstream historical cause is not provable from retained production data**. The market-data table keeps only one row per symbol, overwriting each earlier quote. Snapshots do not record the input price or its capture time, and there is no persisted market-refresh execution history. Therefore, the available evidence cannot distinguish:

1. A missed/failed ticker refresh that left no eligible row, causing the old position mark to persist; or
2. Successful refreshes that kept recording the same Bitvavo `last` value, which remained eligible and was copied again.

Candle closes are a separate data stream and are not inputs to paper-portfolio valuation. Their movement shows a price-proxy divergence, not which ticker value the portfolio refresh received.

## End-to-end valuation path

1. **Market refresh** — `GET /api/market-refresh` authenticates the scheduler and calls `refreshScheduledMarkets`. The service reads watched markets and existing market-data rows. A row is considered fresh for **60 seconds**; stale/missing rows lead to a Bitvavo ticker fetch.
2. **Ticker parsing and persistence** — The service fetches `/ticker/24h`, reads `ticker.last` as the price, assigns `captured_at` from the application's current time, and upserts by `symbol`. The schema enforces one `Market_Data` row per symbol, so each upsert replaces the prior row. The persisted timestamp is when the application captured the response; the code does not retain a separate provider quote/trade timestamp.
3. **Paper-trading run** — `POST /api/paper-trading` calls the database paper-trading RPC. The RPC iterates portfolios and invokes `AI_Crypto_Bot_Refresh_Paper_Portfolio` before processing decisions, producing portfolio snapshots on scheduled runs even when no trade occurs.
4. **Position mark update** — The refresh function copies `Market_Data.price` to each open position only if the matching row's `captured_at` is between **15 minutes old and 1 minute in the future**. If no row qualifies, the `UPDATE` simply affects no matching position. The function does not return a stale-price status for that case or clear the previous `current_price`. Position updates set `updated_at` through a database trigger.
5. **Snapshot calculation** — Regardless of whether the position update matched a market-data row, the function calculates `available_balance + SUM(amount × current_price)`, updates the portfolio, and inserts a snapshot. Thus snapshots can continue at the normal cadence while reusing an old position mark.

Market refresh, candle refresh, and paper trading are separate scheduled operations. Candle closes are not consulted by the portfolio refresh.

Provider/storage errors handled inside the market-data service set a `refreshStatus` and preserve the last stored rows. Because the route can return normally for such a handled failure, HTTP 200 alone does not prove that the ticker data was updated; the response status and processed-record metrics must also be checked.

## Production evidence

### Historical plateau

- The 30 snapshots from **01:53:09 to 04:18:12 UTC** retained portfolio value **€9,725.642059867291**, available balance **€8,754.548395983575**, and the same open WIN-EUR position.
- Reconstructing the mark from each snapshot and the unchanged quantity gives **€0.000059401** for every row.
- A newer 1m/5m candle close was visible at the 04:18 snapshot, but that snapshot still had the old value. By 04:23, the mark had moved to **€0.000060599** and the portfolio value rose by **€19.585027345208**, exactly the position quantity multiplied by the mark difference.
- Snapshots continued at roughly five-minute intervals throughout the plateau. The paper-trading process was therefore still creating snapshots; that alone does not establish that each run updated the position from a fresh market-data row.
- `AI_Crypto_Bot_Scanner_Events` contained **zero events from 01:45 to 04:30 UTC**. The table records selected market/provider/storage failures, not successful per-run quote inputs; zero events is not proof every refresh succeeded.

### Current behavior at observation time

At **09:39:26 UTC**, production showed:

- All **102** `Market_Data` rows shared `captured_at = 09:35:15.009 UTC`; none was older than ten minutes.
- The position's `updated_at` was **09:38:11.096 UTC**, matching the latest snapshot time. Its `current_price` (**€0.000061411**) equaled the latest WIN-EUR market-data price (**€0.000061411**, captured 09:35:15 UTC).
- Portfolio snapshots were present at approximately 09:13, 09:18, 09:23, 09:28, 09:33, and 09:38 UTC.
- The deployed `AI_Crypto_Bot_Refresh_Paper_Portfolio` function definition matches the reviewed migration's freshness filter, mark update, valuation, and snapshot behavior.

This demonstrates that the market-data and paper-portfolio paths were operating in a cadence consistent with the documented five-minute schedule at the time of inspection. It does **not** establish their schedule or success during the earlier plateau.

## Answers to the investigation questions

| Question | Finding |
|---|---|
| Is `Market_Data` updating on schedule? | **Currently consistent with schedule:** all 102 rows were captured together at 09:35:15 UTC, less than five minutes before the 09:39:26 database observation. **For the plateau:** not verifiable from the one-row-per-symbol table or available event history. |
| Is `position.current_price` being updated on schedule? | **Currently yes:** the row's update timestamp matched the 09:38:11 snapshot, and the stored position price equaled the eligible market-data price. Historical position update timestamps are overwritten, so they cannot show whether this happened at each plateau snapshot. |
| Did paper trading skip the refresh? | The overall portfolio refresh did not stop: it kept inserting snapshots. A position-price update can nevertheless match no eligible row and silently leave the prior price in place; the portfolio snapshot still proceeds. The historical records cannot establish whether this happened. |
| Was stale-but-eligible `Market_Data` reused? | A single row older than 15 minutes is **not eligible**. However, an eligible row can be copied repeatedly if its stored price is unchanged. If a row is missing/stale, the *position's previously stored mark* can persist for longer than 15 minutes. The historical quote/capture sequence needed to distinguish these cases is not retained. |
| Why did the mark remain €0.000059401 for about 145 minutes? | The direct mechanism is hold-last-mark valuation: each snapshot used the unchanged `Positions.current_price`. Whether that happened because eligible ticker rows kept reporting the same `last` value or because a fresh eligible row was absent cannot be determined. |

## Root-cause classification

**Confirmed behavior:** A missing or ineligible market-data row does not block portfolio refresh or snapshot creation. The old `Positions.current_price` remains usable indefinitely until a later eligible row overwrites it. This is the mechanism that permits a long flat mark despite later changes in another price series.

**Not established:** Whether the market refresh was missed/failed during the 145-minute interval, whether Bitvavo's `last` value was unchanged on successful refreshes, or how often a changed ticker price was available but not applied. The prior market-data rows were overwritten, the snapshot schema omits mark inputs, and the scanner-event table is not a successful-run log.

**Not indicated:** A valuation arithmetic or rounding defect. The 04:23 portfolio increase exactly matches the stored position quantity multiplied by the change in the implied mark.

## Observability gap

The current data model cannot reproduce the price input used by each historical snapshot. To distinguish an upstream refresh failure from a same-price ticker response in a future incident, each valuation run would need to retain, per open position, the applied `Market_Data.price`, its `captured_at`, its age, and whether a qualifying row was found. The market-refresh success/failure status and records-processed metrics would also need durable run history; current endpoint metrics are emitted to function logs rather than stored as per-run quote history. This is a recommendation only, not an implementation.

## Sources

- Read-only production queries against `AI_Crypto_Bot_Market_Data`, `AI_Crypto_Bot_Positions`, `AI_Crypto_Bot_Portfolio_Snapshots`, and `AI_Crypto_Bot_Scanner_Events`, observed 2026-11-04 09:39 UTC.
- [Market refresh route](../../api/market-refresh.mjs), [ticker refresh, parsing, and upsert path](../../lib/market-data.mjs#L96), [60-second ticker cache](../../lib/market-data.mjs#L694), and [market-data freshness check](../../lib/market-data.mjs#L1149).
- [Paper-trading route](../../api/paper-trading.mjs) and [scheduled paper-trading execution](../../PostgreSQL/migrations/20261101154600_phase08_paper_trading.sql#L617).
- [Portfolio mark update and 15-minute eligibility filter](../../PostgreSQL/migrations/20261101154600_phase08_paper_trading.sql#L107), [valuation and snapshot insertion](../../PostgreSQL/migrations/20261101154600_phase08_paper_trading.sql#L120), [position schema and update trigger](../../PostgreSQL/migrations/20261031190000_create_agent_tables.sql#L36), and [latest-row-per-symbol market-data schema](../../PostgreSQL/migrations/20261031190000_create_agent_tables.sql#L73).
- [Market and paper-trading scheduling documentation](../SCHEDULING.md) and [database documentation](../DATABASE.md).
- [Portfolio Valuation Trace Audit](./PORTFOLIO_VALUATION_TRACE_AUDIT.md), containing the full snapshot/candle comparison for the plateau.
