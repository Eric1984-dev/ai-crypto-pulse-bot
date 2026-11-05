# AI Candle RPC Hardening Implementation Report

## Summary

Hardened the bounded AI candle-read RPC locally. The database now enforces the enabled-market contract, and the AI caller requests an exact PostgREST count and rejects responses whose `Content-Range` is missing, unknown, or inconsistent with the returned rows. The migration remains unapplied; no production settings, data, deployments, paper trades, or live-trading behavior were changed.

## Contract and safety

- The RPC accepts one supported interval and one to four unique, non-empty uppercase `*-EUR` symbols.
- SQL rejects malformed symbols and symbols that are absent from or disabled in `AI_Crypto_Bot_Watched_Markets`. A disable between the caller's watched-market read and RPC invocation therefore fails closed.
- The function remains `SECURITY INVOKER`, uses an empty `search_path`, qualifies referenced objects, and retains the per-symbol descending timestamp query with `LIMIT 150`.
- Execution remains revoked from `PUBLIC`, `anon`, and `authenticated`, and granted only to `service_role`.
- The caller sends `Prefer: count=exact`. It accepts a response only when the exact total and reported range agree with the body; `*/0` is accepted for a complete empty result. Missing count metadata or a partial range raises `INVALID_DATABASE_RESPONSE`, preventing incomplete candle groups from reaching analysis.
- A full four-market batch can return 600 rows. The API function count remains 12; no route or dependency was added.

## Compatibility and regression coverage

The PGlite migration test seeds distinguishable values for two enabled markets, 200 rows per market and interval, and all six supported intervals. For each interval it compares all returned candle fields against the previous REST selection (`ORDER BY symbol, timestamp DESC`, retaining the newest 150 per symbol), checks per-symbol order and uniqueness, and exercises an enabled market with no candle rows.

Additional tests cover null arrays and entries, empty arrays, blank and duplicate symbols, malformed and unknown symbols, disabled markets, excessive group size, unsupported/null intervals, the service-role-only grants (including the `PUBLIC` ACL), and incomplete or uncounted caller responses. The migration tests also assert the invoker security mode, empty search path, and 150-row SQL limit.

The AI indicator, freshness, and decision formulas were not changed. For a complete RPC result, the per-market candle fields and latest-150 selection remain equivalent to the former path. An incomplete API response now fails the analysis run instead of being silently consumed.

## PostgREST rollout prerequisite

`supabase/config.toml` does not define `max_rows`; its local project identifier and seed settings do not establish the hosted value. The intended production project identity and its hosted `max_rows` were not verified in this task. Before a controlled migration/deployment, confirm both the project identity and that its PostgREST `max_rows` is at least 600. No hosted setting was changed.

## Validation performed

| Command | Result |
|---|---|
| `node --test tests/ai-engine.test.mjs tests/database-migrations.test.js` | Passed: 49 tests, 0 failures |
| `npm.cmd test -- --test-reporter=dot` | Passed: full test suite exited 0 |
| `npm.cmd run build` | Passed: static project and database migration validation |
| `git diff --check` | Passed |
| `(Get-ChildItem -Path api -Recurse -File \| Where-Object { $_.Extension -in @('.mjs', '.js', '.ts') } \| Measure-Object).Count` | 12 API function files; unchanged |

No Supabase migration was applied and no deployment was performed.

## Files changed for this follow-up

- `README.md`
- `ROADMAP.md`
- `lib/ai-engine.mjs`
- `supabase/migrations/20261105120000_ai_candle_history_rpc.sql`
- `tests/ai-engine.test.mjs`
- `tests/database-migrations.test.js`
- `docs/API.md`
- `docs/ARCHITECTURE.md`
- `docs/CHANGELOG.md`
- `docs/DATABASE.md`
- `docs/TESTING.MD`
- `docs/reports/AI_CANDLE_RPC_HARDENING_IMPLEMENTATION_REPORT.md`

## Recommendation

The local code and tests are ready for a controlled rollout only after the intended Supabase project identity and hosted `max_rows >= 600` are confirmed. If that setting cannot be verified or is lower, hold migration/deployment; do not silently accept the truncated response.
