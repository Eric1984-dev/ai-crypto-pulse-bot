# Stale-Market WAIT Period: Root-Cause Timeline

**Validation cutoff:** 2026-11-04 10:12:16 UTC
**Scope:** Read-only comparison of the 2026-11-01 all-market stale-snapshot WAIT period with subsequent code commits, production behavior, and observed external scheduler configuration. No code, database, scheduler, or deployment settings were changed.

## Executive conclusion

The all-market stale-snapshot WAIT symptom was confined to **2026-11-01 06:25:22–16:15:48 UTC**. The first subsequent complete 102-market batch without stale-market or stale-candle WAITs was recorded at **16:20:45 UTC**. Production history contains no later stale-market WAITs, and the 48-hour query ending at 2026-11-04 10:12:16 UTC found none.

**Verdict: A. Historical issue already resolved — operationally, based on the observed production symptom.** This does not establish which deployment or scheduler change resolved it. The exact Vercel Ready time and timestamp of any external scheduler edit were not retained. The candidate market-refresh commits landed while the incident was still occurring, and the later candle-freshness protection and candle-scheduler coverage work address candle data, not the market-snapshot freshness check that caused these WAITs.

The implementation still compares snapshot timestamps with a reference time captured near the beginning of AI analysis. The historical records are consistent with a timing race or clock skew, but do not prove the cause. Therefore, the observed incident is resolved, while the precise fix and code-level elimination of the suspected race remain unverified.

## Timeline (UTC)

| Time | Event | What it establishes |
|---|---|---|
| Nov 1 05:56:05 | Phase 07 baseline commit `ce6765a7f3cc293129556358224fdb072c9602bb` | Precedes the first recorded AI decision at 05:57:38. Commit time is not a Vercel deployment time. |
| Nov 1 06:25:22–16:15:48 | Stale-market WAIT period | 3,876 WAIT decisions across all 102 markets, exactly 38 per market. Each was stored as `available=false` and `stale=true`. |
| Nov 1 06:30:20 | Market refresh timeout commit `0ed024e4c9db3a80a2299b33919e014c2033cea3` | Landed during the incident. Its changes concern refresh execution/metrics and incremental candle refresh; stale-market WAITs continued for hours afterward. No deployment-ready time is available. |
| Nov 1 07:03:12 | Market/candle refresh split commit `60b103df24373c906b1f8ebd305269e0deacaf6b` | Also landed during the incident. It separates candle ingestion from market snapshots; the incident continued after the commit. |
| Nov 1 11:13:22 | AI candle-query fix commit `684112423f8213632ee6e87c3faf30bbc05c1f63` | Landed during the incident but concerns candle retrieval, not the market-snapshot stale flag. |
| Nov 1 16:15:48.525771 | Last recorded stale-market WAIT | End of the observed all-market stale-snapshot symptom. |
| Nov 1 16:20:45.439706 | First subsequent complete 102-market batch with no stale-market or stale-candle WAITs | Production behavior had recovered by this time, about 4 minutes 57 seconds after the last stale-market WAIT. The exact scheduler edit or deployment that preceded recovery is unknown. |
| Nov 3 12:15:10 | Candle coverage measured in production | 77 of 102 markets had no candle interval updated within the prior 24 hours. This is candle coverage evidence, not evidence that market snapshots were stale. |
| Nov 3 12:34:43 | Candle freshness protection commit `c3f10464b764691bd6712f7b38825fc4eb858b74` | Added interval-specific candle-age validation. Its exact Vercel Ready time is unavailable. |
| Nov 3 12:36:19–14:51:15 | Production `STALE_CANDLE_DATA` WAITs | 561 candle-freshness WAITs across 77 markets were observed. These are a distinct protective behavior, not a recurrence of stale market snapshots. The first such record shows the protection was active in production by 12:36:19. |
| Nov 3, time not retained | External candle scheduler inventory inspected | 126 job definitions were observed: 125 active and one inactive (`1d`, batch 20). This is an external cron configuration, not a code deployment; the exact edit and inspection times are unavailable. |
| Nov 3 13:19:53–21:19:53 | AI analysis scheduler observation window | 96 complete batches of 102 markets ran. This confirms sustained complete analysis batches during the observed window, not the exact time or mechanism of scheduler recovery. |
| Nov 3 17:46:08–21:45:19 | Candle-refresh route request-log window | 6,433 requests, close to the approximately 6,470 expected from the inspected active candle schedule. This corroborates that the candle schedule was operating in this window. |
| Nov 4 10:12:16 | 48-hour production query cutoff | No stale-market WAITs and no analysis batch with all 102 markets in WAIT were found in the preceding 48 hours. |

## Incident evidence and likely mechanism

The incident comprised 38 analysis cycles and 3,876 decisions. All 102 markets were affected in each cycle. The stored quotes had non-null prices and capture timestamps; their capture times were only **6.7–31.7 seconds before** the corresponding decision persistence time, averaging 16.3 seconds. This does not resemble a prolonged absence of provider data.

The AI engine captures its reference time near run start, fetches market snapshots later, then validates the fetched timestamps against that earlier reference. A snapshot timestamp later than the reference is treated as stale, even if it is recent relative to when the decision is stored. This is consistent with the production evidence and with overlapping refresh/analysis execution or runtime clock skew. The retained records do not include run-start timestamps or correlated market-refresh execution logs, so neither cause can be confirmed. See [`lib/ai-engine.mjs`](../../lib/ai-engine.mjs) and the detailed production findings in [`STRATEGY_HEALTH_AUDIT.md`](./STRATEGY_HEALTH_AUDIT.md).

The incident ended between the last stale decision at 16:15:48 and the first clean full batch at 16:20:45. There is no timestamped scheduler change or verified Vercel deployment event in that interval. Thus, production recovery is bounded to that interval, but cannot be attributed to a specific action.

## How the named fixes relate to the incident

### Market-refresh changes during Nov 1

The timeout and endpoint-split commits occurred during the incident, but the stale-market WAITs persisted after both. Their commit timestamps do not prove when they reached production, and the recorded changes do not identify a direct change to the market-snapshot timestamp comparison. They therefore cannot be identified as the confirmed resolution.

### Candle freshness protection on Nov 3

The candle freshness safeguard landed after the Nov 1 incident. It rejects stale or future-dated candle intervals and emits `STALE_CANDLE_DATA` when fewer than two sufficiently populated fresh intervals remain. The report states that the separate 15-minute market-snapshot freshness check was unchanged. Its production WAITs on Nov 3 are expected candle-quality blocks, not evidence that the Nov 1 market-snapshot incident returned. See [`CANDLE_FRESHNESS_PROTECTION_REPORT.md`](./CANDLE_FRESHNESS_PROTECTION_REPORT.md).

### Candle-scheduler coverage expansion

The scheduler inventory and route-request evidence were collected on Nov 3, after the incident. The observed jobs target `/api/candle-refresh`; market snapshots use the separate `/api/market-refresh` endpoint. The 6,433 candle requests corroborate that the observed candle schedule was active, but neither proves when it was expanded nor explains the earlier market-snapshot WAITs. Coverage was not fully complete: the `1d` batch 20 job was inactive. See [`CANDLE_REFRESH_COVERAGE_REPORT.md`](./CANDLE_REFRESH_COVERAGE_REPORT.md) and [`SCHEDULER_CADENCE_VERIFICATION.md`](./SCHEDULER_CADENCE_VERIFICATION.md).

## Recurrence check

For the 48-hour period **2026-11-02 10:12:16–2026-11-04 10:12:16 UTC**, production history contained:

- **58,548** decisions across **574** batches and 102 markets.
- **0** market-snapshot stale WAIT decisions.
- **0** batches with all 102 markets in WAIT.
- **561** `STALE_CANDLE_DATA` WAIT decisions from Nov 3 12:36:19 to 14:51:15 UTC. This was a separate candle-freshness condition, not a stale-market recurrence.

The full available decision history after the Nov 1 incident likewise contains no later market-snapshot stale WAITs. These results establish absence of the symptom in the queried production records, not that every possible scheduler timing race has been eliminated.

## Attribution limitations

- Git commit timestamps identify source-history events, not Vercel deployment-ready timestamps.
- The Vercel dashboard deployment history was not accessible during this read-only investigation; exact historical Ready times could not be verified.
- External cron-job.org settings are not version-controlled. The later inventory records the observed job state, but not the exact time of edits or expansion.
- Supabase decision rows preserve decision and quote timestamps but not the AI run-start time or a correlated scheduler execution ID.
- The candle coverage report's Nov 3 12:15 observation and later scheduler inventory show different evidence types; neither provides a timestamped scheduler-change event.

## Sources

- [`STRATEGY_HEALTH_AUDIT.md`](./STRATEGY_HEALTH_AUDIT.md) — incident counts, freshness behavior, and 48-hour decision analysis.
- [`CANDLE_FRESHNESS_PROTECTION_REPORT.md`](./CANDLE_FRESHNESS_PROTECTION_REPORT.md) — candle-age rules and scope separation from market-snapshot freshness.
- [`CANDLE_REFRESH_COVERAGE_REPORT.md`](./CANDLE_REFRESH_COVERAGE_REPORT.md) — Nov 3 production candle coverage.
- [`SCHEDULER_CADENCE_VERIFICATION.md`](./SCHEDULER_CADENCE_VERIFICATION.md) — observed cron-job.org configuration and Vercel request volume.
- [`POST_SCHEDULER_OPPORTUNITY_ANALYSIS.md`](./POST_SCHEDULER_OPPORTUNITY_ANALYSIS.md) — complete AI-analysis batches observed on Nov 3.
- [`lib/ai-engine.mjs`](../../lib/ai-engine.mjs) — AI run timing and market-snapshot freshness validation.

No tests were run because this was a report-only task.
