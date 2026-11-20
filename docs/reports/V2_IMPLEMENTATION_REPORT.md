# AI Engine V2 Implementation Report

**Status:** Historical V2.0.0 implementation record; superseded as an active-state reference. The operator reports V2.1.0 deployed to the Pi, and production decisions tagged `2.1.0` were observed. The exact running binary/build is not independently verified here.
**Mode:** Paper trading only
**Baseline:** `v1-final-backup` and `v1-final` point to commit `d51bd633f51731f047cb4ea23e138d4817545a37`

The original status and validation results below describe the V2.0.0 implementation
at the time of that work. They are not the current Pi deployment status. The
active Raspberry Pi implementation is the JavaScript engine; the historical
Supabase/database-analysis migration notes below do not describe the active
production backend.

## Implementation summary

The V2 directional score introduced in this implementation was subsequently
extended with the misalignment penalty. The current Raspberry Pi V2.1.0 score
is:

```text
E1d = clamp(1d EMA percent spread * 50, -100, 100)
R1d = clamp((1d RSI14 - 50) * 2, -100, 100)
A1h = 1 when 1h and 1d EMA directions agree and are non-sideways; otherwise 0
V1h = clamp(1h volume ratio - 0.50, 0, 1)

Market Strength = clamp(
  0.75 * E1d
  + 0.10 * E1d * A1h
  + 0.10 * E1d * V1h
  + 0.05 * R1d
  - misalignmentPenalty,
  -100,
  100
)
```

`misalignmentPenalty` is 20 when 1d and 1h directions do not match as the same
non-sideways direction; otherwise it is zero. Alignment contributes to score
and confidence but is not a hard gate for generating an AI BUY. The paper
executor separately requires explicit alignment before opening a position.

For valid V2 inputs, confidence is:

```text
clamp(
  40
  + 30 * abs(E1d) / 100
  + 10 * A1h
  + 10 * V1h
  + 5 * clamp(max(0, sign(E1d) * R1d / 100), 0, 1)
  - capped average volatility penalty
  - misalignmentPenalty,
  0,
  95
)
```

The current confidence formula uses `abs(E1d) / 100` as trend strength,
alignment, volume and RSI confirmations, the capped volatility penalty, and
the misalignment penalty. Confidence is a deterministic model-strength score,
not direction or a calibrated win probability; strong bearish signals can
have high confidence. MACD and momentum remain in the persisted timeframe
diagnostics but do not contribute directly to Market Strength or confidence.
Market context is not used in the score. Coverage and depth bonuses are removed
from actionable V2 confidence; the bounded low-data fallback remains.

Fresh valid 1h volume-ratio and 1d EMA/RSI inputs are required. If they are
missing or invalid, the engine stores a non-actionable `WAIT`. Existing
snapshot and candle freshness checks, two-interval analysis minimum, four-fresh-
interval directional gate, 65 AI confidence floor, and ±20 directional score
levels were retained in V2.0.0. The 67 paper-entry gate cited in this original
implementation record applied to the historical SQL executor experiment; the
current Raspberry Pi paper executor uses confidence >= 70. New decisions use
the existing strategy snapshot fields with name `Deterministic Technical
Analysis V2`; V2.1.0 adds the two post-score BUY filters described below.

The optional database-analysis path was updated by an append-only migration
proposal for the then-used database-analysis deployment.
No database table, column, index, policy, API route, Vercel Function, new
dependency, executor, or risk-control change was introduced. Database mode
remains opt-in.

## Paper entry-filter experiment addendum

The Pi JavaScript engine is version `2.1.0`. The operator reports deployment,
and production decision records tagged `2.1.0` were observed. After deriving
the directional decision and confidence, an otherwise qualifying BUY is kept
only when stored 1d momentum `changePct` is > 0 and the existing 1h volume
confirmation score is >= 0.25. The score is
`clamp(hourlyVolumeRatio - 0.5, 0, 1)`. Failed BUY candidates become HOLD
decisions whose persisted reason includes `LOW_DAILY_MOMENTUM`,
`LOW_VOLUME_SCORE`, or both. Momentum remains excluded from Market Strength and
confidence. The exact running Pi binary/build is not independently verified.

This isolated paper experiment was motivated by a 14-trade in-sample analysis;
the combined filter retained six closed trades and is not independently
validated. The filter is implemented only in the active Pi JavaScript decision
path. No database analysis function, execution audit constraint, executor,
schema, confidence rule, risk control, or exit behavior was changed. The
experiment and its monitoring criteria are recorded in
[`STRATEGY_CHANGELOG.md`](../STRATEGY_CHANGELOG.md) and
[`RISK_MANAGEMENT.md`](../RISK_MANAGEMENT.md).

## Files changed

- [lib/ai-engine.mjs](../../lib/ai-engine.mjs) — JavaScript scoring, confidence, required-input handling, and V2 decision identity.
- [20261110120000_ai_engine_v2_replacement.sql](../../PostgreSQL/migrations/20261110120000_ai_engine_v2_replacement.sql) — replacement body for the existing database-analysis function.
- [tests/ai-engine.test.mjs](../../tests/ai-engine.test.mjs) — V2 formula, diagnostic-only inputs, missing-input, and safety-gate coverage.
- [tests/database-migrations.test.js](../../tests/database-migrations.test.js) — migration application, JavaScript/SQL parity, and missing-input coverage.
- [README.md](../../README.md)
- [ROADMAP.md](../../ROADMAP.md)
- [docs/ARCHITECTURE.md](../ARCHITECTURE.md)
- [docs/CHANGELOG.md](../CHANGELOG.md)
- [docs/DATABASE.md](../DATABASE.md)
- [docs/DEPLOYMENT.md](../DEPLOYMENT.md)
- [docs/TESTING.MD](../TESTING.MD)

The previously generated proposal, investigation, and planning reports were
committed separately before implementation in commit
`d51bd633f51731f047cb4ea23e138d4817545a37`.

## Database impact

The migration replaces only the existing
`public."AI_Crypto_Bot_Run_Database_AI_Analysis"(timestamptz)` implementation.
Its signature, response shape, service-role-only execution, and underlying
tables remain unchanged. The migration is append-only and must be applied
manually before database analysis is used with the V2 implementation.

The statement that this migration had not been applied to Supabase was the
status at the original V2.0.0 report date. Supabase is not the active production
backend. This report does not establish the current Pi binary/build or the
status of the historical database-analysis path.

## Validation results

| Check | Result |
|---|---|
| `npm.cmd test` | Passed: 362 tests, 0 failures |
| `npm.cmd run build` | Passed: static project validation and database migration validation (18 prefixed tables, RLS coverage, seed consistency) |
| `git diff --check` | Passed |
| Production migration/deployment validation | Not performed |

## Git rollback point and commands

The V1 baseline is commit `d51bd633f51731f047cb4ea23e138d4817545a37`;
both `v1-final-backup` and `v1-final` reference it. The V2 implementation
commit is `1e68f66e2819869e91c50e73b52a85712619ff37`.

To revert the implementation commit on `main` without rewriting history:

```powershell
git switch main
git revert --no-edit 1e68f66e2819869e91c50e73b52a85712619ff37
```

This restores the committed V1 code and documentation while preserving the
separately committed investigation reports. The SQL migration was not applied
to production; if it is applied later, reverting Git alone will not reverse the
database function. Restore database behavior only through a reviewed forward
migration.
