# Paper Trading Confidence Threshold Experiment

## Status

Implementation and local validation are complete. Production migration and deployment have not been performed or verified.

## Applicability

This report documents the historical SQL paper executor and its 67-confidence experiment. It does not describe the active Raspberry Pi executor, which continues to enforce a minimum BUY confidence of 70; the historical SQL migration is not part of the Pi runtime.

## Reason

The supplied decision analysis showed:

- 625 BUY decisions in the 65–70 confidence band
- 156 BUY decisions in the 70–75 confidence band

Approximately 80% of BUY decisions were below the previous entry threshold. The experiment is intended to increase simulated trade activity and provide additional Analytics data.

## Implementation

The new migration [`20261102140000_paper_trading_confidence_experiment.sql`](../../PostgreSQL/migrations/20261102140000_paper_trading_confidence_experiment.sql) updates the existing `AI_Crypto_Bot_Apply_Paper_Decision` function for databases where the Phase 08 migration has already been applied. It changes the BUY-entry rejection condition from confidence below 70 to confidence below 67. The migration fails explicitly unless the expected original condition occurs exactly once.

Confidence 67 is accepted by the confidence gate; values below 67 are rejected. The decision must still pass every other existing requirement, including freshness, enabled-market checks, emergency/pause state, position limits, cooldown, funds, and drawdown protections.

## Scope and safeguards

- Paper Trading only; live trading remains disabled.
- AI decision generation, BUY/SELL logic, and confidence calculations are unchanged.
- Analytics calculations and confidence buckets are unchanged.
- SELL exits remain unaffected by the BUY-entry confidence threshold.
- No portfolio calculations, database schema, API endpoints, or Vercel Functions were added or changed.
- The original Phase 08 migration remains unchanged; the new forward migration applies the approved experiment to existing installations.

## Evaluation

Review at 25 closed trades. If the experiment continues, make a final evaluation at 50 closed trades using:

- Trade count
- Win rate
- Profit factor
- Drawdown
- Portfolio growth

No experiment outcome is asserted before the evaluation data is available.

## Files changed

- `PostgreSQL/migrations/20261102140000_paper_trading_confidence_experiment.sql`
- `tests/database-migrations.test.js`
- `docs/RISK_MANAGEMENT.md`
- `docs/OPERATIONS_LOG.md`
- `docs/CHANGELOG.md`
- `docs/reports/PHASE_08_COMPLETION_REPORT.md`
- `docs/reports/CONFIDENCE_THRESHOLD_EXPERIMENT_REPORT.md`

The existing worktree already records the approved experiment in `ROADMAP.md`; it was not changed during this implementation.

## Validation

- `npm.cmd test` — passed, 230 tests; 0 failures.
- `npm.cmd run build` — passed static project and database migration validation.
- The migration-backed database tests verify that confidence 66 is skipped and confidence 67 executes a paper BUY.

## Deployment note

The migration must be applied to the production Supabase database before production behavior changes. Neither the production migration nor a Vercel deployment was performed or verified as part of this task.
