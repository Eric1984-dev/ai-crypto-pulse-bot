# Archive Market Seed Execution Guide

## Purpose and safety boundary

This manual utility copies all rows from Supabase `public."AI_Crypto_Bot_Watched_Markets"` to the same table in the Raspberry Pi database `ai_crypto_bot_archive`. It explicitly transfers `id`, `symbol`, `enabled`, `priority`, `created_at`, and `updated_at`.

The source transaction is read-only. The target transaction is atomic and uses ID-based idempotent upserts. The utility never deletes rows from either database, never changes Supabase, and does not invoke AI analysis, paper trading, or any scheduler. It is not a continuous synchronization service. Do not run it until the source role, target writer, production project identity, target database/schema, and backup readiness have been independently confirmed.

The archive target's current contents, credentials, and deployment state have not been independently verified by this implementation. The user-provided context that the target contains zero rows is not treated as a measured result.

## Files and requirements

- Utility: [`archive-market-seed.mjs`](../../archive-server/src/archive-market-seed.mjs)
- Automated tests: [`archive-market-seed.test.mjs`](../../tests/archive-market-seed.test.mjs)
- Node.js: 20.6 or newer
- Existing dependency: `pg` in `archive-server/package.json`
- PostgreSQL: direct TLS-verified Supabase connection and TLS-verified PostgreSQL 17 archive server

No dependency or `/api` route is added. Keep this CLI separate from the health service and its read-only `ARCHIVE_DB_*` account.

## Access prerequisites

### Supabase source role

Use a dedicated PostgreSQL login for this utility, not `SUPABASE_SERVICE_ROLE_KEY`, the Supabase anon key, a general authenticated account, or an archive health account. It must:

- Connect only to the independently verified Supabase project.
- Have `SELECT` on `public."AI_Crypto_Bot_Watched_Markets"` and no source write, DDL, role-administration, superuser, or `BYPASSRLS` privileges.
- Be covered by an approved RLS policy that exposes **all** watched-market rows needed for the copy, including disabled markets. RLS-filtered reads could otherwise appear successful while omitting source rows.
- Use verified TLS. Never disable certificate validation.

The CLI checks its connected project host/reference, database, role name, read-only transaction, and effective table/schema privileges. Set `SUPABASE_ARCHIVE_MARKET_READ_SCOPE_CONFIRMED=true` only after a database owner has independently confirmed the exact role grants and full-row RLS visibility. This flag is an operator attestation, not a substitute for inspecting the source policy. Creating or changing a Supabase role, grant, or RLS policy needs separate approval and is not performed by this utility.

### Archive target writer

Use a dedicated non-owner, non-superuser archive writer. It needs `USAGE` on `public`, plus `SELECT`, `INSERT`, and `UPDATE` on the watched-market table. It must not have `DELETE`, `TRUNCATE`, `TRIGGER`, schema-create, superuser, or role-administration privileges. Keep the existing read-only health-check account unchanged.

The CLI verifies that the target database is exactly `ai_crypto_bot_archive`, checks the table's six-column/type contract, primary key on `id`, unique constraint on `symbol`, and absence of non-internal triggers. It stops before writing if those assumptions do not hold.

## Environment variables

Provide these settings through a root-owned environment file outside the repository, for example `/etc/cryptopulse/archive-market-seed.env`, with restrictive permissions (such as `0600`). Keep these credentials separate from the health service's environment file. Do not add them to `.env.example`, Vercel, source control, shell command arguments, or logs.

| Variable | Required | Notes |
|---|---:|---|
| `SUPABASE_ARCHIVE_READONLY_URL` | Yes | Direct PostgreSQL URL using the dedicated source reader. The CLI accepts `db.<project-ref>.supabase.co:5432/postgres` form so the expected project can be checked; pooler endpoints are deliberately rejected by this initial utility. |
| `SUPABASE_ARCHIVE_EXPECTED_PROJECT_REF` | Yes | Project reference independently confirmed by the operator; must match the source URL hostname. |
| `SUPABASE_ARCHIVE_READONLY_ROLE` | Yes | Must match the PostgreSQL role in the connection URL and the role returned by the source server. |
| `SUPABASE_ARCHIVE_MARKET_READ_SCOPE_CONFIRMED` | Yes | Must be `true`; set only after confirming complete row visibility and least-privilege grants as described above. |
| `SUPABASE_ARCHIVE_SSL_CA` | No | Path to trusted CA certificate if the system trust store is insufficient. |
| `SUPABASE_ARCHIVE_SSL_SERVERNAME` | No | Certificate DNS name when it differs from the direct connection host. |
| `ARCHIVE_SYNC_DB_HOST` | Yes | Archive PostgreSQL host, normally the Pi's local/LAN host. |
| `ARCHIVE_SYNC_DB_PORT` | No | Defaults to `5432`. |
| `ARCHIVE_SYNC_DB_NAME` | Yes | Must equal `ai_crypto_bot_archive`; any other value is rejected. |
| `ARCHIVE_SYNC_DB_USER` | Yes | Dedicated archive writer role. |
| `ARCHIVE_SYNC_DB_PASSWORD` | Yes | Archive writer password. |
| `ARCHIVE_SYNC_DB_SSL_CA` | No | Trusted CA certificate path for the archive server. |
| `ARCHIVE_SYNC_DB_SSL_SERVERNAME` | No | Certificate DNS name when it differs from the configured host. |
| `ARCHIVE_SYNC_BATCH_SIZE` | No | Defaults to `250`; accepted range is `1`–`500`. |

Example variable names only (do not put example credentials into a real file):

```text
SUPABASE_ARCHIVE_READONLY_URL=postgresql://<reader>:<password>@db.<project-ref>.supabase.co:5432/postgres
SUPABASE_ARCHIVE_EXPECTED_PROJECT_REF=<verified-project-ref>
SUPABASE_ARCHIVE_READONLY_ROLE=<dedicated-reader-role>
SUPABASE_ARCHIVE_MARKET_READ_SCOPE_CONFIRMED=true
ARCHIVE_SYNC_DB_HOST=<archive-host>
ARCHIVE_SYNC_DB_PORT=5432
ARCHIVE_SYNC_DB_NAME=ai_crypto_bot_archive
ARCHIVE_SYNC_DB_USER=<dedicated-writer-role>
ARCHIVE_SYNC_DB_PASSWORD=<secret>
ARCHIVE_SYNC_BATCH_SIZE=250
```

## Run procedure

1. Confirm a current, recoverable archive backup exists and that the source project reference and target database are correct. Verify the target table is the deployed archive schema, not a production database.
2. Confirm source policy visibility includes every row, and target privileges are limited to the required table operations. The CLI makes the source transaction read-only and rechecks effective privileges at runtime.
3. Install dependencies from the existing package lock if needed. Do not copy secrets into the repository.
4. On the Pi, from the `archive-server` directory, run:

   ```sh
   node --env-file=/etc/cryptopulse/archive-market-seed.env src/archive-market-seed.mjs
   ```

5. Capture the single JSON completion record from standard output in the approved operations log. It contains identities, counts, batch totals, and no credentials or copied row payloads.

Do **not** run this against production until separately authorized. This implementation was not executed against any database as part of its generation.

## Processing and duplicate behavior

- Supabase is read in a repeatable-read, read-only transaction, ordered by UUID ID and paged with a bounded keyset batch.
- The archive is handled in one transaction that locks the table before inspecting it, preventing concurrent market-seed writers from invalidating the preflight.
- Each source row is validated. The target is checked by both ID and symbol before its batch is written.
- A same-ID/different-symbol or same-symbol/different-ID conflict stops the run before that batch is upserted; the surrounding archive transaction rolls back all batches.
- Rows absent in the target are inserted. Existing rows with the same ID/symbol but differing values are updated from the source. Fully identical rows are skipped without rewriting.
- The target upsert uses an explicit six-column list, `ON CONFLICT (id)`, and `IS DISTINCT FROM` checks. It does not update IDs or delete archive-only rows.
- Both transactions commit only after the selected source row count, counter arithmetic, archive count delta, and full-field batch comparisons pass. A failure rolls back the archive transaction. If a connection is lost around commit, rerun safely; the ID upsert and unchanged-row predicate make it idempotent.

## Output and acceptance checks

On success the utility prints one JSON record with:

- `sourceRowCount`
- `archiveRowCountBefore` and `archiveRowCountAfter`
- `insertedRows`, `updatedRows`, and `skippedRows`
- `batchCount`, source project reference, target database, and `sourceReadOnly`

Acceptance criteria:

1. `insertedRows + updatedRows + skippedRows === sourceRowCount`.
2. `archiveRowCountAfter === archiveRowCountBefore + insertedRows`; no archive-only rows are removed.
3. The tool completes its per-batch full-field comparison for all six columns, including exact PostgreSQL timestamp values.
4. The exit code is `0`; otherwise the output is a safe error category and non-zero status.
5. A second run without source changes reports zero inserted, zero updated, and all source rows skipped. Archive total row count remains unchanged.
6. The read-only source role remains unchanged; no source DML or DDL is issued by the CLI.

The utility does not itself produce a source-side audit trail, independent checksum manifest, or proof that the RLS policy made every source row visible. The role and policy review are prerequisites. For a first production copy, separately record source/target identities and have the database owner verify the complete source count in a suitably authorized read-only review.

## Recovery and rollback

- **Preflight/schema/credential failure:** no row writes are committed. Fix the verified prerequisite and rerun.
- **ID/symbol conflict or row validation failure:** the entire archive transaction is rolled back. Review the conflicting identity; do not overwrite or delete archive rows to force success.
- **Failure before archive commit:** the archive transaction rolls back; rerun when the issue is resolved.
- **Failure after archive commit but before the success message:** rerun. Existing rows are compared and skipped or safely updated; no duplicate IDs are created.
- **Unexpected committed values:** stop additional runs, retain the Supabase source unchanged, take a fresh archive backup, investigate, and restore/correct only under a separately approved recovery procedure.
- **Rollback preference:** because this is additive copying, normally stop the utility and leave the copied archive rows intact. Do not delete archive rows as an informal rollback.

## Verification performed for this implementation

Unit tests validate configuration guards, row validation, insert/update/skip classification, conflict rejection, explicit upsert columns, timestamp preservation, and TLS verification without opening database connections. The CLI itself was not run and no database or SQL command was executed as part of this implementation.
