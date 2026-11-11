# Vercel dashboard bridge

The `api/` directory intentionally contains only three functions:

- `auth-session.mjs` forwards single-admin login, session lookup, and logout to the Raspberry Pi API.
- `protected-page.mjs` checks the Pi session before returning protected dashboard HTML.
- `dashboard-data.mjs` forwards a single allowlisted, authenticated `/api/v1/` request to the configured Pi API origin.

These are transport/authentication bridges only. Market ingestion, analysis, paper trading, monitoring, and scheduling run on the Raspberry Pi. Supabase-backed legacy routes and scheduler-trigger functions were removed in Phase 10. See [API documentation](../docs/API.md) and the [cleanup report](../docs/post-migration-cleanup-report.md).
