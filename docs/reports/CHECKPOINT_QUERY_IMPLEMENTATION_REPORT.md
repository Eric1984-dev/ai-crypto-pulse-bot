# Candle Checkpoint RPC Implementation Report

## Summary

Replaced the candle refresh checkpoint scan and per-symbol fallback reads with a single read-only Supabase RPC call per requested interval. The RPC returns the latest stored timestamp for each requested symbol using a `LATERAL` lookup over the existing `(symbol, interval, timestamp)` index.

Refresh freshness checks, overlap/start timestamps, bootstrap limits, candle writes, API responses, and scheduler behavior remain unchanged. The change adds no tables, indexes, endpoints, or Vercel Functions.

## Files changed

- `PostgreSQL/migrations/20261102150000_candle_checkpoint_rpc.sql` — creates the stable, `SECURITY INVOKER` RPC, hardens `search_path`, validates supported intervals, and grants execution only to `service_role`.
- `lib/market-data.mjs` — replaces historical checkpoint reads and missing-symbol fallback reads with the RPC while preserving the `symbol:interval` map and storage error handling.
- `tests/market-data.test.mjs` — covers parity, bootstrap without history, empty batches, histories exceeding 2,000 rows, RPC failures, and unchanged provider start/limit behavior.
- `tests/database-migrations.test.js` — covers function creation, execution permissions, interval validation, and latest-timestamp results.
- `README.md`, `ROADMAP.md`, `docs/DATABASE.md`, `docs/SCHEDULING.md`, and `docs/CHANGELOG.md` — document the implemented checkpoint lookup.

## Validation

- `node --test tests/market-data.test.mjs` — passed, 37 tests.
- `npm.cmd test` — passed, 266 tests.
- `npm.cmd run build` — passed; static project and database migration validation succeeded.

## Deployment status

The RPC was applied and verified in Supabase. The function exists in `public`, is executable by `service_role`, and is not executable by `anon` or `authenticated`. No production application deployment or end-to-end runtime validation was performed. Scheduler configuration and production data were not changed.
