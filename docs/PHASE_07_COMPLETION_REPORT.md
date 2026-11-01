# Phase 07 Completion Report — AI Engine

## Implementation summary

Phase 07 adds a server-side deterministic technical-analysis engine. It reads enabled markets and real persisted market snapshots/candles, calculates EMA, RSI, MACD, momentum, volume, volatility, and 24-hour range context, then stores a confidence-scored `BUY`, `SELL`, `HOLD`, or `WAIT` decision for each analyzed market.

The existing `AI_Crypto_Bot_Status` singleton transitions through `ANALYZING` and then `ACTIVE`, `IDLE`, or `ERROR`. `STOPPED` and already-`ANALYZING` states prevent an analysis run. Status updates include `updated_at`. Existing dashboard data and rendering already consume the persisted AI decision history.

No schema migration or new table was added. The engine does not create trades or orders and does not modify portfolios, positions, balances, market snapshots, or candles.

## AI architecture and analysis flow

```text
External scheduler
  -> POST /api/ai-analysis (Authorization: Bearer CRON_SECRET)
  -> AI_Crypto_Bot_Status and AI_Crypto_Bot_Watched_Markets
  -> AI_Crypto_Bot_Market_Data and AI_Crypto_Bot_Candles
  -> deterministic indicator and confidence model
  -> AI_Crypto_Bot_AI_Decisions
  -> existing authenticated dashboard
```

The endpoint uses the server-only service role for database reads and writes. The service uses bounded candle-query concurrency and per-request timeouts. It reads each market/interval combination separately, with a 1,000-row limit per interval, so a global PostgREST response cap cannot starve the later intervals. It logs analysis start, each analyzed market and generated decision/confidence, completion, and failures without logging credentials or raw provider errors.

## Decision logic and confidence model

- Each timeframe needs at least 26 valid candles. The analysis supports `1m`, `5m`, `15m`, `1h`, `4h`, and `1d`.
- Technical features combine EMA12/EMA26 trend spread, RSI14, MACD histogram, five-candle price momentum, recent-versus-average volume, and ATR-style volatility.
- Available market context combines the 24-hour change with the current price's position in the validated 24-hour high/low range.
- The weighted timeframe score is combined with market context. Confidence increases with signal strength, candle coverage/depth, and a fresh market snapshot, and is reduced by high volatility.
- A stale, invalid, or absent market snapshot produces `WAIT`. Fewer than two sufficiently populated timeframes produces `WAIT`; partial coverage caps confidence below the directional threshold and yields `HOLD` when otherwise analyzable. Neutral or low-confidence analysis produces `HOLD`.
- Directional decisions require adequate data and a confidence score of at least 65. Confidence remains bounded from 0 to 95 in the current model.
- Missing candles are never synthesized. Invalid candle rows are ignored and counted in decision indicators.

## Endpoint

`POST /api/ai-analysis` is protected by the shared timing-safe `CRON_SECRET` Bearer check. It requires `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in the server environment. It has no request body and returns the run status and analyzed/stored/waiting counts. It returns generic errors rather than raw database details.

No Vercel Cron route or external scheduler has been configured by this change. An operator can call the endpoint from an external scheduler, including cron-job.org, as documented in [Scheduling](./SCHEDULING.md) and [Deployment](./DEPLOYMENT.md).

## Database usage

Reads:

- `AI_Crypto_Bot_Status`
- `AI_Crypto_Bot_Watched_Markets`
- `AI_Crypto_Bot_Market_Data`
- `AI_Crypto_Bot_Candles`

Writes:

- `AI_Crypto_Bot_AI_Decisions` — one decision per enabled market per successful analysis run.
- `AI_Crypto_Bot_Status` — analysis lifecycle and `updated_at`.

No other table is written. RLS policies and migrations remain unchanged; service-role usage stays server-side.

## Files changed

Added:

- `api/ai-analysis.mjs`
- `lib/ai-engine.mjs`
- `lib/cron-auth.js`
- `tests/ai-engine.test.mjs`
- `docs/PHASE_07_COMPLETION_REPORT.md`
- `docs/PHASE_07_CANDLE_QUERY_FIX_REPORT.md`

Modified:

- `api/market-refresh.mjs` — reuse the shared scheduler authorization helper.
- `scripts/validate-project.js` — require the AI endpoint, engine service, and shared authorization helper.
- `README.md`
- `ROADMAP.md`
- `docs/API.md`
- `docs/ARCHITECTURE.md`
- `docs/DATABASE.md`
- `docs/TESTING.MD`
- `docs/SCHEDULING.md`
- `docs/DEPLOYMENT.md`
- `docs/CHANGELOG.md`

## Tests and validation

Added AI engine and API tests covering indicator outputs, bullish/bearish/neutral decisions, confidence bounds and partial-data reduction, missing/stale/invalid inputs, decision persistence, status PATCH behavior, STOPPED/empty-market behavior, database failures, scheduler authorization/configuration, and generic failure responses. The candle query regression simulates the PostgREST 1,000-row cap and verifies all six intervals reach the persisted decision. Existing dashboard tests cover the authenticated AI decision response and recent-decision rendering.

| Command | Result |
|---|---|
| `node --test tests/ai-engine.test.mjs tests/dashboard.test.js` | Passed: 29 tests |
| `npm.cmd test` | Passed: 89 tests, 0 failures |
| `npm.cmd run build` | Passed: static project validation and database migration validation (16 prefixed tables, RLS coverage, seed consistency) |

Tests use deterministic fixtures and mocked PostgREST responses; they do not represent a live Supabase, Bitvavo, scheduler, or deployment smoke test.

## Known limitations

- The engine is deterministic technical analysis, not a trained or generative AI model.
- The endpoint is not scheduled automatically. Configure an external scheduler and server environment variables before expecting recurring analysis.
- If candle history is empty or incomplete, decisions are deliberately conservative (`WAIT`/`HOLD`) with reduced confidence.
- The current decision table has no analysis-run idempotency key; a scheduler retry may persist another decision row for the same market.
- No live Supabase or production endpoint verification was performed.

## Phase 08 readiness

Phase 07 is complete and the existing dashboard can display the persisted decisions. The project is ready to begin Phase 08 implementation, but this phase does not implement or authorize trading. Phase 08 must add its own risk-manager validation and paper-trading execution safeguards before any decision can mutate a simulated portfolio. Phase 08 has not been started.

## Follow-up: interval-aware candle retrieval

The original multi-interval query applied one row limit to all intervals combined. With intervals sorted alphabetically and rows ordered newest-first within each interval, the 1,000-row PostgREST response cap could fill with `15m` and `1d` rows before the other intervals were returned. The engine now requests each supported interval independently, retaining the existing analysis, confidence model, tables, and schema. Regression coverage verifies that all six intervals are represented when the stored counts exceed the former combined-query cap. See [the candle query fix report](./PHASE_07_CANDLE_QUERY_FIX_REPORT.md) for the follow-up validation results.
