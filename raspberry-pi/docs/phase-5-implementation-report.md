# Phase 5 Implementation Report: Market Data Ingestion Runtime

## Outcome

Implemented a manually invoked, bounded market-data ingestion pass inside `raspberry-pi/`. It fetches public Bitvavo ticker and candle data for enabled markets already stored in PostgreSQL, then writes to existing snapshot, candle, and scanner-event tables. The command exits when the pass finishes; it does not install or start a scheduler.

No application code outside `raspberry-pi/` was changed. No database was contacted for ingestion, and no deployment, migration, schema change, AI analysis, paper trade, or live order was performed.

## Implemented components

- `src/services/bitvavo-public-client.mjs`: public Bitvavo GET-only adapter for 24-hour tickers and candles. It validates symbols, intervals and bounds, applies an 8-second timeout, limits response bodies to 2 MiB, and surfaces safe provider error codes.
- `src/services/market-data-ingestion.mjs`: reads the enabled-market universe from the existing watched-markets repository, validates provider data, processes bounded batches, retrieves per-market candle checkpoints, and isolates per-market failures. Fatal provider/database failures stop further dependent work and are reflected in the result.
- `src/repositories/market-ingestion-repository.mjs`: parameterized writes with explicit column lists to existing market-data, candle and scanner-event tables. Writes use transactions; candles are written in chunks of at most 100. Existing unique keys use `ON CONFLICT`; if a supported legacy conflict constraint is absent, a bounded table-lock/update/insert fallback prevents duplicates without DDL.
- `src/database/write-transaction.mjs`: explicit `BEGIN READ WRITE` transaction helper. Existing API reads remain read-only.
- `src/ingest-market-data.mjs`: one-shot CLI requiring an explicit interval selection, for example `npm run ingest:market-data -- --intervals=1m` or `--intervals=all`. It closes the pool after completion and returns a failing exit status for incomplete runs.
- Ingestion contract validation: uses the current PostgreSQL database and existing tables/columns, permits warnings about legacy constraints and write-capable grants, and still rejects unsafe role/table properties or missing required write privileges.

## Data source, batching, and bounds

- The only market universe source is `public."AI_Crypto_Bot_Watched_Markets"`; no market catalog, seed list, `config/markets.js`, fallback list, or market mutation is used.
- Supported intervals are `1m`, `5m`, `15m`, `1h`, `4h`, and `1d`.
- Processing is bounded to five markets per storage batch, at most four concurrent candle workers, 500 candles per market/interval request, and 100 candles per write chunk.
- Candle checkpoints are derived from the latest stored timestamp for each requested symbol and interval. A first request is bounded to the latest 500 candles; subsequent requests resume from the stored checkpoint. No unbounded backfill is performed.
- At approximately 102 enabled markets, a pass has 21 market batches per interval. `--intervals=all` can make up to 612 candle requests plus one ticker request and store up to 306,000 candles on an initially empty candle table. Begin with selected intervals and monitor Raspberry Pi resource use.
- Provider failures or invalid data are reported without discarding successfully collected markets. Best-effort scanner events are recorded for bounded missing/invalid/storage-failure cases.

## Database identity and credentials

The API's `DATABASE_USER` remains intended to be read-only. The manual ingestion CLI accepts the optional pair `INGESTION_DATABASE_USER` and `INGESTION_DATABASE_PASSWORD`; both must be set together. When provided, those credentials are used only by ingestion. If absent, ingestion uses the regular `DATABASE_USER`, which therefore must have the needed write privileges for that command.

Ingestion writes only existing rows/tables: latest market snapshots, candles, and bounded scanner events. It does not write watched markets or call PostgreSQL runtime functions. No schema or data changes were performed during validation.

## Snapshot history limitation

The existing `AI_Crypto_Bot_Market_Data` schema has a unique key on `symbol`. The implementation therefore updates the existing latest-snapshot row for each market; it cannot preserve a time series of snapshots without changing the schema. This is a known limitation against the broader snapshot-history goal and remains unresolved by design under the no-schema-change constraint. Candle history is stored incrementally in the existing candle table.

## Validation

| Check | Result |
|---|---|
| Raspberry Pi package tests: `npm.cmd --prefix raspberry-pi test` | Passed: 66 tests, 0 failures. |
| Repository tests: `npm.cmd test` | Passed: 428 tests, 0 failures. |
| JavaScript syntax: `node --check` across `raspberry-pi/src` and `raspberry-pi/tests` | Passed: 52 modules checked. |
| `git diff --check` | Passed. |
| Build | Not configured: `raspberry-pi/package.json` has no build script; runtime uses Node.js ES modules directly. |
| PostgreSQL persistence/duplicate-path checks | In-memory PGlite checks passed for writes and duplicate protection with and without the legacy unique constraints, including `BEGIN READ WRITE` with `default_transaction_read_only=on`. No live Pi database was written or used for this phase's ingestion validation. |
| Live Bitvavo-to-Pi ingestion | Not run. The CLI writes data; no production ingestion was started during implementation. |

These results confirm local tests and syntax only. They do not prove the configured Pi role's live grants, production database consistency, or live provider connectivity.

## Assumptions, limitations, and risks

- The pre-existing Raspberry Pi database schema and market data tables are present as reported; actual live ingestion privileges and writes remain to be verified by the operator.
- A separate writer identity is recommended so the API's read-only role is not expanded. Grant it only the necessary privileges on existing ingestion tables.
- Missing constraints are handled through the documented bounded fallback, but pre-existing duplicate keys in an inconsistent database are not repaired.
- The ticker endpoint provides a single 24-hour snapshot response per pass, not historical snapshot data.
- The initial all-interval pass can be substantial for a Raspberry Pi 3 and should not be run without observing resource usage and provider limits.
- No historical candle data is assumed. The first run only requests bounded recent history; longer gaps need later explicit runs.
- No retry scheduler, AI analysis, paper trading, dashboard cutover, or automated recovery loop is included.

## Documentation updated

- `raspberry-pi/README.md`
- `raspberry-pi/docs/runtime-foundation.md`
- `raspberry-pi/docs/phase-2-deployment-validation.md`
- This report

## Phase 6 boundary

Phase 5 stops at manually invoked market-data ingestion. AI analysis and paper trading are not migrated or invoked. Scheduler ownership, cycle ordering, overlap/duplicate control at runtime, and any production cutover remain for separately authorized phases. No Phase 6 work was started.
