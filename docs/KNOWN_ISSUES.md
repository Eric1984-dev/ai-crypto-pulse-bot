# Known Issues

## Open Production Validation

- The hosted Supabase migration history, RLS/grants, and Realtime publication state have not been verified in this environment. The Phase 11 publication migration and live Realtime/reconnect smoke tests remain pending.
- Production authentication, dashboard, scanner, Bitvavo ingestion, AI analysis, paper-trading jobs, and Admin Actions have not been smoke-tested against a deployed Vercel/Supabase environment.
- Analytics and Analytics Exports still return `503 DASHBOARD_DATA_UNAVAILABLE`. The supplied production log localizes the failure to `AI_Crypto_Bot_AI_Decisions`, query `analytics.ai-decisions`, page 3 (`1000-1499`), HTTP `416/PGRST103`; the Supabase message/details were not captured. Temporary query diagnostics now capture the exact query and error fields, but the precise range rejection and deployed behavior remain unresolved pending redeployment and log review.
- A prior Market Scanner HTTP 503 (`MARKET_DATA_UNAVAILABLE`) was associated with a failing database/PostgREST read, but its original query and production root cause remain unconfirmed. The later-range `416/PGRST103` pagination case has a targeted fix; production errors remain generic.
- Market snapshot, candle refresh, AI analysis, and paper-trading execution require configured external scheduler jobs. Production scheduler configuration and execution are unverified.
- Admin Actions require the server-side `ADMIN_USER_IDS` allowlist to be configured and verified.

See [the Phase 12 system validation report](reports/PHASE_12_SYSTEM_VALIDATION_REPORT.md) for status classification, [the Analytics root-cause report](reports/ANALYTICS_ROOT_CAUSE_REPORT.md) for the latest evidence, and recommended follow-up.

## Scope Limitations

- Paper trading is simulated only. `ENABLE_LIVE_TRADING=false` is required; no exchange order or private Bitvavo API is used.
- Strategy optimization, backtesting, and live trading are not implemented.
- Dashboard and Portfolio require valid Supabase configuration and applied migrations. Financial aggregates are shown as unavailable rather than partial when bounded reads cannot guarantee complete calculations.
- Realtime has polling fallback, but hosted publication delivery has not been verified.
- Chart.js and Three.js use pinned CDNs. Visualization fallback preserves the surrounding page when a library or WebGL is unavailable; hardware-specific performance varies.
- Automated mobile/browser tests do not replace physical-device smoke testing.