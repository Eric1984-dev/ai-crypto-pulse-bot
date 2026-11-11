# Portfolio Valuation Trace Audit

**Production data observed:** 2026-11-04 09:32 UTC
**Scope:** Read-only trace of the 145-minute WIN-EUR portfolio plateau, comparison with stored candles and the latest market-data row, and valuation-sensitivity calculations. No code, database, or scheduler settings were changed.

## Executive finding

The 145-minute flat is fully explained at the **valuation-input layer**: all 30 snapshots have the same available balance, one open WIN-EUR position, the same position quantity, and the same implied position mark. That tuple reproduces the stored portfolio value exactly. The position was not too small for ordinary price movements, and 12-decimal rounding cannot explain a flat lasting 30 snapshots.

The mark remained **€0.000059401 per WIN** through the 04:18:12 UTC snapshot. Candle history then showed a new 1m/5m close of **€0.000060599**, but the 04:18 snapshot still used the old implied mark. At 04:23:08, the position mark changed to €0.000060599 and the portfolio increased by **€19.585027345208**—exactly the position quantity multiplied by the mark difference.

This is strong evidence that the portfolio mark lagged the changing market-price proxy and then caught up on a later valuation run. The available database cannot establish whether the historical `Market_Data` row had an unchanged `last` price or lacked a fresh eligible row: `Market_Data` retains only the latest row per symbol, not a quote history. So the repeated **stored mark** is proven; the exact upstream feed/refresh cause is not.

## Trace method and limits

Snapshots store total portfolio value, available balance, open-position count, and capture time, but not per-position prices or values. `Market_Data` stores one row per symbol and overwrites it on refresh. Consequently, the historical `Market_Data.price` and `captured_at` used for each of the 30 snapshots cannot be queried retrospectively.

For the 145-minute interval, every snapshot had exactly one open position and no WIN-EUR trades occurred. The position quantity therefore remained constant. The implied WIN-EUR mark can be reconstructed from:

```text
implied mark = (snapshot portfolio value - available balance) / WIN-EUR quantity
```

This is an inference from the persisted snapshot, not a historical read of `Market_Data`. Candle timestamps and closes below are the latest stored candle at or before each snapshot; candles are a price proxy and are not the input used by the paper-portfolio refresh.

## Identical valuation tuple across all 30 snapshots

| Field | Value in every snapshot |
|---|---:|
| Open positions | 1 |
| Available balance | €8,754.548395983575 |
| WIN-EUR quantity | 16,348,102.959272006431 |
| Implied WIN-EUR mark | €0.000059401000 |
| WIN-EUR market-value contribution | €971.093663883716 |
| Final portfolio value | €9,725.642059867291 |
| Historical `Market_Data.captured_at` | Not retained per snapshot |

The following table lists every snapshot in the flat run and the latest candle records visible as of that snapshot:

| Snapshot UTC | Latest 1m candle at/before snapshot (close) | Latest 5m candle at/before snapshot (close) |
|---|---|---|
| 2026-11-04 01:53:09.816843 | 2026-11-03 21:16 (€0.000060635) | 2026-11-03 21:15 (€0.000060635) |
| 2026-11-04 01:58:11.861954 | 2026-11-03 21:16 (€0.000060635) | 2026-11-03 21:15 (€0.000060635) |
| 2026-11-04 02:03:10.051255 | 2026-11-03 21:16 (€0.000060635) | 2026-11-03 21:15 (€0.000060635) |
| 2026-11-04 02:08:11.972166 | 2026-11-03 21:16 (€0.000060635) | 2026-11-03 21:15 (€0.000060635) |
| 2026-11-04 02:13:09.809949 | 2026-11-03 21:16 (€0.000060635) | 2026-11-03 21:15 (€0.000060635) |
| 2026-11-04 02:18:11.838184 | 2026-11-03 21:16 (€0.000060635) | 2026-11-03 21:15 (€0.000060635) |
| 2026-11-04 02:23:09.361743 | 2026-11-03 21:16 (€0.000060635) | 2026-11-03 21:15 (€0.000060635) |
| 2026-11-04 02:28:12.258953 | 2026-11-03 21:16 (€0.000060635) | 2026-11-03 21:15 (€0.000060635) |
| 2026-11-04 02:33:10.539666 | 2026-11-03 21:16 (€0.000060635) | 2026-11-03 21:15 (€0.000060635) |
| 2026-11-04 02:38:12.237298 | 2026-11-03 21:16 (€0.000060635) | 2026-11-03 21:15 (€0.000060635) |
| 2026-11-04 02:43:09.401467 | 2026-11-03 21:16 (€0.000060635) | 2026-11-03 21:15 (€0.000060635) |
| 2026-11-04 02:48:12.963414 | 2026-11-03 21:16 (€0.000060635) | 2026-11-03 21:15 (€0.000060635) |
| 2026-11-04 02:53:09.183561 | 2026-11-03 21:16 (€0.000060635) | 2026-11-03 21:15 (€0.000060635) |
| 2026-11-04 02:58:11.740590 | 2026-11-03 21:16 (€0.000060635) | 2026-11-03 21:15 (€0.000060635) |
| 2026-11-04 03:03:10.095530 | 2026-11-03 21:16 (€0.000060635) | 2026-11-03 21:15 (€0.000060635) |
| 2026-11-04 03:08:11.515547 | 2026-11-03 21:16 (€0.000060635) | 2026-11-03 21:15 (€0.000060635) |
| 2026-11-04 03:13:09.850246 | 2026-11-03 21:16 (€0.000060635) | 2026-11-03 21:15 (€0.000060635) |
| 2026-11-04 03:18:11.364834 | 2026-11-03 21:16 (€0.000060635) | 2026-11-03 21:15 (€0.000060635) |
| 2026-11-04 03:23:08.363072 | 2026-11-03 21:16 (€0.000060635) | 2026-11-03 21:15 (€0.000060635) |
| 2026-11-04 03:28:11.448990 | 2026-11-03 21:16 (€0.000060635) | 2026-11-03 21:15 (€0.000060635) |
| 2026-11-04 03:33:10.165300 | 2026-11-03 21:16 (€0.000060635) | 2026-11-03 21:15 (€0.000060635) |
| 2026-11-04 03:38:10.947785 | 2026-11-03 21:16 (€0.000060635) | 2026-11-03 21:15 (€0.000060635) |
| 2026-11-04 03:43:09.074065 | 2026-11-03 21:16 (€0.000060635) | 2026-11-03 21:15 (€0.000060635) |
| 2026-11-04 03:48:12.093194 | 2026-11-03 21:16 (€0.000060635) | 2026-11-03 21:15 (€0.000060635) |
| 2026-11-04 03:53:08.800257 | 2026-11-03 21:16 (€0.000060635) | 2026-11-03 21:15 (€0.000060635) |
| 2026-11-04 03:58:12.259419 | 2026-11-03 21:16 (€0.000060635) | 2026-11-03 21:15 (€0.000060635) |
| 2026-11-04 04:03:09.557865 | 2026-11-03 21:16 (€0.000060635) | 2026-11-03 21:15 (€0.000060635) |
| 2026-11-04 04:08:11.499799 | 2026-11-03 21:16 (€0.000060635) | 2026-11-03 21:15 (€0.000060635) |
| 2026-11-04 04:13:09.170397 | 2026-11-03 21:16 (€0.000060635) | 2026-11-03 21:15 (€0.000060635) |
| 2026-11-04 04:18:12.121526 | 2026-11-04 04:16 (€0.000060599) | 2026-11-04 04:15 (€0.000060599) |

## Price-capture sequence around the plateau

| Snapshot UTC | Implied WIN-EUR mark | WIN-EUR value | Portfolio value | Latest 5m close available |
|---|---:|---:|---:|---:|
| 2026-11-04 01:53:09–04:18:12 (30 snapshots) | €0.000059401 | €971.093663883716 | €9,725.642059867291 | €0.000060635 until 04:18; then €0.000060599 |
| 2026-11-04 04:23:08 | €0.000060599 | €990.678691228924 | €9,745.227087212499 | €0.000060599 |
| 2026-11-04 05:18:11 | €0.000060599 | €990.678691228924 | €9,745.227087212499 | €0.000060381 |
| 2026-11-04 05:23:10 | €0.000060381 | €987.114804783803 | €9,741.663200767378 | €0.000060219 |

At 04:18, the latest candle close was 2.016801% above the implied portfolio mark, yet the snapshot remained at the old value. At 04:23, the mark matched that 04:16 candle close. The portfolio increase exactly equals `quantity × (€0.000060599 - €0.000059401)`. A later example at 05:18–05:23 shows the same lag pattern: the 05:18 snapshot retained the prior mark despite a newer candle close, and the following snapshot adopted €0.000060381.

Across the latest 100-snapshot window ending at 09:28:11 UTC, there were 91 adjacent pairs with one open position. Portfolio value repeated in 78 pairs; a 5-minute candle close changed in 15 pairs, including 10 pairs where the portfolio value did not change. This establishes that candle closes can change while the persisted portfolio mark remains flat, but does not prove that the exact `Market_Data.price` input changed in those pairs.

## Latest snapshot and current source comparison

The latest snapshot at **2026-11-04 09:28:11 UTC** recorded portfolio value **€9,758.501746815428** and WIN-EUR mark **€0.000061411**. The quantity remained **16,348,102.959272006431**, giving a position value of **€1,003.953350831853**, or **10.287987%** of the portfolio.

At the database observation time (09:32:09 UTC), the latest `Market_Data` row also contained €0.000061411, captured at **09:30:33 UTC**—about 2 minutes 22 seconds after the snapshot. Its equal price is consistent with the mark used at 09:28, but its later timestamp means it cannot establish that row as the snapshot's actual input. The latest stored 1m candle was at 09:21 (close €0.000060170) and the latest 5m candle at 09:20 (close €0.000060170), respectively about 7.18 and 8.18 minutes before the snapshot. These timestamps/prices are distinct from the ticker snapshot.

## WIN-EUR portfolio sensitivity

The position is **not small relative to this portfolio**: it represented 9.984880% during the flat interval and 10.287987% at the latest snapshot. The following assumes available balance and all other inputs remain constant.

| Base valuation | Position value | Price move | Expected position-value / portfolio change | Approx. total portfolio change |
|---|---:|---:|---:|---:|
| 145-minute plateau | €971.093663883716 | 1% | ±€9.710936638837 | ±0.099849% |
| 145-minute plateau | €971.093663883716 | 5% | ±€48.554683194186 | ±0.499244% |
| 145-minute plateau | €971.093663883716 | 10% | ±€97.109366388372 | ±0.998488% |
| Latest snapshot | €1,003.953350831853 | 1% | ±€10.039533508319 | ±0.102880% |
| Latest snapshot | €1,003.953350831853 | 5% | ±€50.197667541593 | ±0.514399% |
| Latest snapshot | €1,003.953350831853 | 10% | ±€100.395335083185 | ±1.028799% |

## Findings by proposed cause

| Candidate cause | Finding |
|---|---|
| Unchanged market-data value | The **implied position mark** was exactly unchanged across all 30 snapshots. Historical `Market_Data.price` values are overwritten, so whether its row was repeatedly refreshed with the same price is unknown. |
| Very small position | Ruled out as the primary explanation. WIN-EUR was approximately 10% of the portfolio; a 1% move should change total value by about 0.10%, far above the 12-decimal storage precision. |
| Valuation logic | The formula is consistent with the data: available balance plus `quantity × current_price`, rounded to 12 places. The 04:23 price transition reproduces the observed €19.585027345208 portfolio increase exactly. No arithmetic defect is indicated. |
| Stale or unavailable eligible `Market_Data` | A single stale row is not eligible for the full 145 minutes: the SQL refresh accepts market data only up to 15 minutes old. If no eligible row matches, the position's existing `current_price` is not overwritten, and the refresh can still snapshot the portfolio using that stored mark. The history cannot distinguish this case from an eligible row that continued reporting the same last-traded price. |
| Candle/portfolio mismatch | Confirmed as a proxy mismatch. The 04:18 candle close had advanced while the stored valuation had not; the valuation caught up at 04:23. Candle close is not the direct paper-trading valuation input. |

No WIN-EUR trade and no matching WIN-EUR/provider/market-data refresh event were found in the 01:53–04:18 interval. This does not rule out a refresh issue because the event table is not a per-run quote audit.

## Exact reason and conclusion

**Exact persisted-data reason:** all 30 snapshots reused the same effective WIN-EUR mark (€0.000059401), with the same quantity and available balance. The portfolio calculation therefore produced the same total at every snapshot. The unchanged value is not caused by a small notional position or by two-decimal display formatting.

**Most likely upstream explanation:** the valuation mark did not advance with the market-price proxy during the plateau, then caught up to the €0.000060599 close on the 04:23 refresh. The implementation permits the last stored position mark to persist when there is no eligible `Market_Data` row. However, the exact historical `Market_Data.captured_at` and quote values were not retained, so this audit cannot conclusively attribute the delay to stale/missing ticker refresh versus an unchanged ticker `last` value. No claim is made that the precise upstream feed failure has been proven.

Future per-refresh observability would need to record, alongside each portfolio snapshot, each open position's market-data price and `captured_at`, quantity, calculated position value, and whether a fresh market-data row was applied. This is a recommendation only; no code or database changes were made.

## Sources

- Read-only production queries against `AI_Crypto_Bot_Portfolio_Snapshots`, `AI_Crypto_Bot_Positions`, `AI_Crypto_Bot_Trades`, `AI_Crypto_Bot_Market_Data`, `AI_Crypto_Bot_Candles`, and `AI_Crypto_Bot_Scanner_Events`, observed 2026-11-04 09:32 UTC.
- [Portfolio mark update and 15-minute eligibility filter](../../PostgreSQL/migrations/20261101154600_phase08_paper_trading.sql#L107), [valuation formula and snapshot insertion](../../PostgreSQL/migrations/20261101154600_phase08_paper_trading.sql#L120), and [scheduled refresh call](../../PostgreSQL/migrations/20261101154600_phase08_paper_trading.sql#L617).
- [Position and market-data schema](../../PostgreSQL/migrations/20261031190000_create_agent_tables.sql#L36), [one latest market-data row per symbol](../../PostgreSQL/migrations/20261031190000_create_agent_tables.sql#L73), [candle history schema](../../PostgreSQL/migrations/20261031190000_create_agent_tables.sql#L86), and [snapshot schema](../../PostgreSQL/migrations/20261031190000_create_agent_tables.sql#L208).
- [Ticker refresh and symbol upsert path](../../lib/market-data.mjs#L96), [60-second ticker cache](../../lib/market-data.mjs#L694), and [freshness check](../../lib/market-data.mjs#L1149).
- [Database documentation](../DATABASE.md) and [paper-trading scheduling documentation](../SCHEDULING.md#phase-08-paper-trading-execution).
- [Portfolio snapshot repeat analysis](./PORTFOLIO_SNAPSHOT_REPEAT_ANALYSIS.md) and [Portfolio History chart audit](./PORTFOLIO_HISTORY_AUDIT.md).
