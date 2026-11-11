# Post-Fix Trade Threshold Impact Analysis

**Audit window:** 2026-11-04 08:56:02–10:45:16 UTC

**Data cutoff:** 2026-11-04 10:45:16.611867 UTC

**Current production BUY threshold:** 67
**Scope:** Read-only analysis of the same post-fix period as the [Post-Fix Trade Generation Audit](./POST_FIX_TRADE_GENERATION_AUDIT.md). No code, database, scheduler, or threshold settings were changed.

## Executive result

The audit window contained **32 BUY decisions**. All 32 were below the current 67 entry threshold, with confidence from 65.10 to 66.61. No BUY decision reached 67.

Threshold-only counts show:

- At **65**, 32 BUY decision records across four markets pass the confidence gate.
- At **66**, seven records across one market pass.
- At **67**, zero records across zero markets pass.

These are opportunity estimates, not actual or guaranteed trades. The raw decision count repeats signals for the same market. Under the Phase 08 one-open-position-per-market rule and the observed existing WIN-EUR position, a static upper-bound estimate is **four distinct-market entries at 65, one at 66, and zero at 67**, if every other execution check passes.

## Confidence distribution

Bands use inclusive lower bounds and exclusive next-band bounds; the final band includes all confidence values >= 67.

| BUY confidence band | BUY decisions | Share of BUY decisions | Markets represented |
|---|---:|---:|---:|
| 65.00–65.49 | 8 | 25.0% | 3 |
| 65.50–65.99 | 17 | 53.1% | 2 |
| 66.00–66.49 | 4 | 12.5% | 1 |
| 66.50–66.99 | 3 | 9.4% | 1 |
| 67.00+ | 0 | 0.0% | 0 |
| **Total** | **32** | **100.0%** | **4 unique markets overall** |

The unique-market counts by band are not additive: MEGA-EUR appears in multiple bands.

## Threshold-only simulation

| BUY threshold | BUY decision records meeting threshold | Unique eligible markets | Estimated distinct-market entries | Additional decision opportunities vs. 67 | Additional markets vs. 67 |
|---:|---:|---:|---:|---:|---:|
| 65 | 32 | 4 | Up to 4 | +32 | +4 |
| 66 | 7 | 1 | Up to 1 | +7 | +1 |
| 67 (current) | 0 | 0 | 0 | 0 | 0 |

### Interpretation of the estimate

- **Decision records** count each stored BUY signal meeting only the specified confidence threshold.
- **Unique eligible markets** count each symbol once, regardless of repeated BUY decisions.
- **Estimated distinct-market entries** assume no more than one new position per eligible market during the window. There was one existing open WIN-EUR position against a maximum of five open positions, leaving capacity for up to four additional positions. None of the four BUY markets had an open position or a historical paper trade in the audited data.
- These are upper-bound estimates, not a replay of executor outcomes. Freshness, position sizing, available balance, cooldown, drawdown, emergency state, decision supersession, and other risk controls still apply. The audit's execution records do not persist a rejection result for every BUY.

## Cause of zero trades at the current threshold

The confidence distribution is the direct, measured reason the BUY signals did not qualify under the current 67 gate: **100% (32/32) of BUY records clustered below 67**, and the highest score was 66.61. The threshold-only simulation would admit seven records at 66, but all seven are MEGA-EUR signals; at 65 it would admit 32 records across four markets.

Market breadth was limited: only **4 of 102 tracked markets** generated a BUY during the audit window. However, the prior audit found 95 additional HOLD decisions across seven markets with Market Strength >= 20, all below the AI signal-generation confidence floor of 65. That evidence indicates confidence constrained both entry eligibility and upstream BUY generation. For the zero-trade result in this specific window, the 67 threshold's mismatch with the observed BUY confidence distribution is the primary quantified factor; limited market breadth is secondary context.

## Scope and limitations

- The queried production rows are limited to the exact post-fix period above; no earlier historical BUY decisions are included.
- The confidence threshold is the only simulated variable. AI decisions, market conditions, position state, scheduling, and risk controls are held as observed.
- Repeated BUY records are not independent trades. The estimate deduplicates by market for potential entries and does not assume repeated positions in the same symbol.
- This analysis quantifies opportunity counts only. It does not estimate profitability, win rate, P&L, or whether any hypothetical entry would have passed all execution checks.
- No threshold change is recommended or proposed.

## Sources

- [Post-Fix Trade Generation Audit](./POST_FIX_TRADE_GENERATION_AUDIT.md)
- [Risk management and one-position-per-market rules](../RISK_MANAGEMENT.md)
- [AI signal-generation logic](../../lib/ai-engine.mjs)
- [Confidence-threshold experiment migration](../../PostgreSQL/migrations/20261102140000_paper_trading_confidence_experiment.sql)

**Tests:** Not run; this is a read-only quantitative report.
