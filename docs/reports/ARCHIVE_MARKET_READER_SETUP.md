# Archive Market Reader Setup

**Purpose:** Provision the temporary Supabase PostgreSQL reader required by `archive-market-seed.mjs`.  
**Mode:** Instructions and SQL artifact only. The SQL was not executed, and no database, role, policy, credential, or environment was changed.

## Scope and compatibility

[`ARCHIVE_MARKET_READER_ROLE_V2.sql`](../../ARCHIVE_MARKET_READER_ROLE_V2.sql) is the reviewed role setup artifact for the non-login role `cryptopulse_archive_market_reader`; it grants only database `CONNECT`, `public` schema `USAGE`, and table `SELECT` on `public."AI_Crypto_Bot_Watched_Markets"`, then adds the matching all-row `SELECT` RLS policy. It rejects existing role/policy collisions rather than silently accepting an unknown state. The superseded V1 role script and standalone RLS migration draft have been removed; V2 is the retained setup artifact.

The script is designed for the existing [`archive-market-seed.mjs`](../../archive-server/src/archive-market-seed.mjs). That utility checks for the exact Supabase project host, database `postgres`, role identity, a read-only transaction, `USAGE` without `CREATE` on `public`, table `SELECT` without write privileges, and a role that is not superuser or `BYPASSRLS`. The V2 SQL validates the Supabase-managed membership edge described in the [V2 review](./ARCHIVE_MARKET_READER_ROLE_V2_REVIEW.md), rejects any other membership involving the reader, and checks privileges on other public relations/schemas and the expected RLS configuration.

This credential is for copying watched-market rows only. It grants no access to AI decisions, candles, trades, or other application tables. The seed utility does not copy AI decisions.

## Required authorization

Creating a PostgreSQL role, grants, or RLS policy changes Supabase security metadata. Under the project database rules, treat this as a reviewed database change: obtain approval, review the SQL, record the change, and verify its resulting grants/policy. Do not execute it as part of this task. The supplied SQL has no `IF NOT EXISTS`; if a role or policy with the specified name already exists, stop and inspect the collision before deciding how to proceed.

Run the SQL as the Supabase database owner (normally `postgres`) in the verified project and specifically in database `postgres`. Do not run it against the Raspberry Pi archive database.

## Provisioning sequence

1. **Verify the destination project.** In the intended Supabase Dashboard, confirm the project reference and the Connect-panel endpoint. The setup SQL itself checks `current_database() = 'postgres'`, but does not identify which Supabase project is open.
2. **Inspect current role/schema grants and RLS.** Confirm the role and policy names are unused, RLS is enabled on `AI_Crypto_Bot_Watched_Markets`, and no unexpected global grants would give this role broader access. The SQL's validation block aborts the transaction if its least-privilege checks fail; do not “fix” a failure by granting broad privileges or revoking privileges from `PUBLIC` or other roles.
3. **Review and execute `ARCHIVE_MARKET_READER_ROLE_V2.sql`** in the Supabase SQL Editor or another approved administrative connection. It creates the role with `NOLOGIN`, so no password is present in the SQL artifact and the role cannot yet authenticate.
4. **Set the role password out of band.** From a trusted administrator `psql` session connected to the same Supabase project, use:

   ```text
   \password cryptopulse_archive_market_reader
   ```

   Enter a generated high-entropy password at the prompts. Do not put the password in SQL, shell arguments, editor history, this repository, or logs. Then enable login for the role in the same administrative session:

   ```sql
   ALTER ROLE cryptopulse_archive_market_reader LOGIN;
   ```

   Use verified TLS for the administrator connection. If the project or Pi network cannot reach the direct endpoint, stop and resolve the documented IPv6/direct-connection limitation; do not substitute a pooler URL, which the current utility rejects.
5. **Validate with the reader identity.** Before running the seed utility, connect as the new reader over verified TLS and confirm its identity, transaction read-only state, table privileges, and visible row count. Compare the reader-visible count with an independent trusted owner count. The SQL policy uses `USING (true)` so every watched-market row, including disabled rows, is visible.
6. **Store credentials on the Pi only.** Use the exact source URL and environment variables in the next section. Keep the Supabase credential separate from the archive writer and health-check account.
7. **Run the seed only when separately authorized.** Complete the target schema, archive writer, backup, and source row-count checks in the [market seed execution guide](./MARKET_SEED_EXECUTION_GUIDE.md), then run the utility manually.
8. **Remove the temporary role after the POC** unless an owner explicitly approves retaining it for a defined archive operation. Use the cleanup SQL below after the utility has disconnected.

The SQL file creates the role in a disabled-login state. If secure password setup or role activation cannot be completed, leave it `NOLOGIN` and do not put it in the Pi environment.

## Reader validation queries

Run these checks while connected as `cryptopulse_archive_market_reader`. They are validation queries only; they were not run for this deliverable.

```sql
SELECT
  current_database() AS database_name,
  current_user AS role_name,
  current_setting('transaction_read_only') AS transaction_read_only;
```

Expected: `database_name = postgres`, `role_name = cryptopulse_archive_market_reader`, and `transaction_read_only = on` when checked inside a read-only transaction.

```sql
BEGIN READ ONLY;

SELECT
  count(*) AS visible_rows,
  count(DISTINCT id) AS distinct_ids,
  count(DISTINCT symbol) AS distinct_symbols
FROM public."AI_Crypto_Bot_Watched_Markets";

ROLLBACK;
```

The three counts should match the independently verified owner count; the task context reports 102 source rows, but that count was not re-measured here. A count match is a useful visibility check, not a row-by-row content comparison.

The CLI independently verifies privileges during its run. A policy or grant mismatch, unexpected broader privilege, wrong source project/role/database, non-verified TLS, or incomplete RLS visibility must stop the run.

## Pi source connection and environment

The utility accepts only a direct URI in this form:

```text
postgresql://cryptopulse_archive_market_reader:<URL-ENCODED-PASSWORD>@db.<project-ref>.supabase.co:5432/postgres
```

Replace `<project-ref>` with the verified project reference and percent-encode reserved characters in the password. Do not add URI query parameters such as `sslmode`; the utility configures certificate-verified TLS itself. The direct endpoint generally requires IPv6; direct IPv4 availability must be confirmed for the project. The existing utility rejects shared-pooler hosts/usernames.

Set these required source variables in the Pi-only environment file:

```text
SUPABASE_ARCHIVE_READONLY_URL=<direct-postgresql-uri>
SUPABASE_ARCHIVE_EXPECTED_PROJECT_REF=<verified-project-ref>
SUPABASE_ARCHIVE_READONLY_ROLE=cryptopulse_archive_market_reader
SUPABASE_ARCHIVE_MARKET_READ_SCOPE_CONFIRMED=true
```

Set `SUPABASE_ARCHIVE_MARKET_READ_SCOPE_CONFIRMED=true` only after a database owner has verified the role's exact grants, policy, and full row visibility. It is an operator attestation, not a runtime proof of RLS completeness.

Optional source TLS settings:

```text
SUPABASE_ARCHIVE_SSL_CA=<trusted-ca-file-path>
SUPABASE_ARCHIVE_SSL_SERVERNAME=<certificate-dns-name-if-needed>
```

The target writer remains separate and uses:

```text
ARCHIVE_SYNC_DB_HOST=<archive-host>
ARCHIVE_SYNC_DB_PORT=5432
ARCHIVE_SYNC_DB_NAME=ai_crypto_bot_archive
ARCHIVE_SYNC_DB_USER=<dedicated-archive-writer>
ARCHIVE_SYNC_DB_PASSWORD=<archive-writer-password>
```

Optional target settings are `ARCHIVE_SYNC_DB_SSL_CA`, `ARCHIVE_SYNC_DB_SSL_SERVERNAME`, and `ARCHIVE_SYNC_BATCH_SIZE` (1–500; default 250). Do not reuse the read-only health-check `ARCHIVE_DB_*` account as the archive writer.

Keep the environment file outside the repository with restrictive ownership and permissions. Do not add the source password to `.env.example`, Vercel, or any tracked file.

## Cleanup after the proof of concept

First stop the utility and close all sessions using the temporary role. Then, as the Supabase database owner, run this cleanup in the same verified Supabase `postgres` database:

```sql
BEGIN;

ALTER ROLE cryptopulse_archive_market_reader NOLOGIN;

DROP POLICY "AI_Crypto_Bot_Watched_Markets_archive_reader_select"
  ON public."AI_Crypto_Bot_Watched_Markets";

REVOKE ALL PRIVILEGES
  ON TABLE public."AI_Crypto_Bot_Watched_Markets"
  FROM cryptopulse_archive_market_reader;
REVOKE ALL PRIVILEGES ON SCHEMA public
  FROM cryptopulse_archive_market_reader;
REVOKE ALL PRIVILEGES ON DATABASE postgres
  FROM cryptopulse_archive_market_reader;

DROP ROLE cryptopulse_archive_market_reader;

COMMIT;
```

If cleanup reports a dependency or active-session error, stop and inspect it; do not use `CASCADE`. Confirm the role and policy are absent through a separately authorized read-only check, and remove the credential from the Pi secret file.

## References

- [Archive credential implementation](./ARCHIVE_CREDENTIAL_IMPLEMENTATION.md)
- [Market seed execution guide](./MARKET_SEED_EXECUTION_GUIDE.md)
- [Archive sync architecture](./ARCHIVE_SYNC_ARCHITECTURE.md)
- [Database documentation](../DATABASE.md)
- [Source schema/RLS migration](../../PostgreSQL/migrations/20261031190000_create_agent_tables.sql)
- Supabase: [Postgres roles](https://supabase.com/docs/guides/database/postgres/roles)
- Supabase: [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- Supabase: [Connecting to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres)
