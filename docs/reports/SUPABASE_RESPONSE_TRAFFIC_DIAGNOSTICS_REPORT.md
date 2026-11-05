# Supabase Response-Traffic Diagnostics Report

## Result

Added per-invocation Supabase response diagnostics to the existing scheduled AI-analysis and candle-refresh paths. The metrics are included in their existing structured Vercel runtime completion logs; candle refresh also returns them in its existing metrics response. No new function, route, scheduler entry, database table, migration, or production setting was added.

For each Supabase HTTP method and pathname, the summary reports:

- Request count.
- The sum and count of response `Content-Length` headers exposed to the function.
- A separate UTF-8 JSON-body size estimate based on re-serializing successfully parsed JSON.

Query strings, credentials, headers, request/response contents, and non-Supabase requests such as Bitvavo are excluded. Metrics are not persisted in Supabase. The wrapper filters by the configured Supabase origin.

## Measurement limits

`Content-Length` is only available for some responses. `jsonBodyBytesEstimate` is not a measured wire size: it is calculated after JSON parsing and re-serialization, and does not represent compressed transfer bytes. Minimal write responses may not contain a parsed JSON body. Browser-direct traffic and other functions, including market refresh, paper trading, dashboard, scanner, and analytics, are outside this initial instrumentation scope.

Use the Supabase Usage page as the authoritative aggregate egress measurement. These per-function summaries help compare server-side endpoint payloads but do not exactly allocate billed egress by endpoint. Logs are stored in Vercel Runtime Logs according to the project's plan retention; no Log Drain was configured.

## Changed files

- `lib/supabase-response-metrics.mjs`
- `lib/ai-engine.mjs`
- `lib/market-data.mjs`
- `tests/supabase-response-metrics.test.mjs`
- `tests/ai-engine.test.mjs`
- `tests/market-data.test.mjs`
- `docs/API.md`
- `docs/SCHEDULING.md`
- `docs/CHANGELOG.md`

## Validation

- `node --test tests/supabase-response-metrics.test.mjs tests/ai-engine.test.mjs tests/market-data.test.mjs` — passed, 67 tests.
- `npm.cmd test -- --test-reporter=dot` — passed (exit code 0).
- `npm.cmd run build` — passed; static project and database migration validation succeeded.
- `git diff --check` — passed.

No production calls were made by this implementation task, and no deployment was performed. Vercel logs will contain the new fields only after the code is deployed and the scheduled functions run.
