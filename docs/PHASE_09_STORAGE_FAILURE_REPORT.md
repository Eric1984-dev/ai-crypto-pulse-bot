# Phase 09 Storage Failure Logging Report

## Summary

Added production-safe logging for `STORAGE_UNAVAILABLE` errors in the existing authenticated `/api/market-summary` handler. Logs identify the failed query, database table, operation, pagination page/range, HTTP status, allowlisted Supabase error code, and failure category. The production API status and JSON body are unchanged.

## Log format

```text
Market data storage request failed. STORAGE_UNAVAILABLE FAILED_QUERY=scanner.daily-candles TABLE=AI_Crypto_Bot_Candles OPERATION=SELECT PAGE=2 RANGE=1000-1999 HTTP_STATUS=403 ERROR_CODE=42501 FAILURE_CATEGORY=RLS_OR_PERMISSION
```

Scanner query names distinguish daily candles, hourly candles, and AI decisions. Table reads are labeled `SELECT`; writes carry their table and `INSERT` or `UPSERT` operation metadata. Non-paginated reads use `PAGE=unknown RANGE=none`; absent status/code values are logged as `unknown`.

## Security

- Logs contain only bounded internal metadata and validated labels.
- No tokens, credentials, user data, request URLs, response bodies, raw database messages, or error causes are logged.
- Unknown or invalid labels are replaced with `unknown`; absent ranges use `none`.
- Development-only response diagnostics remain as before.
- The production response remains:

```json
{
  "error": {
    "code": "MARKET_DATA_UNAVAILABLE",
    "message": "Stored market data is temporarily unavailable."
  }
}
```

## Files changed

- `lib/market-data.mjs` — attach table, operation, page, and range metadata to storage failures.
- `lib/market-handler.mjs` — emit safe query/table/operation/page/range/status/code/category labels.
- `tests/market-data.test.mjs` — cover metadata, production logs, secret redaction, and response compatibility.
- `docs/API.md`, `README.md`, `ROADMAP.md`, and `docs/CHANGELOG.md` — document the logging behavior.

## Validation

- `npm.cmd test` — passed, 139 tests and 0 failures.
- `npm.cmd run build` — passed; static project and database migration validation succeeded.

No new API routes, database changes, trading behavior, or Phase 10 work were introduced.
