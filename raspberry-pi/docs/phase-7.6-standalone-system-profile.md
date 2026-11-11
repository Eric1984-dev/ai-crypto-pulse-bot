# Phase 7.6 — Standalone System Profile

## Outcome

Paper trading no longer depends on Supabase Auth or on profiles synchronized from another service. The Raspberry Pi runtime recognizes one stable system profile and one default paper portfolio. Provisioning is an explicit operator action; runtime startup and scheduled cycles never create or repair either record.

The implementation changes only files under `raspberry-pi/`. No database, migration, or provisioning script was executed against the live Pi, and no existing paper history was modified.

## Identity and schema migration

The reserved system profile UUID is `00000000-0000-4000-8000-000000000100`. Its email is `NULL`; the runtime does not create a synthetic Supabase user or require an external registration.

Apply `migrations/phase-7.6-standalone-system-profile.sql` to the existing `ai_crypto_bot_store` database as its schema owner. The migration:

- Removes only the `AI_Crypto_Bot_Profiles.id` foreign key that points to `auth.users.id`, after verifying the referenced columns.
- Removes the auth-user profile synchronization triggers/function and the profile-insert portfolio trigger/function.
- Removes the user-scoped RLS policies from profiles, portfolios, positions, trades, and portfolio snapshots. It does not enable or disable RLS. The Pi was previously reported to have RLS disabled and no policies; the drops are safe if those policies are absent.
- Adds a partial unique index limiting the reserved system profile to one portfolio.
- Does not create tables, copy or delete existing data, reset balances, alter trades/positions/snapshots, or drop the `auth` schema.

The migration intentionally fails on an unexpected auth foreign key or an existing duplicate system portfolio rather than guessing how to repair the schema. Existing auth-backed profile rows and their associated paper records are left in place.

## One-time provisioning

Stop the Raspberry Pi runtime before applying the migration or provisioning. The operator runs the migration first, then `sql/provision-system-profile.sql`, with `psql` connected to `ai_crypto_bot_store` as a role permitted to insert into the existing profile, portfolio, and snapshot tables. These scripts are not called by Node.js, `npm start`, the scheduler, or the paper-trading role.

Example from the `raspberry-pi` directory on the Pi:

```sh
psql --set ON_ERROR_STOP=1 --dbname ai_crypto_bot_store \
  --file migrations/phase-7.6-standalone-system-profile.sql
psql --set ON_ERROR_STOP=1 --dbname ai_crypto_bot_store \
  --file sql/provision-system-profile.sql
```

The provisioning transaction takes the same transaction advisory lock as a paper-trading cycle. It inserts the profile, one portfolio with the existing 10,000 virtual starting balance, and the initial portfolio snapshot atomically. It has no `ON CONFLICT` update path and never resets an existing balance.

On a repeat invocation, an existing system profile with exactly one portfolio is treated as already provisioned and left unchanged. A reserved-ID collision, profile without exactly one portfolio, or orphan portfolio causes the transaction to fail for manual inspection; it does not repair partial state. A failed transaction rolls back its inserts. A successful transaction remains in PostgreSQL across reboot.

## Runtime behavior

The paper service reads only the reserved system profile and its portfolio under the existing paper-trading transaction lock. It no longer scans all profiles, creates missing portfolios, or processes other profiles' portfolios. Existing legacy profiles and their trades, positions, balances, and snapshots are not migrated or rewritten; they are outside the Pi runtime's active system account.

- If the profile is missing, the paper cycle emits `paper_trading_not_provisioned` with `SYSTEM_PROFILE_NOT_PROVISIONED` and returns `SKIPPED`.
- If the profile exists but its portfolio is missing, it emits the same event with `SYSTEM_PORTFOLIO_NOT_PROVISIONED` and returns `SKIPPED`.
- If exactly one valid portfolio exists, the regular paper-trading rules and persistence path are unchanged.
- Multiple portfolios or malformed ownership/state fail closed. Runtime code has no profile or portfolio insert method.

This permits ingestion and analysis to continue before explicit provisioning while preventing BUY/SELL execution until the system paper account is ready. Restarting the process only reads existing rows; it cannot reinitialize balances or recreate deleted state.

### Post-provision trade-state fix

The first reported paper cycle after provisioning failed with `PAPER_TRADING_NUMERIC_INVALID`. The repository intentionally returns only the updated balance, portfolio value, and open-position count after a fill; the service had replaced its full cycle state with that partial result. The subsequent peak/drawdown calculation then read a missing peak value (and later decisions would also lose their daily baseline). The service now merges returned trade values into the existing cycle state for both BUY and SELL, preserving drawdown baselines. Regression tests exercise partial trade-state returns and multiple decisions in one cycle.

## Validation procedure

After operator-managed migration and provisioning, validate the database before restarting the service:

```sql
SELECT id, email
FROM public."AI_Crypto_Bot_Profiles"
WHERE id = '00000000-0000-4000-8000-000000000100';

SELECT id, user_id, starting_balance, available_balance, portfolio_value
FROM public."AI_Crypto_Bot_Portfolios"
WHERE user_id = '00000000-0000-4000-8000-000000000100';

SELECT snapshot.portfolio_id, snapshot.portfolio_value,
       snapshot.available_balance, snapshot.open_positions
FROM public."AI_Crypto_Bot_Portfolio_Snapshots" AS snapshot
JOIN public."AI_Crypto_Bot_Portfolios" AS portfolio
  ON portfolio.id = snapshot.portfolio_id
WHERE portfolio.user_id = '00000000-0000-4000-8000-000000000100'
ORDER BY snapshot.captured_at;
```

Expect one profile with a null email, one portfolio whose initial balance/value is 10,000, and one initial snapshot with zero open positions. Confirm the application database role remains the separately configured least-privilege paper role; do not grant it profile or portfolio provisioning privileges. After starting the runtime, inspect logs for normal cycles and confirm no unexpected profile/portfolio writes.

## Validation results

- Raspberry Pi package tests: passed (`npm test`).
- Repository tests: passed (`npm test`).
- First post-provision runtime failure `PAPER_TRADING_NUMERIC_INVALID`: fixed by preserving portfolio drawdown state across partial trade results; regression coverage added for BUY, SELL, and multiple decisions.
- Node.js syntax checks for Raspberry Pi `.mjs` and `.js` files: passed.
- Migration and provisioning SQL: passed in an isolated PGlite fixture containing the legacy Auth FK, triggers, and user-scoped policies. The check confirmed removal of the Auth FK/triggers, atomic creation of the profile/portfolio/snapshot, and a repeat run preserving a changed portfolio balance.
- `git diff --check`: passed.
- The SQL migration/provisioning scripts were not applied to production. Live schema state, runtime behavior on the Pi, and post-migration validation remain operator tasks.

## Assumptions, limitations, and follow-up

- The Pi database name is `ai_crypto_bot_store`, and the existing profile, portfolio, and snapshot tables match the Phase 7 contract.
- The current Pi has no profiles or portfolios, as reported. No live query was run to re-confirm those counts.
- The standalone runtime now intentionally manages a single system portfolio. Multi-user dashboard authentication and portfolio selection remain future work; no dashboard or Vercel changes are included.
- Do not start the runtime between migration/provisioning and verification. Do not use the paper runtime role to run either SQL file.
- If an existing partial or conflicting system identity is found, stop and inspect it manually. Do not delete, merge, or overwrite paper records as an automatic recovery step.
- Phase 7.6 does not implement Phase 8 features.
