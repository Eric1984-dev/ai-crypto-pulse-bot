# Market Seed POC Execution Checklist

**Scope:** Manually copy `AI_Crypto_Bot_Watched_Markets` from Supabase to the Raspberry Pi archive.
**Expected starting state:** 102 source rows; 0 archive rows.
**Safety:** No source updates/deletes, no archive deletes, no scheduled execution, and no AI-decision copy.

Use this sequence only after the owner accepts the reader-role limitation described below and authorizes the Supabase role/policy change. The checklist is an execution guide; no SQL, database query, copy, or deployment was performed to create it.

## 1. Confirm prerequisites and stop conditions

- [ ] Confirm the Supabase project reference from its Dashboard Connect panel. Do not rely only on the database name `postgres` to identify the project.
- [ ] Confirm the Supabase server is PostgreSQL 16 or later. [`ARCHIVE_MARKET_READER_ROLE_V2.sql`](../../ARCHIVE_MARKET_READER_ROLE_V2.sql) requires the PostgreSQL 16 membership-option columns.
- [ ] Confirm the archive database is `ai_crypto_bot_archive`, the archive schema is deployed, the watched-market table is empty, and a recoverable archive backup exists.
- [ ] Confirm the Pi can reach the Supabase **direct** PostgreSQL endpoint and validate its TLS certificate. The utility rejects pooler endpoints.
- [ ] Confirm a dedicated, non-owner archive writer is available with only `USAGE` on `public` and `SELECT`/`INSERT`/`UPDATE` on the watched-market table. Keep the health-check `ARCHIVE_DB_*` account read-only and separate.
- [ ] Accept that the Supabase reader is restricted for application tables but is not an absolute no-write credential: Supabase grants unavoidable `PUBLIC` temporary-object/large-object capabilities. The utility itself uses a read-only source transaction. If absolute source write prevention is required, **stop**; do not use this direct-login procedure.
- [ ] If the V2 validation fails because of `pg_net`, another schema, public routine, sequence, or unexpected privilege, **stop**. Do not weaken the checks or revoke platform-wide `PUBLIC` grants to make the script pass.

## 2. Supabase: verify the starting state

In the intended Supabase project's SQL Editor, confirm the database and PostgreSQL version:

```sql
SELECT
  current_database() AS database_name,
  current_setting('server_version_num') AS server_version_num;
```

Expected: `database_name = postgres`; `server_version_num >= 160000`.

Check for role/policy collisions before provisioning:

```sql
SELECT rolname
FROM pg_catalog.pg_roles
WHERE rolname = 'cryptopulse_archive_market_reader';
```

Expected: zero rows. If the role exists, inspect it; do not rerun the create script or alter an unknown role.

```sql
SELECT schemaname, tablename, policyname, roles, cmd, qual
FROM pg_catalog.pg_policies
WHERE schemaname = 'public'
  AND tablename = 'AI_Crypto_Bot_Watched_Markets'
  AND policyname = 'AI_Crypto_Bot_Watched_Markets_archive_reader_select';
```

Expected: zero rows. Also confirm the existing `AI_Crypto_Bot_Watched_Markets_select_authenticated` policy is present and unchanged.

Record the trusted owner baseline. The expected count is 102:

```sql
SELECT
  current_database() AS database_name,
  count(*) AS source_rows,
  count(DISTINCT id) AS distinct_ids,
  count(DISTINCT symbol) AS distinct_symbols,
  min(created_at) AS earliest_created_at,
  max(created_at) AS latest_created_at
FROM public."AI_Crypto_Bot_Watched_Markets";
```

Expected: `source_rows = distinct_ids = distinct_symbols = 102`. If not, stop and reconcile the changed source state before proceeding.

## 3. Supabase: create the temporary reader

1. Use the approved database-change process to record/authorize the temporary role and RLS policy.
2. In the verified Supabase `postgres` database, execute the entire [`ARCHIVE_MARKET_READER_ROLE_V2.sql`](../../ARCHIVE_MARKET_READER_ROLE_V2.sql) once.
3. Do **not** combine V2 with the superseded V1 role or standalone RLS drafts; those files have been removed. V2 creates the policy itself.
4. If the transaction raises an exception, stop. A transaction failure rolls back the role and grants; inspect the reported privilege/state rather than broadening access.
5. In a trusted administrator `psql` session connected to the same Supabase project, set the password without placing it in SQL, shell history, or this repository:

   ```text
   \password cryptopulse_archive_market_reader
   ```

6. Only after setting the secret, enable login:

   ```sql
   ALTER ROLE cryptopulse_archive_market_reader LOGIN;
   ```

### Verify the role and platform-managed membership

As the administrator, confirm the role remains non-privileged:

```sql
SELECT
  rolname,
  rolcanlogin,
  rolinherit,
  rolsuper,
  rolcreatedb,
  rolcreaterole,
  rolreplication,
  rolbypassrls,
  rolconnlimit
FROM pg_catalog.pg_roles
WHERE rolname = 'cryptopulse_archive_market_reader';
```

Expected: one row; `rolcanlogin = true`, `rolinherit = false`, all privileged flags false, and `rolconnlimit = 1`.

Supabase PostgreSQL 16+ adds a managed admin membership when `postgres` creates a role. Confirm that the only membership involving this role is the expected one:

```sql
SELECT
  granted_role.rolname AS granted_role,
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
WHERE granted_role.rolname = 'cryptopulse_archive_market_reader'
   OR member_role.rolname = 'cryptopulse_archive_market_reader';
```

Expected: one row, `granted_role = cryptopulse_archive_market_reader`, `member_role = postgres`, `grantor_role = supabase_admin`, `admin_option = true`, `inherit_option = false`, and `set_option = false`. Any other membership is a stop condition.

## 4. Supabase: validate grants, policy, and full visibility

Connect as `cryptopulse_archive_market_reader` using verified TLS. Check the effective role/table access:

```sql
SELECT
  current_database() AS database_name,
  current_user AS role_name,
  current_setting('transaction_read_only') AS transaction_read_only,
  pg_catalog.has_database_privilege(current_user, 'postgres', 'CONNECT') AS can_connect,
  pg_catalog.has_database_privilege(current_user, 'postgres', 'CREATE') AS can_create_database_objects,
  pg_catalog.has_schema_privilege(current_user, 'public', 'USAGE') AS can_use_public,
  pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_in_public,
  pg_catalog.has_table_privilege(
    current_user,
    'public."AI_Crypto_Bot_Watched_Markets"',
    'SELECT'
  ) AS can_select_markets,
  pg_catalog.has_table_privilege(
    current_user,
    'public."AI_Crypto_Bot_Watched_Markets"',
    'INSERT'
  ) AS can_insert_markets,
  pg_catalog.has_table_privilege(
    current_user,
    'public."AI_Crypto_Bot_Watched_Markets"',
    'UPDATE'
  ) AS can_update_markets,
  pg_catalog.has_table_privilege(
    current_user,
    'public."AI_Crypto_Bot_Watched_Markets"',
    'DELETE'
  ) AS can_delete_markets,
  pg_catalog.has_table_privilege(
    current_user,
    'public."AI_Crypto_Bot_Watched_Markets"',
    'TRUNCATE'
  ) AS can_truncate_markets;
```

Expected: role/database are `cryptopulse_archive_market_reader`/`postgres`; `can_connect`, `can_use_public`, and `can_select_markets` are true; `can_create_database_objects`, `can_create_in_public`, and all table-write checks are false. The `PUBLIC` temporary/large-object baseline is the documented platform limitation; do not interpret it as a grant of table DML.

Confirm that the reader sees all rows, not an RLS-filtered subset:

```sql
BEGIN READ ONLY;

SELECT
  current_database() AS database_name,
  current_user AS role_name,
  current_setting('transaction_read_only') AS transaction_read_only,
  count(*) AS visible_rows,
  count(DISTINCT id) AS distinct_ids,
  count(DISTINCT symbol) AS distinct_symbols,
  min(created_at) AS earliest_created_at,
  max(created_at) AS latest_created_at
FROM public."AI_Crypto_Bot_Watched_Markets";

ROLLBACK;
```

Expected: `transaction_read_only = on`; all three counts equal 102; timestamp bounds match the trusted owner baseline. Do not set `SUPABASE_ARCHIVE_MARKET_READ_SCOPE_CONFIRMED=true` until the owner has confirmed this equality and the role/policy scope.

## 5. Raspberry Pi: verify the archive target

Use an authorized read-only target connection first. Confirm the target database is empty and correctly identified:

```sql
SELECT
  current_database() AS database_name,
  current_user AS role_name,
  count(*) AS archive_rows,
  count(DISTINCT id) AS distinct_ids,
  count(DISTINCT symbol) AS distinct_symbols
FROM public."AI_Crypto_Bot_Watched_Markets";
```

Expected: `database_name = ai_crypto_bot_archive`; `archive_rows = distinct_ids = distinct_symbols = 0`.

Confirm the table contract and constraints before supplying writer credentials:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'AI_Crypto_Bot_Watched_Markets'
ORDER BY ordinal_position;
```

Expected columns, in order: `id uuid NOT NULL`, `symbol text NOT NULL`, `enabled boolean NOT NULL`, `priority integer NOT NULL`, `created_at timestamp with time zone NOT NULL`, `updated_at timestamp with time zone NOT NULL`. The table must have a primary key on `id` and a unique constraint on `symbol`.

The archive writer must be a dedicated non-owner/non-superuser. The utility checks its database/table identity, schema usage, and effective privileges at runtime. Do not run with the health-check account.

## 6. Raspberry Pi: install and configure the manual run

1. Use the dedicated archive-sync operating-system account and a root-controlled environment file outside the repository, such as `/etc/cryptopulse/archive-market-seed.env`. Restrict file ownership and permissions so only the operator running the CLI can read it.
2. Set these values in that file. Replace placeholders locally; never paste secrets into the checklist, chat, shell arguments, Vercel, or source control.

   ```text
   SUPABASE_ARCHIVE_READONLY_URL=postgresql://cryptopulse_archive_market_reader:<URL-ENCODED-PASSWORD>@db.<verified-project-ref>.supabase.co:5432/postgres
   SUPABASE_ARCHIVE_EXPECTED_PROJECT_REF=<verified-project-ref>
   SUPABASE_ARCHIVE_READONLY_ROLE=cryptopulse_archive_market_reader
   SUPABASE_ARCHIVE_MARKET_READ_SCOPE_CONFIRMED=true
   SUPABASE_ARCHIVE_SSL_CA=
   SUPABASE_ARCHIVE_SSL_SERVERNAME=
   ARCHIVE_SYNC_DB_HOST=<verified-archive-postgresql-host>
   ARCHIVE_SYNC_DB_PORT=5432
   ARCHIVE_SYNC_DB_NAME=ai_crypto_bot_archive
   ARCHIVE_SYNC_DB_USER=<dedicated-archive-writer>
   ARCHIVE_SYNC_DB_PASSWORD=<archive-writer-password>
   ARCHIVE_SYNC_DB_SSL_CA=
   ARCHIVE_SYNC_DB_SSL_SERVERNAME=
   ARCHIVE_SYNC_BATCH_SIZE=250
   ```

   Percent-encode reserved characters in the source URL credentials. Leave optional CA/server-name values empty only when system trust and certificate hostname validation succeed. Do not add URI query parameters or use a pooler URL.
3. From the deployed `archive-server` directory, verify Node.js is at least 20.6:

   ```sh
   node --version
   ```

4. Install the existing locked dependency if this is a fresh checkout:

   ```sh
   npm ci
   ```

5. Immediately before copying, rerun the read-only source and archive count checks. Stop unless they still report source 102 and archive 0.

## 7. Raspberry Pi: execute the seed once

From the `archive-server` directory on the Pi:

```sh
node --env-file=/etc/cryptopulse/archive-market-seed.env src/archive-market-seed.mjs
```

The utility reads the source in a repeatable-read, read-only transaction and copies all six explicit columns. It uses bounded UUID keyset batches (250 rows by default), checks conflicts, performs idempotent target upserts, validates each batch, and commits the archive transaction only after reconciliation. No source DML/DDL or row deletion is issued.

For the assumed 102 source rows and zero target rows, expect one batch and a successful JSON completion record with:

| Output | Expected |
|---|---:|
| `sourceRowCount` | 102 |
| `archiveRowCountBefore` | 0 |
| `archiveRowCountAfter` | 102 |
| `insertedRows` | 102 |
| `updatedRows` | 0 |
| `skippedRows` | 0 |
| `batchCount` | 1 |
| `sourceReadOnly` | `true` |

Any non-zero exit status, validation error, identity mismatch, count mismatch, privilege failure, or TLS failure is a failed run. Do not manually repair rows or rerun after an unexplained error; first inspect the safe error category and preserve both databases unchanged.

## 8. Validate the first copy

Run the same aggregate query on Supabase and on the archive, using the corresponding connection:

```sql
SELECT
  current_database() AS database_name,
  count(*) AS row_count,
  count(DISTINCT id) AS distinct_ids,
  count(DISTINCT symbol) AS distinct_symbols,
  min(created_at) AS earliest_created_at,
  max(created_at) AS latest_created_at,
  min(updated_at) AS earliest_updated_at,
  max(updated_at) AS latest_updated_at
FROM public."AI_Crypto_Bot_Watched_Markets";
```

Expected:

- Supabase source: 102 rows, 102 distinct IDs, 102 distinct symbols.
- Archive: database name `ai_crypto_bot_archive`, 102 rows, 102 distinct IDs, 102 distinct symbols.
- Source and archive timestamp bounds match.
- The utility reports `insertedRows + updatedRows + skippedRows = sourceRowCount`; it also validates all six source/target fields for every copied row.
- Supabase remains unchanged. The source reader's `BEGIN ... READ ONLY` transaction and lack of source table write privileges are required; do not treat a matching row count alone as proof of full-row equality.

## 9. Verify idempotency with one rerun

Run the exact same command again while source data is unchanged:

```sh
node --env-file=/etc/cryptopulse/archive-market-seed.env src/archive-market-seed.mjs
```

Expected: source 102, archive before/after 102, `insertedRows = 0`, `updatedRows = 0`, `skippedRows = 102`; the archive total remains 102. If any row updates, stop and investigate the source/target difference rather than treating the run as an unchanged replay.

## 10. Close out the temporary access

After both runs and validations pass:

- [ ] Record the two non-secret completion JSON summaries and validation results in the approved operations log.
- [ ] Remove or revoke the temporary Pi source credential and environment-file access if no additional authorized use is planned.
- [ ] In Supabase, disconnect the reader and clean up its policy/grants/role only if no approved follow-up copy requires them. Use the approved administrative process; do not use `CASCADE`. Verify cleanup afterward.
- [ ] Keep the archive writer separate from the health account; revoke it too if it was created solely for this one-time POC and no further archive writes are approved.
- [ ] Leave all Supabase rows and all archive rows intact. This procedure authorizes no deletion or production retention change.

## References

- [Market seed execution guide](./MARKET_SEED_EXECUTION_GUIDE.md)
- [Archive market seed implementation](./ARCHIVE_MARKET_SEED_IMPLEMENTATION.md)
- [Archive credential implementation](./ARCHIVE_CREDENTIAL_IMPLEMENTATION.md)
- [V2 role review](./ARCHIVE_MARKET_READER_ROLE_V2_REVIEW.md)
- [Archive schema](../../AI_CRYPTO_BOT_ARCHIVE_SCHEMA.sql)
- [Seed utility](../../archive-server/src/archive-market-seed.mjs)
- [Database documentation](../DATABASE.md)
