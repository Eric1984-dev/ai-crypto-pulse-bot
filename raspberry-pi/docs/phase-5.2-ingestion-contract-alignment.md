# Phase 5.2 — Ingestion Contract Alignment

## Outcome

Updated the ingestion preflight to support the confirmed Raspberry Pi ownership model without changing the strict API contract or making owner access the default.

The user-confirmed live database facts for this phase are:

- Database: `ai_crypto_bot_store`
- Ingestion login: `ai_crypto_bot_archive_user`
- RLS is disabled; no RLS policies are installed.
- No PostgreSQL runtime functions are installed.
- The ingestion login owns the existing project tables.
- The remaining blocker was the application's ingestion contract validation.

No database connection, SQL statement, grant, role change, schema change, ingestion run, or deployment was performed. These live facts are recorded as user-confirmed and were not independently queried during this phase.

## Contract decision

Table ownership is a powerful database capability: an owner can alter or drop its table and has destructive DML rights. It is not safe as a general default for an API/runtime identity. However, the current architecture intentionally uses the existing table-owning login for the explicitly invoked ingestion CLI, while the API can continue using its separate read-only `DATABASE_USER`.

The contract now supports that narrowly acknowledged deployment mode through:

```env
INGESTION_ALLOW_TABLE_OWNER=false
```

The default remains `false`. Setting it to the exact string `true` is an explicit operator acknowledgement for the configured ingestion login only. It requires both ingestion credentials and rejects an ingestion username identical to `DATABASE_USER`. It does not change the API's `validateRuntimeContracts` or any database grants.

## Validation behavior

The change is limited to `evaluateIngestionDatabaseContract`:

- Without the opt-in, ownership of a prefixed table continues to fail with `INGESTION_ROLE_UNSAFE_TABLE_PRIVILEGE`.
- With the opt-in, ownership is accepted only for the existing names in `REQUIRED_TABLES`; each accepted owned table is included in `warnings` as `INGESTION_ROLE_TABLE_OWNER_ALLOWED:<table>`.
- An unowned prefixed table with effective `DELETE` or `TRUNCATE` remains a hard failure.
- Ownership of an unknown prefixed table remains a hard failure, even with the opt-in.
- Missing `INSERT` or `UPDATE` on `AI_Crypto_Bot_Market_Data` or `AI_Crypto_Bot_Candles` remains a hard failure.
- SUPERUSER, `BYPASSRLS`, `CREATEDB`, `CREATEROLE`, `CREATE` on schema `public`, database/role identity mismatches, and other contract failures remain hard failures.
- Missing legacy constraints, write-capable grants, and absent optional/runtime functions retain their existing ingestion warning/optional behavior.
- `evaluateDatabaseContract` and the API's read-only owner/write rejection are unchanged.

The warning is surfaced by the existing `market_data_ingestion_preflight_passed` log entry. The ingestion repository still issues only its bounded parameterized snapshot/candle upserts and best-effort scanner-event inserts; it does not issue `DELETE`, `TRUNCATE`, DDL, or runtime function calls. This limits application behavior, but it does not remove the greater impact of a compromised owner credential.

## Safe operating configuration

- Keep `DATABASE_USER` / `DATABASE_PASSWORD` as the API's separate read-only identity.
- Set `INGESTION_DATABASE_USER=ai_crypto_bot_archive_user` and its password only in the Pi's local ignored `.env`.
- Set `INGESTION_ALLOW_TABLE_OWNER=true` only when intentionally using this existing table owner for manual ingestion. Leave it unset or `false` in other environments.
- Protect the owner credential as a high-impact secret. Do not copy it to Vercel, expose it to HTTP routes, or use it for the API.
- The opt-in is not a database role change and does not make the API accept an owner role.

The Pi's confirmed RLS-disabled state means no policy change is needed for this specific environment. If RLS is enabled in another installation, this opt-in does not bypass RLS; the normal role must still satisfy that database's policies.

## Files changed

- `src/config/runtime-config.mjs` — parse `INGESTION_ALLOW_TABLE_OWNER` as a strict boolean, default false.
- `src/ingest-market-data.mjs` — require a distinct `INGESTION_DATABASE_USER` when owner mode is enabled, so the owner login cannot also become the API identity through CLI credential fallback.
- `src/services/database-contracts.mjs` — add an explicit, ingestion-only known-table ownership opt-in and warnings.
- `src/services/contract-validation.mjs` — pass the parsed setting only to ingestion contract evaluation.
- `tests/runtime-config.test.mjs` — test default, explicit values, and invalid boolean input.
- `tests/contract-validation.test.mjs` — test default rejection, opt-in acceptance, warning emission, unknown/non-owned table rejection, elevated-role rejection, and unchanged API validation.
- `.env.example`, `README.md`, and runtime/Phase 2/Phase 5 documentation — explain the setting and security boundary.

## Validation

| Check | Result |
|---|---|
| Raspberry Pi package tests: `npm.cmd --prefix raspberry-pi test` | Passed: 70 tests, 0 failures. |
| Repository tests: `npm.cmd test` | Passed: 432 tests, 0 failures. |
| Syntax: `node --check` over Raspberry Pi source and test modules | Passed: 52 modules checked. |
| `git diff --check` | Passed. |
| Live Pi database / SQL | Not run; no connection or SQL was executed. |
| Live Bitvavo ingestion | Not run. |

No build script is configured for the Raspberry Pi package. Test and syntax results must not be interpreted as production ingestion validation; the operator must separately authorize a first live one-shot run.

## Phase boundary

Phase 5.2 changes only ingestion-contract configuration, validation, tests, and documentation under `raspberry-pi/`. It does not execute the CLI, alter roles or grants, change the database, add scheduling, or proceed to Phase 6.
