# AI Engine V2 Proposal

**Status:** Design proposal only; not implemented, activated, or deployed  
**Evidence basis:** Existing production-data investigations in this directory  
**Trading mode:** Paper trading only

## Executive proposal

Keep CryptoPulse's deterministic, analysis-only AI Engine and its existing
Watched Markets -> stored market data/candles -> AI Engine -> AI Decisions
architecture. Replace the broad, equally applied multi-timeframe indicator mix
with a daily-EMA-led candidate score, modest higher-timeframe and 1-hour volume
confirmation, and a small daily RSI contribution.

This is a candidate for controlled simulation, not an asserted optimum. The
reports consistently identify 1-day EMA spread as the most promising signal,
but their samples are short, correlated, and regime-dependent. Most importantly,
the latest execution replay closed no more than one trade for any candidate
model. That evidence cannot establish better profitability, win rate, or
drawdown.

## Current AI Engine (V1)

The current engine is deterministic and analysis-only. It reads the enabled
watched markets, stored market snapshots, and fresh OHLCV candles; computes
indicators; and persists BUY, SELL, HOLD, or WAIT decisions. It does not open or
close trades or modify a portfolio. The separate Paper Trading Engine applies
the Risk Manager to stored decisions.

### Current Market Strength

Each valid timeframe currently combines:

| Indicator | Current per-timeframe weight |
|---|---:|
| EMA12/EMA26 trend | 30% |
| Momentum | 25% |
| RSI14 | 15% |
| MACD histogram | 15% |
| Signed volume score | 15% |

The valid timeframe scores are weighted and normalized using:

| Interval | Current weight |
|---|---:|
| 1m | 5% |
| 5m | 10% |
| 15m | 15% |
| 1h | 25% |
| 4h | 30% |
| 1d | 15% |

The final score blends 90% of the weighted timeframe score with 10% market
context. Context combines 24-hour price change (70%) and position in the
24-hour range (30%). The engine's trend feature is
`clamp((EMA12 - EMA26) / EMA26 * 5000, -100, 100)`. Its RSI score is
`clamp((RSI14 - 50) * 2, -100, 100)`.

The score produces a directional signal at absolute Market Strength 20 or
greater. For sufficient data, current confidence is:

```text
clamp(
  35
  + abs(Market Strength) * 0.38
  + candle coverage fraction * 15
  + average candle depth * 10
  - average volatility penalty,
  0,
  95
)
```

The current average volatility penalty is 0, 4, or 12 points for low, medium,
or high volatility per valid timeframe. Insufficient data produces a capped
low-data confidence; stale or insufficient histories fail safely. Confidence
below 65 prevents a directional signal. Paper Trading separately enforces its
current 67 BUY-entry gate.

### Current flow and invariants

```text
AI_Crypto_Bot_Watched_Markets
              |
Stored market snapshots and candles
              |
Deterministic indicators, Market Strength, confidence
              |
AI_Crypto_Bot_AI_Decisions
              |
Risk Manager -> Paper Trading Engine
```

The V2 proposal preserves this boundary: the AI Engine recommends and records;
only the existing risk-managed executor may execute paper trades. It also
preserves the current decision types, market universe, freshness checks,
database tables, API route, paper-only mode, and downstream risk controls.

## Proposed AI Engine V2

### Candidate Market Strength weights

V2 would make the 1-day EMA spread the directional anchor. Other features
would confirm or qualify that direction rather than independently manufacture a
signal.

| Candidate component | V2 weight | Definition and role |
|---|---:|---|
| 1-day EMA spread | 75% | Primary signed direction and trend strength |
| 1h/1d EMA alignment | 10% | Confirmation only; no hard alignment filter |
| 1-hour volume confirmation | 10% | Ratio-aware confirmation in the direction of the 1-day EMA |
| 1-day RSI14 | 5% | Small supporting directional input; never a standalone RSI cutoff |
| Momentum | 0% | Retain as a diagnostic output, not a directional score input |
| MACD | 0% | Retain as a diagnostic output; test precision and horizon-specific value separately |
| 24-hour market context | 0% | Retain in recorded market data, but remove from the directional score |

These are pre-validation design weights, not statistically optimized
coefficients. The zero MACD weight is provisional: MACD appeared noisy or
precision-limited at 24 hours, while some reports found a 4-hour association.
It should remain observable and be evaluated as a separate challenger.

### Candidate score

Normalize the score components to `[-100, 100]`:

```text
E1d = clamp(1-day EMA percent spread * 50, -100, 100)
R1d = clamp((1-day RSI14 - 50) * 2, -100, 100)

A1h = 1 when 1-hour and 1-day EMA directions agree and are non-sideways;
      otherwise 0

V1h = clamp((1-hour volume ratio - 0.50) / 1.00, 0, 1)

MarketStrengthV2 = clamp(
  0.75 * E1d
  + 0.10 * (E1d * A1h)
  + 0.10 * (E1d * V1h)
  + 0.05 * R1d,
  -100,
  100
)
```

`V1h` is zero at or below a 0.50 ratio and reaches one at a ratio of 1.50; it
is capped above that point. It is not itself bullish or bearish: multiplying
it by `E1d` makes volume confirm the daily direction. Low volume is neutral
rather than an inverted signal, and high volume alone cannot create a BUY.
The mapping is deliberately simple and must be fixed before any holdout
evaluation; the reports do not establish an optimal volume-ratio curve.

`A1h` and `V1h` scale the signed daily EMA rather than adding independent
directional points. This keeps the daily EMA as the signal anchor and avoids
turning alignment or volume into a standalone entry rule. A bearish daily EMA
remains bearish when its confirmations agree.

### Candidate confidence

V2 confidence should represent the strength and agreement of the directional
evidence, not imply a calibrated probability of profit.

```text
T1d = abs(E1d) / 100
Rconfirm = clamp(max(0, sign(E1d) * R1d / 100), 0, 1)
Pvol = the existing average volatility penalty (0, 4, or 12 points)

ConfidenceV2 = round(clamp(
  40
  + 30 * T1d
  + 10 * A1h
  + 10 * V1h
  + 5 * Rconfirm
  - Pvol,
  0,
  95
))
```

The fixed base and feature weights above are starting hypotheses, not a fitted
calibration. V2 removes the current coverage and depth *bonuses* because their
variation contributed little to ranking outcomes in the examined BUY samples.
It does **not** remove candle-count, freshness, or data-validity safeguards:
those remain eligibility checks, not rewards. The volatility penalty remains
unchanged in this first candidate so that it is not weakened based on unstable
predictive associations.

For V2, a valid, fresh 1-day EMA and 1-hour volume input are required to
calculate the candidate score. If either is missing, stale, or invalid, the
engine should return WAIT with the applicable data-quality reason rather than
silently substituting zero or producing a partial directional score. Existing
low-data handling remains fail-safe.

### Decision and execution boundaries

For the first simulation, keep the current `+20/-20` directional score levels,
the AI confidence floor of 65, and the paper executor's 67 BUY gate unchanged.
These values are comparison controls, not a claim that the redesigned
confidence remains calibrated to them. Recalculate candidate eligibility and
trade outcomes under both existing gates before considering any threshold
change.

BUY, SELL, HOLD, and WAIT remain the supported outputs. V2 does not add
stop-loss, take-profit, trailing-stop, or other exit behavior; the separate
shadow-exit framework remains non-executable. No risk control, portfolio rule,
cooldown, emergency control, or live-trading setting changes.

## Signals changed and rationale

| Change | Direction | Rationale from prior reports |
|---|---|---|
| 1-day EMA spread | Increase substantially | The most consistent and strongest observed 24-hour association; EMA-only ranked best in the simplified score comparison. |
| 1h/1d trend alignment | Add modest confirmation | Bearish-daily BUYs performed poorly in the observed trade sample, but the realized sample had only three closed countertrend losses and no closed aligned trades. |
| 1-hour volume ratio | Add modest, direction-aware confirmation | It had a positive 24-hour association in some analyses, but bucket/filter results were mixed and non-monotonic. |
| RSI | Reduce to a small daily input | Some 24-hour information appeared, but short-horizon and model-combination results were inconsistent. RSI above 70 is not a validated blocking rule. |
| Momentum | Remove from the candidate score | Adding momentum reduced 24-hour ranking quality in the nested comparison and provided weak standalone evidence. Keep it available for later evaluation. |
| MACD | Remove from the initial candidate score, retain diagnostically | Stored values were frequently zero after rounding; findings were horizon-dependent, including some 4-hour benefit. Test higher precision and horizons separately before a lasting removal. |
| Market context blend | Remove from the candidate directional score | The 10% blend was the largest measured source of 24-hour signal dilution in one nested comparison. Preserve underlying market data for context and future testing. |
| Coverage/depth confidence bonuses | Remove as additive confidence points; retain as data gates | They had little variation in the tested BUY cohort. Their lack of predictive variation is not a reason to weaken data sufficiency or freshness checks. |
| Volatility confidence penalty | Keep unchanged initially | Its relationship with returns was unstable, and volatility retains risk meaning. Evaluate any penalty adjustment separately. |

## Evidence strength and limitations

The reports are not fully consistent: results change by horizon, repeated-row
handling, and sample definition. They use overlapping decision rows, short
market periods, rounded persisted features, and candle-derived forward returns
rather than a large set of independent realized trades. Some candidate
comparisons hold the existing BUY cohort fixed, while others replay only a
small number of executed positions.

In the latest production-style replay, each candidate model closed at most one
trade. Candle coverage was sparse, and historical execution-time market prices
and some executor state were unavailable. Its win-rate, drawdown, and ending
equity figures cannot support model selection. Accordingly, the V2 weights and
confidence formula above are transparent hypotheses to test, not a claim that
they maximize future returns.

## Validation and promotion gates

Before any V2 implementation or activation:

1. Use the planned strategy simulator or an equivalent offline harness. Freeze
   the V2 formulas before evaluating a chronological holdout; do not tune on
   the holdout.
2. Compare V1 and V2 across 4-hour and 24-hour forward outcomes and the full
   decision universe, not only historical BUY decisions.
3. Replay the unchanged signal gates and the complete Paper Trading Risk
   Manager, including position limits, cooldowns, fees, slippage, drawdown
   rules, and fresh-price requirements. Report unique opportunities as well as
   repeated decision rows.
4. Report sample sizes, missing/stale input rates, calibration, BUY count,
   closed-trade count, win rate, expectancy, profit factor, drawdown, and
   return after costs. Do not infer a production edge from rank correlation or
   open-position marks alone.
5. Evaluate RSI, MACD precision, volatility penalty, and volume mapping as
   separate ablations so a change can be attributed.
6. Require sufficient independent, closed-trade evidence across more than one
   market regime. Set the sample-size rule before evaluation; do not invent a
   target from the observed results.
7. If later approved for implementation, version the engine and stored
   decisions, keep JavaScript and database analysis paths behaviorally
   equivalent, preserve the existing decision schema and API/function count,
   and retain a clear rollback to V1.

## Architecture impact

This proposal requires no new API route, Vercel Function, database table, AI
provider, or trading executor. It uses the existing indicator inputs and
decision persistence. Implementation would need coordinated JavaScript and
database-path changes if database analysis mode is enabled, plus parity tests
and versioned decision reasons. The Risk Manager remains authoritative;
`ENABLE_LIVE_TRADING=false` and paper-only behavior remain unchanged.

## Prior investigation reports

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

Current implementation reference: [AI Engine](../../lib/ai-engine.mjs).
