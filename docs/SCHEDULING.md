# Scheduling

## Phase 06 market refresh

Market snapshots use a lightweight endpoint:

```text
GET /api/market-refresh
```

This job only synchronizes watched markets, refreshes stale ticker snapshots, and updates market summaries. It does not request or write candles. It requires `Authorization: Bearer <CRON_SECRET>` and the server-only `SUPABASE_SERVICE_ROLE_KEY`. Invoke it with an external scheduler such as cron-job.org; Vercel Cron is not configured, so Vercel Hobby deployments do not depend on it. A five-minute cadence is a reasonable starting point for snapshots.

## Phase 06 candle refresh

Candles use a separate endpoint, processing exactly one supported interval and at most five markets per invocation:

```text
GET /api/candle-refresh?interval=1m&batch=0
```

`interval` must be one of `1m`, `5m`, `15m`, `1h`, `4h`, or `1d`. `batch` is a zero-based non-negative integer. Enabled, Bitvavo-valid watched markets are ordered by priority and symbol, then partitioned into batches of five. The response includes `batchCount`; schedule every batch index for each desired interval. For example, 102 eligible markets require 21 batches per interval. Stagger tasks where possible to avoid simultaneous provider/database bursts, and set each interval's cadence according to the required candle freshness.

The endpoint uses the same `Authorization: Bearer <CRON_SECRET>` header and server-only Supabase service role as the market refresh. Store the secret in the scheduler's protected header settings; never put it in a URL or query string. Set the scheduler's HTTP timeout to at least 90 seconds and monitor `candleRefreshDurationMs`, `recordsProcessed.candles`, `providerRequests`, `batchCount`, and the returned status. The service keeps incremental latest-timestamp reads, skips intervals with no completed candle, caps incremental/bootstrap requests at 500 candles, uses a maximum concurrency of four, preserves the 60-second cache, and upserts on `(symbol, interval, timestamp)`. `AI_Crypto_Bot_Candles` remains the AI Engine data source.

`/api/market-refresh` reports `marketRefreshDurationMs`, `marketDataRefreshDurationMs`, and market snapshot counts. `/api/candle-refresh` reports candle duration and candle counts independently. Successful HTTP `200` responses may still contain `partial`, `provider-unavailable`, or `storage-unavailable` results; inspect status and failure counts rather than treating HTTP success alone as proof that all data refreshed.

## Phase 07 AI analysis

The analysis endpoint is available at:

```text
POST /api/ai-analysis
```

It requires `Authorization: Bearer <CRON_SECRET>` and the Supabase server environment (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`). Configure an external scheduler using the deployed URL and `POST`; do not place the secret in the URL or query string. There is no Vercel Cron declaration, so the endpoint remains compatible with Vercel Hobby.

The endpoint skips runs when the existing agent status is `STOPPED` or `ANALYZING`, and stores decisions only in the existing AI decision table. It does not execute trades or modify portfolios. Scheduler cadence is an operator choice; monitor HTTP responses and `AI_Crypto_Bot_Status` after configuring it.

## Phase 08 paper-trading execution

After `/api/ai-analysis` has returned success, invoke:

```text
POST /api/paper-trading
Authorization: Bearer <CRON_SECRET>
```

Configure `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, and `ENABLE_LIVE_TRADING=false` in Vercel's server environment. The endpoint accepts no body. Keep the cron secret in protected scheduler-header settings, never in the URL or task name. No Vercel Cron configuration is required, so this also works on Vercel Hobby.

Schedule the paper-trading request only after the AI-analysis request completes; do not run them concurrently. Use the same cadence as AI analysis (five minutes is a suitable example when analysis runs every five minutes). The database processes only the newest stored decision per enabled market, serializes overlapping paper jobs, and makes repeated requests idempotent. Running more often does not create repeat trades for the same decision.

Inspect the JSON status and the `paperTradingDurationMs`, `portfoliosProcessed`, `decisionsProcessed`, `tradesExecuted`, `duplicates`, and `skipped` metrics. A skipped run may indicate that analysis is still in progress or another paper-trading invocation holds the database lock. The 15-minute freshness check, confidence/risk checks, and per-market cooldown are enforced in the database. No private Bitvavo endpoint, account credential, or real order is used.

## Future scheduled work

Market scanning, portfolio strategy evaluation, market ranking, backtesting, and live trading remain unimplemented. Future scheduled jobs must be idempotent, retry-safe, and duplicate-safe. Duplicate executions may never create duplicate trades or strategy changes. Vercel Cron Jobs, external schedulers, and scheduled functions are possible execution providers; the application endpoint should remain scheduler-independent.
