# Changelog

## Unreleased

- Show dashboard Pi services as Unknown, rather than Offline, when a monitoring request fails and preserve the last successful metrics.
- Show Raspberry Pi temperature, CPU, and memory on both the dashboard and Exports page using the existing authenticated monitoring endpoint.
- Add a complete, sequential JSONL history export for AI analysis with bounded Pi API pages, per-source file splitting, and cancellation status; remove overlapping CSV export cards while retaining API compatibility.
- Fix complete-history exports rejecting valid candle-window pages that do not contain the ordinary `items` field.
- Highlight the active historical export source and show progress feedback on the export button.
- Name analysis export folders `cryptopulse-analysis-ddMMyyyyHHmmss`.
- Deduplicate exported candle rows while preserving anchor-to-window links in JSONL.
- Fix Raspberry Pi shadow-exit evaluations being skipped because the evaluator shared the scheduler's PostgreSQL advisory-lock key; existing installations must apply Phase 8.12.
