# History Cap Implementation Review

**Status:** Implementation review plan only  
**Scope:** Reduce the AI engine's per-market, per-interval candle history cap from 1,000 to 150 rows. No code, database, scheduler, or production settings were changed.

## Recommendation

Proceed to a controlled implementation review, not directly to production deployment. The latest full replay preserved all 102 decision types, freshness outcomes, and decision-relevant quality flags; confidence and Market Strength changed by no more than 0.01. The replay measured a 77.08% reduction in rows loaded into the analysis input.

The implementation must separate the per-market history cap from the REST page size. Today one constant controls both. Changing that constant from 1,000 to 150 would reduce each grouped PostgREST page size and can increase total requests. A read-only simulation of the current pagination algorithm against current enabled-market candle counts found:

| Configuration | Per-market cap | REST page size | Simulated requests | Change vs. current |
|---|---:|---:|---:|---:|
| Current | 1,000 | 1,000 | 484 | — |
| Candidate, separate limits | 150 | 1,000 | 352 | 132 fewer (27.3%) |
| Naive shared-constant change | 150 | 150 | 615 | 131 more (27.1%) |

The simulation used current counts for 102 enabled markets, groups of four markets, six intervals, the existing ordering and pagination algorithm, and a 1,000-row per-market upper bound. These are estimated request counts for that data snapshot, not production measurements or a guarantee for future market distributions. The candidate may still retrieve rows beyond each market's 150-row in-memory cap because a REST page is shared across multiple symbols.

## Current implementation and proposed change

In [lib/ai-engine.mjs](../../lib/ai-engine.mjs), `MAX_CANDLES_PER_INTERVAL` is 1,000. It currently controls:

- The PostgREST `limit` for each grouped candle request.
- The maximum number of rows retained per market and interval.
- The pagination completion and active-market checks.

The fetcher groups up to four markets per interval and requests rows ordered by `symbol.asc,timestamp.desc`. It then retains up to the cap for each symbol. A 150-row implementation should introduce a distinct per-market history cap while preserving a separately named REST page-size limit of 1,000. The per-market cap must govern retained rows and completion checks; the page-size limit must govern request `limit` and short-page detection.

No trading rules, indicator formulas, confidence thresholds, freshness limits, scheduler behavior, or persistence schema should change.

## Impacted implementation and verification locations

| Area | Location | Review action |
|---|---|---|
| Cap and page-size constants | [lib/ai-engine.mjs](../../lib/ai-engine.mjs) | Separate per-market cap from REST page size; retain the REST page size at 1,000. |
| Grouped history fetch and pagination | [lib/ai-engine.mjs](../../lib/ai-engine.mjs) | Use the correct limit for page retrieval and the 150 cap for per-symbol retention/completion. Confirm offsets continue to produce the newest rows without gaps or duplicates. |
| Pagination regression tests | [tests/ai-engine.test.mjs](../../tests/ai-engine.test.mjs) | Preserve tests for grouped paging, mixed per-market row counts, and row ordering. Update assertions to distinguish request page size from per-market cap. |
| History-cap regression test | [tests/ai-engine.test.mjs](../../tests/ai-engine.test.mjs) | Verify no more than 150 latest rows per market/interval reach analysis, and that newest-row selection remains correct. |
| Freshness and decision behavior | [tests/ai-engine.test.mjs](../../tests/ai-engine.test.mjs) | Verify freshness still uses the latest candle timestamp and stale/fresh classification does not depend on the older rows being excluded. |

## Behavioral invariants to preserve

1. **Latest candle selection:** Requests remain ordered by symbol ascending and timestamp descending; each market retains its newest rows, not an arbitrary sample.
2. **Freshness:** Existing per-interval age limits and latest-candle freshness checks remain unchanged. The newest candle for each market/interval must be identical before and after capping.
3. **Indicator inputs:** Indicator functions receive the latest 150 valid candles per interval (or all available rows when fewer than 150 exist). No formula, normalization, or candle validation rule changes.
4. **Market coverage:** All enabled watched markets and all six configured intervals remain processed.
5. **Pagination:** Mixed market histories, short pages, sparse intervals, and continuation offsets must not omit eligible markets or repeat rows.
6. **Failure behavior:** Existing fetch failures and analysis safeguards remain intact; reduced history must not be used to mask incomplete or failed reads.

The replay evidence is encouraging but limited to one complete 102-market production batch. Its 1,000-row replay reproduced the stored decisions and relevant metadata, and the 150-row run preserved decision types and freshness outcomes. It does not establish equivalence for all market regimes or quantify Active CPU savings.

## Rollout plan

### Staging

1. Implement only the independent limits and focused regression tests described above.
2. Run the existing AI engine test suite and the repository's configured build/type checks applicable to the change.
3. Replay a complete staging batch at both 1,000 and 150 rows using identical candle inputs.
4. Compare per-market decision type, confidence, Market Strength, freshness results, quality flags, candle counts, and latest candle timestamps.
5. Confirm request counts and returned-row counts are captured separately; do not infer CPU from row reduction alone.
6. Do not proceed if pagination tests fail, the newest candle differs, freshness outcomes change unexpectedly, or the replay reveals unexplained decision changes.

### Production

1. Deploy only after staging validation and implementation review approval.
2. Verify the deployed code version and the first complete post-deployment analysis batch.
3. Compare it with the most recent 1,000-row baseline where equivalent inputs are available; record any decision or quality differences rather than assuming the staging result generalizes.
4. Monitor several consecutive complete analysis runs before treating the rollout as stable. Do not change scheduler frequency or market coverage as part of this rollout.

## Monitoring and post-deployment validation

For each sampled run, record or inspect:

- Enabled market and interval counts, and markets analyzed.
- Candle request count (`candleQueries`) and rows retained/read (`candleReads`, where available).
- Per-market candle counts and the latest timestamp per interval.
- Fresh/stale interval counts and data-quality outcomes.
- Decision-type distribution, confidence, and Market Strength versus the pre-deployment baseline.
- Endpoint execution duration and Vercel Active CPU from platform observability.
- Fetch errors, incomplete batches, and unexpected pagination retries.

Acceptance checks:

- All enabled markets are represented and all expected intervals are accounted for.
- The latest candle timestamps and freshness classifications match the same-input baseline.
- Per-market retained history does not exceed 150 candles per interval.
- No unexplained changes occur in decisions, confidence, Market Strength, or quality flags.
- Request count does not exhibit the increase predicted by the naive shared-limit change.
- Production Active CPU and duration are measured directly; row-count and request-count reductions alone are not proof of CPU savings.

## Rollback

If pagination, freshness, decision, data-quality, or operational behavior regresses, restore the per-market history cap to 1,000 while keeping the page-size constant explicitly separate. Deploy the rollback through the normal release process, then verify a complete analysis run, market coverage, and freshness recovery. Preserve logs and comparisons from the affected runs for diagnosis; do not compensate by changing thresholds, scheduler cadence, or risk controls.

## Estimated impact

| Measure | Estimate | Qualification |
|---|---:|---|
| Rows loaded in the paired replay | 400,041 → 91,671; 308,370 fewer (77.08%) | Measured for the latest complete 102-market replay batch, not a production workload guarantee. |
| Rows passed to indicator analysis in that replay | 385,695 → 88,521; 297,174 fewer (77.05%) | Replay result; indicator and decision logic are otherwise unchanged. |
| Candle REST requests in current-count simulation | 484 → 352; 132 fewer (27.3%) | Assumes the page size remains 1,000 and applies the current pagination algorithm to the captured row counts. |
| Requests if the shared constant were simply set to 150 | 615; 131 more (27.1%) than current | Demonstrates why the two limits must be separated. |
| Supabase storage/schema | No change expected | The cap affects analysis reads and in-memory inputs only; no migration or new table is part of this plan. |
| Active CPU / execution time | Not quantified | Must be measured after implementation with Vercel observability; fewer rows or requests do not translate linearly to CPU. |

Reducing retained candle rows should reduce parsing and indicator workload. The exact CPU and duration benefit is unknown because current evidence does not attribute internal AI-analysis CPU by stage. Use the measurement approach in [AI_ANALYSIS_PROFILING_PLAN.md](./AI_ANALYSIS_PROFILING_PLAN.md) if stage-level attribution is required.

## Documentation synchronization

After implementation, update the directly relevant descriptions of candle history depth and behavior in [README.md](../../README.md), [ROADMAP.md](../../ROADMAP.md), [docs/ARCHITECTURE.md](../ARCHITECTURE.md), [docs/SCHEDULING.md](../SCHEDULING.md), [docs/CHANGELOG.md](../CHANGELOG.md), and [docs/reports/PHASE_07_COMPLETION_REPORT.md](./PHASE_07_COMPLETION_REPORT.md), as applicable. Keep this plan and [FULL_1000_VS_150_DECISION_REPLAY.md](./FULL_1000_VS_150_DECISION_REPLAY.md) clearly labeled as evidence and review artifacts, not proof of production deployment or CPU improvement.

## Decision

**Ready for controlled implementation review.** The 150-row cap has favorable one-batch replay results and a plausible workload benefit. Implementation review must preserve a 1,000-row REST page size separately from the 150-row per-market retention cap, add pagination/freshness regression coverage, and treat production CPU impact as unverified until measured.

No code, tests, database schema, scheduler, or production settings were changed for this plan.
