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

## Planned application endpoints

The following non-authentication endpoints remain future contracts; they are not implemented.

Alle endpoints draaien in Vercel Functions.

---

GET /api/status

Geeft Agent Status terug.

Response:

{
  "status":"ACTIVE"
}

---

GET /api/market

Marktdata ophalen.

Response:

{
  "btc":100000,
  "eth":3500
}

---

GET /api/portfolio

Portfolio data.

---

GET /api/trades

Trade history.

---

GET /api/ai-decisions

AI beslissingen.

---

POST /api/paper-buy

Voert paper buy uit.

---

POST /api/paper-sell

Voert paper sell uit.

---

POST /api/scan

Marktscan uitvoeren.

---

POST /api/analyze

AI analyse uitvoeren.

---

Geen endpoint mag ooit echte orders plaatsen.

# Standard Error Response

```json
{
  "success": false,
  "error": {
    "code": "MARKET_DATA_UNAVAILABLE",
    "message": "Market data unavailable"
  }
}
```

---

Every endpoint must document:

- Authentication Required
- Rate Limited
- Request Format
- Response Format
- Error Responses