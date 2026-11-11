# Production History-Cap Reconciliation and Position-Exit Simulation

**Database observation:** 2026-11-05 09:51 UTC<br>
**Database session timezone:** UTC<br>
**Scope:** Read-only production and repository investigation, plus correction of the current BUY-entry threshold statement in `docs/API.md`. No trading code, database objects/data, deployment, scheduler, or live-trading settings were changed.

## Executive findings

1. A Git commit that changes the AI Engine history cap from 1,000 to 150 candles per market and interval exists: [`26a1c2ed76ff367be98d391b397d7f8b82e82c7c`](https://github.com/Eric1984-dev/ai-crypto-pulse-bot/commit/26a1c2ed76ff367be98d391b397d7f8b82e82c7c), committed at **2026-11-04 13:50:23 UTC**. The production decision records show the history-depth transition between complete batches at 13:46:19 and 13:51:16 UTC. The timing is compatible with that commit, but no accessible Vercel deployment record ties the commit to a deployment or proves when it became Ready/promoted. **The production deployment and commit attribution therefore remains unresolved.**
2. The current production paper-trading function uses a BUY-entry confidence gate of **67**, and the repository's `20261102140000_paper_trading_confidence_experiment.sql` migration changes that gate from 70 to 67. The separate AI Engine directional-signal floor is **65**. `docs/API.md` was corrected to state both thresholds distinctly; `docs/RISK_MANAGEMENT.md` already documented the current 67 gate.
3. An exploratory, causal, 1-minute-close simulation covered the six retained BUY position episodes: one closed BEAM-EUR position and five currently open positions. It evaluated fixed take-profit levels of 5%, 10%, 15%, and 20%; trailing stops of 5%, 10%, and 15% after 5% activation; and position stop-losses of 5%, 10%, 15%, and 20%.
4. The retained candle path is severely incomplete: the six position episodes have only **2,228 observed 1-minute candles out of 12,640 expected minute slots (17.6%)**, with gaps up to 423 minutes and a 24-hour initial gap for BEAM-EUR. Results are observed-data-only scenarios, not a reliable backtest. The apparent gains in some scenarios are dominated by one ARX-EUR run-up. **The evidence does not support selecting or recommending any exit rule.**
5. The one actual SELL in this history was BEAM-EUR: a fresh recorded AI `SELL` at 01:46:16 UTC on Nov 4, executed at 01:48:12 UTC for **-EUR 246.71 realized P&L**. The other five positions had no SELL trade at the observation cutoff. This is consistent with the current decision-driven exit design; it is not evidence that an eligible SELL was ignored.

## 1. Production history-cap deployment reconciliation

### Persisted production evidence

The prior open-position audit queried complete 102-market decision batches and found:

| Batch timestamp (UTC) | Decisions | Maximum candles recorded in any interval | Markets with an interval above 150 |
|---|---:|---:|---:|
| 2026-11-04 13:46:19 | 102 | 1,000 | 102 |
| 2026-11-04 13:51:16 | 102 | 150 | 0 |

This establishes a production decision-input-depth transition between those persisted batches. It does not identify a deployment, its commit, or its activation time.

### Git and source comparison

Git history contains commit `26a1c2ed76ff367be98d391b397d7f8b82e82c7c` (`fix vercel cpu`) at **13:50:23 UTC**, between the two recorded decision batches. Its `lib/ai-engine.mjs` change:

- changed `MAX_CANDLES_PER_INTERVAL` from `1000` to `150`;
- introduced `CANDLE_QUERY_PAGE_SIZE = 1000`; and
- retained the 1,000-row REST page size and pagination behavior.

The current local AI Engine has the same 150-candle analysis cap and 1,000-row REST page size. The commit is a plausible source for the change, but matching timestamps and source content do not prove that Vercel built, readied, or promoted that commit.

### Deployment evidence availability and verdict

- The Vercel dashboard was not authenticated in the available browser session; it returned the Vercel login page. No deployment list, deployment ID, Ready timestamp, production alias promotion, or deployment-to-commit record could be inspected.
- The GitHub Actions workflow-run query returned zero runs for `main` in the available repository records. This does not rule out a Vercel Git integration or a deployment performed outside GitHub Actions.
- Supabase's migration-list tool returned no rows. This is not deployment evidence and is not treated as proof that a database migration or function is absent.
- Database decision records show the change in effective input depth, but are not used to infer a deployment commit.

**Conclusion:** A specific Git commit that implements the 150-row cap is verified. A specific Vercel production deployment and its relationship to that commit are **not verified**. The discrepancy between the production row counts and the prior reports remains unresolved.

### Prior report comparison

- [`FINAL_HISTORY_CAP_DEPLOYMENT_REPORT.md`](./FINAL_HISTORY_CAP_DEPLOYMENT_REPORT.md) recommended against deployment based on insufficient historical parity.
- [`HISTORY_CAP_IMPLEMENTATION_REPORT.md`](./HISTORY_CAP_IMPLEMENTATION_REPORT.md) described the code as locally implemented and not deployed.
- [`FULL_1000_VS_150_DECISION_REPLAY.md`](./FULL_1000_VS_150_DECISION_REPLAY.md) supported implementation review based on one batch, not production deployment approval.
- The subsequent production decision-depth transition is new evidence that production behavior changed. It does not resolve who deployed which commit or whether the change followed the review process.

For traceability, version analysis configuration independently from strategy version. Record an immutable configuration identifier (or digest) with each AI decision for inputs such as history cap, REST page size, freshness limits, indicator configuration, and decision thresholds. Do not change the existing strategy version merely to encode a data-loading configuration change.

## 2. BUY-threshold verification and documentation correction

Read-only production inspection of `pg_get_functiondef` for `public."AI_Crypto_Bot_Apply_Paper_Decision"(uuid, uuid)` found `v_decision.confidence < 67` and did not find the old `< 70` BUY gate. The production function also contains the SELL execution path and current fee calculation.

The local migration history distinguishes the baseline and experiment:

- [`20261101154600_phase08_paper_trading.sql`](../../PostgreSQL/migrations/20261101154600_phase08_paper_trading.sql) defines the Phase 08 baseline BUY gate of 70.
- [`20261102140000_paper_trading_confidence_experiment.sql`](../../PostgreSQL/migrations/20261102140000_paper_trading_confidence_experiment.sql) verifies and replaces the single old condition with the 67 gate.
- [`RISK_MANAGEMENT.md`](../RISK_MANAGEMENT.md) already documents the current paper-entry threshold as 67.
- The AI Engine's separate signal-generation floor is 65.

Updated [`API.md`](../API.md) to say that paper BUY execution requires confidence of at least 67 and that the separate AI signal-generation floor is 65. The Phase 08 prompt remains a record of the original 70 baseline; it was not changed because it describes the historical baseline, not the current executor setting.

The migration-list tool returned an empty list, so no applied-migration ledger was available from that tool. The current production function definition directly verifies the active 67 behavior; the empty list is not interpreted as evidence that the migration was not applied.

## 3. Position-level exit-rule simulation

### Production data and window

Read-only Supabase queries were observed at approximately **2026-11-05 09:50:58–09:51:50 UTC**. The session timezone was UTC. The simulation used all retained BUY position episodes, from each paper BUY timestamp through the actual SELL timestamp for a closed position or the query cutoff for an open position.

| Production data | Rows at observation |
|---|---:|
| `AI_Crypto_Bot_Trades` | 7 |
| `AI_Crypto_Bot_Positions` | 6 (5 OPEN, 1 CLOSED) |
| BUY position episodes | 6 |
| Actual SELL trades | 1 |
| `AI_Crypto_Bot_Candles`, 1m interval, all markets | 142,341 |

The six episodes were BEAM-EUR, WIN-EUR, ARX-EUR, MEGA-EUR, POL-EUR, and SXT-EUR. BEAM-EUR is the only closed episode. Current position marks were last updated at 09:48:12 UTC on Nov 5.

### Actual strategy and exits

The deployed executor closes an open position on an eligible stored SELL decision. The database function has no per-position take-profit, trailing-stop, or stop-loss logic. Portfolio-level drawdown gates prevent new BUY entries; they are not per-position exits.

The only stored SELL trade in the available six episodes was BEAM-EUR:

| Decision time (UTC) | Execution time (UTC) | Confidence | Execution price | Realized P&L |
|---|---|---:|---:|---:|
| 2026-11-04 01:46:16 | 2026-11-04 01:48:12 | 65.76 | EUR 0.0034309656 | **-EUR 246.71** |

The five other positions had no recorded SELL trade by the observation cutoff. The stored BEAM decision was a valid SELL; it was executed. There is no evidence in these records of a dropped or rejected eligible SELL.

### Candle completeness

The simulation evaluates observed 1-minute candles only. The coverage denominator is the number of expected one-minute slots from entry through actual exit (BEAM) or query cutoff (open positions). Missing slots were not interpolated.

| Market | Observed / expected 1m slots | Coverage | First candle delay after entry | Maximum internal gap | Last candle to episode end |
|---|---:|---:|---:|---:|---:|
| BEAM-EUR | 794 / 3,340 | 23.8% | 1,460 min | 77 min | 1 min |
| WIN-EUR | 242 / 4,057 | 6.0% | 1 min | 423 min | 32 min |
| ARX-EUR | 498 / 1,367 | 36.4% | 1 min | 44 min | 2 min |
| MEGA-EUR | 204 / 1,367 | 14.9% | 4 min | 105 min | 20 min |
| POL-EUR | 207 / 1,367 | 15.1% | 2 min | 70 min | 12 min |
| SXT-EUR | 283 / 1,142 | 24.8% | 1 min | 51 min | 6 min |
| **Total** | **2,228 / 12,640** | **17.6%** |  |  |  |

The BEAM candle history misses almost the first 24 hours of its open life. The open positions have substantial missing intervals. Therefore an apparent absence of a trigger means only that no trigger was found in the retained candles; it does not establish that the rule would not have triggered during a gap.

### Simulation rules and cost model

To avoid lookahead and avoid treating candle extremes as fills:

1. Triggers were evaluated only after an observed 1-minute candle close. Candle highs and lows were not used.
2. A trigger was modeled as exiting at the **next available retained candle's open**. This is an OHLC proxy, not a guaranteed executable fill; when candle rows are missing it can be later than one minute after the trigger.
3. The modeled SELL execution applied the project's 0.10% adverse slippage to that open, then a 0.25% fee to the slipped notional. Entry cost used the actual BUY execution price times quantity plus the actual entry fee. The BUY execution price already includes the recorded entry slippage, so no second entry-slippage charge was added.
4. No historical bid/ask or spread series is retained. Spread is therefore unavailable and excluded; fee/slippage estimates are not equivalent to actual fill simulation.
5. Fixed take-profit triggers were +5%, +10%, +15%, or +20% above the fee-inclusive recorded entry basis.
6. Position stop-loss triggers were -5%, -10%, -15%, or -20% below the same entry basis.
7. Trailing stops armed after the observed close first reached +5% above entry basis, then triggered when a later observed close fell 5%, 10%, or 15% from the highest observed close since entry.
8. If no candidate trigger occurred before the actual BEAM SELL, the actual SELL outcome was retained. If no trigger occurred for a still-open position, it was marked at the stored current position price less modeled exit slippage and fee; it remains an unrealized, right-censored outcome.
9. Actual BUY entries, quantities, and entry times were held fixed. No alternative entry decisions, capital recycling, re-entries, or risk-gate effects were simulated.

### Scenario results

`Net result` sums actual realized P&L for an episode closed by the existing AI SELL, simulated net P&L for a hypothetical exit, and estimated net liquidation P&L for positions still open at the cutoff. Thus, it is not all realized P&L. `Closed` includes actual or hypothetical exits; `Open` counts right-censored positions. Average hold time uses only episodes closed by that scenario. Drawdown is the worst **single-position observed peak-to-trough net P&L** in EUR, including entry at zero; it is not portfolio/account maximum drawdown.

| Scenario | Rule-trigger exits | Closed / open | Mean holding hours (closed only) | Net result (EUR) | Worst single-position drawdown (EUR) |
|---|---:|---:|---:|---:|---:|
| Existing strategy, no per-position exit | 0 | 1 / 5 | 55.67 | -384.83 | 293.62 |
| Fixed take-profit 5% | 1 | 2 / 4 | 29.07 | -326.78 | 246.71 |
| Fixed take-profit 10% | 1 | 2 / 4 | 29.58 | -276.93 | 246.71 |
| Fixed take-profit 15% | 1 | 2 / 4 | 29.75 | -229.87 | 246.71 |
| Fixed take-profit 20% | 1 | 2 / 4 | 29.94 | -192.53 | 246.71 |
| Trailing 5% after +5% activation | 1 | 2 / 4 | 30.64 | -206.32 | 246.71 |
| Trailing 10% after +5% activation | 1 | 2 / 4 | 30.97 | -265.32 | 246.71 |
| Trailing 15% after +5% activation | 1 | 2 / 4 | 31.50 | -329.15 | 246.71 |
| Position stop-loss 5% | 4 | 4 / 2 | 11.71 | -249.62 | 279.22 |
| Position stop-loss 10% | 2 | 2 / 4 | 14.20 | -250.92 | 293.62 |
| Position stop-loss 15% | 1 | 1 / 5 | 30.31 | -289.59 | 293.62 |
| Position stop-loss 20% | 1 | 1 / 5 | 38.53 | -342.05 | 293.62 |

The modeled rule exits observed in the retained data were:

| Scenario | Market | Modeled fill time (UTC) | Raw next-observed open | Modeled net P&L |
|---|---|---|---:|---:|
| Fixed take-profit 5% | ARX-EUR | Nov 4 13:32 | 0.21566 | +EUR 43.22 |
| Fixed take-profit 10% | ARX-EUR | Nov 4 14:33 | 0.22618 | +EUR 93.07 |
| Fixed take-profit 15% | ARX-EUR | Nov 4 14:53 | 0.23611 | +EUR 140.13 |
| Fixed take-profit 20% | ARX-EUR | Nov 4 15:16 | 0.24399 | +EUR 177.47 |
| Trailing 5% after +5% activation | ARX-EUR | Nov 4 16:40 | 0.24108 | +EUR 163.68 |
| Trailing 10% after +5% activation | ARX-EUR | Nov 4 17:19 | 0.22863 | +EUR 104.68 |
| Trailing 15% after +5% activation | ARX-EUR | Nov 4 18:23 | 0.21516 | +EUR 40.85 |
| Position stop-loss 5% | ARX-EUR | Nov 5 07:58 | 0.19500 | -EUR 54.69 |
| Position stop-loss 5% | BEAM-EUR | Nov 2 18:29 | 0.0041198 | -EUR 95.88 |
| Position stop-loss 5% | MEGA-EUR | Nov 4 12:14 | 0.04131 | -EUR 50.62 |
| Position stop-loss 5% | SXT-EUR | Nov 4 15:13 | 0.00828 | -EUR 52.82 |
| Position stop-loss 10% | BEAM-EUR | Nov 2 18:37 | 0.0040912 | -EUR 102.17 |
| Position stop-loss 10% | SXT-EUR | Nov 4 18:43 | 0.007848 | -EUR 101.16 |
| Position stop-loss 15% | BEAM-EUR | Nov 3 00:27 | 0.0038672 | -EUR 151.47 |
| Position stop-loss 20% | BEAM-EUR | Nov 3 08:40 | 0.0036288 | -EUR 203.93 |

Most modeled triggers used the next observed candle one minute later. Exceptions include the ARX 5% stop-loss (8 minutes) and SXT 10% stop-loss (2 minutes). The next observed open remains a proxy and does not establish that a real order could execute there.

The fixed targets and trailing rules triggered only on ARX-EUR in the retained data. The observed decision-mark peak for ARX on Nov 4 was later, at 15:31 UTC, and modeled to about +EUR 219.83 net under the prior open-position audit's mark-based calculation. The fixed targets would therefore have exited before that later mark, while the trailing scenarios would have given back some of the subsequent observed peak. These comparisons are descriptive only: the mark is not a guaranteed fill, candles are incomplete, and the scenarios were selected for this investigation rather than validated out of sample. Rules did not trigger on WIN-EUR or POL-EUR in the retained rows, which does not prove that they would not trigger during missing intervals.

### Actual versus hypothetical outcome assessment

- **Actual:** BEAM-EUR closed for -EUR 246.71 realized P&L after an AI SELL. Five other positions remained open; their realized P&L is still zero.
- **Current open-position marks:** At the last stored position update (09:48:12 UTC), the modeled net-to-liquidate values were approximately ARX -EUR 14.84, MEGA -EUR 37.15, POL +EUR 16.23, SXT -EUR 90.53, and WIN -EUR 11.84. These include estimated exit fee/slippage and are not realized outcomes.
- **Baseline simulation total:** -EUR 384.83 combines BEAM's actual realized loss with estimated net liquidation of the five still-open positions.
- **Candidate totals:** All candidate totals are hypothetical and use retained observed candles only. They are not actual trades, not portfolio-account backtests, and not directly comparable to a realized-only total.

### Interpretation and recommendation

The implementation behaves as documented: an eligible SELL closes a position, but no independent position-level profit-protection rule exists. The BEAM SELL was executed; the current open positions have no stored SELL decision in the audited history. The data does not show an executor failure.

Some candidate totals look less negative than the baseline, largely because the observed ARX path contains one large run-up and all alternative exits are selected and evaluated on that same short sample. The history contains only one actual closed position and is missing 82.4% of expected 1-minute slots across the six episodes. These constraints preclude a meaningful comparison of exit-rule quality, premature exits, missed triggers, or generalization to other markets/regimes.

**No candidate exit rule is recommended from this evidence.** Before a future strategy decision, retain immutable, complete decision-time candles and quote/spread data, then evaluate pre-registered rules across a substantially larger out-of-sample set of closed positions with fees, slippage, spread, trigger-to-order delay, portfolio overlap, and risk gates represented. Do not infer that a rule would have improved realized performance from the five currently open positions or the ARX peak.

## 4. Reproducibility and read-only evidence

Tables inspected included `AI_Crypto_Bot_Trades`, `AI_Crypto_Bot_Positions`, `AI_Crypto_Bot_Candles`, and `AI_Crypto_Bot_AI_Decisions`. Additional checks used the repository's Phase 08 SQL migration, confidence experiment migration, AI Engine, Risk Management documentation, and existing history-cap and position audit reports.

Representative read-only production queries:

```sql
-- Active deployed paper BUY gate and exit-rule implementation
SELECT pg_catalog.pg_get_functiondef(
  pg_catalog.to_regprocedure(
    'public."AI_Crypto_Bot_Apply_Paper_Decision"(uuid, uuid)'
  )
);
```

```sql
-- Trade and position episode inventory
SELECT t.symbol, t.side, t.price, t.quantity, t.fees, t.slippage,
       t.realized_pnl, t.created_at, t.ai_decision_id,
       p.status, p.entry_price, p.current_price, p.unrealized_pnl
FROM public."AI_Crypto_Bot_Trades" t
LEFT JOIN public."AI_Crypto_Bot_Positions" p
  ON p.portfolio_id = t.portfolio_id
 AND p.symbol = t.symbol
ORDER BY t.created_at, t.symbol, t.side;
```

```sql
-- 1m candle coverage and gaps per BUY episode, bounded by actual close or query time
WITH buys AS (
  SELECT b.id, b.symbol, b.created_at AS entry_at,
         (SELECT min(s.created_at)
          FROM public."AI_Crypto_Bot_Trades" s
          WHERE s.portfolio_id = b.portfolio_id
            AND s.symbol = b.symbol
            AND s.side = 'SELL'
            AND s.created_at > b.created_at) AS exit_at
  FROM public."AI_Crypto_Bot_Trades" b
  WHERE b.side = 'BUY'
)
SELECT b.symbol, b.entry_at, b.exit_at, count(c.timestamp) AS observed_minutes,
       min(c.timestamp) AS first_candle, max(c.timestamp) AS last_candle
FROM buys b
LEFT JOIN public."AI_Crypto_Bot_Candles" c
  ON c.symbol = b.symbol
 AND c.interval = '1m'
 AND c.timestamp > b.entry_at
 AND c.timestamp <= coalesce(b.exit_at, now())
GROUP BY b.id, b.symbol, b.entry_at, b.exit_at
ORDER BY b.entry_at;
```

The simulation was a read-only SQL CTE over each BUY episode and its retained 1m candles. It used `lead(open)` for the next observed open, a cumulative `max(close)` for trailing rules, and first-crossing close conditions for each rule. It then applied the production SELL cost model (`price * 0.999`, followed by a 0.25% fee), preserved actual SELL outcomes where no candidate trigger preceded them, and calculated per-position drawdowns from observed net-liquidation marks. No rows were inserted or updated.

No tests were run. The only codebase edit was a documentation correction, and the report is a read-only research deliverable.

## Files changed

- `docs/API.md` — current BUY-entry confidence threshold corrected to 67 and distinguished from the AI signal-generation floor of 65.
- `docs/reports/PRODUCTION_HISTORY_CAP_AND_POSITION_EXIT_SIMULATION.md` — this reconciliation and simulation report.
