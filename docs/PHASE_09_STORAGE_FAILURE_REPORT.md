# Phase 09 Storage Failure Logging Report

## Summary

Added production-safe logging for `STORAGE_UNAVAILABLE` errors in the existing authenticated `/api/market-summary` handler. Logs now identify the failed query, database table, and operation. The production API status and JSON body are unchanged.

## Log format

```text
Market data storage request failed. STORAGE_UNAVAILABLE FAILED_QUERY=scanner.daily-candles TABLE=AI_Crypto_Bot_Candles OPERATION=SELECT
```

Scanner query names distinguish daily candles, hourly candles, and AI decisions. Table reads are labeled `SELECT`; writes carry their table and `INSERT` or `UPSERT` operation metadata.

## Security

- Logs contain only validated internal labels.
- No tokens, credentials, user data, request URLs, raw database messages, or error causes are logged.
- Unknown or invalid labels are replaced with `unknown`.
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

- `lib/market-data.mjs` — attach table and operation metadata to storage failures.
- `lib/market-handler.mjs` — emit safe query/table/operation labels for storage failures.
- `tests/market-data.test.mjs` — cover metadata, production logs, secret redaction, and response compatibility.
- `docs/API.md`, `README.md`, `ROADMAP.md`, and `docs/CHANGELOG.md` — document the logging behavior.

## Validation

- `npm.cmd test` — passed, 139 tests and 0 failures.
- `npm.cmd run build` — passed; static project and database migration validation succeeded.

No new API routes, database changes, trading behavior, or Phase 10 work were introduced.
