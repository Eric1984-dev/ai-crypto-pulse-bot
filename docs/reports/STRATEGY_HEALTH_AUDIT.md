# Strategy Health Audit

**Verdict: RED — Investigation required**

**Production observation:** 2026-11-04 10:03 UTC  
**Decision-data cutoff:** 2026-11-04 10:01:19 UTC  
**Scope:** Read-only review of production AI decisions, paper trades, open positions, current market data, deployed paper-trading threshold, implementation, and focused tests. No code, database, scheduler, or deployment settings were changed.

## Executive summary

The deterministic AI and paper-trading rules behaved consistently in the inspected decisions and trades. Directional decisions met their confidence and market-strength rules; the three recorded paper trades were linked to matching, recent decisions; and stale candle intervals were excluded or safely blocked.

However, production recorded **3,876 `WAIT` decisions across all 102 markets during 38 analysis cycles**, from **2026-11-01 06:25:22 to 16:15:48 UTC**. Every affected decision marked its market snapshot unavailable and stale. Each decision nevertheless retained a non-null price and capture timestamp, and those capture timestamps were only **6.7 to 31.7 seconds before the database decision timestamp** (average 16.3 seconds). This is consistent with a time-ordering race or clock skew: the AI service captures its reference time at run start, fetches market data later, and considers a capture timestamp in the future relative to that earlier reference time stale. The stored history does not preserve the AI run-start time or scheduler execution logs, so it cannot establish the exact cause.

No paper trade occurred during those stale-snapshot cycles, so the safeguards failed closed rather than trading on stale data. Nonetheless, the all-market, repeated decision blockage is an unresolved operational/analysis issue and prevents a GREEN verdict.

## Evidence window and coverage

The requested seven-day window was **2026-10-28 10:01:19 through 2026-11-04 10:01:19 UTC**. Production decision history in that window begins only at **2026-11-01 05:57:38 UTC**, so the available evidence covers about **3 days, 4 hours**, not the full seven days.

Within the available history:

| Decision | Count | Average confidence | Confidence range |
|---|---:|---:|---:|
| BUY | 1,425 | 67.48 | 65.00–73.28 |
| HOLD | 75,036 | 59.22 | 38.27–64.99 |
| SELL | 11,820 | 67.05 | 65.00–75.49 |
| WAIT | 4,947 | 34.83 | 18.00–44.00 |
| **Total** | **93,228** |  |  |

These records cover 102 markets. Conclusions about a full seven-day trend, or the long-term predictive quality of the confidence score, are not supported by this shorter history.

## Finding 1 — System-wide stale snapshot decisions

| Measure | Production evidence |
|---|---|
| Affected decisions | 3,876 `WAIT` decisions |
| Market coverage | All 102 markets; exactly 38 affected decisions per market |
| Affected period | 2026-11-01 06:25:22–16:15:48 UTC |
| Snapshot captures represented | 38 distinct capture timestamps, 2026-11-01 06:25:14–16:15:19 UTC |
| Snapshot fields | All 3,876 marked `available=false` and `stale=true`; none had a missing capture timestamp or price |
| Capture-to-decision age | 6.7–31.7 seconds; average 16.3 seconds |
| Trades during the period | 0 |

The AI service reads `currentTime` near the beginning of a run, loads `Market_Data` later, and passes the original time to decision generation. Snapshot validation marks a quote stale if it is more than 15 minutes old **or if its timestamp is later than that reference time**. See [`lib/ai-engine.mjs`](../../lib/ai-engine.mjs#L43), [`lib/ai-engine.mjs`](../../lib/ai-engine.mjs#L129), [`lib/ai-engine.mjs`](../../lib/ai-engine.mjs#L151), and [`lib/ai-engine.mjs`](../../lib/ai-engine.mjs#L482).

Because the stored quote captures were only seconds before each decision was persisted, the records do not look like a conventional prolonged provider outage. They are consistent with the market refresh updating rows after an AI run captured its reference time but before that run loaded the rows; inter-runtime clock skew or a long analysis run cannot be ruled out. The current scheduling guidance describes market refresh and AI analysis as separate jobs but does not establish a completion-order dependency between them. The exact scheduler order and run-start timestamps were not available in the retained evidence.

**Assessment:** This is the main reason for the RED verdict. The system safely emitted `WAIT`, but all markets were blocked for repeated cycles over nearly ten hours. Correlate the historical market-refresh and AI-analysis execution times, deployment logs, and runtime timestamps to determine whether scheduling overlap, clock skew, or another cause produced the classification. Do not weaken the future-timestamp or freshness safeguards based on this evidence alone.

## AI decision and freshness behavior

The implemented deterministic engine uses a minimum signal confidence of 65, requires market-strength magnitude of at least 20 for a directional signal, requires at least two valid candle intervals for analysis, and marks market snapshots older than 15 minutes or in the future stale. Per-interval candle-age limits are 30 minutes for 1m, 2 hours for 5m, 6 hours for 15m, 12 hours for 1h, 24 hours for 4h, and 72 hours for 1d. Stale intervals are excluded from the score.

Production decision-integrity checks found:

- **0** BUY rule violations (confidence below 65 or market strength below +20).
- **0** SELL rule violations (confidence below 65 or market strength above -20).
- **0** directional decisions with a false `sufficientForDirectionalSignal` quality flag.
- **0** directional decisions with a stale market snapshot.
- **256** directional decisions that recorded at least one stale candle interval; all retained at least four fresh intervals and a true directional-quality flag. These decisions are consistent with stale intervals being excluded while sufficient fresh data remained.

The 4,947 WAIT decisions break down as follows:

| WAIT reason | Count | Observed period |
|---|---:|---|
| Market snapshot unavailable/stale | 3,876 | Nov 1, 06:25–16:15 UTC |
| `STALE_CANDLE_DATA` | 561 | Nov 3, 12:36–14:51 UTC |
| Insufficient real candle history | 510 | Nov 1, 05:57–06:11 UTC |

The candle-related WAITs are consistent with the freshness and minimum-history safeguards. The market-snapshot WAITs are protective too, but their all-market repetition and near-contemporaneous capture timestamps need operational investigation.

## Confidence model and paper-entry gate

The AI engine emits directional signals from confidence 65. The approved paper-trading experiment lowers the BUY-entry gate from 70 to **67**; the deployed database function was independently inspected and uses 67. SELL remains available to reduce exposure without the BUY-entry threshold. References: [`RISK_MANAGEMENT.md`](../RISK_MANAGEMENT.md#L27), [`ROADMAP.md`](../../ROADMAP.md#L571), and [`20261102140000_paper_trading_confidence_experiment.sql`](../../PostgreSQL/migrations/20261102140000_paper_trading_confidence_experiment.sql#L1).

Among the 1,425 BUY decisions:

- 792 had confidence from 65 to below 67 and were below the paper-entry gate.
- 467 were from 67 to below 70.
- 166 were at least 70.

The sub-67 BUY decisions are consistent with the separate signal-generation and paper-execution thresholds; they are not evidence of trades bypassing risk controls. The reported confidence is a deterministic score; the available one-trade outcome sample cannot establish statistical calibration or predictive performance.

The experiment is substantially under-sampled: the available trade history contains only **one closed position**, while the documented first review point is 25 closed trades and the final evaluation point is 50. No conclusion to keep or revert the threshold is supported yet.

**Documentation note:** The original [`prompts/08_PAPER_TRADING.md`](../../prompts/08_PAPER_TRADING.md) still lists the Phase 08 baseline confidence of 70. Current risk documentation, the roadmap experiment, and the deployed function use 67. The current runtime behavior is consistent, but the phase prompt could mislead future maintenance unless clearly identified as the original baseline.

## BEAM-EUR trade review

### Entry

- BUY decision: **2026-11-01 18:06:36 UTC**, confidence **70.10**, market strength **+54.66**.
- Candle coverage: **100%**, with no stale intervals; market snapshot was not stale.
- Execution: **18:08:12 UTC**, about 1 minute 36 seconds after the decision. The simulated entry was approximately €1,000 notional, with a €2.50 fee and €0.999 slippage.
- The strong positive composite score, confidence above both the AI signal floor and paper-entry gate, and fresh data are consistent with a valid entry.

### Exit

- SELL decision: **2026-11-04 01:46:16 UTC**, confidence **65.76**, market strength **-34.45**.
- Candle coverage: **100%**, no stale intervals, and the market snapshot was not stale. The reviewed timeframe signals were bearish.
- Execution: **01:48:12 UTC**, about 1 minute 56 seconds after the decision and **2 days, 7 hours, 40 minutes** after entry.
- Realized P&L: **-€246.7096**, approximately **-24.61%** of the €1,002.50 entry cash including fee.

The SELL was directionally consistent with the strategy rules: its confidence exceeded the AI signal floor of 65, its market strength was below -20, and SELL is permitted below the BUY-entry threshold because it reduces exposure. The realized loss is significant for this individual paper trade but is not, by itself, evidence of a logic violation. The available evidence does not show a stale-data-driven exit.

## WIN-EUR open-position review

At the 2026-11-04 10:03 UTC production observation:

- Position status: **OPEN**; amount **16,348,102.959272006431**.
- Entry price: **€0.000061092229**; current price: **€0.000061624**.
- Unrealized P&L: **+€8.6934** (about **+0.87%**).
- The position mark matched the latest market-data price, captured at **10:00:43 UTC**; the position had been updated at **10:03:09 UTC**.
- Latest decision: **HOLD** at **10:01:19 UTC**, confidence **62.13**, market strength **+23.16**, 100% candle coverage, no stale candle intervals, and a fresh market snapshot.

The positive market-strength score alone does not require BUY: confidence was below the AI engine's 65 signal floor, so HOLD was expected. The agent status was **ACTIVE** and emergency state **NORMAL**. The position was modestly profitable at observation time and was being marked from current market data.

## Paper-trading execution and risk controls

The three paper trades in the available window were all linked to a decision with matching symbol and side, and all executed within 15 minutes of that decision. The BUY entries met the live 67 confidence gate; the SELL exit met the AI signal floor and reduced exposure. No trade occurred in the all-market stale-snapshot period.

Focused local validation passed:

```text
npm test -- tests/ai-engine.test.mjs tests/database-migrations.test.js
39 tests passed; 0 failed
```

These tests cover deterministic signal generation, stale market and candle safeguards, the 67 BUY-entry threshold, SELL execution, idempotency, fees/slippage, position and cooldown limits, drawdown controls, and emergency-stop behavior. They are local tests and do not replace production scheduler/log validation. No full test suite, deployment, or live-trading environment verification is claimed.

## Audit limits and follow-up

- Decision history covers only about 3.17 days of the requested seven-day period.
- `Market_Data` retains the latest row rather than a durable refresh history. AI decisions preserve snapshot fields and stale flags, but the analysis run-start time and a correlated market-refresh execution record were not available for this review.
- Therefore, the all-market stale classification is proven, while the exact trigger (scheduler overlap, clock skew, or unusually long run) is not.
- The confidence experiment has one closed trade, insufficient for its documented performance review.

**Recommended next step:** investigate the historical scheduler and runtime timestamps for **2026-11-01 06:25–16:15 UTC**, and confirm that market refresh completes before AI analysis uses its snapshot. Keep the existing fail-safe behavior until the cause is established. No strategy threshold change is justified before the documented closed-trade review point.
