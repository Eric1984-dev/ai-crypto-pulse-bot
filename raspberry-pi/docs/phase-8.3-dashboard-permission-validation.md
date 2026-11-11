# Phase 8.3 — Dashboard Data Permission Validation

## Status and scope

The supplied live evidence reports:

| Request | Result |
|---|---|
| `GET /api/v1/health/live` | `200 OK` |
| `GET /api/v1/markets` | `200 OK` |
| `GET /api/v1/dashboard-data` | `503 DASHBOARD_DATA_UNAVAILABLE`, with `POSTGRES_PERMISSION_DENIED` / SQLSTATE `42501` in the Pi logs |

This report traces the default dashboard request and defines the minimum additional read grants. The SQL migration is prepared but was not applied to the live Pi database in this worktree. The reported endpoint results are user-provided; there was no live Pi connection available here to verify the post-grant `200`.

## Execution path

`GET /api/v1/dashboard-data` is handled by `registerDataRoutes` in `src/api/data-routes.mjs`. For the default view it:

1. Reads enabled markets, singleton runtime status and recent AI decisions.
2. Reads the latest market data for enabled markets.
3. Calls `DashboardRepository.getSystemDashboardData()`.
4. Returns the portfolio, positions, recent trades, snapshots and emergency state.

The repository wraps its statements in read-only transactions via `queryReadOnly`. PostgreSQL SQLSTATE `42501` is normalized to `POSTGRES_PERMISSION_DENIED`; the diagnostic deliberately omits the original server error text and relation name. Consequently, the supplied log proves a PostgreSQL privilege failure but does not identify which relation PostgreSQL named.

## Failing query and affected objects

The first account-specific statement in `DashboardRepository.getSystemDashboardData()` is `PORTFOLIO_SQL`:

```sql
SELECT portfolio.id,
       portfolio.starting_balance,
       portfolio.available_balance,
       portfolio.portfolio_value,
       portfolio.created_at
FROM public."AI_Crypto_Bot_Profiles" AS profile
JOIN public."AI_Crypto_Bot_Portfolios" AS portfolio
  ON portfolio.user_id = profile.id
WHERE profile.id = $1::uuid
ORDER BY portfolio.created_at ASC, portfolio.id ASC
LIMIT 2
```

The documented `ai_crypto_bot_runtime_reader` grant template in the Phase 5.4 report covers the core watched-market, market-data, candle, AI-decision and status tables; it does not grant dashboard account-table reads. Therefore the profile/portfolio query is the first dashboard-specific privilege gap indicated by the checked-in role contract. Either `AI_Crypto_Bot_Profiles` or `AI_Crypto_Bot_Portfolios` (or both) can raise `42501` if the corresponding live `SELECT` grant is absent.

The rest of the default dashboard response also requires direct `SELECT` on:

- `public."AI_Crypto_Bot_Positions"`
- `public."AI_Crypto_Bot_Trades"`
- `public."AI_Crypto_Bot_Portfolio_Snapshots"`
- `public."AI_Crypto_Bot_Emergency_State"`

The complete dashboard read set is also used by the paper-trading reader contract. The endpoint queries ordinary tables directly; it does not depend on a view, materialized view, application-defined function, or sequence. `/api/v1/markets` succeeding confirms the API can connect, resolve the `public` schema and read the watched-markets table, but does not prove access to the portfolio tables.

The precise single relation rejected by the supplied live request cannot be determined from the sanitized log. Run the catalog query below against the Pi database before or after applying the migration to see each effective permission explicitly.

## Minimum fix

The migration grants only `SELECT` on the six dashboard-specific tables omitted from the documented API reader grant list:

[phase-8.3-dashboard-permissions.sql](../migrations/phase-8.3-dashboard-permissions.sql)

It does not grant ownership, DML, `CONNECT`, schema `CREATE`, sequence access, or function execution. Existing core read privileges remain unchanged.

Apply the script to `ai_crypto_bot_store` as an authorized database administrator:

```sh
psql -d ai_crypto_bot_store -v ON_ERROR_STOP=1 \
  -f raspberry-pi/migrations/phase-8.3-dashboard-permissions.sql
```

No database grants were executed from this worktree. Do not place database credentials in the command line, repository or report.

## Effective privilege verification

Run as an authorized administrator on the Pi database. Before applying the migration, `can_select = false` identifies missing read grants; afterward, every row must be `true`.

```sql
SELECT required.table_name,
       pg_catalog.has_table_privilege(
         'ai_crypto_bot_runtime_reader',
         pg_catalog.format('public.%I', required.table_name),
         'SELECT'
       ) AS can_select
FROM unnest(ARRAY[
  'AI_Crypto_Bot_Profiles',
  'AI_Crypto_Bot_Portfolios',
  'AI_Crypto_Bot_Positions',
  'AI_Crypto_Bot_Trades',
  'AI_Crypto_Bot_AI_Decisions',
  'AI_Crypto_Bot_Status',
  'AI_Crypto_Bot_Watched_Markets',
  'AI_Crypto_Bot_Market_Data',
  'AI_Crypto_Bot_Portfolio_Snapshots',
  'AI_Crypto_Bot_Emergency_State'
]::text[]) AS required(table_name)
ORDER BY required.table_name;
```

Expected: ten rows and `can_select = true` for each. The baseline runtime contract separately checks `AI_Crypto_Bot_Candles`, which is not read by this endpoint. No sequence/function checks are needed for these `SELECT` statements. The runtime preflight now validates `SELECT` on every table in the dashboard read set and reports `MISSING_SELECT_PRIVILEGE:<table>` before runtime startup if any are absent.

## Required endpoint verification

After applying the grants and restarting only under the operator's deployment procedure:

1. Run `npm run validate`; confirm `contracts: "valid"` with the configured read-only runtime login.
2. Confirm `GET /api/v1/health/live` returns `200`.
3. Confirm `GET /api/v1/markets` returns `200`.
4. Confirm `GET /api/v1/dashboard-data` returns `200` with the portfolio summary.
5. Load the dashboard and confirm the portfolio summary renders without the data-load error.

Do not use the paper-trading database login or a table owner for the API. No profile, portfolio, trade, position or schema writes are needed.

## Local validation

- Raspberry Pi package tests: `npm.cmd test` — **169 passed, 0 failed**.
- Repository tests: `npm.cmd test` — **508 passed, 0 failed**; includes API and repository tests.
- Syntax validation: `node --check` succeeded for **85** Raspberry Pi source and test `.mjs`/`.js` files.
- `git diff --check` — passed.
- Contract validation tests confirm the runtime rejects a missing dashboard `SELECT` privilege and preserves the separate ingestion/AI role contracts.
- Live PostgreSQL catalog verification and the post-grant dashboard `200` remain pending operator execution because the local Pi `.env` and live database connection are unavailable here.

## Remaining limitation

The current Pi diagnostic records SQLSTATE and a safe category, not the PostgreSQL relation name. The checked-in grant template establishes the missing dashboard table access as the root cause class, while the provided runtime log cannot distinguish which individual missing relation first failed. The catalog query above supplies that exact distinction without granting additional privileges.
