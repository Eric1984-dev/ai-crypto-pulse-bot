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

## Planned application endpoints

Market data ingestion, trading, scanner, AI, and realtime endpoints are not implemented.

No endpoint may place real orders. Every future endpoint must document authentication, rate limiting, request/response formats, and error responses.