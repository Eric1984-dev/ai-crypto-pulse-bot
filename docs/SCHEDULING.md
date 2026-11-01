# Scheduling

## Phase 06 market refresh

The public market refresh function is available at:

```text
GET /api/market-refresh
```

The endpoint requires `Authorization: Bearer <CRON_SECRET>` and uses the server-only `SUPABASE_SERVICE_ROLE_KEY`. It can be invoked by an external scheduler such as cron-job.org. Vercel Cron is optional on plans that support the required schedule and is not configured in `vercel.json`, so Vercel Hobby deployments do not depend on it.

Each scheduled call refreshes stale ticker snapshots and evaluates enabled, Bitvavo-valid watched markets across `1m`, `5m`, `15m`, `1h`, `4h`, and `1d`. It batch-loads each interval's latest stored timestamps, skips pairs until another candle is due, and requests only the range from the latest timestamp. Requests are bounded by the estimated gap and capped at 500 records; the latest stored candle is included once for final-value updates. A market/interval with no stored history receives a one-time bootstrap request of up to 500 recent candles. Candle requests run with a maximum concurrency of four and reuse the existing 60-second in-memory cache. Upserts use the existing `(symbol, interval, timestamp)` conflict key, so retrying the refresh does not create duplicate candle rows.

The response and function logs expose market-refresh duration, candle-refresh duration, and processed-record counts. Configure an external task with the deployed URL, HTTP method `GET`, and the authorization header. Keep the secret in the scheduler's protected header/credential settings; never put it in the URL or query string. A five-minute cadence is a reasonable starting point when the market-data freshness target is 15 minutes; monitor the returned `candleRefresh` counts and adjust for the size of the enabled market universe. Verify successful calls return HTTP `200`, and investigate partial/storage-unavailable candle statuses.

## Phase 07 AI analysis

The analysis endpoint is available at:

```text
POST /api/ai-analysis
```

It requires `Authorization: Bearer <CRON_SECRET>` and the Supabase server environment (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`). Configure an external scheduler using the deployed URL and `POST`; do not place the secret in the URL or query string. There is no Vercel Cron declaration, so the endpoint remains compatible with Vercel Hobby.

The endpoint skips runs when the existing agent status is `STOPPED` or `ANALYZING`, and stores decisions only in the existing AI decision table. It does not execute trades or modify portfolios. Scheduler cadence is an operator choice; monitor HTTP responses and `AI_Crypto_Bot_Status` after configuring it.

## Future scheduled work

Market scanning, portfolio refresh, strategy evaluation, and market ranking remain unimplemented. Future scheduled jobs must be idempotent, retry-safe, and duplicate-safe. Duplicate executions may never create duplicate trades or strategy changes. Vercel Cron Jobs, external schedulers, and scheduled functions are possible execution providers; the application endpoint should remain scheduler-independent.