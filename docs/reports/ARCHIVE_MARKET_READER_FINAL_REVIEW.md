# Archive Market Reader Final Review

**Review date:** 2026-11-07  
**Mode:** Static review only. No SQL was executed, no database was queried or changed, and no credentials were inspected.

## Executive verdict

# C. Do not execute yet

The explicit role grants and RLS policy are appropriately narrow for copying watched-market rows. The seed utility's required source identity and privileges are compatible with this design. However, the script's own fail-closed privilege checks do not inspect effective access to public-schema sequences or functions, including any `SECURITY DEFINER` functions granted to `PUBLIC`. Since this project is deployed into an existing Supabase database and its live object grants were not queried, the script cannot currently establish that the role has no access paths beyond the target table.

Before execution, either add and statically review checks for effective sequence/function privileges or conduct a separately authorized, read-only owner preflight that inventories those grants and documents why each callable object is safe. Also complete the project's required approval/change tracking for the role and policy, then verify the activated login and its effective access as the new role. Do not broaden grants or change privileges for `PUBLIC` or other roles to make the validation pass.

## Review results

| Requirement | Result | Evidence / qualification |
|---|---|---|
| Grants | **PASS — explicit grants are limited** | The role is created with `NOLOGIN`, `NOINHERIT`, no administrative/bypass attributes, and connection limit 1. It receives `CONNECT` on `postgres`, `USAGE` on `public`, and table `SELECT` only. No table write, schema create, role administration, replication, or superuser grant is issued. |
| RLS policy | **PASS — correct for this POC** | The policy is `FOR SELECT`, applies only to the new role, and uses `USING (true)` to expose all watched-market rows, including disabled markets. The source migration enables RLS and the reader is not made table owner or `BYPASSRLS`. |
| Excessive privileges | **NOT FULLY VERIFIED** | The SQL checks effective privileges on public tables/views and schemas, plus database/schema writes and memberships. It does not check effective privileges on sequences or executable functions. |
| Seed utility compatibility | **PASS — subject to post-activation verification** | The CLI requires database `postgres`, the configured role name, a read-only transaction, schema `USAGE` without `CREATE`, and table `SELECT` without writes. The setup guide's separate password and `LOGIN` step matches the script's intentional `NOLOGIN` bootstrap state. |
| Syntax / runtime | **No issue identified statically** | The role attributes, grants, policy, and catalog checks appear syntactically consistent with PostgreSQL 17. This is not a parse test or execution result. |
| Live Supabase state | **NOT VERIFIED** | Role/policy name collisions, actual RLS state, existing object grants, project identity, and reader-visible row completeness were not checked. |

## Detailed findings

### 1. Explicit grants are least-privilege

The removed `ARCHIVE_MARKET_READER_ROLE.sql` draft created the role with `NOLOGIN`, `NOINHERIT`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, `NOBYPASSRLS`, and `CONNECTION LIMIT 1`. Its explicit grants were limited to database connection, `public` schema usage, and `SELECT` on `public."AI_Crypto_Bot_Watched_Markets"`. The SQL did not grant writes, DDL, role management, or access to another table.

The validation block also rejects role memberships, unwanted database/schema privileges, table writes, and effective privileges on other public relations. These are useful fail-closed controls.

### 2. RLS policy matches the required full-row seed

The policy at lines 33–37 is a table-specific `SELECT` policy for `cryptopulse_archive_market_reader` with `USING (true)`. That is appropriate for the seed utility, which copies every watched-market row and must include disabled markets. The project's base migration enables RLS on the table and grants the existing all-row policy only to `authenticated`; it revokes table grants from `PUBLIC`, `anon`, and `authenticated` before granting the intended authenticated read access. The new policy does not alter those existing policies.

The SQL's check that RLS is enabled and the reader is not the table owner is appropriate. `NOBYPASSRLS` prevents bypass through the role attribute; the role-membership check prevents inheriting or switching to another role.

### 3. Privilege-validation gap: sequences and functions

The validation query enumerates public relations with `relkind` `r`, `p`, `v`, `m`, and `f`, but omits sequences (`relkind = 'S'`). It also does not inspect `pg_proc` or effective `EXECUTE` privileges. PostgreSQL function privileges can be granted to `PUBLIC`, and a callable `SECURITY DEFINER` function can expose or mutate data beyond the reader's direct table grants. The SQL makes no explicit sequence/function grants, but that alone does not rule out privileges inherited from `PUBLIC` or existing default/object ACLs.

The repository migrations explicitly revoke `PUBLIC` execution from the known application security-definer functions; this is useful evidence about repository-defined objects, but it does not establish the live ACL state of every object in the existing Supabase database. The review therefore cannot certify the requested “access only to this table” boundary without an additional check or owner preflight.

**Required before execution:** audit and document effective sequence privileges and callable non-system functions for the new role, with particular attention to `SECURITY DEFINER` functions. Prefer adding fail-closed validation for these classes. Do not fix findings by revoking global grants from `PUBLIC` or changing unrelated roles.

### 4. Utility compatibility and activation sequence

[`archive-market-seed.mjs`](../../archive-server/src/archive-market-seed.mjs#L238) compares the connected source identity and `transaction_read_only`, checks `public` schema `USAGE`/`CREATE`, and checks `SELECT` versus `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` on the watched-market table. The role created by the SQL satisfies that contract once a password has been set and `LOGIN` enabled.

The SQL validates the initial disabled-login role. The separate `ALTER ROLE ... LOGIN` step is not covered by that validation block, so repeat the role-attribute and effective-privilege checks after activation, using an owner inspection and a test connection as the reader. Compare the reader-visible row count with a trusted owner count before setting `SUPABASE_ARCHIVE_MARKET_READ_SCOPE_CONFIRMED=true`; that flag is an operator attestation, not a visibility proof.

The `default_transaction_read_only` role setting is defense in depth, not the authorization boundary: callers may override a default session setting. Safety primarily depends on the absence of write privileges and the CLI's explicit read-only source transaction.

### 5. Operational and governance prerequisites

- Confirm the target Supabase project and database `postgres`; the SQL checks database name but cannot identify the project.
- Check that the role and policy names do not already exist. The script intentionally fails on collisions.
- Confirm live RLS, table ownership, and all effective object grants before running.
- Follow the project database-change process: obtain approval, record the role/policy change in the approved migration/change-control mechanism, and verify it after application. This generated SQL is a manual setup artifact, not a versioned Supabase migration.
- Use the setup guide's out-of-band password workflow; do not put a password in SQL, the repository, command arguments, or logs. Keep the temporary login limited to the POC and execute the documented cleanup when it is no longer needed.

## A / B / C decision

- **A. Safe to execute:** No. The explicit grants are narrow, but the complete effective access boundary has not been established.
- **B. Minor issues found:** The sequence/function validation gap and the lack of post-login validation must be resolved or covered by an approved owner preflight.
- **C. Do not execute:** **Selected.** Do not run this SQL until those checks and the required project change-control steps are complete.

## References reviewed

- Removed superseded draft: `ARCHIVE_MARKET_READER_ROLE.sql`
- [`ARCHIVE_MARKET_READER_SETUP.md`](./ARCHIVE_MARKET_READER_SETUP.md)
- [`archive-market-seed.mjs`](../../archive-server/src/archive-market-seed.mjs)
- [`20261031190000_create_agent_tables.sql`](../../PostgreSQL/migrations/20261031190000_create_agent_tables.sql)
- [`DATABASE.md`](../DATABASE.md)
- [`ARCHIVE_CREDENTIAL_IMPLEMENTATION.md`](./ARCHIVE_CREDENTIAL_IMPLEMENTATION.md)
- [`MARKET_SEED_EXECUTION_GUIDE.md`](./MARKET_SEED_EXECUTION_GUIDE.md)
- [`ARCHIVE_SYNC_ARCHITECTURE.md`](./ARCHIVE_SYNC_ARCHITECTURE.md)
- PostgreSQL 17 [`pg_roles` view documentation](https://www.postgresql.org/docs/17/view-pg-roles.html)
