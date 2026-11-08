# Archive Agent Deployment Readiness Assessment

**Assessment date:** 2026-11-07  
**Mode:** Read-only repository/configuration review. No SQL was executed, no database was queried or changed, and no code, credentials, settings, or deployment were modified.

**Subsequent operational update (2026-11-09):** The user reports that readiness checks passed and a manual archive sync later succeeded on the Pi. This supersedes the report's then-current no-sync blocker only. Exact row counts and copy completeness were not provided or independently verified; the assessment below remains a record of the 2026-11-07 state.

## Decision

# C. Not Ready

The proof-of-concept agent cannot safely begin implementation yet. The inspected workspace contains no dedicated, table-scoped Supabase read credential or archive-sync writer credential. The deployed archive database was not queried, and the archive schema file creates no seed rows. In particular, decision rows have a foreign key to watched-market symbols, so every symbol referenced by the source decision history must already exist in the archive's `AI_Crypto_Bot_Watched_Markets` table before any decision batch can be inserted.

The existing Supabase authenticated role is read-only for application clients, but its policies permit reads beyond AI decisions. `service_role` is much broader and bypasses RLS. Neither is an acceptable substitute for the dedicated source identity specified in the approved architecture.

## Readiness summary

| Requirement | Finding | Status |
|---|---|---|
| Approved direction | Supabase → Pi pull agent → `ai_crypto_bot_archive` | **Ready as architecture** |
| Dedicated source read-only credential | Not present in inspected local configuration/templates; remote Pi/Vercel secret stores were not checked | **Blocker** |
| Source RLS/grants for a narrowly scoped identity | Existing authenticated policy is broader than the one-table scope; no dedicated archive-reader role/policy is documented | **Blocker / requires security decision** |
| Archive sync writer credential | No `ARCHIVE_SYNC_DB_*` values are configured in the inspected workspace; the existing health account is read-only | **Blocker** |
| Target database/schema identity | Owner reports it is deployed; not independently verified | **Unverified** |
| Required watched-market anchor rows | The archive DDL contains no seed data; actual archive rows cannot be checked without a database read | **Blocker / unverified** |
| Agent implementation | No sync implementation exists | **Not started** |
| SQL/database changes | Explicitly out of scope for this assessment | **Not performed** |

## 1. Supabase credential availability

The local workspace `.env` was checked for variable names and whether values were present; no secret values were displayed. It has the existing `SUPABASE_URL` and `SUPABASE_ANON_KEY`, but no dedicated `SUPABASE_ARCHIVE_READONLY_URL`, direct read-only database URL, or archive-reader credentials. The process environment likewise had no archive-reader variables. `archive-server/.env` is absent locally; its checked-in example contains only blank archive-health settings. No archive sync credentials are defined in the checked-in templates.

This only describes the local workspace. The Raspberry Pi's protected environment, Vercel project settings, Supabase Vault, and any external secret manager were not accessed. Their contents therefore remain unknown; this report does not claim that no credential exists anywhere.

**Conclusion:** a new dedicated source credential must be provisioned or independently confirmed before implementation. Do not copy or reuse `SUPABASE_SERVICE_ROLE_KEY`.

## 2. Source RLS and required privileges

The local source migration and [database documentation](../DATABASE.md) show:

- RLS is enabled on `AI_Crypto_Bot_AI_Decisions`.
- `anon` and `PUBLIC` do not receive table access.
- `authenticated` has `SELECT` on the decision table, with a policy allowing authenticated users to read all decision rows.
- The same authenticated role also receives read access to other project tables, including global market, candle, status, strategy, scanner-event, and emergency-state data; user-owned tables are scoped by their policies.
- `service_role` has server-side CRUD privileges and bypasses RLS.

A normal authenticated session would allow the decision read, but its effective access is broader than this POC requires. The service role is broader still and violates the approved least-privilege boundary.

For a direct PostgreSQL source connection, a dedicated reader needs database connection access, `USAGE` on the relevant schema, and `SELECT` on `AI_Crypto_Bot_AI_Decisions`, with RLS permitting that exact role to read the table. It must not have `INSERT`, `UPDATE`, `DELETE`, DDL, role-administration, or `BYPASSRLS` privileges. A table grant alone does not bypass RLS. A role without a matching RLS policy may be unable to read the rows.

The migrations do not currently define such an identity or policy. Provisioning it may require a reviewed Supabase role/grant/policy change or a separately approved constrained read mechanism. That work requires explicit authorization and must not be hidden inside the agent implementation.

## 3. Archive writer privileges and existing health account

The POC requires a separate target credential. The existing `ARCHIVE_DB_*` account is documented as a read-only health-check user and must not be elevated or reused for archive writes.

The future writer should have only the privileges needed to connect, inspect watched-market anchors for preflight, and `SELECT`/`INSERT`/`UPDATE` the archive decision table for primary-key upserts. It does not need `DELETE`, `TRUNCATE`, schema creation, or superuser privileges. These permissions are not configured in the repository, and the Pi's database roles were not inspected.

## 4. Archive tables and pre-seeding

The archive DDL gives `AI_Crypto_Bot_AI_Decisions.symbol` a foreign key to `AI_Crypto_Bot_Watched_Markets.symbol` with restrictive delete behavior. Decision inserts therefore require a matching parent market row for every copied symbol.

For this POC, the only table that must be pre-seeded is:

- **`AI_Crypto_Bot_Watched_Markets`** — it must contain every distinct symbol present in the source decision cohort, including symbols for markets that may now be disabled.

The agent must stop before writing if any referenced symbol is missing. It must not disable the foreign key or insert watched-market records itself because the requested copy scope is only AI decisions. If anchors are absent, copying them is a separate scope expansion requiring approval.

No other table is a direct prerequisite for inserting decision rows:

- `strategy_name` and `strategy_version` are text snapshots, not foreign keys to `AI_Crypto_Bot_Strategies`.
- A trade's foreign key points from `AI_Crypto_Bot_Trades` to a decision; trades do not need to be copied before decisions.
- Profiles, portfolios, positions, candles, and market data are not direct parents of AI decision rows.

The checked-in [archive schema](../../AI_CRYPTO_BOT_ARCHIVE_SCHEMA.sql) contains DDL only and does not insert watched markets. The source [initial seed migration](../../supabase/migrations/20261031190100_seed_initial_data.sql) seeds five rows in Supabase; it does not seed the Raspberry Pi archive, nor does it establish that five symbols cover the full historical decision set.

## 5. Archive market-row verification

**Whether watched-market rows already exist in `ai_crypto_bot_archive` is NOT VERIFIABLE under this task's restrictions.** No archive database connection, health request, or SQL query was made. A successful schema deployment proves table definitions exist only if independently confirmed; it does not prove the table has data. The local schema and reports contain no archive row inventory or seed confirmation.

Before any authorized agent run, perform a separate read-only preflight that:

1. Confirms the target database is `ai_crypto_bot_archive` and the expected archive schema is deployed.
2. Reads the distinct source decision symbols.
3. Reads target watched-market symbols.
4. Compares the sets and reports all missing symbols.
5. Stops without writing if any source symbol lacks a target parent row.

The preflight and any decision to seed missing anchors must occur before agent implementation is approved; no such check or seed was performed here.

## 6. Exact blockers

1. **No confirmed least-privilege source identity.** Local templates and environment do not define one; remote secret stores were not checked.
2. **RLS/grant design is unresolved.** Existing authenticated reads cover more than this table, while `service_role` is over-privileged. A suitable role/policy or constrained alternative has not been provisioned and verified.
3. **No separate archive writer credential is configured or verified.** The health user is read-only and unsuitable for upserts.
4. **Required market parent rows are unverified.** The archive schema does not seed them, and all decision symbols must satisfy the target foreign key.
5. **Archive deployment state is not independently verified.** Schema, database identity, role grants, constraints, and current table contents remain owner-reported or unknown.

Any one of the first four blocks a safe implementation. Together, they make this **Not Ready**, rather than “Ready After Minor Changes.”

## 7. Actions required before implementation

1. **Provision/confirm source access:** create or confirm a dedicated source identity that can read only the required decision table, using verified TLS and no write/DDL/role/BYPASSRLS permissions. Confirm its effective RLS behavior. Do not use a normal broad authenticated account or the service-role key without a separate security decision.
2. **Review and authorize any Supabase access-control change:** if the required source role needs grants or an RLS policy, review it as an explicit database change with the project's migration/documentation/verification process. No such change is authorized by this assessment.
3. **Provision a separate target writer:** grant only the target capabilities required for watched-market preflight and decision upserts. Keep the health-check identity unchanged.
4. **Run the authorized read-only archive preflight:** confirm database identity/schema and compare all source decision symbols with target watched-market rows. If rows are missing, obtain explicit approval to seed the minimal market identity records or revise the scope. Do not bypass the FK.
5. **Verify type/constraint parity and backup readiness:** confirm the deployed decision table, primary key, FK, and the target's independent backup/restore process.
6. **Only then approve implementation:** create a manual CLI with fixed table/columns, bounded batches, state checkpointing, idempotent upserts, explicit counts, and interruption tests. Keep Supabase read-only, do not add a schedule or Vercel function, and do not delete rows.

## Final status

**C. Not Ready.** The architecture is suitable, but source authorization, archive writer access, and the archive's watched-market FK anchors are not established. No code change or production database operation should begin until the listed actions are completed and the market-symbol preflight passes.

## References

- [Archive agent POC plan](./ARCHIVE_AGENT_POC.md)
- [Archive sync architecture](./ARCHIVE_SYNC_ARCHITECTURE.md)
- [Archive retention plan](./ARCHIVE_RETENTION_PLAN.md)
- [Archive schema analysis](./AI_CRYPTO_BOT_ARCHIVE_SCHEMA_ANALYSIS.md)
- [Archive schema validation](./AI_CRYPTO_BOT_ARCHIVE_SCHEMA_VALIDATION.md)
- [Archive Server connectivity](./ARCHIVE_SERVER_CONNECTIVITY.md)
- [Database documentation](../DATABASE.md)
- [Source schema migration](../../supabase/migrations/20261031190000_create_agent_tables.sql)
- [Initial market seed migration](../../supabase/migrations/20261031190100_seed_initial_data.sql)
- [Archive schema DDL](../../AI_CRYPTO_BOT_ARCHIVE_SCHEMA.sql)
