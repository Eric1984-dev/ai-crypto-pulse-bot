# Vercel Functions

Phase 02 adds only Supabase Authentication support:

- `auth-config.mjs` returns the public Supabase URL and anon key.
- `auth-session.mjs` validates an access token and manages the HttpOnly route-guard cookie.
- `protected-page.mjs` verifies the session before serving protected HTML.

Application database, market-data, scanner, AI, and trading endpoints are not implemented.
