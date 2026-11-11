# Post-Fix Trade Generation Audit

**Production data captured through:** 2026-11-04 10:45:16 UTC

**Decision window:** 2026-11-04 08:56:02–10:45:16 UTC
**Scope:** Read-only production audit. No code, database, scheduler, or deployment settings were changed.

## Executive finding

**Primary bottleneck: the current paper-entry confidence threshold.** In 22 complete 102-market analysis batches, the AI generated 32 BUY decisions. Every one met the AI signal-generation floor of 65, but their confidence ranged only from 65.10 to 66.61. None reached the live paper-entry threshold of 67, so none was eligible to open a position. No trade rows were created during the decision window.

Confidence also suppresses signal generation upstream: 95 HOLD decisions across seven markets had Market Strength of at least 20, but all had confidence below 65. Market breadth was limited to four BUY markets, but the BUY signals that were emitted had positive Market Strength and complete, fresh inputs. The available evidence does not indicate that candle freshness, scheduler failure, open-position capacity, or emergency controls were the principal cause of the low trade count.

The exact per-decision execution outcome cannot be reconstructed. The executor and logs retain aggregate run metrics, not durable rejection reasons for each decision; the roadmap already identifies this as an execution-audit gap.

## Scope and method

The analysis starts at **08:56:02 UTC**, when the post-deployment validation confirmed candle rows for all 102 enabled markets at all six intervals. This is a conservative operational boundary after the checkpoint RPC production deployment (`d4fce8c`, Ready at 08:42:29 UTC) and the coverage restoration. It intentionally excludes the historical operational incidents preceding these fixes. The exact scheduler-edit time was not available.

The decision query is bounded at the capture time above. It contains **2,244 decisions** from 08:56:18 through 10:41:23 UTC, corresponding to 22 batches of 102 markets. The live BUY-entry threshold was verified as 67; the earlier 70 value is the Phase 08 baseline, not the current experiment setting. AI BUY/SELL generation uses confidence of at least 65 and absolute Market Strength of at least 20.

Production evidence was read from `AI_Crypto_Bot_AI_Decisions`, `AI_Crypto_Bot_Trades`, `AI_Crypto_Bot_Portfolios`, `AI_Crypto_Bot_Positions`, and `AI_Crypto_Bot_Status`. Vercel runtime logs were available only for two recent paper-trading invocations; the Hobby plan did not retain the requested full log range.

## 1. Current decision profile

| Decision | Count | Share |
|---|---:|---:|
| BUY | 32 | 1.43% |
| SELL | 22 | 0.98% |
| HOLD | 2,190 | 97.59% |
| WAIT | 0 | 0.00% |
| **Total** | **2,244** | **100.00%** |

### BUY confidence and strength

| Measure | Result |
|---|---:|
| BUY decisions with confidence >= 65 | 32 |
| BUY decisions with confidence >= 67 | 0 |
| BUY decisions with confidence >= 70 | 0 |
| BUY confidence, average | 65.80 |
| BUY confidence, range | 65.10–66.61 |
| BUY Market Strength, average | 28.64 |
| BUY Market Strength, range | 27.05–31.43 |

The BUY signals passed the AI's Market Strength condition; the gap is between their confidence scores and the separate paper-entry threshold.

### Market opportunity breadth

| Market | BUY decisions | Average BUY confidence | BUY confidence range |
|---|---:|---:|---:|
| MEGA-EUR | 18 | 65.87 | 65.10–66.61 |
| POL-EUR | 12 | 65.77 | 65.61–65.90 |
| INJ-EUR | 1 | 65.24 | 65.24 |
| UNI-EUR | 1 | 65.36 | 65.36 |
| **Unique BUY markets** | **4** | | |

Separately, **95 HOLD decisions across seven markets** had Market Strength >= 20, with average strength 23.62 and maximum 28.91. All 95 had confidence below 65, so they did not become BUY signals. This shows that the confidence-generation gate, not only weak directional strength, constrained the number of opportunities.

## 2. Paper-trading execution funnel

| Funnel stage | Count / result |
|---|---:|
| BUY decisions generated | 32 |
| Met the AI generation floor (confidence >= 65) | 32 |
| Met the live paper-entry threshold (confidence >= 67) | 0 |
| Linked to an executed trade | 0 |
| Trade rows of any side in the window | 0 |
| BUY decisions followed by a later same-market decision before the cutoff | 31 of 32 |

All 32 BUY decisions recorded an available, non-stale market snapshot and all six candle intervals with no stale intervals. Therefore, freshness checks do not explain why these BUYs failed to become trades. There was no WAIT decision in the window.

The requested per-BUY outcome checks are:

| Possible outcome or blocker | Finding for the 32 BUY decisions |
|---|---|
| Executed | **0** linked trades; no trade rows of any side in the audit window. |
| Confidence threshold | **32/32** were below 67. Each would fail this gate if evaluated while current; the database does not store a per-decision rejection result. |
| Superseded by a later decision | **31/32** had a later decision for the same market by the cutoff. Whether that later decision existed before the executor evaluated the BUY is not retained. |
| Cooldown | No historical paper trades were found in any of the four BUY markets, so no trade-based cooldown blocker is evidenced. |
| Position limit | No BUY market had an open position; only WIN-EUR was open, below the configured five-position maximum. No position-limit block is evidenced. |
| Allocation or other risk controls | Not attributable per decision. The portfolio had approximately EUR 8,754.55 available, but no row-level risk outcome is retained, so these checks cannot be conclusively ruled out for every BUY. |
| Freshness | **0** freshness blockers evidenced: all 32 had a fresh market snapshot and all six fresh candle intervals. |

Two visible Vercel logs confirm that the executor ran after analysis during the window:

| Vercel log time (UTC) | Duration | Portfolios | Decisions processed | Trades executed | Duplicates | Skipped |
|---|---:|---:|---:|---:|---:|---:|
| 10:33:11 | 1,256 ms | 1 | 102 | 0 | 0 | 102 |
| 10:38:16 | 5,796 ms | 1 | 102 | 0 | 0 | 102 |

The Vercel Logs UI displayed these times in Europe/Brussels local time; the table converts them to UTC.

These are aggregate results. A skipped count covers all processed decisions, not just BUYs, and cannot be assigned to specific decisions. The paper-trading API logs run-level metrics; neither its logs nor the decision/trade tables retain an individual outcome for each unexecuted decision. Because stale/superseded checks can precede the confidence check, the available evidence cannot prove which earlier BUYs reached which specific executor branch. It does establish that all 32 were below the live 67 threshold and none produced a trade.

## 3. Freshness, coverage, and operational checks

- At the 08:56:02 UTC baseline, all **102/102 enabled markets** had stored candles for each of the six configured intervals. The baseline freshness snapshot still had 20 stale `1m` markets and five stale `5m` markets; coverage should not be confused with freshness.
- Despite those baseline stale counts, every BUY recorded during this audit had all six candle intervals fresh and an available, non-stale market snapshot.
- Across all 2,244 decisions, every market snapshot was marked available and non-stale. A total of 1,840 decisions recorded all six intervals without stale intervals; the remaining 404 HOLD decisions did not record all six intervals as available with no stale intervals. None became WAIT in this window.
- The production status row was `ACTIVE` with no error message at 10:46:19 UTC, shortly after the decision cutoff.
- The executor state observed during the audit was `NORMAL`, with one open position versus the configured maximum of five. Available portfolio balance was approximately EUR 8,754.55. No evidence indicates that emergency stop or the open-position cap was the primary blocker.
- The Vercel Hobby log view reported that runtime logs were not retained for the full requested range. Consequently, the two visible invocations are confirmation that execution ran, not a complete count of paper-trading calls across all 22 batches.

## 4. WIN-EUR open-position review

| Measure | Current observation |
|---|---:|
| Position | OPEN |
| Quantity | 16,348,102.959272 WIN |
| Entry price | EUR 0.000061092229 |
| Current mark | EUR 0.000061536 |
| Unrealized P&L | +EUR 7.25 |
| Portfolio value | EUR 9,760.55 |
| Available balance | EUR 8,754.55 |

All **22 post-cutoff WIN-EUR decisions** were HOLD. Confidence averaged 61.98 (range 59.25–64.99); Market Strength averaged 22.51 (range 15.57–28.91). The latest decision, at 10:41:23 UTC, was HOLD with confidence 62.08 and Market Strength 23.02. The position remained open and modestly above its entry mark; no SELL decision was recorded for WIN-EUR in this window.

## 5. Cause assessment

| Candidate cause | Assessment |
|---|---|
| **A. Market conditions** | Contributing, but not the sole explanation. Only four markets emitted BUY signals. However, 95 HOLDs in seven markets had Market Strength >= 20, showing that directional strength sometimes existed without sufficient confidence. |
| **B. Confidence model** | **Material upstream constraint.** All 32 emitted BUYs scored below 67, and 95 additional strength-qualified HOLDs scored below the AI's 65 signal floor. |
| **C. Paper-trading filters** | **Primary immediate constraint.** The current production entry gate is 67; none of the 32 BUY decisions met it. No trade was linked to a BUY. Exact per-decision skip reasons are not persisted. |
| **D. Risk controls** | Not indicated as the primary cause by the evidence. There was one open position, normal executor state, substantial available balance, and fresh input on every BUY. Individual risk-filter outcomes are not available. |
| **E. Operational issues** | Unlikely to be the principal cause in this window. Twenty-two complete analysis batches were recorded, BUY data was fresh, and paper trading ran successfully in the two visible logs. Full scheduler/executor invocation history was not retained, so this is not proof that no operational issue occurred anywhere in the window. |

### Verdict

Low trade volume in the audited post-fix period is explained primarily by the **confidence mismatch between generated BUYs (65.10–66.61) and the live 67 paper-entry threshold**. The upstream confidence floor also prevented a further 95 strength-qualified HOLDs from becoming signals. Freshness and scheduler recovery are not supported as the primary cause by the observed data. This is an operational diagnosis, not a recommendation to lower the threshold or alter strategy/risk controls.

## 6. Evidence limitations

1. Per-decision execution outcomes are not durably recorded. Confidence rejection, stale/superseded handling, cooldown, allocation, and other risk rejections cannot be counted individually from the retained data.
2. The Vercel Hobby runtime-log retention did not provide a complete invocation history for the requested period. Only two recent aggregate paper-trading log entries were available.
3. This audit covers about 1 hour 49 minutes after the 08:56:02 coverage checkpoint. It does not evaluate earlier pre-fix history or establish long-term trade frequency.
4. The 08:56 freshness counts are a single baseline snapshot, not an interval-by-interval historical freshness trend.

## Sources

- [Checkpoint RPC post-deployment validation](./CHECKPOINT_RPC_POST_DEPLOYMENT_REPORT.md)
- [Checkpoint RPC 24-hour validation](./CHECKPOINT_RPC_24H_VALIDATION.md)
- [Risk management rules](../RISK_MANAGEMENT.md)
- [Scheduler and paper-trading operations](../SCHEDULING.md)
- [AI signal-generation logic](../../lib/ai-engine.mjs)
- [Paper-trading API aggregate logging](../../api/paper-trading.mjs)
- [Execution-audit backlog](../../ROADMAP.md)
- [Confidence-threshold experiment migration](../../PostgreSQL/migrations/20261102140000_paper_trading_confidence_experiment.sql)

**Tests:** Not run; this is a read-only production audit and report.
