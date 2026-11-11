# Known Issues

## Current post-migration verification boundaries

- The operator reports the Pi runtime, PostgreSQL, scheduler, AI, paper trading, dashboard, authentication, Cloudflare Tunnel, and custom domain are operational; this workspace has not independently checked those live services.
- External scheduler-provider configuration and Vercel project settings were not inspected. The repository has no Vercel Cron configuration, and the Pi runtime is the documented scheduler owner.
- The optional archive-copy CLI still has a restricted Supabase source connection. It is not a trading/runtime dependency and was retained because its retirement was not confirmed.
- Historical sections below describe issues from the former Supabase/Vercel runtime and are not statements about the current Pi deployment.

## Open Production Validation

- Phase 14 local Chromium checks cover all 12 pages at 320px, 768px, and 1280px and pass without horizontal overflow. Physical iPhone/Android/desktop rendering, Chrome/Edge/Safari coverage, Lighthouse, and hosted production smoke checks remain unverified.
- The hosted Supabase migration history, RLS/grants, and Realtime publication state have not been verified in this environment. The Phase 11 publication migration and live Realtime/reconnect smoke tests remain pending.
- Production authentication, dashboard, scanner, Bitvavo ingestion, AI analysis, paper-trading jobs, and Admin Actions have not been smoke-tested against a deployed Vercel/Supabase environment.
- The Analytics pagination fix treats HTTP `416` on `analytics.ai-decisions` as end-of-results and is covered by local regressions, including the production-reported `1000-1499` range. The production error is not verified as resolved until this change is deployed and Analytics plus Analytics Exports are smoke-tested; the original Supabase message/details remain unavailable.
- A prior Market Scanner HTTP 503 (`MARKET_DATA_UNAVAILABLE`) was associated with a failing database/PostgREST read, but its original query and production root cause remain unconfirmed. The later-range `416/PGRST103` pagination case has a targeted fix; production errors remain generic.
- Market snapshot, candle refresh, AI analysis, and paper-trading execution require configured external scheduler jobs. Production scheduler configuration and execution are unverified.
- Admin Actions require the server-side `ADMIN_USER_IDS` allowlist to be configured and verified.
- Phase 15 AI Recommendations have local automated coverage but have not been verified against hosted Supabase, deployed Vercel, or live Realtime. Recommendation History exports are recomputed from current stored Analytics data; prior generated recommendation snapshots are not retained.
- Database-mode AI analysis has produced PostgreSQL `57014` statement-timeout failures in the candle-read query. The observed PostgREST `authenticator` role has an 8-second `statement_timeout`; the candle lookup index exists, so the issue is not an absent index. The user reports executing the additive interval-batching migration script in production on 2026-11-09. Keep the fix under validation until a hosted analysis run succeeds; see the [timeout fix report](reports/AI_ANALYSIS_DATABASE_TIMEOUT_FIX_REPORT.md).

See [the Phase 12 system validation report](reports/PHASE_12_SYSTEM_VALIDATION_REPORT.md) for status classification, [the Analytics root-cause report](reports/ANALYTICS_ROOT_CAUSE_REPORT.md) for the latest evidence, and recommended follow-up.

## Scope Limitations

- Paper trading is simulated only. `ENABLE_LIVE_TRADING=false` is required; no exchange order or private Bitvavo API is used.
- Strategy optimization, backtesting, and live trading are not implemented.
- Dashboard and Portfolio require valid Supabase configuration and applied migrations. Financial aggregates fail closed on invalid or inconsistent reads; Analytics specifically treats an AI-decision HTTP `416` as a terminal range and aggregates only the successful pages received before it.
- Realtime has polling fallback, but hosted publication delivery has not been verified.
- Chart.js uses a pinned CDN. The Agent Status circuit is native SVG/CSS and does not require WebGL; physical-device visual checks remain outstanding.
- Automated mobile/browser tests do not replace physical-device smoke testing.

## Investigation - Low Trade Conversion

Status:
Open Investigation

Date:
2026-11-02

Observation:

- 156 BUY decisions with confidence >= 70
- 1 executed BUY trade

Findings:

- 142 qualified BUY decisions originated from BEAM-EUR.
- One BEAM position remains open.
- Repeated BEAM BUY decisions are expected to be blocked by the one-position-per-symbol rule.
- WIN-EUR generated 14 qualified BUY decisions.
- WIN-EUR produced no trades.
- WIN-EUR had no open position, no cooldown, sufficient balance, and was enabled.

Current Assessment:

Multi-market trading is supported by the implementation.

The low number of executed trades appears lower than expected.

Unknown:

- Whether paper-trading execution occurred during the WIN-EUR decision windows.
- Whether decisions expired before execution.
- Whether a scheduler timing issue exists.
- Whether an unrecorded runtime gate prevented execution.

Future Investigation:

- Execution Audit Trail
- Scheduler validation
- Run history visibility
- Decision execution tracking

## Investigation - Intermittent AI Analysis Timeouts

Status:
Resolved - Monitoring

Date:
2026-11-02

Observation:

Production AI Analysis intermittently reported timeout failures.

Original Findings:

- Successful runs analyzed 102 markets.
- Six candle intervals were processed per market.
- Approximately 612 candle reads occurred per execution.
- Runtime frequently approached the Vercel execution limit.
- Multiple production timeout failures were observed.

Root Cause:

The primary runtime bottleneck was sequential candle retrieval across a large number of database batches.

Resolution:

AI Analysis runtime was optimized by replacing sequential candle retrieval batching with a bounded worker queue.

No changes were made to:

- Trading logic
- Risk management
- BUY logic
- SELL logic
- HOLD logic
- WAIT logic
- Confidence calculations
- Decision generation

Validation Results:

Production verification confirmed:

- Runtime reduced from approximately 26-28 seconds to approximately 11.5 seconds.
- 102/102 markets analyzed.
- 102/102 decisions stored.
- 612/612 candle reads completed successfully.
- 300,849 candle rows processed.
- 0 failed reads.
- 0 skipped markets.
- 0 omitted markets.
- Full six-interval analysis coverage preserved.

Current Assessment:

The optimization successfully reduced production runtime while preserving complete analysis coverage.

No loss of decisions, markets, candle data, or indicator calculations was observed.

Remaining Validation:

- Monitor production runtime for 24-48 hours.
- Confirm timeout failures no longer occur.
- Confirm runtime remains below 15 seconds under normal load.
- Confirm stability as market count grows.

Status:

Resolved and under post-deployment monitoring.

Additional Findings

Confidence Distribution:

BUY 65-70 : 625
BUY 70-75 : 156

Approximately 80% of BUY decisions currently fall below the Paper Trading entry threshold of 70.

This suggests the confidence threshold may be a significant contributor to low trade volume.

Further evaluation should be based on additional historical trade data before any threshold changes are considered.
