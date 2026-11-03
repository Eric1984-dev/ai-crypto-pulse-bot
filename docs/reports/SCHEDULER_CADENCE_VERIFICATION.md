# Scheduler Cadence Verification

**Observation date:** 2026-11-03  
**Scope:** Read-only inspection of the live cron-job.org candle-refresh jobs and the Vercel request-log observation in the [CPU Attribution Report](./VERCEL_CPU_ATTRIBUTION_REPORT.md). No scheduler settings, code, or production data were changed.

## Executive finding

The live cron-job.org account has **126 candle-refresh job definitions**: 21 batches (`0`–`20`) for each of the six intervals. **125 are active**; the `1d` job for `batch=20` is marked inactive. At five markets per batch, this leaves the final two eligible markets without scheduled `1d` refreshes.

The active configuration is expected to generate approximately **1,623.08 candle-refresh requests per hour** or **38,954 per day**. The first three intervals run more often than the cadence recommended in the [Scheduler Simplification Report](./SCHEDULER_SIMPLIFICATION_REPORT.md): `1m` every minute rather than every five minutes, `5m` every five minutes rather than every 15 minutes, and `15m` every 15 minutes rather than every 30 minutes. The `1h` and `4h` cadences match that recommendation; the active `1d` jobs run daily, with one batch missing.

The observed **6,433 requests** from 17:46:08–21:45:19 UTC are close to the **approximately 6,470** expected from the inspected schedules during that 3h 59m 11s window (0.58% fewer). This strongly supports the conclusion that the observed request volume is explained by the live schedule, rather than an unaccounted interval or unexplained extra cadence.

## Live configuration

The job list contained 21 definitions per interval, each targeting the existing `/api/candle-refresh?interval=…&batch=…` endpoint. The job editor showed the schedules below; the listed times use each job's `Europe/Brussels` timezone.

| Interval | Job definitions | Active | Active batch indexes | Schedule | Executions/hour | Executions/day |
|---|---:|---:|---|---|---:|---:|
| `1m` | 21 | 21 | `0`–`20` | Every minute (`* * * * *`) | 1,260 | 30,240 |
| `5m` | 21 | 21 | `0`–`20` | Every 5 minutes (`*/5 * * * *`) | 252 | 6,048 |
| `15m` | 21 | 21 | `0`–`20` | Every 15 minutes (`*/15 * * * *`) | 84 | 2,016 |
| `1h` | 21 | 21 | `0`–`20` | At minute 0 hourly (`0 * * * *`) | 21 | 504 |
| `4h` | 21 | 21 | `0`–`20` | At minute 0 every 4 hours (`0 */4 * * *`) | 5.25 | 126 |
| `1d` | 21 | 20 | `0`–`19`; `20` inactive | Daily at midnight, staggered by batch minute (`m 0 * * *`, `m=0`–`19`) | 0.833 | 20 |
| **Total** | **126** | **125** | — | — | **1,623.083** | **38,954** |

For the daily group, batch 0's editor showed `0 0 * * *`, batch 1 showed `1 0 * * *`, and the job list showed the remaining active batches scheduled minute-by-minute through batch 19. Batch 20 was explicitly listed as **Inactive**. Its five-market batch would contain the two markets remaining after 20 full batches, assuming 102 eligible markets.

All 21 jobs for each of `1m`, `5m`, `15m`, `1h`, and `4h` showed successful most-recent executions in the cron-job.org list. The jobs within each of those groups shared the same next execution time, so their requests are scheduled together rather than spread across the interval. Daily jobs are staggered by minute.

## Actual cadence versus recommended cadence

The comparison baseline is the recommended full-coverage schedule in the [Scheduler Simplification Report](./SCHEDULER_SIMPLIFICATION_REPORT.md), not a hard requirement enforced by the endpoint.

| Interval | Live cadence per active job | Recommended cadence | Relative frequency |
|---|---|---|---:|
| `1m` | Every 1 minute | Every 5 minutes | **5× more frequent** |
| `5m` | Every 5 minutes | Every 15 minutes | **3× more frequent** |
| `15m` | Every 15 minutes | Every 30 minutes | **2× more frequent** |
| `1h` | Hourly | Hourly | Same |
| `4h` | Every 4 hours | Every 4 hours | Same |
| `1d` | Daily; 20 of 21 batches active | Daily | Same cadence; batch 20 is missing |

The recommended schedule totals approximately **405.125 requests/hour** or **9,723/day**. The live configuration produces about **4.01×** that request volume, primarily because of the faster `1m`, `5m`, and `15m` schedules. The fast groups also run all 21 batch jobs in the same scheduled minute, creating bursts of 21 invocations per interval tick.

## Comparison with Vercel request logs

The [CPU Attribution Report](./VERCEL_CPU_ATTRIBUTION_REPORT.md) records 6,433 requests to `/api/candle-refresh` in the window **2026-11-03 17:46:08–21:45:19 UTC**. The duration is 3.9864 hours.

| Measure | Requests |
|---|---:|
| Active schedule rate | 1,623.083/hour |
| Expected during the observed 3.9864-hour window | About 6,470 |
| Observed Vercel route requests | 6,433 |
| Observed rate, normalized to one hour | About 1,613.74/hour |
| Observed minus expected | About −37 (−0.58%) |

The expected count assumes each active job executes exactly once on schedule and excludes retries or manual invocations. Vercel's request-log count is route-level and does not identify interval or batch query parameters, so this close match is corroborating evidence, not a per-job reconciliation.

## Answers

1. **Expected requests:** approximately **1,623.08/hour** and **38,954/day** from the active jobs.
2. **Observed comparison:** 6,433 requests in just under four hours is close to the schedule-derived estimate of about 6,470.
3. **Over-frequent intervals:** **Yes.** `1m`, `5m`, and `15m` run 5×, 3×, and 2× more frequently than the prior recommended cadence, respectively.
4. **Coverage issue:** `1d` batch 20 is inactive, leaving its two eligible markets without scheduled daily candle refreshes.
5. **Likely explanation for request volume:** the live schedules themselves explain the high request count; the observed count is not evidence of an additional interval or unexpected scheduler loop.

This is a diagnosis only. No cron-job.org settings were changed.

## Sources and calculation notes

- Read-only cron-job.org job list and representative job editors, inspected on 2026-11-03. Schedule expressions and `Europe/Brussels` timezone were read from the editor; job rows supplied batch indexes, recent execution status, next execution, and the inactive daily batch.
- [Scheduling documentation](../SCHEDULING.md): one interval and one batch per invocation; five markets per batch; 102 eligible markets require 21 batches.
- [Scheduler Simplification Report](./SCHEDULER_SIMPLIFICATION_REPORT.md): recommended interval cadences and projected request counts.
- [Vercel CPU Attribution Report](./VERCEL_CPU_ATTRIBUTION_REPORT.md): 6,433 candle-refresh route requests and exact request-log window.
- Per-day totals use 24 hours. Hourly rates for 4-hour and daily jobs are averages (`21/4` and `20/24`); fractional hourly rates do not imply partial invocations.
- No tests were run because this was a report-only diagnostic task.
