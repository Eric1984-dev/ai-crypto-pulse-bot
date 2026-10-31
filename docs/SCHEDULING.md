# Scheduling

## Phase 06 market refresh

The public market refresh function is available at:

```text
GET /api/market-refresh
```

The endpoint requires `Authorization: Bearer <CRON_SECRET>` and uses the server-only `SUPABASE_SERVICE_ROLE_KEY`. It can be invoked by an external scheduler such as cron-job.org. Vercel Cron is optional on plans that support the required schedule and is not configured in `vercel.json`, so Vercel Hobby deployments do not depend on it.

Configure an external task with the deployed URL, HTTP method `GET`, and the authorization header. Keep the secret in the scheduler's protected header/credential settings; never put it in the URL or query string. Choose a frequency supported by the scheduler and verify successful calls return HTTP `200`.

## Future scheduled work

Market scanning, AI analysis, portfolio refresh, strategy evaluation, and market ranking are not implemented. Future scheduled jobs must be idempotent, retry-safe, and duplicate-safe. Duplicate executions may never create duplicate trades or strategy changes.

Vercel Cron Jobs, external schedulers, and scheduled functions are possible execution providers; the application endpoint should remain scheduler-independent.