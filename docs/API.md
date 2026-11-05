# API Endpoints

## Phase 02 Authentication endpoints

These Vercel Functions support Supabase Authentication only. The Supabase anon key is intentionally public for browser Auth requests; no service-role key or other server secret is returned.

### GET /api/auth-config

Returns `SUPABASE_URL` and `SUPABASE_ANON_KEY` from the server environment with `Cache-Control: no-store`. This endpoint returns only the Supabase public anon key and URL.

### POST /api/auth-session

Validates a Supabase access token against Supabase Auth and sets a short-lived, `HttpOnly`, `SameSite=Lax` session cookie.

Request:

```json
{
  "accessToken": "<Supabase access token>",
  "expiresIn": 3600
}
```

Success: `204 No Content`. Invalid session: `400` or `401`. Missing configuration or unavailable Auth service: `503`.

### DELETE /api/auth-session

Clears the server-side route-guard cookie. Success: `204 No Content`.

### Protected page routes

Vercel rewrites `dashboard.html`, `analytics.html`, `portfolio.html`, `scanner.html`, `history.html`, and `settings.html` to `/api/protected-page`. The function verifies the HttpOnly cookie with Supabase Auth before returning the page. Unauthenticated or invalid sessions receive a `302` redirect to `/login.html` with a safe internal `next` path. Supabase Auth unavailability fails closed with `503`.

Registration, login, logout, password-reset email, and password updates use the Supabase JS Auth SDK directly. No application database, market, trading, or scanner API is implemented in Phase 02.

## Phase 04 dashboard endpoint

### GET /api/dashboard-data

Authentication is required. The endpoint reads the `cp_access_token` HttpOnly cookie, verifies it with Supabase Auth, and sends the verified user's JWT together with the public anon key on read-only PostgREST requests. Supabase RLS scopes user-owned rows. It does not use a service-role key and does not write data.

The endpoint returns current agent status and emergency state, portfolio count and aggregate values, open-position summary, recent trade summary, enabled watched markets, recent AI decisions, the latest market-data capture timestamp (`lastMarketDataAt`), and up to 100 persisted portfolio snapshots. Open positions include the latest available `current_market_price` and its `current_market_captured_at`; when no market snapshot is available, the stored position price is used. A matching recent BUY trade includes the same position data as `openPosition`. The exact record counts are RLS-filtered. Portfolio history contains only stored snapshots; no chart data is fabricated.

Timestamp fields are returned as UTC values and remain unchanged by the API. Browser clients use the shared formatter to display those instants in `Europe/Brussels`; date filters and daily P&L boundaries remain UTC.

Summary semantics:

- `totalPnl`: sum of visible portfolio values minus their starting balances.
- `dailyPnl`: realized P&L from SELL trades since 00:00 UTC. If the bounded query cannot include all matching trades, it is `null`.
- `winRate`: profitable SELL trades divided by all visible SELL trades.
- Count fields represent all visible matching rows; list fields contain a bounded recent subset.

Success response:

```json
{
  "data": {
    "agentStatus": { "status": "IDLE" },
    "emergencyState": { "status": "NORMAL" },
  "lastMarketDataAt": null,
    "portfolio": {
      "count": 0,
      "portfolioValue": null,
      "totalPnl": null,
      "availableBalance": null,
      "dailyPnl": 0,
      "dailyPnlTradeCount": 0,
      "winRate": null,
      "winRateTradeCount": 0
    },
    "openPositions": { "count": 0, "items": [] },
    "openPositionAiStatus": { "count": 0, "items": [] },
    "recentTrades": { "count": 0, "items": [] },
    "watchedMarkets": { "count": 0, "items": [] },
    "aiDecisions": { "count": 0, "items": [] },
    "portfolioSnapshots": []
  }
}
```

`openPositionAiStatus.items` contains one item per returned open position, enriched with `latestAiDecision` for that position's market. The decision is selected by descending `created_at` and `id` and includes `decision`, `confidence`, `marketStrength` (from the stored `indicators` object), and `created_at`; missing decisions or market strength remain `null`. The Dashboard derives a short human-readable commentary from the decision and Market View, and displays current unrealized EUR P&L plus its percentage of entry cost basis, formatted to two decimals. Raw confidence and Market Strength remain available in the existing response for internal consumers but are not rendered in the position cards. The global `aiDecisions` count/KPI, AI calculations, risk management, paper trading, and existing 30-second and Realtime refresh mechanisms are unchanged. No endpoint or Vercel Function was added.

Unauthenticated or expired session: `401`. Wrong method: `405`. Missing configuration, unavailable Supabase, or invalid database responses: `503`. The endpoint sets `Cache-Control: no-store`; it returns no provider credentials or raw database errors.

The authenticated dashboard requests this endpoint after session initialization, then every 30 seconds while visible and immediately when returning to the foreground. Watched-market symbols and priorities are included in this response. Its subtle activity strip displays the stored bot `last_run`, latest market-data `captured_at`, and latest paper-trade timestamp. Analytics and Market Scanner are on-demand views and do not persist run history, so they are labeled accordingly rather than given fabricated timestamps. The dashboard does not request scanner rankings; the dedicated Scanner page uses `/api/market-summary`. Browser requests and server-side PostgREST reads use `no-store`; no endpoint or response contract was added for this refresh behavior.

### Trade History view

The existing `GET /api/dashboard-data` function also serves the authenticated trade-history page when requested with `view=trade-history`; this does not add a Vercel Function. Optional query parameters:

- `page`: positive, 1-based page number. Results contain at most 25 trades; out-of-range pages are clamped to the last available page.
- `search`: up to 32 ASCII letters, digits, dot, underscore, or hyphen; performs a case-normalized market-symbol prefix search.
- `side`: `all`, `buy`, or `sell`.
- `period`: `all`, `24h`, `7d`, or `30d`; the shorter periods use a rolling UTC cutoff.
- `sort`: `newest`, `oldest`, `market`, `action`, `price-high`, `price-low`, `quantity-high`, `quantity-low`, `fees-high`, `fees-low`, `pnl-high`, or `pnl-low`.

The database count and the selected page use the caller's verified JWT and existing trade-table RLS policy. No trade rows are loaded into the browser except the requested page. The response includes the filtered exact count, page metadata, and the selected execution fields (`id`, `symbol`, `side`, `price`, `quantity`, `fees`, `realized_pnl`, and `created_at`). A BUY matching an open position also includes `openPosition` with its amount, entry price, latest market price, and snapshot timestamp.

Success response:

```json
{
  "data": {
    "page": 1,
    "pageSize": 25,
    "totalCount": 1,
    "totalPages": 1,
    "sort": "newest",
    "filters": { "search": "", "side": "all", "period": "all" },
    "items": [{
      "id": "stored-trade-id",
      "symbol": "BTC-EUR",
      "side": "SELL",
      "price": "65000",
      "quantity": "0.01",
      "fees": "0.25",
      "realized_pnl": "12.5",
      "created_at": "2026-03-20T12:00:00.000Z"
    }],
    "stats": {
      "closedTrades": 1,
      "winningTrades": 1,
      "losingTrades": 0,
      "averageProfit": 12.5,
      "averageLoss": null,
      "bestTrade": 12.5,
      "worstTrade": 12.5
    }
  }
}
```

Statistics are all-time and intentionally independent of the current list filters/page. The `AI_Crypto_Bot_Trade_History_Stats()` stable `SECURITY INVOKER` RPC aggregates only the caller's RLS-visible stored SELL executions: profitable/losing counts use realized P&L above/below zero, averages include only positive or negative values respectively, and best/worst use the maximum/minimum realized P&L. Breakeven SELLs count as closed but neither winning nor losing. BUY rows show no realized P&L unless they match an open position, in which case the page displays unrealized P&L and return percentage. SELL rows display derived entry/exit prices and realized return percentage. These are presentation-only calculations from existing fields; no database or trading calculation is changed. The Status column shows `OPEN` for active BUY positions, `CLOSED · Paper Trade` for SELL executions, and `Executed · Paper Trade` otherwise.

The page uses the existing 30-second visible-tab refresh cadence, with same-origin credentials and `no-store` requests. An empty result is a successful empty page, not an API error. Invalid view/filter values return `400`; unauthenticated sessions return `401`; missing permissions, migration, configuration, or database availability fail closed with the existing generic `503` dashboard response. Every persisted trade is shown with status `Executed · Paper Trade`; the trades table has no separate status column.

### Analytics view

The protected `analytics.html` page uses `GET /api/dashboard-data?view=analytics`; this is a view on the existing authenticated Vercel Function, not a new function or endpoint. The handler verifies the same HttpOnly session and reads with the caller's JWT and anon key, so existing Supabase RLS policies remain in force. It reads portfolios, positions, trades, AI decisions, and portfolio snapshots only; it creates no records.

The response contains:

- `tradePerformance`: closed/winning/losing/breakeven trade counts; win/loss rates; average win/loss; profit factor; realized, unrealized, and total P&L; best/worst trade and largest winner/loser; average hold time; open/closed position counts; and per-symbol performance.
- `aiPerformance`: confidence buckets (`70–75`, `75–80`, `80–85`, `85+`), BUY/SELL/HOLD/WAIT action results, strategy and symbol results, best/worst scored confidence ranges, and decision/scored/unscored counts. Confidence and strategy groups also expose `tradeCount`, the number of distinct closed trades represented in their scored outcomes, for evidence-based recommendation sample sizes.
- `portfolio`: current value and growth, maximum drawdown, equity curve, drawdown history, and daily, weekly, and monthly performance.
- `dataQuality`: unmatched or unpaired trade/decision counts.
- `exportCounts`: report-row counts for the four Analytics CSV types.

The optional `period` parameter accepts `30d`, `90d`, or `365d` and defaults to `30d`; ranges are rolling UTC windows. It filters historical trades, AI decisions, and portfolio snapshots. Current portfolio values, total account P&L, and open/closed position metrics remain current account metrics. The selected period is returned as `period` and its UTC cutoff as `periodStart`.

The service reads stable pages of at most 500 rows, prefetching at most four pages per source query. Exact RLS-scoped counts bound the final page. A PostgREST `416/PGRST103` on a subsequent range for any Analytics source is treated as end-of-results; successful earlier pages are retained and prefetched pages after the terminal range are ignored. First-page `416` responses, other `416` codes, and other short, missing, or inconsistent pages fail closed rather than returning partial analytics. Trade and decision streams are merged by market and timestamp, while snapshot calculations run concurrently. Only aggregates and bounded series are returned to the browser; daily, weekly, and monthly series remain capped at 365, 260, and 120 points. Portfolio drawdown and period performance use snapshots within the selected range. The first available in-range snapshot establishes the period baseline; current account total P&L remains all-time.

Calculation and attribution semantics:

- Win/loss rates divide winning/losing SELL trades by all SELL trades in the selected range; breakeven SELL trades remain in the denominator but count as neither wins nor losses. Average loss remains signed. Profit factor is gross realized gains divided by the absolute gross realized losses, and is unavailable when there are no realized losses.
- Realized P&L sums stored SELL `realized_pnl` in the selected range; unrealized P&L sums stored `unrealized_pnl` for current OPEN positions. Total P&L is the sum of current portfolio values less combined starting balances and remains an all-time account metric.
- Hold time is inferred from paired BUY/SELL trade timestamps. It is unavailable when no pairs exist.
- Confidence buckets are non-overlapping: `70 <= confidence < 75`, `75 <= confidence < 80`, `80 <= confidence < 85`, and `85 <= confidence <= 100`. Values below 70 are reported separately.
- BUY outcomes use a paired subsequent SELL result; SELL outcomes use their stored realized P&L. HOLD is scored only when an open position exists, using its subsequent realized result or current unrealized P&L if still open. Decisions without an attributable outcome are marked unscored. This is outcome attribution, not a counterfactual test of alternative decisions.
- Portfolio daily/weekly/monthly performance and the equity/drawdown curves are derived from stored snapshots; no missing history is fabricated.

Unauthenticated sessions return `401`; invalid data views or periods return `400`; authentication or database unavailability returns the existing generic `503` response. Temporary Analytics failure logs include the request view/export type, exact dataset, exact PostgREST method/path/query, operation, page/range, HTTP status, allowlisted database error code, Supabase message/details/hint, and failure category. They do not include rows, access tokens, request headers, or the full response body. When `NODE_ENV=development`, the same query diagnostics are returned under `error.diagnostics`; production responses contain only the existing generic error code and message. Use these logs to identify which source query failed after deployment; local mocks cannot establish hosted Supabase behavior. Remove the temporary diagnostics after the production root cause is confirmed. Responses are `no-store`.

### AI Recommendations view

The protected `recommendations.html` page uses `GET /api/dashboard-data?view=recommendations&period=<30d|90d|365d>` on the existing authenticated function. It runs the existing bounded Analytics loader with the caller's verified JWT/RLS visibility and derives advisory recommendations from its aggregates. The default period is `30d`; the supported windows are rolling 30, 90, and 365 days. No source records are written and recommendations never change strategies, risk controls, markets, portfolio settings, AI parameters, or trades.

The response contains the analysis period and cutoff, generation timestamp, closed-trade sample size, the insufficient-data flag, and recommendations grouped under AI Performance, Market Selection, Portfolio Management, Risk Management, and Strategy Quality. Each recommendation includes its reason, supporting metrics, descriptive estimated impact, confidence tier, sample size/unit, period, and generated timestamp. At least 10 closed trades are required for preliminary recommendations; confidence is Preliminary for 10–49 represented closed trades, Medium for 50–99, and High for 100 or more. Confidence-bucket comparisons use a conservative lower bound of distinct closed trades represented on each side and separately report the scored-outcome counts used in their outcome metrics. If fewer than 10 closed trades exist, the recommendation list is empty and `insufficientData` is true. Confidence-bucket evidence is outcome-attributed Analytics data and is not a counterfactual estimate.

Example:

```json
{
  "data": {
    "generatedAt": "2026-03-21T12:00:00.000Z",
    "analysisPeriod": "30d",
    "periodStart": "2026-02-19T12:00:00.000Z",
    "closedTrades": 12,
    "insufficientData": false,
    "minimumSampleSize": 10,
    "recommendations": [{
      "category": "Strategy Quality",
      "title": "Review Momentum · 1.0",
      "reason": "Scored outcomes for this strategy had negative net P&L and a lower win rate than the account-wide rate.",
      "metrics": [
        { "label": "Scored outcomes", "value": 12, "format": "count" },
        { "label": "Win rate", "value": 25, "format": "percent" },
        { "label": "Net P&L", "value": -20, "format": "currency" }
      ],
      "estimatedImpact": "Reviewing the strategy may help address observed weakness; future performance is not guaranteed.",
      "confidenceLevel": "Preliminary",
      "sampleSize": 12,
      "sampleUnit": "scored decision outcomes",
      "analysisPeriod": "30d",
      "generatedAt": "2026-03-21T12:00:00.000Z"
    }],
    "categories": [
      { "name": "AI Performance", "recommendations": [] },
      { "name": "Market Selection", "recommendations": [] },
      { "name": "Portfolio Management", "recommendations": [] },
      { "name": "Risk Management", "recommendations": [] },
      { "name": "Strategy Quality", "recommendations": [] }
    ]
  }
}
```

The page refreshes after relevant AI-decision, trade, position, portfolio, or snapshot Realtime events, on period changes, and through a 30-second visible-page polling fallback. Hosted Realtime delivery remains subject to the existing publication configuration.

### CSV Exports view

The protected Exports page reuses the authenticated `GET /api/dashboard-data` function; it adds no endpoint or Vercel Function. Both views require a verified session and use the caller's JWT and existing RLS policies:

- `view=export-count&type=<trades|portfolio|decisions|positions>&period=<24h|7d|30d|all>` returns `{ "data": { "exportType": "...", "period": "...", "recordCount": 123 } }`. For Analytics report types, `period=<30d|90d|365d>` returns the generated CSV report-row count; it defaults to `30d`.
- `view=export&type=<trades|portfolio|decisions|positions|analytics-summary|trade-analytics|portfolio-analytics|ai-analytics|recommendations|recommendation-history>&period=<24h|7d|30d|all|90d|365d>` streams a CSV response. Raw datasets retain their existing filters and are read in stable, 500-row Range pages written incrementally. Analytics and recommendation exports use the same selected period and calculations as their dedicated pages.

The date filters use rolling UTC cutoffs. The CSV is UTF-8 with a BOM, CRLF line endings, a header row, standard quoting, and spreadsheet-formula neutralization for untrusted text.

Export columns:

- **Trades** (`AI_Crypto_Bot_Trades`): Date, Symbol, Action, Entry Price, Quantity, Invested Amount, Fees, Gross Value, Net Value, Realized PnL, Status. Gross Value is execution price × quantity. BUY Invested Amount equals gross value and Net Value includes fees; SELL Net Value subtracts fees and Realized PnL comes from the stored trade. BUY realized PnL and SELL invested amount are blank. Status is `Executed · Paper Trade`.
- **Portfolio snapshots** (`AI_Crypto_Bot_Portfolio_Snapshots`): Timestamp, Portfolio Value, Available Balance, Open Positions, Total PnL, Daily PnL. Total PnL uses the stored portfolio starting balance; Daily PnL aggregates stored realized SELL PnL by portfolio and UTC day, consistent with the dashboard.
- **AI decisions** (`AI_Crypto_Bot_AI_Decisions`): Timestamp, Symbol, Decision, Confidence, Market Strength, Reason. Market Strength is read from the stored `indicators.marketStrength` value.
- **Positions** (`AI_Crypto_Bot_Positions`): Open Date, Symbol, Entry Price, Current Price, Position Value, Unrealized PnL, Status. Position Value uses the stored current price × amount.
- **Analytics Summary**: metric, value, unit, and methodology/detail rows.
- **Trade Analytics**: overall and per-symbol closed/winning/losing/breakeven counts, win rate, average outcomes, profit factor, realized P&L, largest outcomes, and average hold time.
- **Portfolio Analytics**: one row per retained daily period with portfolio value, period P&L, drawdown, and growth.
- **AI Analytics**: confidence-bucket, action, strategy, and market outcome summaries, including scored/unscored decisions and attributed P&L.
- **Recommendation exports**: category, recommendation, rationale, supporting metrics, historical impact description, confidence, period, generated timestamp, sample size, and sample unit. Recommendation History is recomputed from stored Analytics inputs and explicitly does not represent an archived sequence of earlier generations.

Analytics reports support rolling 30-, 90-, and 365-day ranges; each report on the Exports page has its own date selector, defaulting to 30 days. A report's count and download use that card's selected period, and counts are based on report rows rather than source trade/decision counts. Raw data exports continue to use their existing 24-hour, 7-day, 30-day, and all-data filters.

Analytics Export count/download failures use the same Analytics source loader and query diagnostics as the Analytics page. Production responses remain generic; development diagnostics identify the request view and export type as well as the failing source query.

The export view returns `400` for invalid export types or periods and `401` for missing or expired sessions. Configuration, permission, and database failures use the existing generic `503` response. Once streaming starts, a later storage failure terminates the stream rather than returning a success-shaped partial file. Responses are `no-store` and contain no provider credentials or raw database errors.

## Phase 05 Agent Status endpoint

### GET /api/agent-status

Authentication is required. The endpoint verifies the `cp_access_token` HttpOnly cookie with Supabase Auth, then selects the current `status` from `AI_Crypto_Bot_Status` using the anon key and the user's access token. RLS remains in force. It is read-only and returns no service-role credentials.

Success response:

```json
{
  "data": {
    "status": "ANALYZING"
  }
}
```

When there is no valid status row, success returns `{"data":{"status":null}}`; the dashboard displays `UNKNOWN` and a neutral visualization. The dashboard polls this endpoint every 15 seconds while visible. An expired session returns `401`; missing configuration or provider/database failure returns `503`; unsupported methods return `405`. Responses use `Cache-Control: no-store`.

## Phase 06 public Bitvavo market data

The market endpoints require a valid `cp_access_token` session and preserve the caller's JWT for RLS-protected reads. They use only Bitvavo's public `GET /v2/markets`, `GET /v2/ticker/24h`, and `GET /v2/{market}/candles` endpoints. No Bitvavo key, private endpoint, account, balance, portfolio, or order access is used.

### GET /api/market-summary

Returns the active watched-market count, the count with stored market data, available stored snapshots, the latest capture time, and refresh state. Vercel Cron where available, or an external scheduler, can invoke the refresh endpoint to synchronize valid configured EUR markets, refresh stale ticker snapshots, and collect candle history. Existing watched-market rows are never overwritten or removed by synchronization.

Success response:

```json
{
  "data": {
    "activeMarkets": 102,
    "marketsWithData": 102,
    "items": [{
      "symbol": "BTC-EUR",
      "price": 65000,
      "volume": 123.4,
      "daily_change": 1.2,
      "high_24h": 66000,
      "low_24h": 64000,
      "captured_at": "2026-03-20T12:00:00.000Z"
    }],
    "refreshedAt": "2026-03-20T12:00:00.000Z",
    "refreshStatus": "refreshed"
  }
}
```

The response also includes `data.scanner`, generated from the same existing endpoint and authenticated database reads. It contains `activeMarkets`, `marketsWithFreshData`, and `watchedMarkets` (the complete enabled market list ordered by priority, with each market's `symbol` and `priority`), plus rankings for `24h`, `7d`, and `30d`; each timeframe has `topGainers`, `topLosers`, `highestVolume`, `strongestMomentum`, and `aiOpportunities` arrays. Each ranking is capped at ten rows. AI opportunities contain `symbol`, `confidence`, `decision`, `reason`, and `created_at`. Paginated scanner reads treat `416/PGRST103` on a generated subsequent range as an empty terminal page; rows already fetched are retained. Other storage failures keep the existing error behavior.

The scanner uses enabled rows from `AI_Crypto_Bot_Watched_Markets`, market snapshots from `AI_Crypto_Bot_Market_Data`, daily/hourly OHLCV rows from `AI_Crypto_Bot_Candles`, and stored decisions from `AI_Crypto_Bot_AI_Decisions`. The 24-hour change and estimated EUR turnover use the stored ticker snapshot; 7-day and 30-day change/turnover use daily candles. Momentum uses 6-hour hourly-candle change for `24h`, 3-day daily-candle change for `7d`, and 7-day daily-candle change for `30d`. It selects the latest stored decision per active market inside the selected period and ranks by confidence, then decision priority and recency. Price rankings require a market snapshot no older than 15 minutes; unavailable or invalid input is omitted instead of fabricated. The scanner is read-only and does not create AI decisions or trades.

The dedicated Scanner page consumes the rankings and complete watched-market list in this response. The Dashboard does not request this endpoint or display the list; it obtains the Tracked Markets KPI from `/api/dashboard-data`. No new API function or database schema is introduced. Browser requests use `cache: "no-store"` and same-origin session credentials.

When a market-summary database read fails and `NODE_ENV` is exactly `development`, the error response additionally includes `error.diagnostics` with a safe query name, failure category, HTTP status, and allowlisted Supabase error code. This field is omitted in production; raw database messages, request URLs, and credentials are never returned. Empty or stale rows are not classified as query failures.

When a market-summary storage operation fails, server logs include the query/table/operation, page number and range, HTTP status, allowlisted Supabase error code, and failure category. Example: `FAILED_QUERY=scanner.daily-candles TABLE=AI_Crypto_Bot_Candles OPERATION=SELECT PAGE=2 RANGE=1000-1999 HTTP_STATUS=403 ERROR_CODE=42501 FAILURE_CATEGORY=RLS_OR_PERMISSION`. Missing values are logged as `unknown` or `none`. These values are bounded internal metadata; tokens, secrets, user data, request URLs, and response bodies are not logged. The public production error response remains unchanged.

### GET /api/market

Returns the stored snapshot and candles for an enabled, tracked market. When configured with the server-only service role, a candle request refreshes the selected interval from Bitvavo and upserts validated OHLCV rows before returning stored results.

Query parameters:

- `symbol`: required uppercase EUR market symbol, such as `BTC-EUR`.
- `interval`: optional `1m`, `5m`, `15m`, `1h`, `4h`, or `1d` (default `1m`).
- `limit`: optional integer from 1 to 500 (default 200).

Provider errors, empty responses, and timeouts preserve and return the most recent stored data when available; the refresh state and scanner-event log identify failures.

### GET /api/market-refresh

A scheduler-protected endpoint for watched-market synchronization and ticker snapshots only. It does not collect candles. It requires `Authorization: Bearer <CRON_SECRET>` and a server-only `SUPABASE_SERVICE_ROLE_KEY`; configure an external scheduler to issue a `GET` request. Do not put the secret in the URL or query string. The service validates configured symbols against Bitvavo's public market catalog, adds only missing valid markets, and refreshes stale ticker snapshots.

Success includes market snapshot data and `metrics.marketRefreshDurationMs`, `metrics.marketDataRefreshDurationMs`, and `metrics.recordsProcessed.marketData`. Successful metrics are logged. The endpoint does not expose either secret. Supabase response-byte instrumentation currently covers AI analysis and scheduled candle refresh only; it does not cover this endpoint or browser-direct traffic.

### GET /api/candle-refresh

A separate scheduler-protected endpoint that accepts one candle interval and one zero-based market batch per invocation. It requires the same authorization header and server-only Supabase service role as `/api/market-refresh`.

Query parameters:

- `interval`: required `1m`, `5m`, `15m`, `1h`, `4h`, or `1d`.
- `batch`: required zero-based non-negative integer. Enabled, Bitvavo-valid watched markets are sorted by priority and symbol and split into batches of at most five.

Example: `GET /api/candle-refresh?interval=1m&batch=0`. The response reports active market count, `batch`, `batchSize`, `batchCount`, selected-market count, attempted/refreshed/missing/failed/cached/unchanged/skipped counts, provider requests, upserted candle count, and a `marketOutcomes` entry for each selected market. `refreshed` counts only markets whose validated rows were persisted. `metrics.candleRefreshDurationMs`, `metrics.recordsProcessed.candles`, `metrics.candleWriteRequests`, and `metrics.candleWriteFallbacks` report refresh duration, successfully persisted rows, candle-table POST attempts, and per-market fallback attempts. `metrics.supabaseResponseTraffic` groups the server-side Supabase requests made during this invocation by HTTP method and path. It includes request counts, any response `Content-Length` values exposed to the function, and an explicitly estimated UTF-8 size for parsed JSON bodies. Bitvavo requests, query strings, credentials, headers, and response contents are not included. This diagnostic is emitted in the existing completion log and returned as part of the existing metrics; it does not write to Supabase or add a route.

The endpoint reads latest stored timestamps for the requested interval, skips markets without a completed new candle, and requests only the incremental range from the latest stored timestamp. Requests are capped at 500 candles, including a bounded bootstrap for markets without history. A four-request provider concurrency cap, 60-second per-instance cache, and existing `(symbol, interval, timestamp)` upsert key remain in place. Validated rows from successful markets in an invocation are sent in one bulk upsert using `resolution=merge-duplicates`, so an updated latest forming candle is retained. If the bulk write fails, the endpoint retries each market's rows independently; one persistent market write failure does not block the other retries. The same unique conflict key makes retries safe if the bulk request committed but its response was lost. Candle OHLCV rows stay compatible with the AI Engine and use only the existing `AI_Crypto_Bot_Candles` table.

Invalid interval/batch input: `400`; missing cron authorization: `401`; missing environment configuration: `503`; upstream/storage failures are reflected in the batch status and scanner-event log. A valid request can return HTTP `200` with a partial or unavailable status, so callers must inspect the response data and metrics.

## Phase 07 AI analysis

Each candle interval is accepted only when its latest valid candle is not future-dated and is within its freshness limit: `1m` 30 minutes, `5m` 2 hours, `15m` 6 hours, `1h` 12 hours, `4h` 24 hours, and `1d` 72 hours. A stale interval is excluded as a whole; when fewer than two intervals with at least 26 valid candles remain, the engine stores `WAIT` with reason `STALE_CANDLE_DATA`. Older historical candles remain available for indicator lookback when that interval's latest candle is fresh. The market snapshot retains its independent 15-minute freshness check.

### POST /api/ai-analysis

Runs deterministic analysis over enabled rows in `AI_Crypto_Bot_Watched_Markets`, using only persisted `AI_Crypto_Bot_Market_Data` snapshots and `AI_Crypto_Bot_Candles`. The compact implementation calls the additive, service-role-only `AI_Crypto_Bot_Get_Latest_AI_Candles_Compact` RPC with up to four enabled markets for each supported interval. SQL validates uppercase EUR symbols against enabled watched-market rows and returns one group per requested symbol. Each group's `candles` array contains up to 150 newest-first six-value tuples in this order: `[timestamp, open, high, low, close, volume]`; an enabled market with no candle history receives an empty array. The caller supplies the interval and symbol list, reconstructs the existing candle rows, verifies requested-symbol order and tuple shape, and requests `Prefer: count=exact`. Missing or partial `Content-Range` metadata and any incomplete or malformed group fail closed. The compact RPC's outer PostgREST result contains at most four rows and requires `max_rows >= 4`. The original flat-row RPC remains available for compatibility; keep its existing `max_rows >= 600` prerequisite until the matching compact caller is deployed. The intended production project identity and hosted setting have not been verified. The engine retains the existing six-interval freshness checks, candle validation, indicator inputs, and decision formulas. It stores one decision per analyzed market in `AI_Crypto_Bot_AI_Decisions` and updates the existing singleton `AI_Crypto_Bot_Status`. It uses EMA, RSI, MACD, momentum, volume, and volatility indicators. The existing dashboard reads and renders the stored decisions.

The maximum compact response is four top-level market groups; each may contain up to 150 candles. The compact tuple format preserves all candle values and order while avoiding repeated symbol, interval, and field-name strings. Apply the additive migration before deploying the matching caller; the old function and caller remain compatible during that sequence. Do not lower PostgREST `max_rows` while the legacy caller may still be active. The repository's local Supabase config does not define this setting; the hosted value has not been verified or changed. If `Content-Range` is unavailable or indicates truncation, analysis fails closed with an invalid database-response error. The existing `AI analysis completed.` runtime log now includes `supabaseResponseTraffic`, grouped by method and pathname, for server-side Supabase requests made by that analysis invocation. It reports exposed response `Content-Length` totals when present and a separately labeled JSON-body byte estimate computed after parsing. Neither value should be described as an exact billable wire-byte measurement; the summary excludes query strings, credentials, response contents, browser-direct traffic, and other function invocations. It is diagnostic-only and is not persisted to the database.

This server-to-server endpoint requires `Authorization: Bearer <CRON_SECRET>` and `POST`; the request has no body. A configured `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and server-only `SUPABASE_SERVICE_ROLE_KEY` are also required. No service-role key or raw database error is returned. An external scheduler may invoke the endpoint; no Vercel Cron schedule is required.

Success response:

```json
{
  "data": {
    "status": "ACTIVE",
    "analyzedMarkets": 1,
    "decisionsStored": 1,
    "waitingDecisions": 0
  }
}
```

An existing `STOPPED` or `ANALYZING` status returns a successful skipped result without writing decisions. Empty market universes return `IDLE`. Missing/stale snapshots or insufficient candles produce safe low-confidence `WAIT` or `HOLD` decisions rather than fabricated data.

Errors: unsupported method `405`; missing cron secret `503` (`CRON_NOT_CONFIGURED`); invalid scheduler authorization `401` (`CRON_AUTH_REQUIRED`); missing Supabase/service-role configuration `503` (`AI_ENGINE_NOT_CONFIGURED`); database/analysis failures `503` (`AI_ANALYSIS_UNAVAILABLE`). Responses use `Cache-Control: no-store`.

## Phase 08 paper trading

### POST /api/paper-trading

This server-to-server endpoint invokes the service-role-only `AI_Crypto_Bot_Run_Paper_Trading` database function. It uses only the newest stored AI decision per enabled market and the corresponding stored market snapshot; the database rejects stale decisions and snapshots. It does not call Bitvavo or any exchange endpoint.

Required headers and environment:

- `Authorization: Bearer <CRON_SECRET>`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only)
- `ENABLE_LIVE_TRADING=false`

The request has no body. Schedule it after `/api/ai-analysis` completes. Runs are serialized with a database advisory lock, and the unique trade idempotency key is deterministically derived from the portfolio and AI-decision IDs. Repeating a request cannot create a duplicate trade for the same decision.

The shared paper-trading service also makes a best-effort call to the separate shadow-exit evaluator before execution and, when trades execute, afterward. Shadow evaluation errors are logged separately and do not fail the paper-trading run. The evaluator writes only shadow scenario state/events; it cannot create AI decisions, trades, positions, balances, or portfolio snapshots. The actual BUY/SELL RPC and its risk controls are unchanged.

BUY decisions open a position only with confidence at least 67 (the separate AI Engine signal-generation floor is 65), a fresh market snapshot, no active emergency/pause, fewer than five open positions, no same-market trade within 15 minutes, and remaining daily/portfolio drawdown capacity. Entry notional is capped at 10% of current portfolio value and available funds. SELL decisions close all open positions for that market when a fresh snapshot is available; HOLD and WAIT never trade. SELL can reduce risk without the entry confidence/cooldown gates. Trading fees are 0.25%; simulated slippage is 0.10%.

Daily drawdown of 5% and maximum portfolio drawdown of 15% prevent new entries. A 20% peak drawdown writes an `EMERGENCY_STOP` event and sets Agent Status to `STOPPED`. Existing positions remain visible; only a valid SELL can close them. A stale/invalid input fails closed and never creates a trade.

Success response includes `data.status` (`COMPLETED` or `SKIPPED`), portfolio/decision/trade/duplicate/skip counts, and `metrics.paperTradingDurationMs`. Successful metrics are logged without credentials. Unsupported method: `405`; missing cron configuration or Supabase configuration: `503`; invalid authorization: `401`; missing or non-false live-trading flag: `503`; database failure or invalid RPC response: `503`. Responses use `Cache-Control: no-store`.

The authenticated `GET /api/dashboard-data` response includes real realized and unrealized P&L summaries when the corresponding bounded history/position reads are complete. If a query exceeds its supported page size, the affected aggregate is `null`, not an incomplete sum.

The same authenticated read-only response also includes `shadowExitScenarios` for open positions and up to five recent closed-position groups. Each position contains the fixed, versioned rule grid and its tracking/trigger/finalization state, observed mark, modeled hypothetical net outcome, and—after an actual close—the actual close details for comparison. Missing or invalid scenario data is reported separately from actual portfolio metrics. This uses the existing `/api/dashboard-data` function and RLS-readable shadow-state table; no API route or Vercel Function was added. These values are simulations and are not actual P&L or executable fills.

## Dashboard Admin Actions

### GET /api/admin-actions

Verifies the current HttpOnly Supabase session against Supabase Auth and checks the verified user ID against the server-only `ADMIN_USER_IDS` environment variable. The allowlist is a comma-separated list of Supabase Auth user UUIDs. An authorized administrator receives `{ "data": { "isAdmin": true } }`; ordinary authenticated users receive `403`, and missing/expired sessions receive `401`. The dedicated protected `admin.html` page keeps its actions and Admin navigation link hidden unless this check succeeds.

### POST /api/admin-actions

Runs one of the existing server-side services on demand. The request uses the existing same-origin Supabase session cookie; the browser never receives or sends `CRON_SECRET` or `SUPABASE_SERVICE_ROLE_KEY`.

Request body:

```json
{ "action": "ai-analysis" }
```

or:

```json
{ "action": "paper-trading" }
```

The response contains the underlying service result in `data` and `metrics.executionDurationMs`. AI analysis still observes Agent Status and its normal in-progress/STOPPED behavior. Paper trading still requires `ENABLE_LIVE_TRADING=false` and invokes the same database RPC and risk controls as the scheduled endpoint; it does not bypass decision freshness, confidence, cooldown, position, drawdown, emergency-stop, or idempotency checks. The action result can report a successful request that was skipped by those existing safeguards; inspect `data.status`.

Required server configuration: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `ADMIN_USER_IDS`; paper-trading actions also require `ENABLE_LIVE_TRADING=false`. The cron secret remains server-side and is not used by dashboard JavaScript.

Errors: unsupported method `405`; invalid action `400`; missing/expired Supabase session `401`; authenticated non-admin `403`; missing allowlist or Supabase configuration `503`; AI/database action failure `503`. Responses use `Cache-Control: no-store`. This endpoint exposes no market-refresh or candle-refresh action.

## Phase 11 Supabase Realtime

Realtime updates are delivered directly by Supabase Realtime using the existing authenticated Supabase JS client; there is no application Realtime endpoint and no new Vercel Function. Dashboard, portfolio, history, and scanner subscriptions only listen to the tables needed by each view. Change payloads are not rendered or forwarded; a debounced notification triggers the corresponding existing authenticated API request, which preserves the current session-cookie verification and RLS behavior. Existing polling continues during disconnection and provides a fallback.

The client reconnects Realtime channels automatically. Browser offline/online and visibility events update the connection status and trigger a catch-up refresh. Each browser tab has its own channel and removes its subscription and event listeners when its page is disposed. The publication membership migration is documented in [DATABASE.md](./DATABASE.md). Production Supabase migration and reconnect smoke tests are deployment checks; they are not represented as locally verified.

## Planned application endpoints

Strategy optimization, backtesting, and live-trading endpoints are not implemented. No endpoint may place real orders. Every future endpoint must document authentication, rate limiting, request/response formats, and error responses.
