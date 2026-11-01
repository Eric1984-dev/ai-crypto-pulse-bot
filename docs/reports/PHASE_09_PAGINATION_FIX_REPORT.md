# Phase 09 Pagination Fix Report

## Summary

The scanner's bounded paginated reads now treat HTTP `416` with PostgREST code `PGRST103` on a generated subsequent range as an empty terminal page. Previously, any non-2xx response became `STORAGE_UNAVAILABLE`, causing `/api/market-summary` to fail even after earlier pages had been fetched.

The pagination helper retains rows from successful pages and stops when the terminal page is empty. The special case is restricted to generated ranges after the first page; other HTTP failures, including `416/PGRST103` on the first page, keep the existing error behavior.

## Pagination behavior

- Single-page and multi-page results retain the existing fetch and ranking behavior.
- A later-range `416/PGRST103` returns an empty page, causing the existing short-page condition to stop pagination.
- A successful but incomplete final page is retained and ends pagination normally.
- Scanner calculations and the public API response contract are unchanged.

## Security and scope

- No credentials, response bodies, or user data are logged or exposed.
- No API routes, database schema, or trading logic changed.
- Phase 10 was not started.

## Files changed

- `lib/market-data.mjs` — recognize `416/PGRST103` for generated subsequent pages as end-of-pagination.
- `tests/market-data.test.mjs` — cover single-page, multi-page, out-of-range final page, and incomplete final page behavior.
- `docs/API.md`, `README.md`, `ROADMAP.md`, and `docs/CHANGELOG.md` — document the pagination behavior.

## Validation

- `npm.cmd test` — passed, 142 tests and 0 failures.
- `npm.cmd run build` — passed; static project and database migration validation succeeded.
