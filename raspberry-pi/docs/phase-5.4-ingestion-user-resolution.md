# Phase 5.4 — Ingestion User Configuration Resolution

## Outcome

The configuration error is caused by using the same PostgreSQL login for the API and ingestion:

```text
DATABASE_USER=ai_crypto_bot_archive_user
INGESTION_DATABASE_USER=ai_crypto_bot_archive_user
INGESTION_ALLOW_TABLE_OWNER=true
```

The owner opt-in requires a distinct ingestion login. “Distinct” means a different PostgreSQL role name, not merely a separate environment-variable key. The current error message was clarified to state this directly.

The opt-in must not be changed to permit the same login. The API contract is strictly read-only and rejects table ownership and write privileges. Using the table owner as `DATABASE_USER` would therefore violate the API contract as well as expose the owner credential to the API.

No live database was queried or changed. The deployment facts in this report—database `ai_crypto_bot_store`, RLS disabled, no policies, and `ai_crypto_bot_archive_user` owning the project tables—are the facts supplied for this phase.

## Role decision

- **A newly created ingestion role is not required to resolve the current error.** The existing table owner can remain the ingestion login under the explicit owner opt-in, provided it is not also the API login and all other ingestion-contract checks pass.
- **A separate read-only API login is required.** Use an existing suitable reader role or provision one. Set it as `DATABASE_USER`; it must have `SELECT` on the five read-contract tables and no ownership, write/sequence privileges, elevated role flags, or effective `CREATE` on `public`.
- **A dedicated non-owner ingestion login is the preferred least-privilege configuration.** It is optional for the current owner-opt-in path, but it avoids giving the ingestion CLI table-owner powers. With the user-confirmed RLS-disabled state, the grants below are sufficient without policies or `BYPASSRLS`.
- Keep the owner exception restricted to ingestion. It accepts ownership only for known project tables; it does not permit unsafe privileges on unknown tables, elevated role properties, or `CREATE` on `public`.

The Phase 5.1 recommendation for a dedicated writer preceded confirmation of the live RLS state. Phase 5.2 added the narrowly scoped owner opt-in after RLS was confirmed disabled. Phase 5.4 preserves that opt-in and resolves the remaining identity mismatch; it does not change ownership, schema, RLS, or data.

## Exact `.env` configuration

### Immediate configuration using the existing table owner

This is the minimum-change configuration consistent with the currently supplied database facts. Replace the API login/password with an existing or newly provisioned read-only identity; keep the existing database host and validated SSL settings.

```dotenv
DATABASE_HOST=<existing PostgreSQL host>
DATABASE_PORT=5432
DATABASE_NAME=ai_crypto_bot_store
DATABASE_USER=ai_crypto_bot_runtime_reader
DATABASE_PASSWORD=<read-only role password>
DATABASE_SSL=<existing validated TLS setting>
DATABASE_SSL_CA_PATH=<existing CA path or empty>
DATABASE_SSL_SERVERNAME=<existing server name or empty>

INGESTION_DATABASE_USER=ai_crypto_bot_archive_user
INGESTION_DATABASE_PASSWORD=<existing table-owner password>
INGESTION_ALLOW_TABLE_OWNER=true

ENABLE_LIVE_TRADING=false
```

Do not set `DATABASE_USER` to `ai_crypto_bot_archive_user` while using this owner mode. Keep credentials only in the Pi's local ignored `.env`; do not put them in Vercel or source control. The API and ingestion CLI use separate pools/configurations: the API keeps the read-only identity, while the one-shot ingestion command applies the `INGESTION_DATABASE_*` identity.

No ingestion-role SQL is needed for this option because `ai_crypto_bot_archive_user` already exists and owns the tables. If the read-only API login does not already exist, an authorized database administrator can provision it with:

```sql
CREATE ROLE ai_crypto_bot_runtime_reader
  LOGIN
  INHERIT
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  NOBYPASSRLS;

GRANT CONNECT ON DATABASE ai_crypto_bot_store
  TO ai_crypto_bot_runtime_reader;

GRANT USAGE ON SCHEMA public
  TO ai_crypto_bot_runtime_reader;

GRANT SELECT ON TABLE
  public."AI_Crypto_Bot_Watched_Markets",
  public."AI_Crypto_Bot_Market_Data",
  public."AI_Crypto_Bot_Candles",
  public."AI_Crypto_Bot_AI_Decisions",
  public."AI_Crypto_Bot_Status"
  TO ai_crypto_bot_runtime_reader;
```

Set the new role's password interactively with `\password ai_crypto_bot_runtime_reader`; do not place a real password in SQL files or shell history. Create no memberships for the reader. These statements are a template and were not executed.

### Preferred least-privilege alternative

If an authorized administrator provisions a dedicated non-owner writer, use this environment instead:

```dotenv
DATABASE_USER=ai_crypto_bot_runtime_reader
DATABASE_PASSWORD=<read-only role password>
INGESTION_DATABASE_USER=ai_crypto_bot_ingestion_user
INGESTION_DATABASE_PASSWORD=<ingestion role password>
INGESTION_ALLOW_TABLE_OWNER=false
```

Create the writer with no elevated attributes, no memberships, and no ownership. The runtime contract requires `SELECT` on the same five read-contract tables, `INSERT` and `UPDATE` on market snapshots and candles, and `INSERT` on scanner events:

```sql
CREATE ROLE ai_crypto_bot_ingestion_user
  LOGIN
  INHERIT
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  NOBYPASSRLS;

GRANT CONNECT ON DATABASE ai_crypto_bot_store
  TO ai_crypto_bot_ingestion_user;

GRANT USAGE ON SCHEMA public
  TO ai_crypto_bot_ingestion_user;

GRANT SELECT ON TABLE
  public."AI_Crypto_Bot_Watched_Markets",
  public."AI_Crypto_Bot_Market_Data",
  public."AI_Crypto_Bot_Candles",
  public."AI_Crypto_Bot_AI_Decisions",
  public."AI_Crypto_Bot_Status"
  TO ai_crypto_bot_ingestion_user;

GRANT INSERT, UPDATE ON TABLE
  public."AI_Crypto_Bot_Market_Data",
  public."AI_Crypto_Bot_Candles"
  TO ai_crypto_bot_ingestion_user;

GRANT INSERT ON TABLE
  public."AI_Crypto_Bot_Scanner_Events"
  TO ai_crypto_bot_ingestion_user;
```

Set its password interactively with `\password ai_crypto_bot_ingestion_user`. Grant no `DELETE`, `TRUNCATE`, sequence, schema `CREATE`, ownership, or other table-write privileges; create no role memberships. These statements are also templates only and were not executed.

## Contract and validation expectations

The code checks the effective PostgreSQL role, not just the username:

- The API's `validateRuntimeContracts` requires read-only transactions, `SELECT` on required read tables, and no write/sequence privileges or table ownership on prefixed project objects.
- The ingestion contract requires the same read access and `INSERT`/`UPDATE` on `AI_Crypto_Bot_Market_Data` and `AI_Crypto_Bot_Candles`.
- Without owner opt-in, project-table ownership, `DELETE`, and `TRUNCATE` are rejected. With owner opt-in, ownership is accepted only on known `AI_Crypto_Bot_*` tables and is reported as a warning.
- Both paths reject SUPERUSER, `BYPASSRLS`, `CREATEDB`, `CREATEROLE`, and effective `CREATE` on `public`. A distinct username does not bypass these checks.
- The writer role needs no sequence grant for the current UUID/timestamp defaults. Scanner-event inserts use existing defaults and do not write watched markets.

After an authorized DBA provisions or selects the API reader, validate it using the existing read-only command:

```sh
npm run validate
```

This validates the API identity only. It does not validate ingestion writes. The ingestion command performs writes after its preflight; do not use it as a dry-run. A live ingestion attempt remains a separate operational action and was not performed for this phase.

For owner mode, the expected preflight output includes `INGESTION_ROLE_TABLE_OWNER_ALLOWED:<table>` warnings. A successful preflight alone does not demonstrate a completed live ingestion pass.

## Implementation and validation

- Updated the owner-mode configuration error to explicitly require `INGESTION_DATABASE_USER` to differ from `DATABASE_USER`.
- Added regression coverage that rejects identical logins and accepts a distinct existing owner login without changing the API database configuration.
- Clarified the `.env.example` comments and linked this resolution report from the Raspberry Pi README.
- No PostgreSQL role, grant, membership, policy, schema, or data change was performed.

| Check | Result |
|---|---|
| Raspberry Pi package tests: `npm.cmd --prefix raspberry-pi test` | Passed: 79 tests, 0 failures. |
| `git diff --check` | Passed. |
| Live PostgreSQL / SQL | Not run. |
| Live Bitvavo ingestion | Not run. |

## Phase boundary

Phase 5.4 resolves the API/ingestion database identity configuration only. It does not run ingestion, alter the database, add scheduling, perform dashboard cutover, or continue to a later phase.
