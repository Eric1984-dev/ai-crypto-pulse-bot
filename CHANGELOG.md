# Changelog

## Unreleased

- Add a complete, sequential JSONL history export for AI analysis with bounded Pi API pages, per-source file splitting, and cancellation status; remove overlapping CSV export cards while retaining API compatibility.
- Fix complete-history exports rejecting valid candle-window pages that do not contain the ordinary `items` field.
- Fix Raspberry Pi shadow-exit evaluations being skipped because the evaluator shared the scheduler's PostgreSQL advisory-lock key; existing installations must apply Phase 8.12.
