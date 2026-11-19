# Volume + Positive Momentum Entry Filter Experiment

**Status:** Implemented in the local Raspberry Pi JavaScript AI engine; not deployed to the Pi  
**Mode:** PAPER only  
**Strategy identity:** Deterministic Technical Analysis V2, version `2.1.0`  
**Change date:** 2026-11-19

## Change

BUY decisions retain every existing signal-generation, confidence, data-quality,
and alignment condition. An otherwise qualifying BUY is converted to HOLD when
either:

- the stored 1d momentum `changePct` is not greater than zero; or
- the existing 1h volume confirmation score is below 0.25. The score is
  `clamp(hourlyVolumeRatio - 0.5, 0, 1)`.

Failed candidate BUYs keep their ordinary confidence and indicator payload. The
persisted AI decision `reason` includes `LOW_DAILY_MOMENTUM`,
`LOW_VOLUME_SCORE`, or both, plus the measured momentum and volume score. This
reuses the existing AI decision history for experiment measurement. It does
not create rows in `AI_Crypto_Bot_Paper_Execution_Audit`: that table's current
reason-code constraint is fixed by the existing schema, and changing it would
require a migration outside this experiment's scope.

## Evidence and hypothesis

The motivating historical cohort had 14 closed trades: 7 winners, 7 losers,
50.0% winrate, +€4.15 average winner, -€10.06 average loser, and -€2.95
expectancy. All four trades whose entry 1d momentum was <= 0 were losses.

Applying both fixed filter conditions retrospectively retained six closed
trades: five wins and one loss, 83.3% winrate, +€2.07 expectancy, and +€12.43
total net P&L. This is an in-sample subset of only six trades, concentrated in
few pairs/time clusters; it is a hypothesis-generating observation, not
validated evidence of improved future performance.

**Hypothesis:** BUY signals with positive daily momentum and sufficient hourly
volume deliver better average trade quality than the previous selection.

## Scope controls

The implementation changes only post-score BUY selection and strategy
identity. It does not change confidence formulas or threshold, EMA/trend,
alignment or RSI calculations, the paper executor, fees, sizing, cooldown,
position/portfolio controls, exits, scheduler, or database schema. SELL, HOLD,
and WAIT behavior remains unchanged except that rejected BUY candidates are
stored as HOLD with an explanatory reason.

The active Raspberry Pi JavaScript engine is versioned `2.1.0` so new AI
decisions are distinguishable from historical version `2.0.0`. Trades retain
their source `ai_decision_id`, allowing a trade to be joined to its entry
decision's `strategy_version` and `created_at`. The version/date in this
document describes the source change, not production deployment; the Pi runtime
has not been updated or verified.

## Monitoring

For new prospective paper data, measure:

- executed BUY count and closed position lifecycles;
- filtered candidate count for each reason code in persisted AI decision text;
- winrate, expectancy, profit factor, average winner, and average loser;
- maximum drawdown, using the same portfolio snapshot definition as baseline.

Success criteria, evaluated on new data, are winrate above 50%, expectancy
better than -€2.95, profit factor above the baseline, and no significant
drawdown deterioration. Report sample size and keep open positions separate
until closed. Do not count the six-trade retrospective subset as an independent
validation set.

## Validation

- Focused AI-analysis and decision-repository tests: **19 passed**.
- Full Raspberry Pi test suite: **280 passed, 0 failed**.
- No production database writes, schema migrations, deployment, or live bot
  configuration changes were performed.

## Files

- Runtime logic: `raspberry-pi/src/services/ai-engine.mjs`
- Focused regression coverage: `raspberry-pi/tests/ai-analysis.test.mjs`
- Strategy history: `docs/STRATEGY_CHANGELOG.md`
- Operational experiment notes: `docs/RISK_MANAGEMENT.md`
