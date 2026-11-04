# Portfolio History Chart Audit

**Audit captured:** 2026-11-04; production snapshot observations from 09:03–09:05 UTC

**Scope:** Read-only code, documentation, deployment-commit, and production-data audit. No code, database, scheduler, or deployment settings were changed.

## Executive result

The Portfolio History chart plots persisted rows from `AI_Crypto_Bot_Portfolio_Snapshots`; it does not calculate a continuously updating market-value series. Snapshot valuation is refreshed during scheduled paper-trading runs using the latest eligible `AI_Crypto_Bot_Market_Data` prices. The dashboard's 30-second polling and Realtime refresh reload those snapshots but do not create new valuations.

The expected result is therefore a sampled series that can remain flat between valuation changes and move when a later paper-trading run records a different portfolio value. The chart is not configured as a stepped chart, but repeated persisted values naturally render as horizontal segments.

Production evidence confirms that the long flats exist in the stored values, not just in Chart.js rendering. In the latest 100 snapshots, 77 adjacent points repeated the prior value (77.8% of comparable pairs); the longest same-value run was 30 points over 145.04 minutes. Earlier consecutive 100-point windows had 68 and 98 distinct values, respectively. Thus, the recent increase in flat values is real, but available data does not identify its precise cause.

The checkpoint RPC deployment cannot directly affect Portfolio History generation. Its deployed change is limited to candle checkpoint lookup and candle-refresh code; the dashboard history reads portfolio snapshots, while paper-trading valuation reads market-data snapshots.

## 1. Data sources and chart path

| Layer | Source / behavior |
|---|---|
| Snapshot table | `AI_Crypto_Bot_Portfolio_Snapshots` stores `portfolio_id`, `portfolio_value`, `available_balance`, `open_positions`, and `captured_at`. The database documentation describes this as user-owned portfolio history. |
| Valuation inputs | `AI_Crypto_Bot_Refresh_Paper_Portfolio` reads `AI_Crypto_Bot_Market_Data`, updates open positions with eligible prices, recalculates portfolio value, and inserts a snapshot. |
| Authenticated API | `GET /api/dashboard-data` selects `portfolio_id`, `portfolio_value`, and `captured_at`, ordered newest first, with a 100-row limit. The request uses the authenticated user's JWT and existing RLS; the returned rows are reversed to chronological order. |
| Frontend | `js/dashboard.js` passes those persisted rows to a Chart.js line chart. It does not derive additional points from current market prices. |

The chart's x-axis labels are formatted snapshot timestamps. It creates one dataset per portfolio represented in the returned rows. The current production query observed one portfolio in the lookback.

## 2. Snapshot creation frequency

Snapshot creation is part of paper-trading database work, not a dedicated snapshot-only endpoint or scheduler job:

1. A new portfolio receives an initial €10,000 snapshot when provisioned. The migration also backfills an initial snapshot for existing profiles that lack a portfolio.
2. `AI_Crypto_Bot_Run_Paper_Trading` calls `AI_Crypto_Bot_Refresh_Paper_Portfolio` for each portfolio before processing the latest decisions. Each successful refresh recalculates portfolio value and inserts a snapshot, even if no trade is executed.
3. If a BUY or SELL decision executes, `AI_Crypto_Bot_Apply_Paper_Decision` recalculates the value after the trade and inserts an additional snapshot. Rejected, duplicate, HOLD, and WAIT decisions do not create this execution snapshot.

The paper-trading endpoint is externally scheduled after AI analysis. Scheduling documentation gives five minutes as a suitable example cadence; the scheduler configuration itself was not available for verification during this audit.

Read-only production snapshot timing provides the following empirical evidence:

| Observation | Result |
|---|---:|
| Snapshot rows in the 14-day lookback | 780 |
| Portfolios represented | 1 |
| Data range observed | 2026-11-01 16:17:16–2026-11-04 09:03:09 UTC |
| Mean interval | 5.01 minutes |
| Median interval | 5.00 minutes |
| p95 interval | 5.06 minutes |
| Maximum interval | 12.21 minutes |
| Gaps over 10 minutes | 1 |
| Gaps over 15 or 30 minutes | 0 |

The observed production cadence is approximately five minutes and is consistent with the documented example. It is measured from stored timestamps, not verified against the external scheduler's current settings.

## 3. How and when valuation changes

Valuation does **not** update continuously when a ticker or candle changes. Market refresh persists market data independently; a later paper-trading run reads an eligible market-data price (at most 15 minutes old, with a one-minute future-time allowance), updates open-position marks, calculates portfolio value, and stores the result.

If a paper-trading run is skipped before portfolio refresh (for example, because another run holds the lock or analysis is in progress), that run does not produce its regular refresh snapshot. A successful trade can add a second snapshot in that same run. There is no separate periodic snapshot worker in the inspected code.

The dashboard refreshes its data every 30 seconds when visible and on relevant Realtime invalidations. Those refreshes can redraw the chart with newer persisted rows, but they do not themselves write a valuation or interpolate market prices between snapshots.

## 4. Expected versus actual chart behavior

### Expected

- The chart represents stored valuation snapshots, not a live mark-to-market feed.
- New points generally arrive with paper-trading portfolio refreshes, empirically about every five minutes in the observed production data.
- If successive valuation snapshots are equal, horizontal segments are correct. A changed valuation appears at a later sampled timestamp; values between samples are not represented.
- The frontend configures a normal line chart with `tension: 0.25` and `spanGaps: false`; it does not request Chart.js stepped-line rendering.

### Actual

The chart's latest 100 persisted points covered 2026-11-04 00:53:09–09:03:09 UTC:

| Consecutive 100-point window | Distinct portfolio values | Adjacent points repeating the prior value |
|---|---:|---:|
| Latest | 22 | 77/99 (77.8%) |
| Immediately prior | 68 | 32/99 (32.0%) |
| Earlier | 98 | 2/99 (2.0%) |

The latest window includes a longest run of 30 same-value snapshots over 145.04 minutes. These adjacent windows are descriptive, not a controlled comparison of market conditions. They establish that the current flat segments are present in stored snapshot values and that their frequency increased in the more recent samples. The database does not retain per-run price inputs or valuation diagnostics sufficient to determine why each repeated value occurred.

### Assessment

**The stair-step appearance is correct for the current snapshot-based chart contract.** It is not evidence that the chart is interpolating incorrectly or that the RPC introduced a stepped-line mode. However, the recent rise in repeated snapshot values is a real change in the persisted series. Its cause cannot be established from the available snapshot rows alone.

If the intended product behavior is a continuously moving portfolio valuation, that would require a separately designed valuation sampling/update mechanism; more frequent dashboard polling would only reread the same stored values. No such change was made as part of this audit.

## 5. Checkpoint RPC impact

The production deployment commit `d4fce8c` is **“Optimize candle checkpoint lookup.”** Its changed files include `lib/market-data.mjs` and the candle checkpoint RPC migration, plus tests and documentation; it does not change `js/dashboard.js`, `api/dashboard-data.mjs`, or the paper-trading migration.

The checkpoint RPC reads latest timestamps from `AI_Crypto_Bot_Candles` for candle refresh. Portfolio valuation and chart generation use separate paths:

```text
Market refresh → AI_Crypto_Bot_Market_Data
              → Paper trading refresh → AI_Crypto_Bot_Portfolio_Snapshots
              → Dashboard data API → Chart.js
```

The paper-trading valuation function does not read candle checkpoints or call the checkpoint RPC. Therefore, the RPC deployment has **no direct data-path effect** on portfolio snapshot generation or chart values. The inspected commit also provides no evidence of an indirect change to the market-data refresh or paper-trading valuation path.

## 6. Sources

- Production read-only aggregates from `AI_Crypto_Bot_Portfolio_Snapshots`, observed 2026-11-04 09:03–09:05 UTC. The queries returned counts and timing/change statistics only, not portfolio values.
- [Dashboard snapshot query and 100-row limit](../../api/dashboard-data.mjs#L28), [snapshot selection](../../api/dashboard-data.mjs#L659), and [chronological response](../../api/dashboard-data.mjs#L749).
- [Dashboard chart rendering](../../js/dashboard.js#L169), [chart configuration](../../js/dashboard.js#L224), and [30-second refresh interval](../../js/dashboard.js#L22).
- [Paper portfolio refresh and snapshot insertion](../../supabase/migrations/20261101154600_phase08_paper_trading.sql#L81), [per-run refresh call](../../supabase/migrations/20261101154600_phase08_paper_trading.sql#L617), and [post-trade snapshot insertion](../../supabase/migrations/20261101154600_phase08_paper_trading.sql#L555).
- [Snapshot table definition](../../supabase/migrations/20261031190000_create_agent_tables.sql#L208), [scheduling documentation](../SCHEDULING.md#phase-08-paper-trading-execution), and [database documentation](../DATABASE.md#user-portfolio-and-trading-tables).
- Deployed checkpoint commit `d4fce8c`, inspected with `git show --name-only`; its code paths are `lib/market-data.mjs` and `supabase/migrations/20261102150000_candle_checkpoint_rpc.sql`.
