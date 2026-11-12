# Changelog

## Unreleased

- Add a complete, sequential JSONL history export for AI analysis with bounded Pi API pages, per-source file splitting, and cancellation status; remove overlapping CSV export cards while retaining API compatibility.
- Fix complete-history exports rejecting valid candle-window pages that do not contain the ordinary `items` field.
- Highlight the active historical export source and show progress feedback on the export button.
- Name analysis export folders `cryptopulse-analysis-ddMMyyyyHHmmss`.
- Fix Raspberry Pi shadow-exit evaluations being skipped because the evaluator shared the scheduler's PostgreSQL advisory-lock key; existing installations must apply Phase 8.12.
