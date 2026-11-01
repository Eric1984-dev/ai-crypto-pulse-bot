# Exports Module Report

## Architecture

The protected `exports.html` page uses the existing authenticated `/api/dashboard-data` Vercel Function. `view=export-count` provides an exact RLS-filtered row count, while `view=export` streams CSV output from stable Supabase Range requests. Server-side reads use the verified session JWT and existing row-level security; there is no new API endpoint, function file, dependency, or database migration.

The browser downloads the CSV directly through a same-origin URL rather than buffering it in a JavaScript Blob. The server writes each bounded page as it is fetched and respects response backpressure. A failure before streaming returns the existing generic error response; a storage failure after streaming starts terminates the connection instead of presenting a partial file as successful.

## Exported datasets and CSV structure

All exports use a UTF-8 BOM, CRLF line endings, a header row, RFC-style CSV quoting, and formula-injection neutralization for untrusted cells. Timestamps remain UTC. Supported rolling periods are Last 24 Hours, Last 7 Days, Last 30 Days, and All Data.

| Export | Source | Columns |
|---|---|---|
| Trades | `AI_Crypto_Bot_Trades` | Date, Symbol, Action, Entry Price, Quantity, Invested Amount, Fees, Gross Value, Net Value, Realized PnL, Status |
| Portfolio Snapshots | `AI_Crypto_Bot_Portfolio_Snapshots` | Timestamp, Portfolio Value, Available Balance, Open Positions, Total PnL, Daily PnL |
| AI Decisions | `AI_Crypto_Bot_AI_Decisions` | Timestamp, Symbol, Decision, Confidence, Market Strength, Reason |
| Positions | `AI_Crypto_Bot_Positions` | Open Date, Symbol, Entry Price, Current Price, Position Value, Unrealized PnL, Status |

Trade values are derived from existing execution fields: gross value is price × quantity; BUY invested amount equals gross value and BUY net value includes fees; SELL net value subtracts fees and realized PnL is the stored value. Non-applicable BUY/SELL columns are blank. The status is the fixed label `Executed · Paper Trade` because the source table has no status column. Portfolio total PnL uses the stored starting balance; daily PnL aggregates realized SELL PnL by portfolio and UTC day, matching the dashboard definition. Decision market strength uses the stored `indicators.marketStrength` field. Position value is stored current price × amount. These exports do not change trading or database calculations.

## Performance and large-dataset strategy

- Count queries use Supabase exact counts without returning all rows.
- CSV reads are ordered consistently and paginated in 500-row ranges.
- CSV data is emitted incrementally; application memory is bounded by the current page and small aggregation maps needed for portfolio context, not the complete trade/decision/position dataset.
- Portfolio context aggregation uses bounded database reads and retains only starting balances and per-portfolio/day realized-PnL aggregates.
- The browser initiates a direct download, avoiding a full-file in-memory Blob and reducing the chance of UI freezes.

Exact counts and portfolio daily-PnL aggregation still require database work proportional to the relevant records. Very large exports may take longer to complete; the page reports the selected filter and count before download.

## Files changed

- `exports.html`, `js/exports.js`, `css/styles.css` — protected export UI, filters, states, and downloads.
- `lib/exports.mjs`, `api/dashboard-data.mjs` — dataset definitions, count queries, pagination, CSV mapping/streaming, and integration with the existing API function.
- `js/auth.js`, `api/protected-page.mjs`, `vercel.json` — route protection.
- `dashboard.html`, `portfolio.html`, `scanner.html`, `history.html`, `settings.html`, `admin.html`, `index.html` — protected navigation links.
- `scripts/validate-project.js`, `tests/auth.test.js`, `tests/project-setup.test.js` — project and route validation.
- `tests/exports.test.mjs`, `tests/exports-ui.test.js` — export-service, route, CSV, large-dataset, and UI tests.
- `README.md`, `docs/API.md`, `docs/TESTING.MD`, `docs/CHANGELOG.md` — project documentation.
- `docs/reports/EXPORTS_MODULE_REPORT.md` — this report.

## Tests and build validation

Validation completed against the final implementation:

- `npm.cmd test`: passed, 181 tests and 0 failures.
- `npm.cmd run build`: passed static project validation and database migration validation (16 prefixed tables, RLS coverage, and initial seed consistency).
- API function count: verified at 12 files.

The tests use mocked Supabase responses and do not verify a hosted database, deployed Vercel streaming, or production authentication configuration.

## Vercel function count

Exports uses the existing `api/dashboard-data.mjs` function for both count and stream requests. No API file was added; the verified function count remains **12**.

Phase 13 has not been started.
