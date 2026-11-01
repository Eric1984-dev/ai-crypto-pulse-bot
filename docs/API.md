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

Vercel rewrites `dashboard.html`, `portfolio.html`, `scanner.html`, `history.html`, and `settings.html` to `/api/protected-page`. The function verifies the HttpOnly cookie with Supabase Auth before returning the page. Unauthenticated or invalid sessions receive a `302` redirect to `/login.html` with a safe internal `next` path. Supabase Auth unavailability fails closed with `503`.

Registration, login, logout, password-reset email, and password updates use the Supabase JS Auth SDK directly. No application database, market, trading, or scanner API is implemented in Phase 02.

## Phase 04 dashboard endpoint

### GET /api/dashboard-data

Authentication is required. The endpoint reads the `cp_access_token` HttpOnly cookie, verifies it with Supabase Auth, and sends the verified user's JWT together with the public anon key on read-only PostgREST requests. Supabase RLS scopes user-owned rows. It does not use a service-role key and does not write data.

The endpoint returns current agent status and emergency state, portfolio count and aggregate values, open-position summary, recent trade summary, enabled watched markets, recent AI decisions, and up to 100 persisted portfolio snapshots. The exact record counts are RLS-filtered. Portfolio history contains only stored snapshots; no chart data is fabricated.

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
    "recentTrades": { "count": 0, "items": [] },
    "watchedMarkets": { "count": 0, "items": [] },
    "aiDecisions": { "count": 0, "items": [] },
    "portfolioSnapshots": []
  }
}
```

Unauthenticated or expired session: `401`. Wrong method: `405`. Missing configuration, unavailable Supabase, or invalid database responses: `503`. The endpoint sets `Cache-Control: no-store`; it returns no provider credentials or raw database errors.

The authenticated dashboard requests this endpoint after session initialization, then every 30 seconds while visible and immediately when returning to the foreground. The separate market-summary request is refreshed with it. Both browser requests and server-side PostgREST reads use `no-store`; no endpoint or response contract was added for this refresh behavior.

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

The response also includes `data.scanner`, generated from the same existing endpoint and authenticated database reads. It contains active/fresh-market counts and rankings for `24h`, `7d`, and `30d`; each timeframe has `topGainers`, `topLosers`, `highestVolume`, `strongestMomentum`, and `aiOpportunities` arrays. Each ranking is capped at ten rows. AI opportunities contain `symbol`, `confidence`, `decision`, `reason`, and `created_at`.

The scanner uses enabled rows from `AI_Crypto_Bot_Watched_Markets`, market snapshots from `AI_Crypto_Bot_Market_Data`, daily/hourly OHLCV rows from `AI_Crypto_Bot_Candles`, and stored decisions from `AI_Crypto_Bot_AI_Decisions`. The 24-hour change and estimated EUR turnover use the stored ticker snapshot; 7-day and 30-day change/turnover use daily candles. Momentum uses 6-hour hourly-candle change for `24h`, 3-day daily-candle change for `7d`, and 7-day daily-candle change for `30d`. It selects the latest stored decision per active market inside the selected period and ranks by confidence, then decision priority and recency. Price rankings require a market snapshot no older than 15 minutes; unavailable or invalid input is omitted instead of fabricated. The scanner is read-only and does not create AI decisions or trades.

The scanner page and dashboard preview consume this response; no new API function or database schema is introduced. Browser requests use `cache: "no-store"` and same-origin session credentials.

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

Success includes market snapshot data and `metrics.marketRefreshDurationMs`, `metrics.marketDataRefreshDurationMs`, and `metrics.recordsProcessed.marketData`. Successful metrics are logged. The endpoint does not expose either secret.

### GET /api/candle-refresh

A separate scheduler-protected endpoint that accepts one candle interval and one zero-based market batch per invocation. It requires the same authorization header and server-only Supabase service role as `/api/market-refresh`.

Query parameters:

- `interval`: required `1m`, `5m`, `15m`, `1h`, `4h`, or `1d`.
- `batch`: required zero-based non-negative integer. Enabled, Bitvavo-valid watched markets are sorted by priority and symbol and split into batches of at most five.

Example: `GET /api/candle-refresh?interval=1m&batch=0`. The response reports active market count, `batch`, `batchSize`, `batchCount`, selected-market count, attempted/refreshed/missing/failed/cached/unchanged/skipped counts, provider requests, and upserted candle count. `metrics.candleRefreshDurationMs` and `metrics.recordsProcessed.candles` are reported separately from snapshot metrics.

The endpoint reads latest stored timestamps for the requested interval, skips markets without a completed new candle, and requests only the incremental range from the latest stored timestamp. Requests are capped at 500 candles, including a bounded bootstrap for markets without history. A four-request concurrency cap, 60-second per-instance cache, and existing `(symbol, interval, timestamp)` upsert key remain in place. Candle OHLCV rows stay compatible with the AI Engine and use only the existing `AI_Crypto_Bot_Candles` table.

Invalid interval/batch input: `400`; missing cron authorization: `401`; missing environment configuration: `503`; upstream/storage failures are reflected in the batch status and scanner-event log. A valid request can return HTTP `200` with a partial or unavailable status, so callers must inspect the response data and metrics.

## Phase 07 AI analysis

### POST /api/ai-analysis

Runs deterministic analysis over enabled rows in `AI_Crypto_Bot_Watched_Markets`, using only persisted `AI_Crypto_Bot_Market_Data` snapshots and `AI_Crypto_Bot_Candles`. Candle rows are queried separately for each supported interval, with a per-interval limit, so a global PostgREST response cap cannot starve later intervals. It stores one decision per analyzed market in `AI_Crypto_Bot_AI_Decisions` and updates the existing singleton `AI_Crypto_Bot_Status`. It uses EMA, RSI, MACD, momentum, volume, and volatility indicators. The existing dashboard reads and renders the stored decisions.

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

BUY decisions open a position only with confidence at least 70, a fresh market snapshot, no active emergency/pause, fewer than five open positions, no same-market trade within 15 minutes, and remaining daily/portfolio drawdown capacity. Entry notional is capped at 10% of current portfolio value and available funds. SELL decisions close all open positions for that market when a fresh snapshot is available; HOLD and WAIT never trade. SELL can reduce risk without the entry confidence/cooldown gates. Trading fees are 0.25%; simulated slippage is 0.10%.

Daily drawdown of 5% and maximum portfolio drawdown of 15% prevent new entries. A 20% peak drawdown writes an `EMERGENCY_STOP` event and sets Agent Status to `STOPPED`. Existing positions remain visible; only a valid SELL can close them. A stale/invalid input fails closed and never creates a trade.

Success response includes `data.status` (`COMPLETED` or `SKIPPED`), portfolio/decision/trade/duplicate/skip counts, and `metrics.paperTradingDurationMs`. Successful metrics are logged without credentials. Unsupported method: `405`; missing cron configuration or Supabase configuration: `503`; invalid authorization: `401`; missing or non-false live-trading flag: `503`; database failure or invalid RPC response: `503`. Responses use `Cache-Control: no-store`.

The authenticated `GET /api/dashboard-data` response includes real realized and unrealized P&L summaries when the corresponding bounded history/position reads are complete. If a query exceeds its supported page size, the affected aggregate is `null`, not an incomplete sum.

## Dashboard Admin Actions

### GET /api/admin-actions

Verifies the current HttpOnly Supabase session against Supabase Auth and checks the verified user ID against the server-only `ADMIN_USER_IDS` environment variable. The allowlist is a comma-separated list of Supabase Auth user UUIDs. An authorized administrator receives `{ "data": { "isAdmin": true } }`; ordinary authenticated users receive `403`, and missing/expired sessions receive `401`. The dashboard keeps the Admin Actions section hidden unless this check succeeds.

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

## Planned application endpoints

Market Scanner, strategy optimization, backtesting, realtime, and live-trading endpoints are not implemented. No endpoint may place real orders. Every future endpoint must document authentication, rate limiting, request/response formats, and error responses.