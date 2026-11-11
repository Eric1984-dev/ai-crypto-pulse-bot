# AI Engine V2 Implementation Report

**Status:** Implemented and committed on `main`; production migration and deployment have not been performed
**Mode:** Paper trading only
**Baseline:** `v1-final-backup` and `v1-final` point to commit `d51bd633f51731f047cb4ea23e138d4817545a37`

## Implementation summary

The active JavaScript AI Engine now directly uses the V2 directional score:

```text
E1d = clamp(1d EMA percent spread * 50, -100, 100)
R1d = clamp((1d RSI14 - 50) * 2, -100, 100)
A1h = 1 when 1h and 1d EMA directions agree and are non-sideways; otherwise 0
V1h = clamp(1h volume ratio - 0.50, 0, 1)

Market Strength = clamp(
  0.75 * E1d
  + 0.10 * E1d * A1h
  + 0.10 * E1d * V1h
  + 0.05 * R1d,
  -100,
  100
)
```

For valid V2 inputs, confidence is:

```text
clamp(
  40
  + 30 * abs(E1d) / 100
  + 10 * A1h
  + 10 * V1h
  + 5 * clamp(max(0, sign(E1d) * R1d / 100), 0, 1)
  - existing average volatility penalty,
  0,
  95
)
```

MACD and momentum remain in the persisted timeframe diagnostics but do not
contribute to directional scoring. Market context is not used in the score.
Coverage and depth bonuses are removed from actionable V2 confidence; the
bounded low-data fallback remains unchanged.

Fresh valid 1h volume-ratio and 1d EMA/RSI inputs are required. If they are
missing or invalid, the engine stores a non-actionable `WAIT`. Existing
snapshot and candle freshness checks, two-interval analysis minimum, four-fresh-
interval directional gate, 65 AI confidence floor, ±20 directional score
levels, and paper executor's 67 BUY gate remain unchanged. New decisions use
the existing strategy snapshot fields with name `Deterministic Technical
Analysis V2` and version `2.0.0`.

The optional database-analysis path is updated by an append-only migration.
No database table, column, index, policy, API route, Vercel Function, new
dependency, executor, or risk-control change was introduced. Database mode
remains opt-in.

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

The migration has **not** been applied to Supabase, and no production runtime,
deployment, or hosted database validation is claimed.

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
