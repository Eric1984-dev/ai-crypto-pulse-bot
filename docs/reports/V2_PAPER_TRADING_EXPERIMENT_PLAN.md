# V2 Paper Trading Experiment Plan

**Status:** Planning only; no code, configuration, migration, or deployment changes  
**Mode:** Paper trading only; no real money or exchange orders  
**Candidate:** [AI Engine V2 proposal](./AI_ENGINE_V2_PROPOSAL.md)

## 1. Objective and scope

Run one controlled, reversible paper-trading experiment using AI Engine V2
decisions, and compare its realized results with the existing V1 paper-trading
history. V1 remains implemented and is the default. V2 must not be activated
until the version-selection, execution-isolation, risk-regression, and reporting
requirements below are implemented and verified.

The experiment changes only which AI Engine version generates eligible
decisions. It does not change the Risk Manager, paper executor's trading rules,
market universe, scheduler cadence, fees, slippage, exits, or live-trading
configuration. There is no concurrent V1 shadow writer: a single active
version produces decisions for all enabled markets and portfolios at a time.

## 2. Configuration contract

Add a server-side environment variable:

```env
AI_ENGINE_VERSION=V1
```

| Value | Behavior |
|---|---|
| `V1` | Use the preserved current engine. This is the default when the variable is unset. |
| `V2` | Use the frozen candidate formulas in the V2 proposal. |
| Any other value | Fail closed: analysis and paper execution return an explicit configuration error and create no new decisions or trades. Do not silently fall back to V1. |

The setting is server-only and must not be sent to browser code. Both
`/api/ai-analysis` and `/api/paper-trading` must read and validate the same
value. Keep `AI_ANALYSIS_MODE` separate: JavaScript and database analysis modes
must produce the selected engine version's behavior and metadata consistently.
A database-mode analysis call must receive and validate the selected version;
it must not silently run V1 when V2 was requested.

Map the environment value to an immutable engine identity in the existing
`strategy_name` / `strategy_version` decision fields. V1 retains its current
identity; V2 receives a distinct identity and version. Every generated
decision, including HOLD and WAIT, must be tagged. Untagged or unknown-version
decisions are not eligible for the V2 experiment or its primary comparison.

Changing the environment value is an operator-controlled rollout/rollback
action. The agent may not change environment variables or select its own
version.

## 3. Version isolation at paper execution

The current paper executor selects the newest stored decision per enabled
market without filtering by engine version. Before V2 can execute trades, the
existing paper-trading service/RPC must receive the expected engine identity
and apply it when selecting decisions.

Required behavior:

- In V1 mode, process only fresh V1 decisions.
- In V2 mode, process only fresh V2 decisions.
- If no fresh decision exists for the configured version, skip that market.
- Never fall back to the other version, an untagged decision, or an older
  decision from another version.
- A version mismatch, invalid version, or inconsistent decision provenance
  fails closed and is visible in the run result/logs.
- Preserve the existing decision-to-trade ID link and idempotency key.
- Continue to enforce the existing latest-decision and 15-minute freshness
  checks. AI analysis and paper trading must remain sequential, with paper
  trading invoked only after analysis completes successfully.

This requires a reviewed database migration and an update to the existing
paper-trading RPC contract or an equally strict compatible design. The database
must validate the requested engine identity, and only the service role may
execute the server-side function. A legacy no-argument call, if retained, must
be constrained to V1; it must never bypass version filtering. No new
`/api` route or Vercel Function is proposed.

The V2 flag selects the engine for all enabled markets. It is not a per-market
canary. A missing V2 result must not cause V1 decisions for the same market to
be executed during the experiment.

## 4. Experiment lifecycle

### Phase A: V1 baseline and readiness

1. Freeze a baseline cutoff timestamp and the V1 engine identity.
2. Record all available V1 closed-trade and portfolio-snapshot metrics using
   the definitions in Section 6. Report the sample sizes and missing or
   unversioned records; do not treat historical rows as independent trials.
3. Use both the full available V1 history and, where possible, a
   same-duration period immediately before the V2 start. The adjacent period
   helps describe temporal differences but does not remove market-regime bias.
4. Require every portfolio processed by the executor to be flat before the
   experiment starts. Existing positions must close through normal V1 paper
   decisions; do not force-close, delete, or relabel them to start V2. If the
   portfolios are not flat, remain on V1 until they are.
5. Verify the paper-only environment, selected V1 identity, scheduler
   sequence, migration state, and rollback procedure before enabling V2.

Prior investigations recorded only a small V1 realized sample (three closed
losing positions in the cited window) and open positions at the time of those
reports. The V1 baseline is therefore a descriptive comparator, not a
statistically reliable forecast.

### Phase B: V2 controlled run

1. Deploy the approved V1/V2 selection and execution-version guard while
   leaving `AI_ENGINE_VERSION=V1`.
2. Verify V1 parity first: the default and explicit V1 selection must preserve
   existing decisions and paper-trading behavior.
3. After the readiness checks pass, set `AI_ENGINE_VERSION=V2` in the server
   environment. Keep the existing scheduler cadence and ordering unchanged.
4. Run analysis, then paper trading, using the same enabled markets, stored
   input data, portfolio(s), and unchanged executor limits.
5. Tag V2 decisions with the V2 identity. Attribute experiment entries by the
   version of the BUY decision linked to the BUY trade. Pair each close with
   the corresponding position lifecycle and record the version of the SELL
   decision as well.
6. Preserve all V1 and V2 decision/trade history. Do not overwrite or delete
   prior records.

The primary V2 comparison cohort consists of completed position lifecycles
whose entry and exit decisions are both V2. If a rollback causes V1 to close a
V2-origin position, report that lifecycle separately as a cross-version
rollback close; include its realized effect in total account P&L and drawdown,
but do not present it as a pure V2 entry-and-exit result. Never leave an open
position unmanaged to preserve cohort purity.

### Phase C: checkpoint, end, or rollback

- At **25 closed V2 position lifecycles**, perform the formal interim review.
  Do not declare success solely from this checkpoint. If there is no safety or
  performance stop, continue toward 50.
- The experiment may end at 25 if a rollback criterion is met.
- At **50 closed V2 position lifecycles**, stop the V2 experiment and make the
  final decision. Do not extend or restart it under the same V2 identity without
  a separately reviewed plan.
- At finalization, set the active version to V1. New decisions and executions
  return to V1. Leave existing V2 positions visible and manage them through
  normal fresh SELL decisions and unchanged risk controls; do not force-close.

The count is unique, closed V2 entry position lifecycles, not decision rows,
BUY/SELL execution rows, repeated signals, or shadow scenarios. Open positions
do not count as closed trades. If a lifecycle cannot be attributed
unambiguously, exclude it from the primary V2 count and report the data-quality
gap.

## 5. Risk and safety invariants

All existing safeguards remain authoritative and unchanged:

| Control | Existing rule retained |
|---|---|
| Trading mode | Paper only; `ENABLE_LIVE_TRADING=false` |
| Maximum open positions | 5 |
| Maximum entry notional | 10% of current portfolio value |
| BUY confidence gate | Current paper executor gate: 67 |
| Per-market cooldown | 15 minutes |
| Daily drawdown entry block | 5% |
| Maximum portfolio drawdown entry block | 15% |
| Emergency stop | 20% drawdown from portfolio peak |
| Decision and market snapshot freshness | Existing 15-minute execution check |
| Candle freshness and minimum history | Existing per-interval and data-quality safeguards |
| Costs | 0.25% fee and 0.10% adverse slippage, unchanged |
| Duplicate execution | Existing decision-linked deterministic idempotency |
| SELL behavior | Fresh SELL can close existing positions; no short positions |

An engine-version change must not alter any of these values or bypass their
database enforcement. Emergency stop, pause, stale data, insufficient funds,
position limits, cooldown, and drawdown checks apply equally to V1 and V2.
Shadow exits remain observational and cannot execute or close a position.

## 6. Comparison metrics

Use the same metric definitions and cost treatment for the V1 baseline and V2
cohort. Use actual stored paper trades for realized results; keep counterfactual
candle returns and shadow-exit results separate.

| Metric | Comparison definition |
|---|---|
| Closed trade count | Unique completed position lifecycles; show BUY entries and SELL executions separately as supporting counts. |
| Win rate | Profitable closed position lifecycles divided by all closed lifecycles; report breakeven separately. |
| Net realized P&L | Stored realized P&L after the existing fees and slippage. |
| Expectancy | Mean net realized P&L per closed lifecycle. |
| Profit factor | Gross positive realized P&L divided by absolute gross negative realized P&L; report N/A where undefined. |
| Average net return | Net realized result divided by the same fee-inclusive entry cost basis for both versions. |
| Maximum drawdown | Peak-to-trough drawdown from persisted portfolio snapshots; show the V1 baseline window and V2-from-start window separately. |
| Trade frequency | Unique entries per elapsed day and, separately, per enabled-market-day; do not use repeated decision rows as trades. |
| Average holding time | Time from the associated BUY execution to its closing SELL execution. |
| Costs and exposure | Fees, slippage, open positions, and position sizing, to verify equal execution assumptions. |
| Data quality | Missing/stale V2 inputs, untagged decisions, cross-version skips, and attribution failures. |

Report two V1 baselines where data permits: all available V1 closed lifecycles
and the same-duration period immediately before V2. Show sample size alongside
every metric. The current executor does not persist a durable per-decision
rejection reason, so aggregate `skipped` counts cannot reliably explain every
missed opportunity. Do not infer rejection causes from those aggregate counts.

Use the existing Analytics/exports and persisted decision, trade, and snapshot
records where possible. Any needed version breakdown should extend the existing
reporting path; do not add a serverless endpoint solely for the experiment.

## 7. Success criteria

The 25-trade review is an interim safety and evidence checkpoint. V2 can be
considered successful for continued paper-only use only after the final
50-closed-lifecycle review, and only if all of the following hold:

1. All primary cohort rows have valid V2 entry and exit provenance, and there
   are no version-routing, duplicate-trade, data-integrity, or risk-control
   violations.
2. V2 net expectancy is positive after costs and its profit factor is greater
   than 1.
3. V2 net expectancy exceeds the comparable V1 baseline and V2 profit factor
   is not lower where the V1 metric is defined.
4. V2 maximum drawdown is no worse than the same-duration V1 baseline, and no
   existing daily, portfolio, or emergency limit was bypassed or weakened.
5. Trade count, win rate, holding time, fees, slippage, open positions, and
   data-quality rates are reported with denominators; a higher BUY count or
   win rate alone is not success.

If a V1 baseline metric is undefined or has too few observations to compare,
mark that criterion inconclusive rather than treating it as passed. Passing
these criteria supports only a decision to continue controlled paper
evaluation; it does not prove a future edge or authorize live trading.

## 8. Rollback and stop criteria

### Immediate safety rollback

Stop V2 analysis/execution and switch the active configuration back to V1 if
any of the following occurs:

- Any path attempts a real exchange order, exposes exchange credentials, or
  permits `ENABLE_LIVE_TRADING` to differ from `false`.
- The paper executor processes an untagged or non-active-version decision,
  falls back to another version, or cannot validate the source decision.
- A V2 path bypasses or changes a Risk Manager check, freshness rule,
  idempotency rule, or transactional safeguard.
- V2/DB-mode and V2/JavaScript-mode outputs diverge unexpectedly, or
  configuration/database errors produce success-shaped results.
- Duplicate V2 executions, corrupted provenance, or an unrecoverable
  experiment-attribution error is observed.

Existing safeguards continue to block entries during pause, emergency stop,
drawdown breach, stale inputs, or any other existing rejection condition.
Rollback to V1 must never reset or bypass those states.

### Interim performance rollback

At 25 closed V2 lifecycles, pause new V2 entries and revert to V1 for review if
both V2 net expectancy is negative and profit factor is below 1, and the
same-duration V2 portfolio drawdown is worse than the V1 baseline. Also stop
V2 immediately if any existing risk threshold is reached; this is a risk
response, not a reason to weaken the threshold.

If the 25-trade evidence is mixed and no stop condition is met, continue to 50.
At 50, if any final success criterion is unmet or inconclusive, end the
experiment and revert to V1. No automatic promotion or threshold adjustment
occurs.

### Rollback procedure

1. Set `AI_ENGINE_VERSION=V1` in the server environment.
2. Run AI analysis successfully in V1 mode before the next paper-trading run.
3. Confirm the paper executor accepts only V1 decisions and continues to
   enforce all existing safeguards.
4. Keep V2 decision/trade records and any open V2 positions; do not delete
   experiment history or force-close positions.
5. Record the rollback time, trigger, open-position status, and final cohort
   metrics in the operations/experiment report.

## 9. Implementation and release prerequisites

Before any V2 production-paper activation, the later implementation must:

- Keep V1 code and behavior available and make V1 the unset/default
  `AI_ENGINE_VERSION`.
- Validate the flag in both existing endpoints; fail closed on invalid values.
- Apply identical version selection in JavaScript and database analysis paths.
- Tag every decision with its immutable engine/strategy identity.
- Pass the expected identity to the existing paper-trading RPC and filter
  decisions before execution.
- Preserve or safely wrap the existing no-argument paper-trading RPC so a
  legacy invocation cannot bypass version checks; default any supported
  legacy invocation to V1.
- Keep V1 and V2 metric attribution separate, including exit-version
  attribution and rollback-managed positions.
- Add unit, API, SQL/PGlite, and end-to-end scheduler-order regressions for
  V1 parity, V2 routing, wrong-version rejection, no-version fallback,
  retries/idempotency, SELLs, and all unchanged risk controls.
- Update `.env.example`, README, API, architecture, database, risk management,
  testing, scheduling, strategy changelog, and the experiment report.
- Reuse `/api/ai-analysis`, `/api/paper-trading`, and the existing reporting
  infrastructure. Do not add a `/api` file or exceed the Vercel Hobby limit
  of 12 functions.
- Keep `ENABLE_LIVE_TRADING=false`; do not deploy or enable V2 until the
  implementation, migration review, validation, and separate operator
  approval are complete.

## 10. Decision record and open constraints

- **Active version before approval:** V1.
- **V2 state:** proposal only; inactive.
- **Experiment end:** interim review at 25 closed V2 lifecycles; final stop at
  50, with earlier termination on rollback criteria.
- **No automatic promotion:** a successful paper experiment requires a
  separate explicit decision before any later change.
- **No real-money stage:** this plan does not authorize or prepare activation
  of live trading.
- **Historical comparability:** V1 and V2 run in different time windows.
  Report regime and sample-size limitations; do not describe the comparison as
  a randomized or simultaneous A/B test.
- **Attribution limit:** trades link to their source AI decision, but the
  experiment must verify deterministic pairing of BUY/SELL records to a
  position lifecycle before counting a closed V2 result.

## References

Project instructions and architecture:

- [AGENTS.md](../../AGENTS.md)
- [README.md](../../README.md)
- [ROADMAP.md](../../ROADMAP.md)
- [AI Engine architecture](../ARCHITECTURE.md)
- [Database design](../DATABASE.md)
- [Risk management](../RISK_MANAGEMENT.md)
- [API contracts](../API.md)
- [Scheduling](../SCHEDULING.md)
- [Testing strategy](../TESTING.MD)
- [Deployment guide](../DEPLOYMENT.md)
- [Known issues](../KNOWN_ISSUES.md)
- [Phase 07 AI Engine prompt](../../prompts/07_AI_ENGINE.md)
- [Phase 08 Paper Trading prompt](../../prompts/08_PAPER_TRADING.md)
- [Phase 16 Strategy Simulation prompt](../../prompts/16_STRATEGY_OPTIMIZATION_SIMULATOR.md)

V2 design and completed evidence reports:

- [AI Engine V2 proposal](./AI_ENGINE_V2_PROPOSAL.md)
- [Full strategy effectiveness](./FULL_STRATEGY_EFFECTIVENESS_INVESTIGATION.md)
- [Trade pattern and exit analysis](./TRADE_PATTERN_AND_EXIT_ANALYSIS.md)
- [Higher-timeframe alignment](./HIGHER_TIMEFRAME_ALIGNMENT_ANALYSIS.md)
- [BUY filter effectiveness](./BUY_FILTER_EFFECTIVENESS_ANALYSIS.md)
- [Indicator attribution](./INDICATOR_ATTRIBUTION_ANALYSIS.md)
- [Confidence model attribution](./CONFIDENCE_MODEL_ATTRIBUTION_ANALYSIS.md)
- [Confidence redesign](./CONFIDENCE_REDESIGN_ANALYSIS.md)
- [Market Strength component analysis](./MARKET_STRENGTH_COMPONENT_ANALYSIS.md)
- [Market Strength signal dilution](./MARKET_STRENGTH_SIGNAL_DILUTION_ANALYSIS.md)
- [Simplified Market Strength comparison](./SIMPLIFIED_MARKET_STRENGTH_ANALYSIS.md)
- [Market Strength replay comparison](./MARKET_STRENGTH_REPLAY_COMPARISON.md)
- [Confidence-threshold experiment](./CONFIDENCE_THRESHOLD_EXPERIMENT_REPORT.md)
- [Post-fix confidence cluster](./POST_FIX_CONFIDENCE_CLUSTER_ANALYSIS.md)
- [Post-fix threshold impact](./POST_FIX_THRESHOLD_IMPACT_ANALYSIS.md)
- [Post-fix trade-generation audit](./POST_FIX_TRADE_GENERATION_AUDIT.md)
- [Post-scheduler opportunity analysis](./POST_SCHEDULER_OPPORTUNITY_ANALYSIS.md)
