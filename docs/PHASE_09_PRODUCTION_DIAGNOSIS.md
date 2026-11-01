# Phase 09 Production Diagnosis

## Status

The reported response is HTTP 503 with `MARKET_DATA_UNAVAILABLE`. That response confirms an unhandled Supabase/PostgREST read failure, but the original response does not identify the query, table, HTTP status, or underlying error code. No production request trace or Supabase logs were available, so the exact failing production query remains unconfirmed.

Temporary diagnostics now attach a query name and safe failure classification to the response only when `NODE_ENV` is exactly `development`. The production response remains the existing generic error and includes no diagnostic fields. No API route or database schema was added; Phase 10 was not started.

## Instrumented reads

| Query name | Table | Query purpose |
|---|---|---|
| `summary.watched-markets.initial` | `AI_Crypto_Bot_Watched_Markets` | Load watched markets and enabled/priority state |
| `summary.watched-markets.after-sync` | `AI_Crypto_Bot_Watched_Markets` | Reload after missing markets are inserted |
| `summary.market-data.refresh-check` | `AI_Crypto_Bot_Market_Data` | Check stored snapshots before any stale-market refresh |
| `summary.watched-markets.final` | `AI_Crypto_Bot_Watched_Markets` | Reload after market refresh; failures here are recovered using the previous list |
| `summary.active-market-data` | `AI_Crypto_Bot_Market_Data` | Return snapshots for active markets |
| `scanner.daily-candles` | `AI_Crypto_Bot_Candles` | Read active-market daily candles from the last 32 days |
| `scanner.hourly-candles` | `AI_Crypto_Bot_Candles` | Read active-market hourly candles from the last 10 hours |
| `scanner.ai-decisions` | `AI_Crypto_Bot_AI_Decisions` | Read recent decisions for active markets, newest first |

The three scanner queries execute concurrently. A failure from any unhandled read rejects the summary request. The `refresh-check` and final watched-market reload are caught internally; if they fail but fallback data allows the request to continue, they will not produce the 503 response.

## Development diagnostic fields

Example shape:

```json
{
  "error": {
    "code": "MARKET_DATA_UNAVAILABLE",
    "message": "Stored market data is temporarily unavailable.",
    "diagnostics": {
      "queryName": "scanner.daily-candles",
      "failureKind": "RLS_OR_PERMISSION",
      "httpStatus": 403,
      "databaseCode": "42501"
    }
  }
}
```

Only the query label, categorized failure, numeric HTTP status, and a validated short database error code can be included. Raw database messages, request URLs, headers, tokens, and credentials are not returned. In production, the body remains exactly the generic `code` and `message` response.

## Failure classification

| `failureKind` | Classification |
|---|---|
| `RLS_OR_PERMISSION` | HTTP 403 or PostgreSQL permission code `42501`; check authenticated-role grants and RLS policies for the reported table |
| `SCHEMA_MISMATCH` | HTTP 404 or known missing-table/missing-column codes (`PGRST204`, `PGRST205`, `42703`, `42P01`); compare production schema/migrations and selected columns |
| `MALFORMED_JSON` | Successful HTTP response whose body cannot be parsed as JSON |
| `MALFORMED_RESPONSE` | Successful response parses but is not an array of rows |
| `NETWORK_OR_TIMEOUT` | Supabase fetch rejected or timed out |
| `SUPABASE_SERVER_ERROR` | Supabase returned HTTP 5xx |
| `QUERY_REJECTED` | Other non-success Supabase response; inspect its status and diagnostic code |
| `AUTHENTICATION` | Supabase returned HTTP 401; the route maps this to `INVALID_SESSION`/401 rather than `MARKET_DATA_UNAVAILABLE` |

An empty successful read is not a failure. Missing rows produce empty rankings; stale snapshots are excluded from rankings. Neither condition alone yields `MARKET_DATA_UNAVAILABLE`.

The repository migration defines the four expected tables and their queried columns. This confirms source-to-migration naming consistency, but does not prove that the production database has applied the same migration or grants.

## How to identify the runtime failure

Reproduce the request in a development environment with an authenticated session and `NODE_ENV=development`, then inspect the JSON `error.diagnostics`. Use the reported query name to narrow the affected table and query class, and use the status/database code to distinguish permissions, schema/query rejection, malformed response, or transport failure. Confirm schema and RLS findings against the actual Supabase project; local tests cannot validate production database state.

The existing production JSON alone cannot identify the failed query. Diagnostics are intentionally unavailable in production to avoid exposing implementation or database details.

## Changed files and validation

- Added query labels and failure classification in `lib/market-data.mjs`.
- Added the development-only diagnostic response in `lib/market-handler.mjs`.
- Added regression coverage for query identification, permission/schema/malformed-response categories, and production response redaction in `tests/market-data.test.mjs`.
- Documented the development-only response contract in `docs/API.md`.
- Updated `docs/CHANGELOG.md`.

Validation:

- `npm test` — passed, 139 tests and 0 failures.
- `npm run build` — passed; static project and database migration validation succeeded.
