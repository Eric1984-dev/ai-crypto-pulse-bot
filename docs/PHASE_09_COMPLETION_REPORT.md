# Phase 09 Completion Report — Market Scanner

## Status

Phase 09 is implemented and validated. No Phase 10 functionality was started.

## Architecture

- The scanner reads enabled EUR markets from `AI_Crypto_Bot_Watched_Markets`, ticker snapshots from `AI_Crypto_Bot_Market_Data`, OHLCV history from `AI_Crypto_Bot_Candles`, and stored AI decisions from `AI_Crypto_Bot_AI_Decisions`.
- Server-side ranking is implemented in `lib/market-scanner.mjs` and wired into `lib/market-data.mjs`.
- The existing authenticated `GET /api/market-summary` endpoint now includes the scanner summary. No API route or database object was added.
- `scanner.html` uses the existing session guard and `js/scanner.js`. The Dashboard preview described in the original Phase 09 implementation was later removed; the current Dashboard does not request scanner rankings or display scanner content.
- All browser reads use same-origin credentials and `no-store`. The scanner is read-only and neither generates AI decisions nor places trades.

## Scanner calculations and ranking

| Ranking | 24h | 7d | 30d |
|---|---|---|---|
| Gainers/losers | Stored snapshot `daily_change` | Current snapshot price versus the nearest daily candle at or before the 7-day baseline | Current snapshot price versus the nearest daily candle at or before the 30-day baseline |
| Highest volume | Stored 24-hour base volume multiplied by current price, as estimated EUR turnover | Sum of daily candle base volume multiplied by each candle close | Sum of daily candle base volume multiplied by each candle close |
| Strongest momentum | 6-hour change from hourly candles | 3-day change from daily candles | 7-day change from daily candles |
| AI opportunities | Latest stored decision per active market within the selected period | Same, restricted to the selected 7-day period | Same, restricted to the selected 30-day period |

Price rankings require a valid market snapshot no older than 15 minutes. Missing or invalid inputs are omitted rather than replaced with mock values. Historical baseline candles must be within the scanner's bounded gap tolerance. Each ranking returns at most ten rows. AI opportunities include symbol, confidence, decision, reason, and decision timestamp; ordering is by confidence, decision priority, recency, and symbol.

## Dashboard and scanner UI

- The scanner page provides 24h, 7d, and 30d controls for Top Gainers, Top Losers, Highest Volume, Strongest Momentum, and AI Opportunities.
- It refreshes every 30 seconds while visible, refreshes when returning to the foreground, prevents duplicate in-flight requests, and shows loading, error, and empty states.
- The Dashboard displays tracked-market symbols and priorities only. All five scanner rankings remain on the dedicated Scanner page.
- User-facing values are inserted as text, not HTML.

## Database and API changes

- Database schema/migrations: none.
- New API endpoints/functions: none.
- Existing endpoint extended: `GET /api/market-summary`.
- Candle and decision reads use bounded PostgREST Range pagination. Candle history is limited to 34 daily rows and 12 hourly rows per active market; decision retrieval is capped at 5,000 rows.
- Vercel API function sources verified: **12**. The project remains at the Hobby plan limit.

## Files changed

- `lib/market-scanner.mjs`
- `lib/market-data.mjs`
- `lib/market-handler.mjs`
- `js/scanner.js`
- `js/dashboard.js`
- `scanner.html`
- `dashboard.html`
- `css/styles.css`
- `tests/market-scanner.test.mjs`
- `tests/market-scanner-ui.test.js`
- `tests/market-data.test.mjs`
- `tests/dashboard.test.js`
- `README.md`
- `ROADMAP.md`
- `docs/API.md`
- `docs/DATABASE.md`
- `docs/ARCHITECTURE.md`
- `docs/TESTING.MD`
- `docs/CHANGELOG.md`
- `docs/PHASE_09_COMPLETION_REPORT.md`

## Tests and validation

- `npm test` — passed: **137 tests, 0 failures**.
- `npm run build` — passed: static project validation and database migration validation (16 prefixed tables, RLS coverage, initial seed consistency).
- Vercel API source count — **12**.
- Scanner-focused tests cover gainers, losers, volume, momentum, AI ranking, empty datasets, 1,500-market ranking, range pagination, UI timeframe selection, safe rendering, request coalescing, and dashboard integration.

## Performance considerations and limitations

- Ranking work is bounded to the active watched-market set and ten displayed rows per ranking. Database queries are paginated instead of relying on PostgREST's first-page result.
- 7d/30d rankings depend on stored daily candles; 24h momentum depends on hourly candles. Markets without adequate history will not appear in those rankings.
- Quote-volume values are estimates derived from stored base volume and price, not exchange-reported EUR turnover.
- Decision retrieval is capped at 5,000 recent rows. In exceptionally high decision-volume periods, older decisions may be outside the fetched window.
- Automated validation used fixtures and mocked Supabase requests. No live Supabase smoke test or Vercel deployment was performed.
- Follow-up: dashboard scanner requests and preview markup were removed during UI language standardization. The current behavior is covered by dashboard regression tests and is documented in the Phase 12 validation report.

## Acceptance criteria

- [x] Top Gainers, Top Losers, Highest Volume, Strongest Momentum, and AI Opportunities.
- [x] 24h, 7d, and 30d filters.
- [x] Active watched markets and existing real stored data only.
- [x] Dashboard integration and existing API reuse.
- [x] Sorting, bounded rankings, empty-data handling, and large-dataset tests.
- [x] Documentation updated; no new API function or database schema.
- [x] `npm test`, `npm run build`, and the 12-function count verified.

Phase 09 is complete. Phase 10 remains unstarted.
