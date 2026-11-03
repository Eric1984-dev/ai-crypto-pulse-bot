# Refresh Frequency Impact Analysis

**Observation:** 2026-11-03, latest complete AI batch at 22:11:16 UTC  
**Scope:** Read-only scheduler, candle, and AI-engine analysis. No code, production data, or cron-job.org settings were changed.

## Executive finding

The recommended cadence is supported for a **carefully monitored reduction**:

- `1m`: every 5 minutes
- `5m`: every 15 minutes
- `15m`: every 30 minutes
- `1h`: hourly (unchanged)
- `4h`: every 4 hours (unchanged)
- `1d`: daily (unchanged; reactivate the missing batch 20)

The schedule is projected to fall from **38,954 to 9,723 requests/day** (−29,231; **75.0% fewer**). In a replay using the JavaScript AI Engine and the latest production 1,000-candle inputs, the current decisions for BEAM, WIN, and the 20 strongest positive-strength markets were reproduced exactly. Neither average nor worst-case additional refresh lag changed any of those 21 decisions, and no confidence changed by more than 0.57 points.

This is evidence for reducing cadence, not a guarantee of identical future trading. It does **not** make the current candle pipeline healthy: at the observation time, 24 markets had stale `1m` candles, five had stale `5m` candles, one had stale `15m` candles, and one had stale `1d` candles. The observed multi-hour gaps are far beyond the proposed schedule delays and should be treated as refresh/coverage failures, not as a reason to run every job more frequently.

## Current and recommended scheduler

The latest scheduler inventory recorded 21 batch definitions per interval, with the `1d` batch 20 inactive. One candle-refresh request covers at most five markets; 102 markets therefore need 21 batches.

| Interval | Current active schedule | Current requests/day | Recommended schedule | Recommended requests/day | Change |
|---|---|---:|---|---:|---:|
| `1m` | 21 jobs, every minute | 30,240 | 21 jobs, every 5 minutes | 6,048 | −80% |
| `5m` | 21 jobs, every 5 minutes | 6,048 | 21 jobs, every 15 minutes | 2,016 | −66.7% |
| `15m` | 21 jobs, every 15 minutes | 2,016 | 21 jobs, every 30 minutes | 1,008 | −50% |
| `1h` | 21 jobs, hourly | 504 | Hourly | 504 | No change |
| `4h` | 21 jobs, every 4 hours | 126 | Every 4 hours | 126 | No change |
| `1d` | 20 active jobs, daily | 20 | 21 jobs, daily | 21 | Restore batch 20 |
| **Total** | **125 active jobs** | **38,954** | **126 jobs** | **9,723** | **−75.0%** |

These are schedule-derived totals, assuming every configured job runs once on schedule. The recommended expressions, interpreted in the jobs' `Europe/Brussels` timezone, are:

| Interval | Cron expression per batch |
|---|---|
| `1m` | `*/5 * * * *` |
| `5m` | `*/15 * * * *` |
| `15m` | `*/30 * * * *` |
| `1h` | `0 * * * *` |
| `4h` | `0 */4 * * *` |
| `1d` | Daily; keep the existing staggered batch minutes and reactivate batch 20 |

Stagger batches within each interval rather than firing all 21 requests together. Preserve the existing one-interval/one-batch endpoint design and verify response status, selected markets, provider requests, and candle advancement; HTTP 200 alone does not establish a successful full refresh.

## Expected freshness and observed coverage

Assuming successful refreshes and the provider's candle timestamps behave as expected, the approximate worst-case age is refresh cadence plus one candle interval. The AI Engine's per-interval stale-data limits are shown for comparison.

| Interval | Approx. age at current cadence | Approx. age at recommended cadence | AI stale-data limit | Fresh markets now | After average added lag | After worst-case added lag |
|---|---:|---:|---:|---:|---:|---:|
| `1m` | 2 min | 6 min | 30 min | 78/102 | 78/102 | 76/102 |
| `5m` | 10 min | 20 min | 2 h | 97/102 | 97/102 | 96/102 |
| `15m` | 30 min | 45 min | 6 h | 101/102 | 101/102 | 101/102 |
| `1h` | 2 h | 2 h | 12 h | 102/102 | 102/102 | 102/102 |
| `4h` | 8 h | 8 h | 24 h | 102/102 | 102/102 | 102/102 |
| `1d` | Daily; actual data is close to the age limit | Unchanged | 72 h | 101/102 | 101/102 | 101/102 |

The average/worst projections add respectively 2/4 minutes to `1m`, 5/10 minutes to `5m`, and 7.5/15 minutes to `15m`, then apply the Engine's existing freshness checks to current candle ages. In this point-in-time projection, average lag adds no stale markets; worst-case lag would add two stale `1m` markets and one stale `5m` market.

At 22:11:16 UTC, the freshest stored candle timestamps across the watched universe were `22:11` (`1m`), `22:10` (`5m`), `22:00` (`15m`), `22:00` (`1h`), `16:00` (`4h`), and November 1 at `00:00` (`1d`). The 1-day data was about 70 hours old; one market was already beyond the Engine's 72-hour limit. Daily refresh cadence should therefore remain unchanged and its actual execution/advancement should be monitored separately.

The first three intervals already have markets with latest candle timestamps several hours old, despite their currently faster schedules. Slowing the schedule is not an explanation for those existing gaps. A cadence change should be paired with alerts for stale-market counts and failed/partial refresh outcomes.

## AI replay

The replay used `analyzeMarket()` from the current JavaScript AI Engine, not a SQL reconstruction:

- The reference was the latest complete stored batch, **102/102 markets**, timestamped 2026-11-03 22:11:16 UTC.
- The target set was the 20 highest positive Market Strength markets plus BEAM-EUR.
- For each target, the input included its latest stored candle rows up to the production limit of 1,000 per interval and the latest market snapshot no later than the reference batch.
- The current-engine replay matched the stored decision, confidence, and Market Strength for **21/21 targets**.
- Average and worst-case cadence simulations held market snapshots fixed and omitted candles newer than the added-lag point. This isolates candle-cadence sensitivity; it is not a full historical market replay.

| Scenario | Added lag for `1m` / `5m` / `15m` | Decision changes (21 targets) | Max absolute confidence change | Max absolute strength change | Changes over 1 confidence point |
|---|---|---:|---:|---:|---:|
| Average additional lag | 2 / 5 / 7.5 min | 0 | 0.28 | 0.75 | 0 |
| Worst-case additional lag | 4 / 10 / 15 min | 0 | 0.57 | 1.51 | 0 |

No target crossed the Engine's decision boundaries. A directional decision requires absolute Market Strength of at least 20 **and** confidence of at least 65; the strongest current positive signal was below both conditions.

### BEAM and WIN

| Market | Stored and replayed decision | Confidence | Market Strength | Average-lag result | Worst-lag result |
|---|---|---:|---:|---|---|
| BEAM-EUR | HOLD | 55.55 | −7.59 | HOLD; 55.72 / −8.04 | HOLD; 55.05 / −6.26 |
| WIN-EUR | HOLD | 54.28 | +10.48 | HOLD; unchanged | HOLD; unchanged |

The latest candle timestamps at the reference time were:

| Market | `1m` | `5m` | `15m` | `1h` | `4h` | `1d` |
|---|---|---|---|---|---|---|
| BEAM-EUR | 22:10 | 22:05 | 22:00 | 22:00 | 16:00 | Nov 1 00:00 |
| WIN-EUR | 21:16 | 21:15 | 21:15 | 21:00 | 16:00 | Nov 1 00:00 |

WIN's `1m` candle was already stale at the reference time; it was excluded by the current Engine in both cadence scenarios.

### Top 20 positive-strength markets

All 20 stored decisions were HOLD. The table shows the change in confidence and Market Strength under the worst-case additional lag, relative to the exact-parity current-engine replay.

| Market | Current strength | Confidence | Decision | Worst-case Δ confidence | Worst-case Δ strength |
|---|---:|---:|---|---:|---:|
| IKA-EUR | +17.85 | 58.78 | HOLD | −0.18 | −0.47 |
| POL-EUR | +14.10 | 62.02 | HOLD | 0.00 | 0.00 |
| WIN-EUR | +10.48 | 54.28 | HOLD | 0.00 | 0.00 |
| ACU-EUR | +10.47 | 58.65 | HOLD | 0.00 | 0.00 |
| SKY-EUR | +6.47 | 59.13 | HOLD | 0.00 | 0.00 |
| MOVR-EUR | +6.06 | 53.40 | HOLD | 0.00 | 0.00 |
| CHR-EUR | +5.55 | 58.11 | HOLD | 0.00 | 0.00 |
| ARX-EUR | +5.11 | 57.28 | HOLD | +0.28 | +0.75 |
| MIOTA-EUR | +4.57 | 58.40 | HOLD | 0.00 | 0.00 |
| MEGA-EUR | +4.30 | 56.97 | HOLD | 0.00 | 0.00 |
| INJ-EUR | +3.85 | 56.80 | HOLD | +0.57 | +1.51 |
| XYO-EUR | +3.42 | 58.00 | HOLD | +0.06 | +0.16 |
| STRK-EUR | +3.28 | 54.58 | HOLD | −0.25 | −0.66 |
| XRP-EUR | +3.12 | 57.85 | HOLD | +0.22 | +0.56 |
| DRIFT-EUR | +2.47 | 55.61 | HOLD | 0.00 | 0.00 |
| USDC-EUR | +2.07 | 60.12 | HOLD | −0.28 | −0.74 |
| SXT-EUR | +1.41 | 52.44 | HOLD | 0.00 | 0.00 |
| SAND-EUR | +0.99 | 57.04 | HOLD | 0.00 | 0.00 |
| EURC-EUR | +0.73 | 54.28 | HOLD | 0.00 | 0.00 |
| STRAX-EUR | +0.47 | 57.51 | HOLD | 0.00 | 0.00 |

## Invocation, Supabase, and CPU impact estimates

### Requests and Supabase reads

The candle-refresh handler performs two primary Supabase reads per invocation: load the enabled watched-market list and load the latest stored candle timestamps for the selected batch. On that basis:

- Current schedule: approximately **77,908 primary read requests/day** (38,954 × 2).
- Recommended schedule: approximately **19,446 primary read requests/day** (9,723 × 2).
- Estimated reduction: **58,462 read requests/day** (75.0%), before retries, failures, or other routes.

This is an estimate of endpoint REST reads, **not** Supabase Disk IO blocks. The `/api/ai-analysis` read workload remains unchanged; it still reads all six intervals for all watched markets on its existing cadence.

### Candle upserts

The refresh code reads the latest timestamp, requests candles starting at that timestamp, then upserts with merge-duplicates. It can therefore catch up multiple new bars in a slower invocation, while rewriting an overlapping candle. Assuming complete successful refreshes:

- Approximate unique new candle rows remain near **189,000/day**; they are dictated mainly by interval bar formation, not refresh frequency.
- The schedule yields about **189,208 current** versus **47,226 recommended** per-market refresh opportunities/day. This is also the rough upper bound for overlap-row upserts; actual counts can be lower when a market is unchanged, skipped, or fails.
- A simple tuple-operation model (one new row per formed candle plus one overlap update per successful market refresh) is about **378,000 current** versus **236,000 recommended** candle upsert row operations/day, or roughly **38% fewer**. This is a model of writes, not a measured daily total or a Supabase Disk IO quota forecast.

The key distinction is that reducing scheduler calls should reduce fixed read and request overhead and repeated overlap writes, while successful ingestion should still preserve most unique candle rows. It should not be represented as a 75% reduction in total candle-table writes or total database Disk IO.

### Vercel CPU

Scheduled candle-refresh invocations fall by approximately 75%. This should reduce fixed per-invocation overhead, but each slower invocation processes a larger candle batch. Actual Active CPU savings cannot be calculated from the available Hobby telemetry; request reduction is not the same as CPU reduction. See the [Vercel CPU Attribution Report](./VERCEL_CPU_ATTRIBUTION_REPORT.md).

## Recommendation and operational guardrails

Proceed with a controlled scheduler change to the recommended `1m`, `5m`, and `15m` cadences, while keeping `1h`, `4h`, and `1d` unchanged. The production replay and AI freshness limits support that change for the sampled current conditions. Restore the inactive daily batch 20 so all 102 markets receive daily refreshes.

After changing schedules, compare per-interval freshness and endpoint response metrics over at least one full day. Roll back or increase cadence if stale-market counts rise materially, candle timestamps fail to advance, or provider/storage failures increase. Keep the 1-day interval under separate scrutiny: its latest stored timestamps were already close to the 72-hour limit.

This is not a claim that all six intervals are unnecessary or that future decision timing can never differ. The recommendation retains every interval and its AI weighting; it only reduces how often the first three are refreshed. Slower `5m`/`15m` updates can delay the availability of new bars for one or more five-minute AI runs, even though no decision changed in this snapshot replay.

## Sources and limitations

- Live cron-job.org inventory and request-rate comparison in the [Scheduler Cadence Verification](./SCHEDULER_CADENCE_VERIFICATION.md).
- Recommended schedule and operating safeguards in the [Scheduler Simplification Report](./SCHEDULER_SIMPLIFICATION_REPORT.md) and [Scheduling documentation](../SCHEDULING.md).
- Current candle freshness limits and decision logic in [`lib/ai-engine.mjs`](../../lib/ai-engine.mjs); batch reads, latest-timestamp checks, and upserts in [`lib/market-data.mjs`](../../lib/market-data.mjs).
- Live Supabase AI decisions, market snapshots, watched-market list, and candle rows through the 22:11:16 UTC batch.
- Candle row counts and Disk IO measurement limitations in the [Disk IO Analysis Report](./DISK_IO_ANALYSIS_REPORT.md).
- Supabase and CPU estimates are conditional models, not measured post-change outcomes. The replay is a single point-in-time sensitivity analysis, not a historical backtest across multiple market regimes.
- No code, production data, or scheduler settings were changed. No tests were run because this was a report-only task.
