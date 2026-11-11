# Phase 8.3 — Dashboard Data Permission Validation

## Status and scope

The initial live evidence reported a permission failure. The later Phase 8.4 live validation reports that the missing privileges were identified, the migration was applied on the Pi, and the dashboard endpoint now succeeds:

| Request | Result |
|---|---|
| `GET /api/v1/health/live` | `200 OK` |
| `GET /api/v1/markets` | `200 OK` |
| `GET /api/v1/dashboard-data` | `200 OK` |

The operator reports that `ai_crypto_bot_runtime_reader` lacked `SELECT` on all six dashboard-specific tables listed below and that applying [phase-8.3-dashboard-permissions.sql](../migrations/phase-8.3-dashboard-permissions.sql) resolved the issue. This report documents that live result but does not independently connect to the Pi or database.

See the [Phase 8.4 live validation report](phase-8.4-live-validation-report.md) for the broader live deployment findings.

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

The documented `ai_crypto_bot_runtime_reader` grant template in the Phase 5.4 report covers the core watched-market, market-data, candle, AI-decision and status tables; it does not grant dashboard-specific reads. The operator's subsequent live validation identified missing `SELECT` on all six dashboard-specific tables: `AI_Crypto_Bot_Profiles`, `AI_Crypto_Bot_Portfolios`, `AI_Crypto_Bot_Positions`, `AI_Crypto_Bot_Trades`, `AI_Crypto_Bot_Portfolio_Snapshots`, and `AI_Crypto_Bot_Emergency_State`. The initial sanitized `42501` log alone could not distinguish the denied relation; the later live permission inspection established the full set.

The rest of the default dashboard response also requires direct `SELECT` on:

- `public."AI_Crypto_Bot_Positions"`
- `public."AI_Crypto_Bot_Trades"`
- `public."AI_Crypto_Bot_Portfolio_Snapshots"`
- `public."AI_Crypto_Bot_Emergency_State"`

The complete dashboard read set is also used by the paper-trading reader contract. The endpoint queries ordinary tables directly; it does not depend on a view, materialized view, application-defined function, or sequence. `/api/v1/markets` succeeding confirms the API can connect, resolve the `public` schema and read the watched-markets table, but does not prove access to the portfolio tables.

The sanitized log still does not identify which relation was the first one rejected by PostgreSQL. The operator-reported live validation identifies all six missing grants. The catalog query below can independently confirm effective permissions on the Pi.

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
- The operator reports applying the migration and receiving `200` from all three required endpoints. Live catalog verification and HTTP requests were not independently executed from this worktree because the local Pi `.env` and database connection are unavailable.

## Remaining limitation

The Pi diagnostic records SQLSTATE and a safe category, not the PostgreSQL relation name. The initial log therefore did not expose the failing relation; the subsequent operator validation identified all six missing dashboard grants and reports that the migration resolved them. Use the catalog query above for an independent privilege check.
