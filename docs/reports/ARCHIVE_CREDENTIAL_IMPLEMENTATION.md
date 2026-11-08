# Archive Credential Implementation

**Assessment date:** 2026-11-07  
**Status:** Credential design and run instructions only. No credentials were read or created, no SQL was executed, and no database, code, configuration, or deployment was changed.

## Decision

Use a **direct PostgreSQL connection from the Raspberry Pi with a dedicated, temporary, non-privileged read-only login role** for the watched-market seed proof of concept. Do not use the bot's `SUPABASE_SERVICE_ROLE_KEY`, the anon key, a user JWT, or the database `postgres` administrator password.

The service-role key is **not technically required**. The bot uses it server-side for privileged Data API/PostgREST operations, while [`archive-market-seed.mjs`](../../archive-server/src/archive-market-seed.mjs) uses the `pg` driver to connect directly to PostgreSQL. An API key is not a PostgreSQL login/password, and the seed utility does not implement a REST API source reader. The utility also rejects a source role that is a superuser, bypasses RLS, can create databases/roles, or can write to the source table.

An authenticated JWT is not a drop-in alternative: it is intended for Supabase's Data API, not this direct `pg` connection. The existing `authenticated` role's RLS policy allows reads beyond this one-table seed scope. The anon key alone cannot read this application table.

**Readiness:** the access method is clear, but manual execution is not yet ready. A restricted source login/RLS policy must be provisioned and verified, direct PostgreSQL network reachability from the Pi must be confirmed, and the archive writer/schema prerequisites must be verified. No live credentials, Pi settings, or database state were inspected for this report.

## A. Fastest safe proof-of-concept path

### 1. Provision a temporary source reader

Create a dedicated login, for example `cryptopulse_archive_market_reader`, with a strong generated password. Keep the role separate from `authenticated`, `service_role`, `postgres`, and all archive-server accounts.

The role's effective permissions must be limited to:

- Connect to the Supabase database `postgres`.
- Use the `public` schema.
- `SELECT` all columns and all rows from `public."AI_Crypto_Bot_Watched_Markets"` only.
- No `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, DDL, role/database administration, replication, superuser, `BYPASSRLS`, or inherited membership in broader roles.

The source migration enables RLS on watched markets and currently has an all-row `SELECT` policy for `authenticated`, not for this custom role. A table grant alone will not make rows visible to the custom login. Provision a separate `SELECT` policy for this reader on the watched-market table, with complete row visibility, and no policy or grants on other application tables.

Creating the role, grants, or policy is a **database security change**. Under project rules it requires separate approval, a reviewed migration/documentation update, and verification. Do not apply it as part of this report or embed the role password in a migration, repository file, command, or log. Set the password through the approved secret-safe administrative process. Revoke/drop this temporary role after the POC if it will not be retained.

### 2. Check the Pi network path before installing credentials

The utility accepts only Supabase's direct database hostname and rejects pooler URLs. Supabase documents direct connections on IPv6 by default; direct IPv4 requires the project's IPv4 add-on. The shared session pooler is an IPv4 alternative, but its hostname and username format are rejected by the current utility.

Therefore:

1. Confirm the Pi can reach the project's direct endpoint over IPv6, **or** that the project has direct IPv4 connectivity enabled.
2. If the Pi is IPv4-only and direct IPv4 is unavailable, stop. Do not substitute a pooler URI or alter the connection string to bypass the guard. Supporting a pooler requires a separately approved utility change and validation.
3. Use the exact host supplied by Supabase's Dashboard **Connect** panel; do not connect by IP address or disable TLS verification.

No Pi network test was performed.

### 3. Use this direct PostgreSQL URI format

```text
postgresql://cryptopulse_archive_market_reader:<URL-ENCODED-PASSWORD>@db.<project-ref>.supabase.co:5432/postgres
```

Replace the example role with the actual dedicated login, and `<project-ref>` with the verified reference from the intended Supabase project's Connect panel. Percent-encode reserved characters in the username/password (especially `@`, `:`, `/`, `?`, `#`, `%`, and spaces). The utility requires:

- `postgresql:` or `postgres:` URI scheme.
- Host exactly `db.<project-ref>.supabase.co`.
- Database path `/postgres`.
- URL username equal to `SUPABASE_ARCHIVE_READONLY_ROLE`.
- A password and no URI query string or fragment.

Do not append `sslmode` or other query parameters. The utility configures TLS itself with certificate verification enabled (`rejectUnauthorized: true`); provide a trusted CA file only if required. The exact direct format is documented by [Supabase's database connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres).

### 4. Store the Pi environment

Place the values in a protected environment file outside the repository. Use a dedicated operator/service account and restrictive ownership/permissions (for example, owner-only read access). Never copy the Supabase service-role key or archive health credentials into this file.

Required source variables:

| Variable | Value |
|---|---|
| `SUPABASE_ARCHIVE_READONLY_URL` | Direct PostgreSQL URI above |
| `SUPABASE_ARCHIVE_EXPECTED_PROJECT_REF` | Verified Supabase project reference |
| `SUPABASE_ARCHIVE_READONLY_ROLE` | Exact custom login name in the URI |
| `SUPABASE_ARCHIVE_MARKET_READ_SCOPE_CONFIRMED` | `true`, only after an administrator independently confirms the role grants, RLS policy, and full row visibility |

Optional source TLS settings:

| Variable | Use |
|---|---|
| `SUPABASE_ARCHIVE_SSL_CA` | Trusted CA certificate path, if needed |
| `SUPABASE_ARCHIVE_SSL_SERVERNAME` | Certificate DNS name only if it differs from the direct endpoint hostname |

Required archive-target variables:

| Variable | Value |
|---|---|
| `ARCHIVE_SYNC_DB_HOST` | Verified archive PostgreSQL host |
| `ARCHIVE_SYNC_DB_PORT` | Archive port; defaults to `5432` |
| `ARCHIVE_SYNC_DB_NAME` | Must be `ai_crypto_bot_archive` |
| `ARCHIVE_SYNC_DB_USER` | Separate non-owner archive writer |
| `ARCHIVE_SYNC_DB_PASSWORD` | Archive writer password |

Optional archive-target settings:

| Variable | Use |
|---|---|
| `ARCHIVE_SYNC_DB_SSL_CA` | Trusted archive CA certificate path, if needed |
| `ARCHIVE_SYNC_DB_SSL_SERVERNAME` | Archive certificate DNS name only if it differs from the configured host |
| `ARCHIVE_SYNC_BATCH_SIZE` | `1`–`500`; default `250` |

The target writer is distinct from the health-check `ARCHIVE_DB_*` account. The utility requires a non-owner, non-superuser target role with `SELECT`, `INSERT`, and `UPDATE` on the watched-market table and without delete, truncate, trigger, DDL, or role-administration privileges. TLS certificate verification is enabled for both connections.

The runtime flag `SUPABASE_ARCHIVE_MARKET_READ_SCOPE_CONFIRMED=true` is an **operator attestation**, not an access-control mechanism or proof of completeness. The utility checks database/role identity, read-only transaction state, and effective grants, but does not independently prove that RLS exposed every source row. Compare a trusted administrator's source row count/ID set with what the reader can see before setting the flag.

### 5. Verify and run manually

Before invoking the copy:

1. Confirm the role's RLS policy and table-only grants using an authorized database owner.
2. Through the read-only reader identity, confirm `current_database() = 'postgres'`, the expected role name, and the expected watched-market count. Compare the count with an independently obtained trusted count so RLS-filtered partial results cannot pass as complete.
3. Confirm the target database is `ai_crypto_bot_archive`, the schema and constraints are correct, the writer has only the required permissions, and a recoverable backup exists.
4. Confirm the archive's market-row state and review any ID/symbol conflicts. The utility retains archive-only rows and fails closed on identity conflicts.
5. Install the existing `archive-server` dependencies if needed; Node.js 20.6 or newer is required. `pg` is already declared in the archive-server package.

From the `archive-server` directory on the Pi:

```sh
node --env-file=/etc/cryptopulse/archive-market-seed.env src/archive-market-seed.mjs
```

The command copies **only** `AI_Crypto_Bot_Watched_Markets`; it does not copy AI decisions. It uses explicit columns and ID-based upserts, keeps the Supabase transaction read-only, and never deletes rows. On success, check:

- `insertedRows + updatedRows + skippedRows === sourceRowCount`.
- `archiveRowCountAfter === archiveRowCountBefore + insertedRows`.
- The source count matches the independently verified count.
- A second unchanged run reports zero inserts and updates, with every source row skipped.

Follow the [market seed execution guide](./MARKET_SEED_EXECUTION_GUIDE.md) for the full execution and recovery procedure. No command was run for this assessment.

## B. Recommended production path

For ongoing archival, provision a dedicated, long-lived source identity through the reviewed database access-control process. Keep its grants and RLS policies restricted to the explicitly approved archive tables; do not make it a member of `authenticated` or use `service_role`. Add access to further tables only as their archival scope is approved and the synchronization implementation is ready. Rotate/revoke credentials through an owned operational process, store them only in the Pi's secret store/environment, and retain verified TLS and single-purpose archive-writer credentials.

Keep the archive agent manual until copy completeness, recovery, backup/restore, and operational ownership have been verified. This integration must remain independent of Vercel, AI analysis, paper trading, and trading risk controls.

## C. Explicit blockers and non-actions

| Item | Status |
|---|---|
| Is `SUPABASE_SERVICE_ROLE_KEY` required? | **No.** It is a Data API/server credential and is not the direct PostgreSQL credential used by this CLI. Do not place it on the Pi. |
| Can an existing bot JWT/anon key be used by this CLI? | **No.** The CLI uses `pg` direct database authentication, not Supabase REST. |
| Can the existing `postgres` database password be used? | **No.** It is an administrator credential, violates least privilege, and the CLI rejects superuser/`BYPASSRLS` roles. |
| Can a temporary POC credential be used? | **Yes**, after approval/provisioning of a dedicated temporary login, narrow grants, and an RLS policy for watched markets. |
| Does the current utility support Supabase pooler URLs? | **No.** It explicitly rejects pooler hostnames and URL query strings. |
| Are source credentials or Pi networking confirmed? | **No.** Local/remote secret stores and Pi connectivity were not inspected here. |
| Were any DB or application changes made? | **No.** |

The previously reported source count of 102 watched markets and archive count of 0 are historical/user-provided context, not measurements from this task. Recheck both before execution.

## References

- [Archive market seed utility](../../archive-server/src/archive-market-seed.mjs)
- [Market seed execution guide](./MARKET_SEED_EXECUTION_GUIDE.md)
- [Archive POC simplification assessment](./ARCHIVE_POC_SIMPLIFICATION_REPORT.md)
- [Archive sync architecture](./ARCHIVE_SYNC_ARCHITECTURE.md)
- [Database documentation](../DATABASE.md)
- [Deployment guide](../DEPLOYMENT.md)
- [Source schema and RLS migration](../../supabase/migrations/20261031190000_create_agent_tables.sql)
- Supabase: [Connect to your database](https://supabase.com/docs/guides/database/connecting-to-postgres)
- Supabase: [Postgres roles](https://supabase.com/docs/guides/database/postgres/roles)
- Supabase: [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
