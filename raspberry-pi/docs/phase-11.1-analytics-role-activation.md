# Phase 11.1 — Analytics Writer Role Activation

## Purpose and current role map

The Phase 11 history migration requires a dedicated PostgreSQL login for the
manual analytics generator. The reported Pi roles are:

| Purpose | PostgreSQL role | Environment variable |
|---|---|---|
| Read-only API | `ai_crypto_bot_runtime_reader` | `DATABASE_USER` |
| Paper trading | `ai_crypto_bot_paper_writer` | `PAPER_DATABASE_USER` |
| Analytics history writer | `ai_crypto_bot_analytics_writer` | `ANALYTICS_DATABASE_USER` |

`ai_crypto_bot_analytics_writer` is the required new role name for this
procedure. It must be distinct from the API, ingestion, AI-analysis, and
paper-trading database users. Confirm the live values before provisioning;
this document does not connect to or alter the Pi database.

The analytics role is only for the explicit
`npm run analytics:generate -- --period=30d` command. It is not used by the
API, scheduler, ingestion, AI analysis, or paper trading.

## Minimum privileges

The role needs:

- `LOGIN` and `CONNECT` to the configured project database.
- `USAGE` on schema `public`.
- `INSERT` on `public."AI_Crypto_Bot_Analytics_Runs"`.

The Phase 11 migration grants the schema and table privileges after creating
the table. The role must not own the table, create objects in `public`, or
receive `SELECT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, or `TRIGGER`
on the analytics table. It must not be a superuser or inherit permissions
through role memberships. Do not grant source-table access.

The generator uses untargeted `ON CONFLICT DO NOTHING` for retry
idempotency. Do not change it to `ON CONFLICT (id)`: PostgreSQL requires
`SELECT` on an explicitly named conflict-target column, which would violate
the writer's INSERT-only privilege model.

## 1. Create the PostgreSQL login

Run as an authorized PostgreSQL role administrator. Use the actual configured
database name if it is not `ai_crypto_bot_store`.

```sql
CREATE ROLE ai_crypto_bot_analytics_writer
  LOGIN
  NOINHERIT
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  NOBYPASSRLS;

GRANT CONNECT ON DATABASE ai_crypto_bot_store
  TO ai_crypto_bot_analytics_writer;
```

Set the password interactively in `psql`; do not put it in a SQL file,
command-line argument, shell history, or source control:

```text
\password ai_crypto_bot_analytics_writer
```

Do not grant role memberships. If the role already exists, inspect its
attributes and memberships rather than issuing a duplicate or broadening its
privileges.

## 2. Configure the Pi environment

Add the following pair to the Raspberry Pi's ignored
`raspberry-pi/.env` file. Keep the password distinct and secret.

```dotenv
ANALYTICS_DATABASE_USER=ai_crypto_bot_analytics_writer
ANALYTICS_DATABASE_PASSWORD=<the password set interactively above>
```

The settings must be present together. The username must differ from
`DATABASE_USER`, `INGESTION_DATABASE_USER`, `AI_DATABASE_USER`, and
`PAPER_DATABASE_USER`. Do not add a real password to `.env.example`, commit
the Pi `.env`, or place these values in Vercel settings.

The generator loads this file when invoked through the package script. Merely
configuring these optional values does not schedule analytics generation.

## 3. Apply the Phase 11 migration

Use the existing authorized schema-owner connection, not the API,
paper-trading, or new analytics runtime role. The migration intentionally
fails if the table or index already exists; inspect any collision instead of
editing the migration to use `IF NOT EXISTS`.

From the Raspberry Pi repository checkout, run `psql` against the configured
database. The three settings must match the actual environment values
exactly. The values below reflect the reported current API and paper roles.

```sh
cd ~/ai-crypto-pulse-bot/raspberry-pi
psql --set=ON_ERROR_STOP=1 --dbname=ai_crypto_bot_store <<'SQL'
SELECT pg_catalog.set_config(
  'cryptopulse.dashboard_database_user',
  'ai_crypto_bot_runtime_reader',
  false
);
SELECT pg_catalog.set_config(
  'cryptopulse.analytics_database_user',
  'ai_crypto_bot_analytics_writer',
  false
);
SELECT pg_catalog.set_config(
  'cryptopulse.paper_trading_database_user',
  'ai_crypto_bot_paper_writer',
  false
);
\i migrations/phase-11-analytics-history.sql
SQL
```

This migration creates the prefixed history table and index, grants
`SELECT` on the history table to the configured API role, and grants `INSERT`
only to the analytics writer. It verifies those table privileges and rejects
an analytics or API role that can create objects in `public`. It does not
grant the paper-trading role analytics-table access.

## 4. Validate privileges and run generation

As a PostgreSQL administrator, confirm role attributes and effective
privileges. These checks should return `LOGIN`, no elevated role flags, and
the indicated privilege values:

```sql
SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
       rolreplication, rolbypassrls, rolinherit
FROM pg_catalog.pg_roles
WHERE rolname = 'ai_crypto_bot_analytics_writer';

SELECT
  pg_catalog.has_database_privilege(
    'ai_crypto_bot_analytics_writer',
    current_database(),
    'CONNECT'
  ) AS can_connect,
  pg_catalog.has_schema_privilege(
    'ai_crypto_bot_analytics_writer',
    'public',
    'USAGE'
  ) AS can_use_public,
  pg_catalog.has_schema_privilege(
    'ai_crypto_bot_analytics_writer',
    'public',
    'CREATE'
  ) AS can_create_in_public,
  pg_catalog.has_table_privilege(
    'ai_crypto_bot_analytics_writer',
    'public."AI_Crypto_Bot_Analytics_Runs"',
    'INSERT'
  ) AS can_insert_history,
  pg_catalog.has_table_privilege(
    'ai_crypto_bot_analytics_writer',
    'public."AI_Crypto_Bot_Analytics_Runs"',
    'SELECT'
  ) AS can_select_history,
  pg_catalog.has_table_privilege(
    'ai_crypto_bot_analytics_writer',
    'public."AI_Crypto_Bot_Analytics_Runs"',
    'UPDATE'
  ) AS can_update_history,
  pg_catalog.has_table_privilege(
    'ai_crypto_bot_analytics_writer',
    'public."AI_Crypto_Bot_Analytics_Runs"',
    'DELETE'
  ) AS can_delete_history;
```

Expected: `can_connect`, `can_use_public`, and `can_insert_history` are true;
`can_create_in_public`, `can_select_history`, `can_update_history`, and
`can_delete_history` are false. The migration additionally checks
`TRUNCATE`, `REFERENCES`, and `TRIGGER` privileges. Investigate any unexpected
effective privilege or role membership before running the generator.

Confirm the role has no granted memberships:

```sql
SELECT granted_role.rolname AS granted_role
FROM pg_catalog.pg_auth_members AS membership
JOIN pg_catalog.pg_roles AS granted_role
  ON granted_role.oid = membership.roleid
WHERE membership.member = (
  SELECT role_row.oid
  FROM pg_catalog.pg_roles AS role_row
  WHERE role_row.rolname = 'ai_crypto_bot_analytics_writer'
);
```

Expected: zero rows.

After confirming the migration and environment values, intentionally generate
one run:

```sh
cd ~/ai-crypto-pulse-bot/raspberry-pi
npm run analytics:generate -- --period=30d
```

The command should exit successfully and log `analytics_run_generated`.
Generation inserts a persistent analytics summary. As a schema owner, verify
the latest row:

```sql
SELECT id, calculation_version, period, period_start, period_end, generated_at
FROM public."AI_Crypto_Bot_Analytics_Runs"
ORDER BY generated_at DESC, id DESC
LIMIT 1;
```

Finally, using an authenticated dashboard session, request
`/api/v1/dashboard-data?view=analytics-history&period=30d` and confirm the new
run is returned. The analytics writer itself should not be able to query the
history table.

If generation fails with `ANALYTICS_RUN_WRITE_FAILED`, the
`analytics_run_generation_failed` event now includes a sanitized `causeCode`
(for example, PostgreSQL SQLSTATE `42501`) without logging the database error
message or credentials. Use that code to distinguish authentication,
connection, and privilege failures; do not share passwords or connection
strings when reporting the result.

## Operational notes

- The API continues to use `DATABASE_USER=ai_crypto_bot_runtime_reader`.
- Leave `ANALYTICS_DATABASE_USER` and `ANALYTICS_DATABASE_PASSWORD` unset
  unless analytics-history generation is intentionally enabled.
- The generator is manual; this procedure does not enable a scheduler or
  change trading behavior.
- No runtime restart is required solely to invoke the manual generator after
  updating `.env`; the package script starts a new Node process and loads the
  file. Do not restart the autonomous runtime as a substitute for validating
  database grants.
- This procedure is a documented template, not evidence that the role,
  migration, generator, or endpoint has been activated on production.
