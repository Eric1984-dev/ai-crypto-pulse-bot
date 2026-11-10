# Phase 5.3 — Ingestion Failure Diagnostics

## Outcome

Improved diagnostics for the manually invoked market-data ingestion command without changing its ingestion decisions, PostgreSQL contract validation, configuration requirements, or safety controls.

The reported `UNKNOWN` outcome could arise when a failure was represented only by a status and code instead of an `Error` object. In particular, a future or malformed candle checkpoint returned `errorCode: "INVALID_CANDLE_CHECKPOINT"` without an error, and the failure logger then replaced the missing code with `UNKNOWN`.

No live database connection, ingestion run, trade, schema change, migration, or deployment was performed.

## Implemented diagnostics

- Added a shared diagnostic formatter that reports `code`, `category`, `message`, and `component` for ingestion failures. Missing error codes now map to `INGESTION_UNEXPECTED_ERROR`, never `UNKNOWN`.
- PostgreSQL diagnostics classify connection, DNS, TLS, timeout, query, privilege, authentication, and write failures. SQLSTATE or network error codes are retained as `causeCode`; log messages are safe summaries rather than raw PostgreSQL error text.
- Bitvavo failures retain the original network `cause` and HTTP status while preserving the existing provider error codes and control flow. HTTP, DNS, TLS, timeout, invalid-response, and missing-market-data conditions are classified explicitly.
- Configuration and contract failures identify their originating stage. Unexpected CLI failures include a safe message and component; a stack trace is included only when `NODE_ENV=development`.
- Development stack traces and contract error details pass through the diagnostic sanitizer. Credentials are not intentionally written to logs.
- Failure logs now include diagnostic fields at the CLI, provider, ingestion, repository, PostgreSQL-pool, and transaction rollback boundaries. Market-level missing/invalid data and malformed checkpoints also emit failure diagnostics.
- A non-completed ingestion result emits a command-level failure summary; preceding market/stage events retain the specific causes.

Representative log shape:

```json
{
  "event": "market_data_ingestion_failure",
  "stage": "candle-refresh",
  "interval": "1m",
  "symbol": "BTC-EUR",
  "code": "INVALID_CANDLE_CHECKPOINT",
  "category": "data_validation",
  "message": "The stored candle checkpoint is invalid or lies in the future.",
  "component": "market-data-ingestion"
}
```

## Behavior and safety preserved

- The existing ingestion contract validation and the `INGESTION_ALLOW_TABLE_OWNER` requirements remain unchanged.
- Provider request limits, batching, checkpoint policy, database writes, and per-market failure isolation remain unchanged.
- The runtime remains manually invoked; no scheduler or API route was added.
- Paper trading remains untouched and no live orders can be placed by this change.

## Files changed

- `src/services/ingestion-diagnostics.mjs` — error classification, safe messages, redaction, and development-only stacks.
- `src/ingest-market-data.mjs` — stage attribution and structured CLI failure output.
- `src/services/bitvavo-public-client.mjs` — preserve transport causes and HTTP status.
- `src/services/market-data-ingestion.mjs` — structured market/stage failures and explicit checkpoint errors.
- `src/repositories/market-ingestion-repository.mjs` — structured storage diagnostics.
- `src/repositories/postgres-read.mjs`, `src/database/pool.mjs`, `src/database/read-only-transaction.mjs`, and `src/database/write-transaction.mjs` — PostgreSQL diagnostic context.
- `tests/ingestion-diagnostics.test.mjs`, `tests/bitvavo-public-client.test.mjs`, and `tests/market-data-ingestion.test.mjs` — cause classification, redaction, stack policy, provider errors, configuration, and checkpoint regression coverage.

## Validation

| Check | Result |
|---|---|
| Raspberry Pi package tests: `npm.cmd --prefix raspberry-pi test` | Passed: 79 tests, 0 failures. |
| Repository tests: `npm.cmd test` | Passed: 441 tests, 0 failures. |
| JavaScript syntax: `node --check` across Raspberry Pi source and tests | Passed: 54 modules checked. |
| `git diff --check` | Passed. |
| Build validation | No Raspberry Pi build script is configured; the package runs Node.js ES modules directly. |
| Live PostgreSQL / Bitvavo ingestion | Not run. |

## Limitations

- Production-specific connectivity, DNS, TLS, and PostgreSQL privilege failures were not induced against the Raspberry Pi; diagnostics are covered with local test doubles.
- Stack traces are restricted to development mode and sanitized, but operators should still treat development logs as sensitive.
- This report does not authorize or perform a live ingestion run. The operator must validate diagnostics during an explicitly approved run on the Pi.

## Phase boundary

Phase 5.3 is limited to ingestion diagnostics and tests under `raspberry-pi/`. No work on AI analysis, paper trading, scheduler cutover, dashboard cutover, or later phases was started.
