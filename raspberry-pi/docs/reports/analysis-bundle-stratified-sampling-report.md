# Analysis Bundle Stratified Sampling

## Change

The bounded analysis bundle now includes trade-linked decisions before sampled
decisions. Remaining decision capacity is selected deterministically in
round-robin order across combined strata keyed by UTC day, market, action,
confidence band, strategy name, and strategy version. The manifest reports source and
included counts, sample coverage, unresolved trade-decision links, and
truncation.

Candle anchors prioritize trades and their linked decisions, then sampled
decisions. The manifest records omitted anchors when the 50-anchor limit is
reached. Linked and sampled decision rows share the configured per-source
limit; the remaining row, candle-window, and export caps are unchanged.

## Validation

- Raspberry Pi test suite: 211 passed, 0 failed.
- Focused analysis-bundle regression tests: 3 passed.
- `node --check` on the changed JavaScript files: passed.
- `git diff --check`: passed after all changes.
- No production database validation, deployment, or dashboard changes were
  performed.
