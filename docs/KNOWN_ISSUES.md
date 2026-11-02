# Known Issues

## Open Production Validation

- Phase 14 local Chromium checks cover all 12 pages at 320px, 768px, and 1280px and pass without horizontal overflow. Physical iPhone/Android/desktop rendering, Chrome/Edge/Safari coverage, Lighthouse, and hosted production smoke checks remain unverified.
- The hosted Supabase migration history, RLS/grants, and Realtime publication state have not been verified in this environment. The Phase 11 publication migration and live Realtime/reconnect smoke tests remain pending.
- Production authentication, dashboard, scanner, Bitvavo ingestion, AI analysis, paper-trading jobs, and Admin Actions have not been smoke-tested against a deployed Vercel/Supabase environment.
- The Analytics pagination fix treats HTTP `416` on `analytics.ai-decisions` as end-of-results and is covered by local regressions, including the production-reported `1000-1499` range. The production error is not verified as resolved until this change is deployed and Analytics plus Analytics Exports are smoke-tested; the original Supabase message/details remain unavailable.
- A prior Market Scanner HTTP 503 (`MARKET_DATA_UNAVAILABLE`) was associated with a failing database/PostgREST read, but its original query and production root cause remain unconfirmed. The later-range `416/PGRST103` pagination case has a targeted fix; production errors remain generic.
- Market snapshot, candle refresh, AI analysis, and paper-trading execution require configured external scheduler jobs. Production scheduler configuration and execution are unverified.
- Admin Actions require the server-side `ADMIN_USER_IDS` allowlist to be configured and verified.
- Phase 15 AI Recommendations have local automated coverage but have not been verified against hosted Supabase, deployed Vercel, or live Realtime. Recommendation History exports are recomputed from current stored Analytics data; prior generated recommendation snapshots are not retained.

See [the Phase 12 system validation report](reports/PHASE_12_SYSTEM_VALIDATION_REPORT.md) for status classification, [the Analytics root-cause report](reports/ANALYTICS_ROOT_CAUSE_REPORT.md) for the latest evidence, and recommended follow-up.

## Scope Limitations

- Paper trading is simulated only. `ENABLE_LIVE_TRADING=false` is required; no exchange order or private Bitvavo API is used.
- Strategy optimization, backtesting, and live trading are not implemented.
- Dashboard and Portfolio require valid Supabase configuration and applied migrations. Financial aggregates fail closed on invalid or inconsistent reads; Analytics specifically treats an AI-decision HTTP `416` as a terminal range and aggregates only the successful pages received before it.
- Realtime has polling fallback, but hosted publication delivery has not been verified.
- Chart.js uses a pinned CDN. The Agent Status circuit is native SVG/CSS and does not require WebGL; physical-device visual checks remain outstanding.
- Automated mobile/browser tests do not replace physical-device smoke testing.