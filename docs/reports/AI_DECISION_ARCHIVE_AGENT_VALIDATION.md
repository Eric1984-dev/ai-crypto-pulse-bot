# AI Decision Archive Agent Validation Guide

**Status:** The user reports that the first manual sync completed successfully and copied data into PostgreSQL on the Pi. Exact row metrics were not provided or independently verified. This guide remains the validation reference for future manual syncs.

## Safety boundary

The current sync copies only `AI_Crypto_Bot_AI_Decisions` from Supabase. Its source transaction is read-only; it contains no source DML, DDL, RPC call, or deletion path. Source validation permits read-only `SELECT` access to multiple `public.AI_Crypto_Bot_*` relations, while rejecting non-prefixed relations, source writes, and source ownership. It writes the archive table only, using the original decision ID as the conflict key. `ON CONFLICT` updates only the archived row with the same ID when values differ. It never deletes archive rows.

Before each future production sync, confirm the source role remains application-table read-only with only approved prefixed `AI_Crypto_Bot_*` SELECT scope, the target role retains only the required archive privileges, the documented Supabase `PUBLIC` residual is accepted, and archive market anchors cover the source cohort. The user previously reported the reader and writer readiness checks passed and now reports one successful manual sync. The exact run counts and copy completeness were not independently checked here. Queries in this guide are read-only; the separately linked writer setup script is a permission-changing bootstrap procedure and must not be rerun against an existing role.

## Automated preflight and per-batch checks

Before any target write, the CLI checks:

- The source database/project/role and target database/role identities.
- Verified TLS configuration on both connections.
- The source transaction is read-only; the source role is not elevated, does not own source relations, may `SELECT` from multiple `public.AI_Crypto_Bot_*` relations, has no effective access to non-prefixed application relations or application-table writes, has no persistent schema/database creation privileges, and has an applicable RLS `SELECT`-true policy on the decision table.
- The CLI does not query `pg_auth_members`. The migration postflight and the read-only membership query below validate the exact Supabase-managed edge: reader as the granted role, `postgres` as member, `supabase_admin` as grantor, `ADMIN=true`, `INHERIT=false`, and `SET=false`. Every other membership involving the reader is rejected. `ADMIN=true` lets `postgres` grant the reader role to other roles; the other two options prevent inherited reader privileges and `SET ROLE` from `postgres` into the reader. This managed edge does not give the reader membership in `postgres` and Supabase does not permit revoking it.
- The migration postflight requires non-system schema `USAGE` only on `public`; it checks relation/column/sequence privileges only in schemas where the reader has effective `USAGE`. A `PUBLIC` object grant in an inaccessible schema is therefore not treated as reader-accessible, while extra relation, column, or sequence access in `public` is still rejected. No `PUBLIC` grants are changed.
- Supabase `PUBLIC` temporary-object and large-object routine capabilities are a documented accepted residual for the direct login. The role-level read-only transaction default does not prevent a credential holder from changing transaction mode outside the agent; do not represent the role as absolutely incapable of all writes or DDL.
- The archive role is not elevated, a member, or an owner. It has only database `CONNECT`, `public` schema `USAGE`, `SELECT`/`INSERT`/`UPDATE` on decisions, and `SELECT` on watched markets, with no grant options. Delete, truncate, references, trigger, unrelated relation/column/sequence access, schema-create, and database-create privileges are rejected.
- The [Pi-local writer SQL](../../archive-server/sql/prepare-archive-decision-writer.sql) is a bootstrap script that checks the expected archive schema and constraints, role attributes, membership state, effective access, and unchanged ownership before committing. It creates a `NOLOGIN` role and does not set credentials; the user reports that the current Pi writer was subsequently activated and used successfully for the first sync.
- Its decision key check uses catalog relation/column OIDs and FK delete-action metadata, not schema-qualified `pg_get_constraintdef()` text; it requires exactly one validated `id` primary key and one validated `symbol`-to-market-`symbol` FK with `RESTRICT`.
- Writer relation and sequence privilege checks account for effective schema `USAGE`: PUBLIC grants in an inaccessible schema are not treated as reachable, while grants in `public` or any other schema the writer can access remain rejected. The writer is still required to have non-system schema `USAGE` only on `public`.
- Both decision tables match the nine-column type/precision/nullability contract, have the decision primary key and watched-market FK, and the archive table has no user trigger.
- Every source symbol in the fixed run cohort exists in archive `AI_Crypto_Bot_Watched_Markets`.
- Every decision row satisfies the stored decision, confidence, JSON-object, strategy-pairing, symbol, and timestamp constraints.

Each target batch is committed in its own transaction. The target row is then read back and compared across all nine fields. The checkpoint is atomically advanced only after that target commit and value validation. A failure stops the run; rerunning is safe because the original UUID is the `ON CONFLICT` key.

### Source login residual check

Run on the source connection before any authorized copy. These checks do not change state:

```sql
SELECT current_database() AS database_name,
       current_user AS role_name,
       current_setting('default_transaction_read_only') AS read_only_default,
       pg_catalog.has_database_privilege(current_user, current_database(), 'CONNECT') AS can_connect,
       pg_catalog.has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_database,
       pg_catalog.has_database_privilege(current_user, current_database(), 'TEMP') AS can_create_temporary_objects,
       pg_catalog.has_schema_privilege(current_user, 'public', 'USAGE') AS public_schema_usage,
       pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE') AS public_schema_create;

SELECT procedure.oid::regprocedure AS routine,
       pg_catalog.has_function_privilege(current_user, procedure.oid, 'EXECUTE') AS can_execute
FROM pg_catalog.pg_proc AS procedure
JOIN pg_catalog.pg_namespace AS namespace
  ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname = 'pg_catalog'
  AND left(procedure.proname, 3) = 'lo_'
ORDER BY procedure.proname, procedure.oid::regprocedure::text;
```

Expected: database `postgres`, the exact reader role, `read_only_default = on`, database `CREATE = false`, and `public_schema_create = false`. `TEMP` and some large-object routine execution may be available through Supabase `PUBLIC` privileges; this is the explicitly accepted platform residual, not an application-table grant. Do not revoke shared `PUBLIC` privileges. Confirm separately that the agent's source transaction is read-only and that only `SELECT` is effective on project application tables.

Verify the role-membership edge from an authorized read-only inspection connection:

```sql
SELECT granted_role.rolname AS granted_role,
       member_role.rolname AS member_role,
       grantor_role.rolname AS grantor_role,
       membership.admin_option,
       membership.inherit_option,
       membership.set_option
FROM pg_catalog.pg_auth_members AS membership
JOIN pg_catalog.pg_roles AS granted_role
  ON granted_role.oid = membership.roleid
JOIN pg_catalog.pg_roles AS member_role
  ON member_role.oid = membership.member
JOIN pg_catalog.pg_roles AS grantor_role
  ON grantor_role.oid = membership.grantor
WHERE granted_role.rolname = 'AI_Crypto_Bot_Archive_Decision_Reader'
   OR member_role.rolname = 'AI_Crypto_Bot_Archive_Decision_Reader';
```

Expected: exactly one row: granted role `AI_Crypto_Bot_Archive_Decision_Reader`, member `postgres`, grantor `supabase_admin`, `admin_option=true`, `inherit_option=false`, and `set_option=false`. Do not attempt to revoke or alter this Supabase-managed edge.

## Before-and-after SQL checks

Run these read-only queries independently against the verified source and archive connections. Do not substitute credentials or modify grants to make a failed check pass.

### Source snapshot metrics

```sql
SELECT
  current_database() AS database_name,
  count(*) AS decision_rows,
  count(DISTINCT id) AS distinct_ids,
  count(DISTINCT symbol) AS distinct_symbols,
  count(*) FILTER (WHERE decision = 'BUY') AS buy_rows,
  count(*) FILTER (WHERE decision = 'SELL') AS sell_rows,
  count(*) FILTER (WHERE decision = 'HOLD') AS hold_rows,
  count(*) FILTER (WHERE decision = 'WAIT') AS wait_rows,
  min(created_at) AS earliest_created_at,
  max(created_at) AS latest_created_at
FROM public."AI_Crypto_Bot_AI_Decisions";
```

Expected: `decision_rows = distinct_ids`; action counts sum to the row count; the source role sees the expected nonzero history. Record this result for the validation record. A role seeing zero or unexpectedly partial rows is not evidence that the source table is empty; stop and investigate its RLS visibility.

### Archive decision metrics

Run the same query on `ai_crypto_bot_archive` after the run. The archive total can include rows that existed before this run, so compare `archiveRowCountBefore` and `archiveRowCountAfter` from the completion record as well as action counts and time bounds.

For a verified empty archive decision table, the first complete source copy should report:

```text
sourceRows = N
insertedRows = N
updatedRows = 0
skippedRows = 0
archiveRowCountAfter = N
sourceUpdates = 0
sourceDeletes = 0
```

For an unchanged rerun covering the same rows, it should report no inserts or updates and rows as skipped. A rerun may also include new source rows and overlap rows; reconcile the run's fixed cutoff and lower bound in its completion record.

### Archive foreign-key closure

Run on the archive after copying:

```sql
SELECT decision.symbol, count(*) AS decision_rows
FROM public."AI_Crypto_Bot_AI_Decisions" AS decision
LEFT JOIN public."AI_Crypto_Bot_Watched_Markets" AS market
  ON market.symbol = decision.symbol
WHERE market.symbol IS NULL
GROUP BY decision.symbol
ORDER BY decision.symbol;
```

Expected: zero rows. The agent performs the source-cohort-to-archive-symbol preflight before writing; this query independently checks that archived decisions have parents.

### Constraints and column precision

On each database, confirm the deployed decision column contract:

```sql
SELECT
  column_name,
  ordinal_position,
  data_type,
  is_nullable,
  numeric_precision,
  numeric_scale,
  datetime_precision
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'AI_Crypto_Bot_AI_Decisions'
ORDER BY ordinal_position;
```

Expected: the same ordered nine columns on both databases; `confidence` is `numeric(5,2)`, `indicators` is `jsonb`, and `created_at` is `timestamp with time zone` with microsecond precision.

Inspect the deployed primary key and foreign keys:

```sql
SELECT
  contype,
  convalidated,
  pg_catalog.pg_get_constraintdef(oid) AS definition
FROM pg_catalog.pg_constraint
WHERE conrelid = 'public."AI_Crypto_Bot_AI_Decisions"'::regclass
  AND contype IN ('p', 'f')
ORDER BY contype, conname;
```

Expected: a validated primary key on `id` and a validated FK from `symbol` to `AI_Crypto_Bot_Watched_Markets(symbol)`. The archive schema also has an incoming trade-to-decision FK; decisions are imported before trades.

## Value-fidelity checks

The agent transfers `confidence::text`, `indicators::text`, and UTC `created_at::text`; it never parses confidence or JSON numeric values into JavaScript numbers. The target casts those strings to `numeric(5,2)`, `jsonb`, and `timestamptz`. Each committed target batch is read back and compared on all fields:

```text
id, symbol, decision, confidence, indicators, reason,
strategy_name, strategy_version, created_at
```

JSONB comparison uses PostgreSQL's canonical JSONB text representation; JSONB key order and insignificant whitespace are not treated as data differences. `confidence` and `created_at` retain their PostgreSQL precision. The checkpoint records the original source cursor as timestamp plus UUID.

For a separately authorized manual spot check, choose a small set of IDs from the completion record's source cohort and run the following query on both databases:

```sql
SELECT
  id::text AS id,
  symbol,
  decision,
  confidence::text AS confidence,
  indicators::text AS indicators,
  reason,
  strategy_name,
  strategy_version,
  created_at AT TIME ZONE 'UTC' AS created_at_utc
FROM public."AI_Crypto_Bot_AI_Decisions"
WHERE id = ANY(ARRAY[
  '00000000-0000-4000-8000-000000000001'::uuid
])
ORDER BY id;
```

Replace the example UUID with actual IDs from the run; compare the source and archive outputs. Do not publish decision payloads or credentials in logs or reports.

## Interruption and idempotency rehearsal

Use a disposable source/target pair with the same schema and privilege contract before production use. Verify all of the following without changing production:

1. A failure before an archive transaction commits leaves its cursor unchanged.
2. A process stop after a target commit but before the checkpoint write replays the batch without creating duplicate IDs.
3. A stop after a checkpoint commits resumes strictly after the saved `(created_at, id)` cursor.
4. A rerun with identical values reports skips and does not change archive row count.
5. A changed source row with the same ID updates only its archive copy and preserves the ID.
6. A missing market anchor, wrong database identity, unexpected schema, broad source read privilege, source write privilege, wrong RLS policy, or malformed row stops before a target commit.
7. A missing, invalid, identity-mismatched, or insecure checkpoint fails closed; the agent never guesses a replacement cursor.
8. No source row count/value changes occur. Source reads run inside a read-only transaction, and the source identity has no effective application-table write or persistent schema/database creation privileges. The accepted Supabase `PUBLIC` temporary-object and large-object routine residual remains outside that narrower guarantee.

The agent holds a repeatable-read, read-only source snapshot for each manual run. Keep runs bounded and monitor source transaction duration. The timestamp-plus-ID watermark and overlap depend on the current append-oriented decision writer; old backdated inserts or manual edits outside the overlap require a separately designed reconciliation.

## Acceptance record

Record only non-secret operational facts:

- Verified source project reference and target database identity.
- Source and target schema-contract result.
- Source/target decision counts before and after.
- Copy cutoff, overlap lower bound, batch count, inserted/updated/skipped totals.
- Missing market anchors (must be zero), validation result, and source updates/deletes (must both be zero).
- Agent exit code, completion timestamp, and checkpoint path (not checkpoint contents).
- Backup/restore validation status for the archive, performed separately.

Do not claim production completeness from a successful process exit or total row counts alone. This guide and the generated code do not authorize source retention changes or deletion.

## Related documentation

- [Installation guide](./AI_DECISION_ARCHIVE_AGENT_INSTALLATION.md)
- [Decision archive POC readiness](./AI_DECISION_ARCHIVE_POC_READINESS.md)
- [Archive sync architecture](./ARCHIVE_SYNC_ARCHITECTURE.md)
