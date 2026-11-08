# Market Export/Import POC

## Purpose and scope

This is a one-time manual CSV copy of all rows in Supabase `public."AI_Crypto_Bot_Watched_Markets"` to the existing table in `ai_crypto_bot_archive`.

The source export is read-only. The target import writes rows to the archive, but creates no database objects. The generated scripts do not create PostgreSQL roles, change grants, alter RLS, or create credentials. They do not delete or update any source or target rows. This task generated scripts and instructions only; **no SQL was executed and no database was queried or changed**.

The expected source is 102 rows and the archive table is empty. The scripts stop if these expected conditions do not hold.

## Files

- [`market_export.sql`](../../market_export.sql) — psql client script that exports the six explicit columns to a local CSV.
- [`market_import.sql`](../../market_import.sql) — psql client script that checks the target, imports the CSV in one transaction, verifies row counts, then exports a target verification CSV.

Both scripts use psql meta-command `\copy`. Run them with the `psql` command-line client, not the Supabase Dashboard SQL Editor. `\copy` reads/writes files on the machine running `psql`, not on the database server.

## Fields and fidelity

The scripts preserve the explicit ordered field list:

1. `id`
2. `symbol`
3. `enabled`
4. `priority`
5. `created_at`
6. `updated_at`

Both export queries set the session time zone to UTC and serialize timestamps as text. The CSV includes the timezone offset and PostgreSQL's available fractional-second precision; importing into `timestamptz` preserves the same timestamp instants. UUIDs are exported as text and parsed back into UUID values. Booleans, integers, symbols, and both timestamps are transferred as all six typed values. The scripts do not regenerate IDs or rely on target defaults.

## Preconditions — no new roles or credentials

- Use only already-authorized Supabase and archive PostgreSQL connection profiles/credentials. This POC does not provision roles or credentials.
- The source connection must already be able to read every row of the watched-market table. The archive import connection must already have permission to insert into the target table. The documented `cryptopulse_archive` alias may be read-only; verify its effective permission first. If no existing authorized write-capable archive connection is available, stop rather than creating a role or credential.
- Do not use the archive health-check account unless it already has the required `INSERT` privilege; its documented purpose is read-only health inspection.
- Verify the existing service profiles point to the intended Supabase project and `ai_crypto_bot_archive`. The database name alone does not identify a Supabase project.
- Confirm both database connections use the existing TLS-verified settings.
- Use an empty, access-controlled working directory. `market_export.csv` and `market_archive_validation.csv` are written there and an existing file with either name may be overwritten.
- Confirm `market_export.csv` has the expected CSV header before importing:

  ```text
  id,symbol,enabled,priority,created_at,updated_at
  ```

- Do not edit the CSV between export and import.

## Execution sequence

### 1. Export from Supabase

From the empty working directory that contains or can reference `market_export.sql`, run using the existing source service profile:

```powershell
psql -X -v ON_ERROR_STOP=1 "service=cryptopulse_source" -f .\market_export.sql
```

The existing `cryptopulse_source` alias is the one referenced by [`archive_market_anchor_precheck.sql`](../../archive_market_anchor_precheck.sql). Do not create a new role or put a password into the command. If the existing profile has a different name, use that existing profile name.

The script opens a repeatable-read, read-only transaction; verifies the database is `postgres` and the table has exactly 102 rows; prints the source count and timestamp range; and writes `market_export.csv` on the psql client machine. Expected psql output is `COPY 102`.

If export and import run on different machines, transfer the CSV using an already approved secure file-transfer method. Recheck that the transferred file has not changed, for example by comparing SHA-256 hashes. Do not create a new database credential for file transfer.

### 2. Verify the archive connection before import

Use the existing authorized archive connection to run this read-only check:

```sql
SELECT
  current_database() AS database_name,
  current_user AS role_name,
  pg_catalog.has_table_privilege(
    current_user,
    'public."AI_Crypto_Bot_Watched_Markets"',
    'INSERT'
  ) AS can_insert;
```

Expected: `database_name = ai_crypto_bot_archive`, and `can_insert = true`. Also confirm the target watched-market row count is zero. If either check fails, stop. The import script itself independently checks the database name, empty target, six-column type contract, primary key, unique symbol constraint, and absence of non-internal triggers.

### 3. Import into the archive

Run on the same client machine/directory as the CSV, using an already-authorized archive connection with `INSERT` privilege:

```powershell
psql -X -v ON_ERROR_STOP=1 "service=cryptopulse_archive" -f .\market_import.sql
```

If `cryptopulse_archive` is the documented read-only precheck profile, do not use it for this step. Substitute only an **already-existing** write-capable archive service profile; if none exists, the import cannot proceed under the no-new-credentials requirement.

The script:

1. Begins a target transaction and enforces the expected target database and table contract.
2. Stops before importing if the table is not empty.
3. Imports the CSV using explicit column names; it does not create roles, tables, temporary tables, or policies.
4. Requires exactly 102 rows, 102 distinct IDs, and 102 distinct symbols before committing. A failure during import/validation aborts the transaction.
5. Exports the committed target rows to `market_archive_validation.csv` using the same ordered columns and UTC timestamp formatting.

Expected import output is `COPY 102`, followed by the archive summary with 102 rows.

### 4. Validate value-for-value equality

Compare the two CSV files byte-for-byte or by SHA-256 hash. Since both are emitted by psql with the same explicit column order and UTC formatting, the files should match exactly:

```powershell
Get-FileHash .\market_export.csv, .\market_archive_validation.csv -Algorithm SHA256
```

Expected: identical hashes. If they differ, do not repeat the import (the target is no longer empty). Preserve both files and inspect the row differences before taking any further action.

As an independent count check, run this query separately on source and archive:

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

Expected source results: `postgres`, 102 rows, 102 distinct IDs, and 102 distinct symbols. Expected archive results: `ai_crypto_bot_archive`, with the same counts and timestamp bounds. Exact CSV equality verifies all six fields; the counts alone do not.

## Safety and failure handling

- `market_export.sql` can only read the source table and writes a CSV file on the client.
- `market_import.sql` writes only to the existing archive watched-market table. It contains no `CREATE ROLE`, `GRANT`, `ALTER POLICY`, `CREATE POLICY`, `DROP`, `DELETE`, or `UPDATE` statements.
- The import script requires an empty target to avoid duplicates and ambiguous conflict handling. Do not remove archive rows to make the precondition pass.
- `ON_ERROR_STOP` causes psql to stop on SQL errors. Import occurs inside a transaction, so an error before `COMMIT` rolls back that import.
- If target data is committed but file/hash validation later fails, stop. Keep the source unchanged and preserve both CSVs for diagnosis; do not try a second import or delete target rows.
- This is a one-time operation. Do not schedule it, add it to the health service, or connect it to Vercel, AI analysis, or paper trading.

## References

- [Market seed implementation and field contract](./ARCHIVE_MARKET_SEED_IMPLEMENTATION.md)
- [Market seed execution guide](./MARKET_SEED_EXECUTION_GUIDE.md)
- [Archive schema validation](./AI_CRYPTO_BOT_ARCHIVE_SCHEMA_VALIDATION.md)
- [Archive market-anchor precheck](../../archive_market_anchor_precheck.sql)
- [Archive schema](../../AI_CRYPTO_BOT_ARCHIVE_SCHEMA.sql)
- [Database documentation](../DATABASE.md)
