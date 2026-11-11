# Phase 5.1 — Live Pi Ingestion Preparation

> **Superseded for the inspected Pi configuration:** Phase 5.2 confirmed RLS is disabled, no RLS policies or PostgreSQL runtime functions exist, and `ai_crypto_bot_archive_user` owns the existing project tables. The current runtime supports that table-owner case only through the explicit `INGESTION_ALLOW_TABLE_OWNER=true` ingestion opt-in. The API remains read-only. See the [Phase 5.2 alignment report](phase-5.2-ingestion-contract-alignment.md). This earlier document is retained to record the preparation-stage recommendations and remains applicable only to other installations with different role/RLS facts.

## Scope and conclusion

This document explains the Phase 5 ingestion preflight and proposes a least-privilege PostgreSQL configuration for the existing `ai_crypto_bot_store` database. It is preparatory documentation only:

- No SQL was executed.
- No database, role, grant, policy, or schema was changed.
- No ingestion run was started.
- Values and privileges on the live Raspberry Pi have not been independently inspected.

The reported errors mean the effective connection role is rejected for its capabilities, not because its name is `ai_crypto_bot_archive_user`. The role name is not hardcoded in the contract. The failure text is not detailed enough to identify which capability caused either error; use the read-only diagnostics below before changing anything.

**Important:** a new role and ordinary `GRANT`s may still be insufficient if the live tables have row-level security (RLS) enabled without applicable write policies. The checked-in schema migration enables RLS on the ingestion tables and defines `SELECT` policies, but does not define `INSERT`/`UPDATE` policies for them. The runtime forbids using a superuser, table owner, or `BYPASSRLS` role to work around that. Confirm the live policies before provisioning; if they match the migration, a grant-only fix cannot safely enable writes. That requires a separately authorized RLS/schema or ingestion-design change.

## What the preflight checks

The CLI applies the optional `INGESTION_DATABASE_USER` and `INGESTION_DATABASE_PASSWORD` pair to the base database configuration. If both are absent, it uses `DATABASE_USER` and `DATABASE_PASSWORD`. It then calls `validateIngestionRuntimeContracts`; the configured database name and effective `current_user` must match the configuration.

The contract logic is in [database-contracts.mjs](../src/services/database-contracts.mjs), [contract-validation.mjs](../src/services/contract-validation.mjs), and [contract-repository.mjs](../src/repositories/contract-repository.mjs).

### Reported errors

`DATABASE_ROLE_TOO_PRIVILEGED` is emitted if one or more of the following is true for the connected role:

- `rolsuper` / SUPERUSER
- `rolbypassrls` / BYPASSRLS
- `rolcreatedb` / CREATEDB
- `rolcreaterole` / CREATEROLE
- effective `CREATE` privilege on schema `public`

The error code does not say which condition matched. Role membership can also confer effective schema privileges, so inspect memberships as well as direct grants.

`INGESTION_ROLE_UNSAFE_TABLE_PRIVILEGE:<table>` means the current role owns that prefixed public table, has effective `DELETE`, or has effective `TRUNCATE`. The check covers all ordinary and partitioned `public.AI_Crypto_Bot_*` tables, not only the two tables written by ingestion. A `REVOKE` cannot remove table ownership.

The contract intentionally permits `INSERT` and `UPDATE` on prefixed tables as warnings, then requires both privileges specifically on `AI_Crypto_Bot_Market_Data` and `AI_Crypto_Bot_Candles`. Missing either produces `MISSING_INGESTION_WRITE_PRIVILEGE:<table>`. It also requires `SELECT` on the five read-contract tables below. Missing constraints and write-capable sequence privileges are warnings for ingestion, not hard failures; granting sequence access is not needed for the UUID defaults in the checked-in table definitions.

### Roles to configure

Use separate identities:

1. **Database administrator/provisioner** — used only by an authorized operator to create/configure roles and grants. Never place this login in the runtime `.env`.
2. **API read-only login** — configured as `DATABASE_USER` / `DATABASE_PASSWORD`. It must continue to pass the strict read-only API contract: `SELECT` on the five read tables, no ownership or write/sequence privileges on prefixed tables/sequences, no elevated role flags, and no `CREATE` on `public`.
3. **Ingestion login** — use a dedicated role such as `ai_crypto_bot_ingestion_user` through `INGESTION_DATABASE_USER` / `INGESTION_DATABASE_PASSWORD`. The name is a recommendation, not a string enforced by the code. Give it only the access below, subject to the live RLS check.

Do not use `service_role`, a superuser, a table owner, or a role with `BYPASSRLS` for ingestion. The current `ai_crypto_bot_archive_user` is not rejected by name, but the reported errors prove that its effective capabilities currently violate the ingestion contract. Keep that archive identity unchanged unless its other uses and grants have been separately reviewed; prefer a new dedicated ingestion login over revoking privileges from a role that may serve the archive workflow.

## Required access

The ingestion preflight reuses the database contract and therefore requires `SELECT` on all five of these tables:

- `public."AI_Crypto_Bot_Watched_Markets"`
- `public."AI_Crypto_Bot_Market_Data"`
- `public."AI_Crypto_Bot_Candles"`
- `public."AI_Crypto_Bot_AI_Decisions"`
- `public."AI_Crypto_Bot_Status"`

The ingestion repository additionally requires:

- `INSERT` and `UPDATE` on `public."AI_Crypto_Bot_Market_Data"` (upsert the latest snapshot).
- `INSERT` and `UPDATE` on `public."AI_Crypto_Bot_Candles"` (upsert OHLCV rows).
- `INSERT` on `public."AI_Crypto_Bot_Scanner_Events"` for best-effort failure-event recording. This is used by the repository but is not part of the ingestion preflight's explicit write-privilege test; without it, event persistence can fail while ingestion reports its other results.
- `CONNECT` on `ai_crypto_bot_store` and `USAGE` on schema `public`.

Do not grant `DELETE`, `TRUNCATE`, table ownership, schema `CREATE`, `CREATEDB`, `CREATEROLE`, SUPERUSER, or `BYPASSRLS`. No sequence grant is required by the UUID-default inserts. Do not grant write access to the watched-market table.

The Phase 5 database operations are visible in [market-ingestion-repository.mjs](../src/repositories/market-ingestion-repository.mjs). The scanner event insert names only `symbol`, `event_type`, and `reason`; the table supplies its UUID and timestamp defaults.

## Read-only diagnostics

The following queries are documentation for an operator to run later using an authorized, read-only inspection session. They were **not** executed for this phase. They do not change database state.

### Database and role attributes

```sql
SELECT current_database() AS database_name,
       role.rolname,
       role.rolsuper,
       role.rolbypassrls,
       role.rolcreatedb,
       role.rolcreaterole,
       role.rolinherit,
       pg_catalog.has_schema_privilege(
         role.rolname, 'public', 'CREATE'
       ) AS can_create_in_public
FROM pg_catalog.pg_roles AS role
WHERE role.rolname IN (
  'ai_crypto_bot_archive_user',
  'ai_crypto_bot_ingestion_user'
);
```

### Table ownership and effective table privileges

```sql
SELECT relation.relname,
       pg_catalog.pg_get_userbyid(relation.relowner) AS owner_name,
       pg_catalog.has_table_privilege(
         'ai_crypto_bot_archive_user', relation.oid, 'SELECT'
       ) AS can_select,
       pg_catalog.has_table_privilege(
         'ai_crypto_bot_archive_user', relation.oid, 'INSERT'
       ) AS can_insert,
       pg_catalog.has_table_privilege(
         'ai_crypto_bot_archive_user', relation.oid, 'UPDATE'
       ) AS can_update,
       pg_catalog.has_table_privilege(
         'ai_crypto_bot_archive_user', relation.oid, 'DELETE'
       ) AS can_delete,
       pg_catalog.has_table_privilege(
         'ai_crypto_bot_archive_user', relation.oid, 'TRUNCATE'
       ) AS can_truncate
FROM pg_catalog.pg_class AS relation
JOIN pg_catalog.pg_namespace AS namespace
  ON namespace.oid = relation.relnamespace
WHERE namespace.nspname = 'public'
  AND left(relation.relname, length('AI_Crypto_Bot_')) = 'AI_Crypto_Bot_'
  AND relation.relkind IN ('r', 'p')
ORDER BY relation.relname;
```

Run the same privilege query for the proposed ingestion login after it is provisioned. The role shown in the query should be replaced with the role being examined; do not infer which permission caused the error from the table name alone.

### Memberships and RLS policies

```sql
SELECT member_role.rolname AS member,
       granted_role.rolname AS granted_role,
       membership.admin_option
FROM pg_catalog.pg_auth_members AS membership
JOIN pg_catalog.pg_roles AS member_role
  ON member_role.oid = membership.member
JOIN pg_catalog.pg_roles AS granted_role
  ON granted_role.oid = membership.roleid
WHERE member_role.rolname = 'ai_crypto_bot_archive_user'
   OR granted_role.rolname = 'ai_crypto_bot_archive_user'
ORDER BY member, granted_role;
```

```sql
SELECT relation.relname,
       relation.relrowsecurity AS rls_enabled,
       relation.relforcerowsecurity AS rls_forced,
       pg_catalog.pg_get_userbyid(relation.relowner) AS owner_name
FROM pg_catalog.pg_class AS relation
JOIN pg_catalog.pg_namespace AS namespace
  ON namespace.oid = relation.relnamespace
WHERE namespace.nspname = 'public'
  AND relation.relname IN (
    'AI_Crypto_Bot_Watched_Markets',
    'AI_Crypto_Bot_Market_Data',
    'AI_Crypto_Bot_Candles',
    'AI_Crypto_Bot_AI_Decisions',
    'AI_Crypto_Bot_Status',
    'AI_Crypto_Bot_Scanner_Events'
  )
ORDER BY relation.relname;
```

```sql
SELECT tablename, policyname, roles, cmd, qual, with_check
FROM pg_catalog.pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'AI_Crypto_Bot_Watched_Markets',
    'AI_Crypto_Bot_Market_Data',
    'AI_Crypto_Bot_Candles',
    'AI_Crypto_Bot_AI_Decisions',
    'AI_Crypto_Bot_Status',
    'AI_Crypto_Bot_Scanner_Events'
  )
ORDER BY tablename, policyname;
```

The checked-in [schema migration](../../PostgreSQL/migrations/20261031190000_create_agent_tables.sql) enables RLS for these data tables and creates read policies for `authenticated`. It grants `SELECT` to `authenticated` and broad DML to `service_role`; it does not define ingestion-role `INSERT`/`UPDATE` policies. If the live Pi catalog confirms this same state, do not proceed on the assumption that the table grants below are sufficient. A `GRANT` alone does not bypass RLS, and enabling `BYPASSRLS` would make the runtime contract fail.

## Proposed SQL for a fresh dedicated role

The following is a **proposed template only**. Do not run it during Phase 5.1. Have the database administrator first confirm the database, schema, live RLS state, table owner, and policy requirements. Set the password through a secure local mechanism such as `\password ai_crypto_bot_ingestion_user`; never put a real password in this file, shell history, or source control.

```sql
CREATE ROLE ai_crypto_bot_ingestion_user
  LOGIN
  INHERIT
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  NOBYPASSRLS;

GRANT CONNECT ON DATABASE ai_crypto_bot_store
  TO ai_crypto_bot_ingestion_user;

GRANT USAGE ON SCHEMA public
  TO ai_crypto_bot_ingestion_user;

GRANT SELECT ON TABLE
  public."AI_Crypto_Bot_Watched_Markets",
  public."AI_Crypto_Bot_Market_Data",
  public."AI_Crypto_Bot_Candles",
  public."AI_Crypto_Bot_AI_Decisions",
  public."AI_Crypto_Bot_Status"
  TO ai_crypto_bot_ingestion_user;

GRANT INSERT, UPDATE ON TABLE
  public."AI_Crypto_Bot_Market_Data",
  public."AI_Crypto_Bot_Candles"
  TO ai_crypto_bot_ingestion_user;

GRANT INSERT (symbol, event_type, reason) ON TABLE
  public."AI_Crypto_Bot_Scanner_Events"
  TO ai_crypto_bot_ingestion_user;
```

Create no memberships for the new role by default. In particular, do not grant it `service_role`. If RLS is enabled, determine the permitted policy path before using the role; this template grants SQL object privileges only and does not create or alter RLS policies. Do not add a `BYPASSRLS` role or transfer table ownership to make it work.

### Revokes and current-role cleanup

A freshly created, unprivileged role needs no `REVOKE` statements: it starts without the old role's direct grants and memberships. The safest migration is to leave `ai_crypto_bot_archive_user` intact, create the dedicated ingestion login only after the RLS condition is understood, then point the CLI to it.

If an authorized operator elects to repair the existing role instead, first identify the direct grant, membership, schema grant, or role attribute that caused the failure. Examples below are conditional and must target only confirmed findings:

```sql
REVOKE DELETE, TRUNCATE ON TABLE
  public."AI_Crypto_Bot_Candles"
  FROM ai_crypto_bot_archive_user;

REVOKE CREATE ON SCHEMA public
  FROM ai_crypto_bot_archive_user;

ALTER ROLE ai_crypto_bot_archive_user
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
```

Replace the example table with each exact offending table reported by the privilege diagnostic. If the privilege comes from a membership, revoke that specific inherited role from this login only after confirming the archive workflow does not depend on it, for example `REVOKE service_role FROM ai_crypto_bot_archive_user;`. Do not issue broad `REVOKE ... ON ALL TABLES` commands or change ownership as a shortcut. `REVOKE` cannot remove ownership; an owner finding requires a separately reviewed ownership plan. None of these conditional statements was executed.

## Migration and validation procedure

1. **Keep the current archive login unchanged for now.** Save the exact first-run `contractErrors` output locally, without sharing passwords. The two error identifiers alone do not disclose the cause.
2. **Use an authorized read-only inspection session** to run the diagnostics above for `ai_crypto_bot_archive_user`. Record role flags, `public` schema `CREATE`, table owner and effective privileges, memberships, and RLS/policies.
3. **Resolve the RLS gate first.** If `Market_Data` or `Candles` has RLS enabled and no applicable `INSERT`/`UPDATE` policy for the new login, stop. Do not add a policy, grant `BYPASSRLS`, use `service_role`, or change ownership under this phase. Request explicit approval for a separate, minimal RLS/schema or implementation change.
4. **Only after the RLS path is confirmed**, an authorized DBA may provision the dedicated role and grants above. Confirm the new login has no unsafe role attributes, no `CREATE` on `public`, no table ownership, no `DELETE`/`TRUNCATE` on any prefixed table, and no unnecessary role memberships or sequence access.
5. **Configure the Pi environment locally:** keep `DATABASE_USER` / `DATABASE_PASSWORD` as the existing read-only API identity; set both `INGESTION_DATABASE_USER=ai_crypto_bot_ingestion_user` and `INGESTION_DATABASE_PASSWORD` for the one-shot ingestion CLI. Do not copy credentials into Vercel or Git.
6. **Run the non-writing API validation** with the read-only `DATABASE_USER`: `npm run validate`. This verifies the API identity and read-only contract; it does not validate writer DML or RLS for ingestion.
7. **Review writer privileges using read-only checks** (`has_table_privilege`, role attributes, RLS catalog, and policy queries). The runtime has no ingestion-preflight-only/dry-run CLI. Running `npm run ingest:market-data -- --intervals=1m` calls preflight and then writes real snapshot/candle/event rows; only run it later as a separately authorized operational action after the database and RLS checks are accepted.
8. **After an explicitly approved live run**, verify the CLI's final result and inspect only the targeted existing data for expected timestamps/row counts. Do not interpret a successful API `npm run validate` as evidence that ingestion writes succeeded.

## Phase 5.1 decision

The dedicated ingestion identity is the intended configuration, and `ai_crypto_bot_archive_user` is intentionally rejected **in its current effective privilege state**, not by its name. Exact direct grants/revokes for that existing login cannot be safely prescribed until the read-only diagnostics identify their source and archive dependencies. More importantly, if the live Pi retains the checked-in RLS policies, a safe grants-only role is not sufficient for Phase 5 writes. No remediation was applied; stop before live ingestion until the RLS compatibility question is resolved with explicit authorization.
