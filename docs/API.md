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

Returns the active watched-market count, the count with stored market data, available stored snapshots, the latest capture time, and refresh state. Vercel Cron where available, or an external scheduler, can invoke the refresh endpoint to synchronize valid configured EUR markets and refresh stale ticker snapshots. Existing watched-market rows are never overwritten or removed by synchronization.

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

### GET /api/market

Returns the stored snapshot and candles for an enabled, tracked market. When configured with the server-only service role, a candle request refreshes the selected interval from Bitvavo and upserts validated OHLCV rows before returning stored results.

Query parameters:

- `symbol`: required uppercase EUR market symbol, such as `BTC-EUR`.
- `interval`: optional `1m`, `5m`, `15m`, `1h`, `4h`, or `1d` (default `1m`).
- `limit`: optional integer from 1 to 500 (default 200).

Provider errors, empty responses, and timeouts preserve and return the most recent stored data when available; the refresh state and scanner-event log identify failures.

### GET /api/market-refresh

Scheduled-refresh endpoint callable by an external scheduler such as cron-job.org, or by Vercel Cron on plans that support the desired schedule. It requires `Authorization: Bearer <CRON_SECRET>` and a server-only `SUPABASE_SERVICE_ROLE_KEY`. Configure the scheduler to issue a `GET` request to the deployed `/api/market-refresh` URL and send the authorization header; do not put the secret in the URL or query string. The endpoint validates configured symbols against the live public market catalog, adds only missing valid markets, and refreshes stale ticker snapshots. It does not expose either secret.

Market endpoint responses use `Cache-Control: no-store`; Bitvavo data and market catalog entries are cached in memory for 60 seconds. Serverless instances have independent in-memory caches, so the persisted `captured_at` timestamp also determines database freshness.

Errors: unauthenticated/expired session `401`; invalid market query `400`; untracked/disabled market `404`; unsupported method `405`; Supabase storage failure `503`; other request failure `500`. Bitvavo outages are represented as safe fallback data and a non-success `refreshStatus` when persisted data is readable.

## Phase 07 AI analysis

### POST /api/ai-analysis

Runs deterministic analysis over enabled rows in `AI_Crypto_Bot_Watched_Markets`, using only persisted `AI_Crypto_Bot_Market_Data` snapshots and `AI_Crypto_Bot_Candles`. It stores one decision per analyzed market in `AI_Crypto_Bot_AI_Decisions` and updates the existing singleton `AI_Crypto_Bot_Status`. It uses EMA, RSI, MACD, momentum, volume, and volatility indicators. The existing dashboard reads and renders the stored decisions.

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

## Planned application endpoints

Risk-managed trading, paper-trading execution, strategy optimization, backtesting, and realtime endpoints are not implemented. No endpoint may place real orders. Every future endpoint must document authentication, rate limiting, request/response formats, and error responses.