# Open-Position Strategy and Data Audit

**Production observation:** 2026-11-05 09:38:46 UTC<br>
**Database session timezone:** UTC<br>
**Yesterday window:** 2026-11-03 23:00 UTC through 2026-11-04 23:00 UTC, corresponding to 2026-11-04 in Europe/Brussels<br>
**Scope:** Read-only review of the five open paper positions, stored decisions, trades, portfolio snapshots, market marks, and retained candles. No code, database, scheduler, deployment, environment, or trading settings were changed.

## Executive findings

1. Production had **five open paper positions** at the observation time: ARX-EUR, MEGA-EUR, POL-EUR, SXT-EUR, and WIN-EUR. Each has one linked BUY trade and no SELL trade. All five are still unrealized; there is no realized P&L for these positions.
2. **ARX-EUR is the position that most likely explains the reported >EUR 100 profit.** Its strongest retained intraday mark was EUR 0.25293 at 15:31:23 UTC on Nov 4. Relative to the inferred raw entry quote, that represents about **EUR 227.46 price-only gross** and **EUR 219.83 estimated net** after the actual entry costs and the modeled exit fee/slippage. The position's database-style mark P&L at that price would be about EUR 224.04. This was an unrealized last-price mark, not a confirmed executable fill; exact historical position-card values are not retained.
3. At that ARX mark, the recorded AI decision was **BUY**, not SELL. Across all **1,835 decisions recorded after the five positions opened**, there were **zero SELL decisions** and zero SELL trades. No evidence shows that a SELL was generated and then ignored, rejected, or delayed.
4. The current strategy has **no per-position take-profit, trailing stop, stop-loss, or profit-protection exit**. It sells only when the deterministic analysis emits SELL and the executor receives a fresh eligible decision and market mark. That is a strategy limitation relative to profit protection, not evidence that the executor mishandled an existing SELL.
5. Candle and market-snapshot quality do **not** explain the missed ARX exit at the retained high or subsequent low. The high and low decision records both report all six intervals fresh, 100% candle coverage, and a fresh market snapshot. Some other decisions did have stale intervals; the engine records and excludes those intervals under its safeguards.
6. A separate **history-depth deployment/version discrepancy** is visible in production records. All 102 decisions at 13:46:19 UTC on Nov 4 recorded at least one interval above 150 candles; all 102 at 13:51:16 UTC recorded no interval above 150. Their stored strategy version remained `1.0.0`. This is evidence of a production input-depth switch, but its exact Vercel deployment and commit are not available from Supabase. It does not explain the lack of a SELL at ARX's later peak.
7. Documentation conflicts on the BUY gate: the deployed database function and [RISK_MANAGEMENT.md](../RISK_MANAGEMENT.md) use 67, while [API.md](../API.md) and the original [Phase 08 prompt](../../prompts/08_PAPER_TRADING.md) still say 70.

## Observation window and evidence coverage

The database returned `2026-11-05 09:38:46.192551+00` as the observation time. All five latest market-data rows were captured at `2026-11-05 09:35:13.718+00` (about 3 minutes 32 seconds old at the observation). The latest stored AI decisions were at `09:36:21 UTC`; the latest portfolio snapshot was at `09:38:12 UTC`.

The position histories begin with WIN-EUR's paper entry at `2026-11-02 14:13:09 UTC`; the other four entries were on Nov 4. For “yesterday,” I used the Europe/Brussels calendar day Nov 4. The UTC query interval is therefore Nov 3 23:00 through Nov 4 23:00, because Brussels was UTC+1.

Relevant retained row counts:

| Data | Rows / count | Scope |
|---|---:|---|
| Open positions | 5 | Current production |
| Closed positions | 1 | Current production; unrelated prior BEAM position |
| Trades | 7 | Five current BUYs plus prior BEAM BUY/SELL |
| Decisions after current position entries | 1,835 | ARX 269, MEGA 269, POL 269, SXT 224, WIN 804 |
| Decisions during the Nov 4 Brussels-time day | 1,420 | The five open-position markets |
| Candle rows | 14,608 | Five markets, timestamps from Oct 28 onward, all intervals |
| Portfolio snapshots | 816 | Portfolio, from Nov 2 14:00 UTC onward |

Inspected production tables included `AI_Crypto_Bot_Positions`, `AI_Crypto_Bot_Portfolios`, `AI_Crypto_Bot_Trades`, `AI_Crypto_Bot_AI_Decisions`, `AI_Crypto_Bot_Market_Data`, `AI_Crypto_Bot_Candles`, `AI_Crypto_Bot_Portfolio_Snapshots`, `AI_Crypto_Bot_Status`, `AI_Crypto_Bot_Emergency_State`, and `AI_Crypto_Bot_Strategies`. The current strategy catalog query returned no rows; recorded decisions instead identify the implemented strategy as `Deterministic Technical Analysis` version `1.0.0`.

The Supabase migration-list tool returned no migration rows. I did not treat that as proof that migrations were absent: the live table constraints and the production paper-trading function definition were checked directly. No Vercel deployment or scheduler log was available, so database snapshots are used only as evidence of persisted portfolio refreshes, not as a complete external invocation log.

## Current positions and marks

`Entry basis` is the database position `entry_price`, which includes entry fee and modeled entry slippage. `Gross price P&L` below is the price move from the entry market quote inferred from the recorded BUY fill and slippage, multiplied by quantity; it excludes fees and hypothetical exit costs. `Estimated net exit P&L` additionally applies the project's 0.10% adverse sell slippage and 0.25% exit fee and subtracts the actual entry cash cost. None of the estimated exits was executed.

| Market | Opened (UTC) | Quantity | Entry execution price | Entry fee | Entry slippage | Entry basis | Latest mark | Gross price P&L | Estimated net exit P&L |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ARX-EUR | Nov 4 11:03 | 4,755.527644 | 0.205305100 | EUR 2.4408 | EUR 0.9754 | 0.205818363 | 0.205060000 | -EUR 0.19 | **-EUR 7.02** |
| MEGA-EUR | Nov 4 11:03 | 22,538.544653 | 0.043303260 | EUR 2.4400 | EUR 0.9750 | 0.043411518 | 0.041910000 | -EUR 30.43 | **-EUR 37.15** |
| POL-EUR | Nov 4 11:03 | 11,346.638917 | 0.085985900 | EUR 2.4391 | EUR 0.9747 | 0.086200865 | 0.088103000 | +EUR 25.00 | **+EUR 18.09** |
| SXT-EUR | Nov 4 14:48 | 112,293.789622 | 0.008699691 | EUR 2.4423 | EUR 0.9759 | 0.008721440 | 0.007965000 | -EUR 81.53 | **-EUR 88.07** |
| WIN-EUR | Nov 2 14:13 | 16,348,102.959272 | 0.000060940 | EUR 2.4906 | EUR 0.9953 | 0.000061092 | 0.000060580 | -EUR 4.89 | **-EUR 11.84** |

At the same observation, the database's stored unrealized P&L (mark less fee-inclusive entry basis, but before exit costs) was approximately **-EUR 109.18** in aggregate. The modeled net liquidation estimate was approximately **-EUR 125.99**. These are estimates based on a current last-price mark, not realized results or executable quotes. The recorded realized P&L for each of the five positions remains zero.

The stored position mark matched the latest market-data price for each market at the final observation. Agent Status was `ACTIVE` and the latest Emergency State was `NORMAL`. The open-position limit is five; the existing-position check prevents further BUYs from stacking another position in any of these markets.

## The reported ARX-EUR profit: detailed timeline

All timestamps below are UTC; add one hour for Europe/Brussels local time on these dates.

| Time | Evidence | Interpretation |
|---|---|---|
| Nov 4 11:01:23 | Linked AI decision: BUY, confidence 67.31, Market Strength +35.03; six intervals available and fresh. Stored market price EUR 0.20510. | Entry signal passed the deployed BUY gate of 67. |
| Nov 4 11:03:10 | Linked paper BUY executed at EUR 0.2053051 for 4,755.527644 ARX; fee EUR 2.4408 and slippage EUR 0.9754. | Execution occurred 1m 46s after the decision. Entry basis became EUR 0.205818363 per unit after entry costs. |
| Nov 4 15:26:00 | Retained 1-minute candle high: EUR 0.25431. | Candle-extreme mark. It does not establish that the price was available on the executable side of the book or that a sell could fill there. |
| Nov 4 15:26:18 | AI decision: BUY, confidence 71.74, Market Strength +51.94, stored last-price mark EUR 0.24835; 100% candle coverage, no stale intervals, fresh market snapshot. | The signal continued to favor upward direction. |
| Nov 4 15:30:35 | The next stored market snapshot used by the Nov 4 15:31 decision was captured. | Snapshot capture preceded decision persistence by about 47 seconds and was fresh. |
| Nov 4 15:31:23 | AI decision: **BUY**, confidence **70.65**, Market Strength **+52.59**, stored mark **EUR 0.25293**; 100% candle coverage, six fresh intervals, no stale market snapshot. | This is the best retained decision-time mark during the Brussels-day window. At that mark, price-only gross P&L is about **+EUR 227.46**; estimated net liquidation after entry and modeled exit costs is **+EUR 219.83**. The database's fee-inclusive-entry mark calculation would show about +EUR 224.04 before exit costs. |
| Nov 4 15:36:19 | AI decision: BUY, confidence 70.13, Market Strength +51.22, mark EUR 0.25147; data still fresh. | No SELL was created after the observed peak. |
| Nov 4 15:09–15:23 | Portfolio snapshots show a 14m 10s gap. AI decisions at 15:11 and 15:21 were BUY; the next snapshot was at 15:23, about 1m 51s after the 15:21 decision. | A refresh-cadence irregularity exists, but the decisions available for the next observed execution window were BUY, not SELL. The gap does not establish a missed exit. |
| Nov 5 08:12:00 | Retained 1-minute candle low after the peak: EUR 0.19196. | Candle low is not an executable-fill record. Applying the same hypothetical cost model gives about -EUR 69.10 net. |
| Nov 5 08:21:17 | AI decision: HOLD, confidence 60.21, Market Strength -19.85, mark EUR 0.19315; all six intervals fresh, 100% coverage. | The model's bearish strength did not reach magnitude 20, and confidence was below the 65 directional-signal floor. HOLD therefore matches the implemented decision rule; no SELL was eligible to execute. The decision-mark net estimate is about -EUR 63.46. |
| Nov 5 09:36:21 | Latest stored ARX decision: HOLD, confidence 53.39, Market Strength +3.67, mark EUR 0.20506; all six intervals fresh. | The current modeled net exit estimate is about -EUR 7.02. |

### Was the peak “real and actionable”?

The evidence supports that ARX had a substantial **paper mark-to-market** gain: both a stored ticker last-price mark and a retained 1-minute candle high imply more than EUR 100 before costs. The 15:31 decision-time mark gives a reproducible hypothetical net estimate of about EUR 219.83 after the project's modeled costs.

It does **not** prove a sell could have been filled at the candle high or even at the exact last-price mark. The ticker and candle tables do not retain order-book bid/ask prices, depth, or fills; candle OHLC is not an execution record. Historical portfolio snapshots retain only aggregate portfolio values, not the per-position price used for each mark, so the exact historical dashboard-card value cannot be independently recovered.

Most importantly, the mark was not actionable under the bot's recorded rules at that point: the AI produced BUY, and the system has no automatic profit-protection rule. A hypothetical SELL on a fresh market mark would be processed by the executor without the BUY confidence threshold or entry cooldown, but no such SELL decision was stored. No evidence indicates that an eligible SELL was dropped.

## Decision and execution review for all five positions

The paper BUY records link each position to a recent AI decision:

| Market | Entry decision (UTC) | Entry decision | Confidence | First decision after open | Decision counts after open (BUY / SELL / HOLD / WAIT) |
|---|---|---|---:|---|---:|
| ARX-EUR | Nov 4 11:01 | BUY | 67.31 | Nov 4 11:06 | 73 / **0** / 196 / 0 |
| MEGA-EUR | Nov 4 11:01 | BUY | 69.08 | Nov 4 11:06 | 8 / **0** / 261 / 0 |
| POL-EUR | Nov 4 11:01 | BUY | 67.08 | Nov 4 11:06 | 13 / **0** / 256 / 0 |
| SXT-EUR | Nov 4 14:46 | BUY | 67.51 | Nov 4 14:51 | 54 / **0** / 170 / 0 |
| WIN-EUR | Nov 2 14:11 | BUY | 68.52 | Nov 2 14:16 | 282 / **0** / 514 / 8 |

The current production database function was inspected directly with `pg_get_functiondef`. It uses the 67 BUY-entry threshold. The SELL path uses the current stored `Market_Data` price with 0.10% adverse slippage and 0.25% fee, closes open positions for that symbol, and is not subject to the BUY confidence or cooldown checks. It does require a fresh eligible decision/market snapshot and an enabled market.

The executor stores executed trades and aggregate run metrics, not durable per-decision rejection outcomes. Therefore, repeated BUY decisions while a position is already open cannot all be assigned a specific persisted skip reason. That limitation does not affect the exit finding: there were no SELL decisions to route through the executor and no SELL trades for any of the five.

## Strategy and exit-rule behavior

The current [AI Engine](../../lib/ai-engine.mjs) is deterministic technical analysis (`Deterministic Technical Analysis`, version `1.0.0`). It evaluates EMA trend, momentum, RSI, MACD, volume, volatility, and stored 24-hour market data across the six candle intervals. Its signal floor is confidence 65; it emits HOLD when market-strength magnitude is below 20 or confidence is below 65. It does not consult the position's unrealized profit to create an exit.

The database paper executor in [the Phase 08 migration](../../PostgreSQL/migrations/20261101154600_phase08_paper_trading.sql) closes a position only for an eligible stored SELL decision. The production function has no take-profit, trailing-stop, stop-loss, or profit-protection code. The portfolio-level 5% daily and 15% maximum drawdown controls block **new BUYs**; the 20% emergency drawdown rule is portfolio-wide and stops new entries. These are not individual-position exits. No emergency stop was active at the observation time.

At the ARX decision-time low on Nov 5, strength was -19.85 and confidence 60.21. Both the magnitude and confidence rules kept it at HOLD. That result is expected under the implementation, although the absence of a protective exit is a material strategy limitation for positions that first become profitable and then reverse.

## Candle and market-data assessment

- The AI Engine reads stored `AI_Crypto_Bot_Candles` by symbol and interval. The current source requests rows ordered by symbol and descending timestamp, retains up to 150 per market/interval, normalizes and sorts them chronologically, and uses the latest normalized timestamp for freshness. Current source keeps the REST page size separate at 1,000. See [AI Engine candle loading and freshness](../../lib/ai-engine.mjs).
- Freshness limits are 30 minutes (`1m`), 2 hours (`5m`), 6 hours (`15m`), 12 hours (`1h`), 24 hours (`4h`), and 72 hours (`1d`). A stale interval is excluded; fewer than two sufficiently populated intervals results in WAIT. These safeguards are documented in [CANDLE_FRESHNESS_PROTECTION_REPORT.md](./CANDLE_FRESHNESS_PROTECTION_REPORT.md).
- The entry and decision-time peak records for ARX, the other four Nov 4 daily peak marks, the later ARX trough, and the latest decisions all report fresh market snapshots and no stale candle intervals. ARX's entry decision had 100% coverage; its Nov 4 peak decision had 100% coverage and all six intervals fresh.
- In the complete post-entry decision history, some intervals were flagged stale: only `1m` for ARX, MEGA, POL, and SXT; WIN also had stale `5m`, `15m`, `1h`, and `4h` intervals at some decisions. The code's recorded behavior is to exclude stale intervals, not to use them as fresh inputs. The selected peak and trough records were not affected by those stale flags.
- The database enforces unique `(symbol, interval, timestamp)` candle keys and OHLC validity constraints. In the retained candles for these five markets from Oct 28 onward, the audit query found zero OHLC-invalid rows and zero timestamps later than the query time. This does not guarantee complete interval coverage.
- Candle history is not an immutable decision-input archive. The table has no row-version/`updated_at` field, and refreshes can upsert an overlapping forming candle. Stored decisions preserve indicator summaries and candle counts, not every OHLCV row as the engine saw it. Exact historical input values and every candle gap cannot therefore be reconstructed.

### Production history-depth transition

The decision records show an abrupt change across complete 102-market batches:

| Batch timestamp (UTC) | Decisions | Maximum candles recorded in any interval | Markets with an interval above 150 |
|---|---:|---:|---:|
| Nov 4 13:46:19 | 102 | 1,000 | 102 |
| Nov 4 13:51:16 | 102 | 150 | 0 |

ARX's Nov 4 11:01 entry decision recorded 746 `1m`, 674 `5m`, 628 `15m`, 539 `1h`, 520 `4h`, and 135 `1d` candles. By its 15:31 peak decision, the recorded count was capped at 150 in each of the first five intervals and 135 in `1d`. All decisions retained strategy version `1.0.0`.

This supports a production input-depth transition around 13:46–13:51 UTC, but does not identify the Vercel deployment, commit, or exact activation time. It conflicts with the [Nov 3 final validation](./FINAL_HISTORY_CAP_DEPLOYMENT_REPORT.md), which recommended keeping the 1,000 cap, and the [implementation report](./HISTORY_CAP_IMPLEMENTATION_REPORT.md), which stated the local change was not deployed. The [Nov 4 replay](./FULL_1000_VS_150_DECISION_REPLAY.md) supported implementation review for one batch, not deployment approval. The production records are new evidence of the input-depth change; deployment history should be checked separately. Because the decision strategy version did not change, the stored strategy metadata cannot distinguish the two input configurations.

This discrepancy affects reproducibility and rollout traceability, but it does not show that the ARX peak decision used stale or malformed candles: its recorded 150-depth inputs passed the freshness and coverage checks. Nor does it establish that depth caused or prevented a SELL.

## Actual versus hypothetical outcomes

These are not realized trades. For each “daily peak,” the price is the highest stored `indicators.marketData.price` for that open position during the Nov 4 Brussels-time window. The “later low” is the lowest subsequent stored decision mark through the observation period. Net estimates apply the actual entry trade cost and the current modeled sell slippage and fee.

| Market | Daily peak decision mark (UTC) | Peak decision | Estimated net if sold at mark | Later decision-mark low (UTC) | Estimated net at later low | Latest-mark net estimate |
|---|---|---|---:|---|---:|---:|
| ARX-EUR | 0.25293 (Nov 4 15:31) | BUY, 70.65 confidence | **+EUR 219.83** | 0.19315 (Nov 5 08:21) | -EUR 63.46 | -EUR 7.02 |
| MEGA-EUR | 0.04392 (Nov 4 11:11) | BUY, 69.66 confidence | +EUR 8.00 | 0.04037 (Nov 5 01:21) | -EUR 71.73 | -EUR 37.15 |
| POL-EUR | 0.08680 (Nov 4 16:36) | HOLD, 63.47 confidence | +EUR 3.35 | 0.084959 (Nov 4 17:16) | -EUR 17.46 | +EUR 18.09 |
| SXT-EUR | 0.008843 (Nov 4 15:01) | BUY, 72.62 confidence | +EUR 10.18 | 0.007713 (Nov 4 21:26) | -EUR 116.27 | -EUR 88.07 |
| WIN-EUR | 0.000062889 (Nov 4 13:56) | HOLD, 64.54 confidence | +EUR 25.78 | 0.000059296 (Nov 5 06:26) | -EUR 32.76 | -EUR 11.84 |

The independently retained 1-minute candle high for ARX was EUR 0.25431 at Nov 4 15:26 UTC. If that high were assumed to be a sellable price, the same cost model would yield about **+EUR 226.37 net**; that assumption is unverified and should not be treated as an achievable fill. The corresponding 1-minute candle low after the high was EUR 0.19196, which models to about -EUR 69.10 net.

### Per-position conclusions

- **ARX-EUR:** Strong retained evidence for the reported >EUR 100 paper mark. The peak-time BUY was based on fresh recorded inputs; the later HOLD at the local low follows the signal thresholds. Strategy has no profit protection. No SELL was ignored.
- **MEGA-EUR:** Its Nov 4 decision-mark high produced only about +EUR 8 net after modeled costs. It subsequently marked lower; all 269 post-entry decisions were BUY/HOLD, with no SELL.
- **POL-EUR:** The Nov 4 high produced about +EUR 3 net after costs; the latest mark is the strongest retained valuation and models to +EUR 18 net. It currently has a BUY signal, but the already-open-position guard prevents another same-market entry. No SELL was generated.
- **SXT-EUR:** Its Nov 4 decision-mark high models to about +EUR 10 net; the one-minute candle high would model to about +EUR 35 net only under the unverified fill assumption. It later fell; no SELL was generated.
- **WIN-EUR:** Its Nov 4 decision-mark high models to about +EUR 26 net. The peak decision was HOLD because confidence 64.54 was below the 65 AI signal floor despite positive Market Strength. No SELL was generated.

## Timing and execution gaps

Portfolio snapshots are the best persisted proxy for successful paper-trading refreshes; they are not Vercel invocation logs. From Nov 2 14:00 UTC through the observation, there were 816 snapshots. The largest adjacent gap was **14m 10s**, Nov 4 15:09:00–15:23:10 UTC. AI decision gaps after the open positions were at most about **10m 5s** for WIN and about **10m 3s** for the other four; one or more expected cycles may have been absent.

The snapshot gap overlaps the ARX run-up but ends before the 15:31 peak decision. Around it, the stored ARX decisions at 15:11 and 15:21 were BUY; the next snapshot was at 15:23, roughly two minutes after the latter. This is an operational cadence irregularity worth monitoring, but it is not evidence that an exit was delayed: no SELL was present in the decision history, and no rejected-decision reason is persisted.

## Recommendations

1. **Reconcile the production history-depth transition** against Vercel deployment records and the exact commit. The retained 13:46/13:51 decision batches show the switch, while reports describe the 150-row change as not deployed or only approved for implementation review.
2. **Version analysis configuration.** Keep strategy/input-depth changes distinguishable in decision history; all observed decisions remained version `1.0.0` despite the production depth transition.
3. **Evaluate position-level exits separately** (for example take-profit, trailing stop, or stop-loss) using a backtest with fees, slippage, spread, and conservative fill assumptions before changing current paper rules. This audit does not recommend activating an alternative rule or manually closing a position.
4. **Persist per-decision execution outcomes** in a future, explicitly approved change. Current aggregate `skipped` metrics cannot establish whether a given non-executed decision failed a confidence, freshness, cooldown, or position check.
5. **Correct the documented BUY threshold conflict**: production and `RISK_MANAGEMENT.md` use 67, while `API.md` and the Phase 08 prompt say 70.
6. Continue monitoring decision cadence, paper snapshot gaps, and candle freshness. Do not infer candle completeness from the recorded row counts or treat an OHLC extreme as an executable price.

## Reproducibility and read-only evidence

Queries were issued against Supabase with the database session timezone set to UTC. The main query shapes were:

```sql
-- Current open positions, latest market mark, and fee/slippage-adjusted exit estimate
SELECT p.symbol, p.amount, p.entry_price, p.current_price, p.unrealized_pnl,
       md.price, md.captured_at
FROM public."AI_Crypto_Bot_Positions" AS p
LEFT JOIN public."AI_Crypto_Bot_Market_Data" AS md ON md.symbol = p.symbol
WHERE p.status = 'OPEN';
```

```sql
-- Decision mark and stored strategy/data-quality fields
SELECT symbol, created_at, decision, confidence, strategy_name, strategy_version,
       indicators #>> '{marketData,price}' AS mark,
       indicators #>> '{marketData,capturedAt}' AS market_capture,
       indicators #>> '{marketStrength}' AS market_strength,
       indicators #> '{dataQuality,staleCandleIntervals}' AS stale_intervals
FROM public."AI_Crypto_Bot_AI_Decisions"
WHERE symbol IN ('ARX-EUR', 'MEGA-EUR', 'POL-EUR', 'SXT-EUR', 'WIN-EUR')
  AND created_at >= TIMESTAMPTZ '2026-11-02 14:00:00+00';
```

```sql
-- Candle row validity and future-timestamp checks
SELECT count(*) FILTER (WHERE "timestamp" > now()) AS future_rows,
       count(*) FILTER (WHERE high < greatest(open, close, low)
                         OR low > least(open, close)) AS invalid_ohlc_rows
FROM public."AI_Crypto_Bot_Candles"
WHERE symbol IN ('ARX-EUR', 'MEGA-EUR', 'POL-EUR', 'SXT-EUR', 'WIN-EUR')
  AND "timestamp" >= TIMESTAMPTZ '2026-10-28 00:00:00+00';
```

```sql
-- Snapshot gaps as persisted run proxies
WITH ordered AS (
  SELECT captured_at,
         lag(captured_at) OVER (ORDER BY captured_at) AS previous_at
  FROM public."AI_Crypto_Bot_Portfolio_Snapshots"
  WHERE portfolio_id = '<audited portfolio>'
)
SELECT previous_at, captured_at, captured_at - previous_at AS gap
FROM ordered
WHERE previous_at IS NOT NULL
ORDER BY gap DESC;
```

The production paper-trading function was checked read-only through `pg_get_functiondef`; its BUY gate, SELL cost model, and absence of take-profit/trailing/stop-loss logic were compared with [the Phase 08 migration](../../PostgreSQL/migrations/20261101154600_phase08_paper_trading.sql) and [the confidence experiment migration](../../PostgreSQL/migrations/20261102140000_paper_trading_confidence_experiment.sql). Candle constraints were read from `pg_constraint`. No tests were run because this was a read-only production audit.

## Limitations

- Historical portfolio snapshots do not retain per-position marks or quote capture timestamps. Historical position-card values cannot be reproduced exactly.
- Market-data rows retain only the latest ticker mark per symbol; they do not retain historical bid/ask, order-book depth, or a full quote series.
- Candle rows can be updated by overlapping refreshes and have no immutable version timestamp. The full exact OHLCV payload used for each past decision cannot be proven.
- External Vercel and cron-job.org invocation logs were not queried. Snapshot gaps cannot identify the exact skipped, delayed, or failed scheduler invocation.
- The production `ENABLE_LIVE_TRADING` environment variable was not read from the database. No live-trading behavior or settings were changed; this audit inspected only paper-trading records and the repository's required paper-mode controls.
- Estimates assume the recorded market mark was available for an immediate modeled exit. They are counterfactual calculations, not realized returns, guaranteed fills, or evidence that a different strategy would have performed better.
