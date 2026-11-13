# Changelog

## Unreleased

- Move the collapsed Infrastructure metrics card beneath the dashboard's live backend signal.
- Replace the vague dashboard Bot Run timestamp with AI-analysis and paper-trading stage statuses and cycle times; remove on-demand Analytics and Market scan placeholders.
- Remove the inactive Shadow Exit monitoring panel and its dashboard rendering; historical shadow records remain available to full-history exports.
- Show the Raspberry Pi model as the first infrastructure metric on the dashboard and Exports page using the existing monitoring route.
- Document guarded Raspberry Pi paper-history reset and €2,000 portfolio initialization scripts; the reset preserves watched markets and market data.
- Document a repeatable, operator-run procedure for applying PostgreSQL migrations on the Raspberry Pi.
- Make dashboard data, agent status, and monitoring reads wait for `Retry-After` and retry once on rate limiting.
- Show dashboard Pi services as Unknown, rather than Offline, when a monitoring request fails and preserve the last successful metrics.
- Color dashboard temperature, CPU, and memory meters to match the Exports status thresholds.
- Show Raspberry Pi temperature, CPU, and memory on both the dashboard and Exports page using the existing authenticated monitoring endpoint.
- Add a complete, sequential JSONL history export for AI analysis with bounded Pi API pages, per-source file splitting, and cancellation status; remove overlapping CSV export cards while retaining API compatibility.
- Fix complete-history exports rejecting valid candle-window pages that do not contain the ordinary `items` field.
- Highlight the active historical export source and show progress feedback on the export button.
- Name analysis export folders `cryptopulse-analysis-ddMMyyyyHHmmss`.
- Deduplicate exported candle rows while preserving anchor-to-window links in JSONL.
- Fix Raspberry Pi shadow-exit evaluations being skipped because the evaluator shared the scheduler's PostgreSQL advisory-lock key; existing installations must apply Phase 8.12.
# Unreleased

- Exclude in-progress or misaligned candle intervals from ingestion and AI indicators, with explicit stale/missing/incomplete data-quality reporting and regressions around UTC daily candle closure.
- Order equal-timestamp portfolio snapshots with an insertion sequence in analytics and exports. The additive Pi migration is a proposal only and has not been applied.
- Clarify that the current Pi paper BUY confidence gate remains 70; the historical SQL executor's 67 experiment is not the active Pi setting.
- Add one active PAPER-only position exit: a fee/slippage-adjusted +€3 net floor ratcheted by 1.5 × fresh closed 5-minute ATR, with persisted high-water/stop state and auditable automatic SELLs. The shadow candidate grid is no longer evaluated during paper-trading cycles.
- Add the local Phase 8.14 position-exit schema migration proposal; no migration, database reset, deployment, or live verification was performed.
