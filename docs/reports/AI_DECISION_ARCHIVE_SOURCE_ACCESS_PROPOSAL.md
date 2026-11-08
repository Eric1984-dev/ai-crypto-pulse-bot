# AI Decision Archive Source Access Proposal

**Date:** 2026-11-07  
**Historical status (2026-11-07):** Scoped application-data access was accepted for migration preparation only. The migration and documentation were prepared but had not been applied when this proposal was written.

**Subsequent operational update (2026-11-09):** The user reports that source/writer readiness checks passed and a manual archive sync succeeded. This does not change the historical proposal or independently verify current role grants, copied row counts, or restore readiness.

## Decision summary

The existing archive-reader SQL does **not** provide the source access required by the AI decision agent. It provisions a watched-market reader only. A decision reader would need a separate role, a table-specific all-row `SELECT` RLS policy, and a `SELECT` grant on `AI_Crypto_Bot_AI_Decisions`.

There is a platform-level constraint: Supabase grants some privileges to `PUBLIC`, including temporary-object access on the `postgres` database and execution of large-object functions. Those privileges cannot be denied to one role while the `PUBLIC` grants remain. The accepted preparation path is therefore limited to decision-table application access: no project-table writes, no persistent schema/database creation, no memberships other than Supabase's exact managed `postgres`-member-of-reader edge, no elevated reader attributes, and an additive decision-table RLS policy. `default_transaction_read_only=on` is defense in depth only and can be overridden by the login. This is not an absolute no-write/no-DDL database identity.

The user accepted this scoped-access interpretation for preparing the executable migration and documentation only. That approval does not authorize applying SQL, setting a password, enabling `LOGIN`, configuring the Pi, or running the archive agent. The canonical migration is [`20261107120000_ai_decision_archive_reader.sql`](../../supabase/migrations/20261107120000_ai_decision_archive_reader.sql); the inline SQL draft below is retained as historical proposal context and must not be used instead of the canonical migration.

Do not revoke `TEMP` or function execution from `PUBLIC`. Those are shared database-wide changes, not per-role least-privilege grants.

## Existing repository findings

- [`ARCHIVE_MARKET_READER_ROLE_V2.sql`](../../ARCHIVE_MARKET_READER_ROLE_V2.sql) creates `cryptopulse_archive_market_reader` and grants `SELECT` only on `AI_Crypto_Bot_Watched_Markets`. It is not a decision reader and its role name does not follow the project prefix.
- The removed `ARCHIVE_MARKET_READER_RLS_MIGRATION.sql` draft added a watched-market policy only and duplicated the role script's policy creation. It was superseded by the V2 role setup artifact.
- The source migration creates `AI_Crypto_Bot_AI_Decisions_select_authenticated` with `USING (true)` for `authenticated`, revokes application-table grants from `PUBLIC`, `anon`, and `authenticated`, and grants `SELECT` to `authenticated`. There is no archive-reader decision policy.
- [`AI_CRYPTO_BOT_ARCHIVE_SCHEMA.sql`](../../AI_CRYPTO_BOT_ARCHIVE_SCHEMA.sql) defines archive tables and constraints; it does not provision roles or grants.
- The archive CLI requires a direct source role with decision-table `SELECT`, a matching all-row RLS policy, verified TLS, and no effective access to unrelated project tables. It uses a read-only source transaction. This does not make the PostgreSQL login itself absolutely incapable of other writes.

## Prepared source-role scope

### Identity and scope

Use the prefixed PostgreSQL role name:

```text
"AI_Crypto_Bot_Archive_Decision_Reader"
```

Use the prefixed policy name:

```text
"AI_Crypto_Bot_AI_Decisions_Archive_Reader_Select"
```

The migration creates the role as `NOLOGIN`, `NOINHERIT`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, `NOBYPASSRLS`, and limited to one connection. Its only application-object privilege is `SELECT` on `public."AI_Crypto_Bot_AI_Decisions"`. It receives no access to watched markets on Supabase; the agent reads watched-market anchors only from the Pi archive. Postflight requires the single platform-managed membership edge: the reader is the granted role, `postgres` is its member, `supabase_admin` is the grantor, `ADMIN=true`, `INHERIT=false`, and `SET=false`. It rejects every other membership where the reader is either the granted role or the member. `ADMIN=true` lets `postgres` grant the reader role to another role; `INHERIT=false` and `SET=false` prevent automatic privilege inheritance and `SET ROLE` from `postgres` into the reader. The edge does not make the reader a member of `postgres`; Supabase manages the grant and does not permit revoking it. Postflight requires effective schema `USAGE` only on `public` among non-system schemas. It checks other relation, column, and sequence privileges only in schemas where the reader has effective `USAGE`, so an object grant in an inaccessible schema is not treated as reachable; extra access in `public` remains rejected. No `PUBLIC` grants are changed. Other postflight assertions reject persistent schema/database creation, CryptoPulse function execution, or unexpected role attributes. The role-level read-only default is not an enforcement boundary.

### Forward SQL draft

This earlier inline SQL is superseded. Do not execute it; use the canonical migration linked above after separate approval to apply it.

```sql
BEGIN;

DO $preflight$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Run only in the approved Supabase postgres database';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'AI_Crypto_Bot_Archive_Decision_Reader'
  ) THEN
    RAISE EXCEPTION 'Decision reader role already exists; inspect before proceeding';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'AI_Crypto_Bot_AI_Decisions'
      AND policyname = 'AI_Crypto_Bot_AI_Decisions_Archive_Reader_Select'
  ) THEN
    RAISE EXCEPTION 'Decision reader policy already exists; inspect before proceeding';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class
    WHERE oid = 'public."AI_Crypto_Bot_AI_Decisions"'::regclass
      AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Decision-table RLS must be enabled';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'AI_Crypto_Bot_AI_Decisions'
      AND policyname = 'AI_Crypto_Bot_AI_Decisions_select_authenticated'
      AND cmd = 'SELECT'
      AND roles @> ARRAY['authenticated']::name[]
      AND qual = 'true'
  ) THEN
    RAISE EXCEPTION 'Existing authenticated decision policy differs from expectation';
  END IF;
END
$preflight$;

CREATE ROLE "AI_Crypto_Bot_Archive_Decision_Reader"
  WITH NOLOGIN
       NOINHERIT
       NOSUPERUSER
       NOCREATEDB
       NOCREATEROLE
       NOREPLICATION
       NOBYPASSRLS
       CONNECTION LIMIT 1;

ALTER ROLE "AI_Crypto_Bot_Archive_Decision_Reader"
  SET default_transaction_read_only = on;

REVOKE ALL PRIVILEGES ON DATABASE postgres
  FROM "AI_Crypto_Bot_Archive_Decision_Reader";
GRANT CONNECT ON DATABASE postgres
  TO "AI_Crypto_Bot_Archive_Decision_Reader";

REVOKE ALL PRIVILEGES ON SCHEMA public
  FROM "AI_Crypto_Bot_Archive_Decision_Reader";
GRANT USAGE ON SCHEMA public
  TO "AI_Crypto_Bot_Archive_Decision_Reader";

REVOKE ALL PRIVILEGES
  ON TABLE public."AI_Crypto_Bot_AI_Decisions"
  FROM "AI_Crypto_Bot_Archive_Decision_Reader";
GRANT SELECT
  ON TABLE public."AI_Crypto_Bot_AI_Decisions"
  TO "AI_Crypto_Bot_Archive_Decision_Reader";

CREATE POLICY "AI_Crypto_Bot_AI_Decisions_Archive_Reader_Select"
  ON public."AI_Crypto_Bot_AI_Decisions"
  AS PERMISSIVE
  FOR SELECT
  TO "AI_Crypto_Bot_Archive_Decision_Reader"
  USING (true);

COMMIT;
```

The role is deliberately left `NOLOGIN` and has no password in SQL. The preflight preserves the existing authenticated policy and fails on name collisions instead of silently adopting unknown state. The canonical deployment migration includes reviewed post-creation checks for role attributes, the exact Supabase-managed membership edge, effective privileges on application relations, columns, sequences and routines in schemas the reader can use, table ownership, and the intended RLS policy. The archive CLI's source preflight does not query `pg_auth_members`; the membership shape is enforced by this migration and can be verified with the read-only query in the validation guide.

Before any login is activated, inspect effective `TEMP` access on database `postgres` and effective execution on large-object write functions, and record those results as the accepted platform residual. Do not revoke shared `PUBLIC` privileges. Stop if the migration's postflight finds other relation access, persistent schema/database creation, or unexpected role/policy state, or if approval of the residual is withdrawn; `default_transaction_read_only` does not remove these privileges.

### Secure password activation

After separate approval and successful privilege review:

1. Keep the role `NOLOGIN` while the SQL migration is reviewed and applied.
2. From an approved, verified-TLS administrative `psql` session, set a generated password interactively with `\password "AI_Crypto_Bot_Archive_Decision_Reader"`. Do not put the password in SQL, shell arguments, editor history, repository files, or logs.
3. Enable `LOGIN` only after the password has been set and the privilege decision has been approved.
4. Transfer the credential to the Pi operator only through the approved secret manager/password channel. Store it only in the Pi's protected, ignored environment file, readable by the archive service account. Never place it in Vercel, this report, or chat.
5. In the Pi environment, set `SUPABASE_ARCHIVE_READONLY_ROLE` to the exact quoted PostgreSQL identifier and use a direct PostgreSQL URI for that role. Keep TLS certificate verification enabled. Do not use `service_role`, `authenticated`, or the `postgres` inspection connection as the agent source.

The `\password` command is a `psql` meta-command, not SQL. It was not run.

### Rollback draft

Run only after separate approval, after stopping the agent and closing reader sessions. Do not use `CASCADE`.

```sql
BEGIN;

ALTER ROLE "AI_Crypto_Bot_Archive_Decision_Reader" NOLOGIN;

DROP POLICY "AI_Crypto_Bot_AI_Decisions_Archive_Reader_Select"
  ON public."AI_Crypto_Bot_AI_Decisions";

REVOKE ALL PRIVILEGES
  ON TABLE public."AI_Crypto_Bot_AI_Decisions"
  FROM "AI_Crypto_Bot_Archive_Decision_Reader";
REVOKE ALL PRIVILEGES ON SCHEMA public
  FROM "AI_Crypto_Bot_Archive_Decision_Reader";
REVOKE ALL PRIVILEGES ON DATABASE postgres
  FROM "AI_Crypto_Bot_Archive_Decision_Reader";

DROP ROLE "AI_Crypto_Bot_Archive_Decision_Reader";

COMMIT;
```

If a dependency or active-session error occurs, stop and inspect it; do not force removal. The rollback does not change `PUBLIC`, `authenticated`, the decision table, its data, or its RLS setting.

## Pi-local read-only archive verification procedure

This procedure is for an authorized operator **on the Raspberry Pi**. It does not use SSH or the Vercel tunnel. Use only already-provisioned connection profiles and credentials. If those are unavailable, stop; do not place a password in a command, environment dump, shell history, or log. The source profile uses the user-verified decision reader. The Pi-local writer role is prepared in [the writer-role SQL script](../../archive-server/sql/prepare-archive-decision-writer.sql) but has not been applied; it remains `NOLOGIN` until separately approved and provisioned. Before then, use only an already-authorized Pi-local inspection identity for read-only checks. Do not use the agent role or change its login state as part of this procedure.

Use `psql` service aliases backed by the existing protected PostgreSQL service/passfile configuration; do not put credentials in the service name or command line. Ensure the services retain verified TLS (`sslmode=verify-full`) and the intended certificate trust. Replace the service-alias placeholders with already configured aliases only.

### 1. Verify archive database and role identity

Connect using the existing archive writer profile and run this read-only transaction:

```sql
BEGIN READ ONLY;

SELECT current_database() AS database_name,
       current_user AS role_name,
       current_setting('transaction_read_only') AS transaction_read_only,
       role.rolsuper AS is_superuser,
       role.rolbypassrls AS bypasses_rls,
       role.rolcreatedb AS can_create_database,
       role.rolcreaterole AS can_create_role,
       role.rolreplication AS can_replicate,
       role.rolinherit AS inherits_roles,
       pg_catalog.has_database_privilege(current_user, current_database(), 'CREATE')
         AS can_create_schema,
       pg_catalog.has_database_privilege(current_user, current_database(), 'TEMP')
         AS can_create_temporary_objects
FROM pg_catalog.pg_roles AS role
WHERE role.rolname = current_user;

SELECT pg_catalog.pg_has_role(current_user, roleid, 'MEMBER') AS membership,
       rolname AS granted_role
FROM pg_catalog.pg_roles
WHERE pg_catalog.pg_has_role(current_user, oid, 'MEMBER');

ROLLBACK;
```

Expected database name: `ai_crypto_bot_archive`. The writer must not be superuser, `BYPASSRLS`, database/role administrator, replicating, table owner, or a member of broader project roles. No database `CREATE` is expected. Treat effective `TEMP` as a platform-level DDL capability; if the requirement forbids it, stop and request a security decision rather than changing `PUBLIC`.

### 2. Verify exact table privileges and absence of unrelated table access

In the same read-only connection:

```sql
BEGIN READ ONLY;

SELECT
  pg_catalog.has_table_privilege(current_user,
    'public."AI_Crypto_Bot_AI_Decisions"', 'SELECT') AS decision_select,
  pg_catalog.has_table_privilege(current_user,
    'public."AI_Crypto_Bot_AI_Decisions"', 'INSERT') AS decision_insert,
  pg_catalog.has_table_privilege(current_user,
    'public."AI_Crypto_Bot_AI_Decisions"', 'UPDATE') AS decision_update,
  pg_catalog.has_table_privilege(current_user,
    'public."AI_Crypto_Bot_AI_Decisions"', 'DELETE') AS decision_delete,
  pg_catalog.has_table_privilege(current_user,
    'public."AI_Crypto_Bot_AI_Decisions"', 'TRUNCATE') AS decision_truncate,
  pg_catalog.has_table_privilege(current_user,
    'public."AI_Crypto_Bot_AI_Decisions"', 'TRIGGER') AS decision_trigger,
  pg_catalog.has_table_privilege(current_user,
    'public."AI_Crypto_Bot_Watched_Markets"', 'SELECT') AS markets_select,
  pg_catalog.has_table_privilege(current_user,
    'public."AI_Crypto_Bot_Watched_Markets"', 'INSERT') AS markets_insert,
  pg_catalog.has_table_privilege(current_user,
    'public."AI_Crypto_Bot_Watched_Markets"', 'UPDATE') AS markets_update,
  pg_catalog.has_table_privilege(current_user,
    'public."AI_Crypto_Bot_Watched_Markets"', 'DELETE') AS markets_delete,
  pg_catalog.has_table_privilege(current_user,
    'public."AI_Crypto_Bot_Watched_Markets"', 'TRUNCATE') AS markets_truncate;

SELECT namespace.nspname, relation.relname, relation.relkind,
       pg_catalog.has_table_privilege(current_user, relation.oid, 'SELECT') AS can_select,
       pg_catalog.has_table_privilege(current_user, relation.oid, 'INSERT') AS can_insert,
       pg_catalog.has_table_privilege(current_user, relation.oid, 'UPDATE') AS can_update,
       pg_catalog.has_table_privilege(current_user, relation.oid, 'DELETE') AS can_delete,
       pg_catalog.has_table_privilege(current_user, relation.oid, 'TRUNCATE') AS can_truncate,
       pg_catalog.has_table_privilege(current_user, relation.oid, 'TRIGGER') AS can_trigger
FROM pg_catalog.pg_class AS relation
JOIN pg_catalog.pg_namespace AS namespace
  ON namespace.oid = relation.relnamespace
WHERE namespace.nspname = 'public'
  AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND (
    pg_catalog.has_table_privilege(current_user, relation.oid, 'SELECT')
    OR pg_catalog.has_table_privilege(current_user, relation.oid, 'INSERT')
    OR pg_catalog.has_table_privilege(current_user, relation.oid, 'UPDATE')
    OR pg_catalog.has_table_privilege(current_user, relation.oid, 'DELETE')
    OR pg_catalog.has_table_privilege(current_user, relation.oid, 'TRUNCATE')
    OR pg_catalog.has_table_privilege(current_user, relation.oid, 'TRIGGER')
  )
ORDER BY namespace.nspname, relation.relname;

ROLLBACK;
```

Expected writer scope: `SELECT`, `INSERT`, and `UPDATE` on decisions; `SELECT` on watched markets; no `DELETE`, `TRUNCATE`, or `TRIGGER`; no other project relation privileges. Also audit sequence and executable routine grants, including large-object functions, and inspect column-level ACLs; table-level privilege checks alone do not prove those are absent.

### 3. Verify deployed decision schema and constraints

```sql
BEGIN READ ONLY;

SELECT ordinal_position, column_name, data_type, is_nullable,
       numeric_precision, numeric_scale, datetime_precision
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'AI_Crypto_Bot_AI_Decisions'
ORDER BY ordinal_position;

SELECT contype, convalidated,
       pg_catalog.pg_get_constraintdef(oid) AS definition
FROM pg_catalog.pg_constraint
WHERE conrelid = 'public."AI_Crypto_Bot_AI_Decisions"'::regclass
  AND contype IN ('p', 'f')
ORDER BY contype, conname;

ROLLBACK;
```

Expected: the agent's ordered nine-column contract, a validated primary key on `id`, and a validated `symbol` FK to watched-market `symbol` with restrictive delete behavior. Compare the output to the source contract before any copy.

### 4. Compare source decision symbols to local archive anchors

First verify each existing service connection separately. Then, on the Pi, obtain sorted symbol-only query results from the source reader and archive writer and compare them locally. Use temporary files with cleanup; these files contain only market symbols and are not database writes or configuration changes.

```sh
set -eu
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

psql -X -A -t -v ON_ERROR_STOP=1 \
  "service=<existing-supabase-reader-service>" \
  -c 'SELECT DISTINCT symbol
      FROM public."AI_Crypto_Bot_AI_Decisions"
      ORDER BY symbol' > "$tmpdir/source-symbols"

psql -X -A -t -v ON_ERROR_STOP=1 \
  "service=<existing-archive-writer-service>" \
  -c 'SELECT symbol
      FROM public."AI_Crypto_Bot_Watched_Markets"
      ORDER BY symbol' > "$tmpdir/archive-symbols"

LC_ALL=C sort -u "$tmpdir/source-symbols" -o "$tmpdir/source-symbols"
LC_ALL=C sort -u "$tmpdir/archive-symbols" -o "$tmpdir/archive-symbols"
comm -23 "$tmpdir/source-symbols" "$tmpdir/archive-symbols"
```

Expected output: no lines. Any missing symbol is a stop condition; do not disable the FK or seed rows as part of this reader-access change. The agent independently repeats this check before writing.

The service aliases must already exist and must not embed passwords in command arguments. If either connection profile, required archive grant, or target schema is unavailable, stop and request authorization; do not use the dashboard health tunnel or the `postgres` inspection identity as a substitute.

## Documentation updates after approval

Do not change operational documentation to imply that access exists until the approved migration and secure login provisioning have actually succeeded. After approval and verification, update:

- [`docs/DATABASE.md`](../DATABASE.md): record the prefixed source role, the exact decision-only `SELECT` grant, the additive RLS policy, migration reference, and any accepted `PUBLIC` capability limitation.
- [`docs/reports/AI_DECISION_ARCHIVE_AGENT_INSTALLATION.md`](./AI_DECISION_ARCHIVE_AGENT_INSTALLATION.md): set the exact role identifier, secure password activation/storage procedure, and Pi-only source URI instructions.
- [`docs/reports/AI_DECISION_ARCHIVE_AGENT_VALIDATION.md`](./AI_DECISION_ARCHIVE_AGENT_VALIDATION.md): add the role/ACL checks, strict stop conditions, and reader-visible row-count comparison.
- [`docs/DEPLOYMENT.md`](../DEPLOYMENT.md): clarify that the source credential belongs on the Pi only and that the Vercel health tunnel is unrelated.
- [`docs/CHANGELOG.md`](../CHANGELOG.md): record only the completed, verified access change—not this proposal.

Do not alter the existing authenticated policy or bot behavior. Do not add a Vercel endpoint, scheduler, service-role credential, or archive data operation.

## Remaining approval gates

No SQL was applied, no role/policy or database object was changed, no secret was accessed, and no Pi configuration or archive data was touched. Separate approval is still required before:

1. Applying the canonical migration to the intended Supabase project.
2. Setting the role password through an approved secure `psql` prompt, auditing effective privileges, and enabling `LOGIN`.
3. Transferring the credential to the Pi through an approved secure channel and changing Pi configuration.
4. Running the read-only Pi-local verification procedure or the archive agent.
