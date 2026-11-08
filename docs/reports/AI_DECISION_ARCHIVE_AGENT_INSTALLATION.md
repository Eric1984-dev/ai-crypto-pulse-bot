# AI Decision Archive Agent Installation

**Current status:** The user reports that reader/writer readiness checks passed and the first manual `npm run sync:ai-decisions` run successfully copied data from Supabase to PostgreSQL on the Pi. Exact inserted/updated/skipped counts were not provided and have not been independently verified. The CLI remains Pi-side and is not a Vercel deployment.

## What this installs

The CLI in `archive-server/src/archive-ai-decisions.mjs` copies only `public."AI_Crypto_Bot_AI_Decisions"` from the approved Supabase project to `ai_crypto_bot_archive`.

- Supabase is accessed through a direct PostgreSQL connection using `AI_Crypto_Bot_Archive_Decision_Reader`.
- The archive is written with a separate, least-privilege PostgreSQL account.
- The CLI and standalone health service run on the Raspberry Pi. Vercel only proxies the health view through the existing authenticated dashboard API; it does not run the CLI.
- The agent does not expose a sync endpoint, add a Vercel Function, or run on a timer.
- The watched-market rows must already exist in the archive. The agent checks all symbols in the copy cohort and stops before writing if any are missing.
- No source rows are inserted, updated, or deleted. No archive rows are deleted.
- Installing the CLI does not create credentials, roles, RLS policies, grants, or database objects. The separate writer-role SQL below is an operator-reviewed database change and has not been applied.

Do not use `SUPABASE_SERVICE_ROLE_KEY`, an authenticated browser key, or the health-check database account for synchronization. The source role is separate from the Pi-local archive writer. Do not rerun or alter the completed Supabase reader setup as part of this Pi-local writer preparation.

## Prerequisites

1. Raspberry Pi OS with Node.js 20.6 or newer and npm.
2. The approved Pi-to-Supabase network path, using PostgreSQL TLS with certificate verification.
3. The dedicated direct Supabase role, after separate approval and provisioning:
   - can read all rows from `AI_Crypto_Bot_AI_Decisions` and may have `SELECT` on multiple `public.AI_Crypto_Bot_*` application relations;
   - has no effective `INSERT`, `UPDATE`, `DELETE`, or `TRUNCATE` access, owns no source relations, and has no access to non-prefixed application relations;
   - has no application-table writes, persistent schema/database creation, role administration, replication, superuser, or RLS-bypass privileges;
   - is not the table owner and has only Supabase's platform-managed membership edge: the reader is the granted role, `postgres` is its member, `supabase_admin` is the grantor, with `ADMIN=true`, `INHERIT=false`, and `SET=false`; and
   - has the additive decision-table `SELECT` RLS policy.
4. Acceptance of the documented Supabase `PUBLIC` residual for direct logins: temporary-object access on the `postgres` database and execution of granted large-object routines may remain available. These shared privileges are not revoked. `default_transaction_read_only=on` is a default only; the agent itself uses a read-only source transaction, but this is not an absolute restriction against a credential holder deliberately overriding the default.
5. A separate archive writer role prepared by [the Pi-local SQL script](../../archive-server/sql/prepare-archive-decision-writer.sql). It must have only database `CONNECT`, `public` schema `USAGE`, decision-table `SELECT`/`INSERT`/`UPDATE`, and watched-market `SELECT`; it must not be a superuser, owner, role member, or have grant options, delete, truncate, references, trigger, schema/database creation, or role-administration privileges. The user reports that writer readiness checks passed and the writer connection was used successfully by the first sync.
6. The archive schema deployed and the required market anchors present. Existing source and target access must be verified before an operational run.
7. Sufficient Raspberry Pi disk space for logs and the small checkpoint file; decision payloads are streamed in bounded batches.

The CLI performs identity, effective privilege-scope, RLS-policy, schema, TLS-configuration, target-trigger, and market-anchor preflights. It does not inspect `pg_auth_members`; verify the exact platform-managed membership edge using the migration postflight and the read-only query in the [validation guide](./AI_DECISION_ARCHIVE_AGENT_VALIDATION.md). A failed CLI preflight stops the run before decision rows are written.

## Prepare the Pi-local writer role

The script at `../../archive-server/sql/prepare-archive-decision-writer.sql` is a bootstrap procedure for the local PostgreSQL database on the Raspberry Pi only. It refuses to run outside `ai_crypto_bot_archive`, refuses an existing writer-role name rather than altering it, checks the agent's decision-table columns and key constraints, and fails closed unless the existing legacy account and required tables are present. The user reports that writer readiness has been completed on the current Pi; do not rerun this script against the existing role.

For a fresh, separately approved installation only, an authorized Pi-local database operator may apply it through an already configured protected PostgreSQL service/profile. Do not use the Vercel tunnel or the agent account for role creation. For example:

```sh
psql -X -v ON_ERROR_STOP=1 -d ai_crypto_bot_archive \
  -f /opt/cryptopulse/archive-server/sql/prepare-archive-decision-writer.sql
```

The script is a bootstrap-only procedure: it creates `AI_Crypto_Bot_Archive_Decision_Writer` as `NOLOGIN`, applies only the four listed grants, then verifies role attributes, zero memberships, effective schema/table/column/sequence access, no grant options, and unchanged relation ownership. It does not set a password, enable `LOGIN`, alter the existing `ai_crypto_bot_archive_user`, change table ownership, or modify table data. The user reports the role was subsequently configured and its connection passed the first sync; do not rerun the create-role script against the existing role.

The script contains a separate non-cascading rollback procedure. Review and approve it separately before use; it first refuses rollback if the writer has unexpected memberships or ownership. Never use `DROP OWNED`, `CASCADE`, owner transfers, or a broad role cleanup.

## Install on the Pi

Use the existing dedicated archive service account if one is already configured. Replace `cryptopulse-archive` below with its actual user and group; do not run the CLI as root. Keep the software, environment file, and checkpoint directory accessible only to that account.

```sh
sudo install -d -o cryptopulse-archive -g cryptopulse-archive -m 0750 /opt/cryptopulse
sudo install -d -o cryptopulse-archive -g cryptopulse-archive -m 0700 /var/lib/cryptopulse/archive-sync
```

Deploy the reviewed repository revision to `/opt/cryptopulse`, then install the isolated package dependencies:

```sh
cd /opt/cryptopulse/archive-server
npm ci --omit=dev
if [ ! -e .env ]; then install -m 0600 .env.example .env; fi
chmod 600 .env
```

Set the environment file owner to the account that will invoke the CLI. If `.env` already exists for the health service, preserve it and add only the required agent settings; do not overwrite it. Do not copy the repository's `.env` from a developer machine. Edit `.env` with a protected editor; do not put connection strings or passwords in shell commands, service arguments, or logs.

## Required environment

Set these values in `archive-server/.env`:

| Variable | Required value |
|---|---|
| `SUPABASE_ARCHIVE_READONLY_URL` | Direct URI: `postgresql://<encoded-role>:<encoded-password>@db.<project-ref>.supabase.co:5432/postgres`. URL-encode username/password characters. Do not add a service-role key or a query-string SSL override. |
| `SUPABASE_ARCHIVE_EXPECTED_PROJECT_REF` | The approved Supabase project reference; must match the URI host. |
| `SUPABASE_ARCHIVE_READONLY_ROLE` | The exact database role in the URI username. It must not be `service_role`. |
| `SUPABASE_ARCHIVE_DECISION_READ_SCOPE_CONFIRMED` | Set to `true` only after independently confirming the approved least-privilege role and RLS policy. Code also checks effective grants and the policy. |
| `SUPABASE_ARCHIVE_SSL_CA` | Optional path to the trusted CA certificate when it is not in the Pi system trust store. TLS certificate verification remains mandatory. |
| `SUPABASE_ARCHIVE_SSL_SERVERNAME` | Optional verified certificate DNS name only when it differs from the connection host. |
| `ARCHIVE_SYNC_DB_HOST` | Archive PostgreSQL host reachable from the Pi. |
| `ARCHIVE_SYNC_DB_PORT` | Archive PostgreSQL port; default `5432`. |
| `ARCHIVE_SYNC_DB_NAME` | Must be exactly `ai_crypto_bot_archive`. |
| `ARCHIVE_SYNC_DB_USER` | Dedicated archive decision-writer role, not the health-check account. |
| `ARCHIVE_SYNC_DB_PASSWORD` | Password for the archive decision-writer role. |
| `ARCHIVE_SYNC_DB_SSL_CA` | Optional archive PostgreSQL CA file path. |
| `ARCHIVE_SYNC_DB_SSL_SERVERNAME` | Optional verified archive certificate DNS name when it differs from the host. |
| `ARCHIVE_SYNC_STATE_PATH` | Absolute private path, for example `/var/lib/cryptopulse/archive-sync/ai-decisions.json`. Its directory must be owned by the service account and mode `0700`; the state file and lock are mode `0600`. |
| `ARCHIVE_SYNC_BATCH_SIZE` | Optional integer `1`–`500`; default `250`. |
| `ARCHIVE_SYNC_OVERLAP_SECONDS` | Optional integer `0`–`2592000`; default `86400` (24 hours). A positive overlap re-reads recent source rows on each completed rerun. |

The source URI password must be URI-encoded. The direct host is checked against the configured project reference. The agent always uses verified TLS for both databases; never disable certificate verification to work around a connection failure.

### Provision writer credentials later

The role SQL intentionally leaves the writer `NOLOGIN` and does not set a password. The user reports that credentials were later provisioned through the approved secure process for the successful sync. Do not put credentials in the SQL script, shell arguments, repository files, Vercel, chat, or logs.

Deliver the writer credential to the Pi only through the approved secret manager or other secure credential channel. Store it only in the Pi's protected ignored environment file. Set `ARCHIVE_SYNC_DB_USER` to `AI_Crypto_Bot_Archive_Decision_Writer`. Keep the source reader credential separate and URL-encode its password when setting `SUPABASE_ARCHIVE_READONLY_URL`.

Do not create a systemd timer or cron entry for this proof of concept. It is manually invoked.

## Manual invocation

Only run after the prerequisites and the separate validation guide have been reviewed:

```sh
cd /opt/cryptopulse/archive-server
npm run sync:ai-decisions
```

The process writes one JSON completion record and per-batch summaries without credentials or row payloads. Safe failure codes go to stderr and a nonzero exit status is returned. `Ctrl+C` or `SIGTERM` completes the active target batch, saves its checkpoint, and exits with status `130`.

The state file is bound to the source project reference and archive database name. An interrupted run resumes the same fixed cutoff and cursor. A later manual run starts from the saved high-water timestamp minus the overlap window. If the source cohort count changes during a resume, the run safely replays that cohort from its beginning with ID-based upserts.

## Stop conditions

Do not continue or widen access if the agent reports any configuration, identity, privilege, RLS, schema, anchor, checkpoint, count, or row-validation error. Preserve the checkpoint and review the safe error code. Do not manually edit the checkpoint cursor to skip rows.

If a lock remains after an unclean interruption, confirm that no agent process is running before removing the exact stale `.lock` file. Do not delete the checkpoint to clear a lock. A missing or malformed checkpoint is a stop condition and requires an intentional full replay or restoration of a verified checkpoint.

The agent is a copy-only synchronization utility, not an archive backup or restore process. Keep source retention unchanged and maintain a separate tested backup of the archive database.

## Related documentation

- [Archive sync architecture](./ARCHIVE_SYNC_ARCHITECTURE.md)
- [Decision archive validation guide](./AI_DECISION_ARCHIVE_AGENT_VALIDATION.md)
- [Decision archive POC readiness](./AI_DECISION_ARCHIVE_POC_READINESS.md)
- [Archive schema](../../AI_CRYPTO_BOT_ARCHIVE_SCHEMA.sql)
