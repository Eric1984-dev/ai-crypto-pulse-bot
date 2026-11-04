# Vercel CPU Limit Impact Report

**Date:** 2026-11-04
**Observation time:** 2026-11-04 07:15–07:20 UTC (live Supabase queries)
**Scope:** Diagnosis only. No code, scheduler settings, or production data were changed.
**Data sources:** Live Supabase (`AI_Crypto_Bot_Status`, `AI_Crypto_Bot_Market_Data`, `AI_Crypto_Bot_AI_Decisions`, `AI_Crypto_Bot_Portfolio_Snapshots`, `AI_Crypto_Bot_Candles`, `AI_Crypto_Bot_Positions`, `AI_Crypto_Bot_Trades`), repository code/migrations, Vercel Hobby plan documentation, and the 2026-11-03 scheduler/CPU reports.

## Executive answer

**No. The Vercel Fluid Active CPU limit has not measurably impacted CryptoPulse production execution as of 2026-11-04 07:16 UTC.**

All four scheduled pipelines were executing on cadence at observation time and show continuous execution history since their tables began retaining data (2026-11-01):

- **AI Analysis:** last run 2026-11-04 07:11:19 UTC (4m 25s old), status `ACTIVE`. 863 decision batches in 72h at an average interval of **5.00 minutes**; maximum gap **10.01 minutes**; zero gaps over 30 minutes.
- **Paper Trading:** 758 portfolio snapshots in 72h at an average interval of **4.99 minutes**; maximum gap **12.21 minutes**; zero gaps over 30 minutes.
- **Market Refresh:** all 102 `AI_Crypto_Bot_Market_Data` rows refreshed 53 seconds before observation.
- **Candle Refresh:** `1m` candle ingestion present in **every hour** of the last 48 hours; latest `1m`/`5m` candles 1m 18s old at observation.

The long flat sections in the portfolio chart are **not** caused by scheduler or Vercel interruption. They are caused by **market inactivity in the single open position (WIN-EUR)**: snapshots keep being written every 5 minutes during the flat sections, while Bitvavo shows zero-trade periods for WIN-EUR during exactly those hours.

**The risk remains real.** The live schedule generates ~38,954 candle-refresh requests/day (~39,800 total scheduler invocations/day) against a Hobby allowance of **4 CPU-hours/month**. If Vercel enforces the hard cap, all functions pause project-wide and all four schedulers stop simultaneously. That has not happened yet in the retained data window.

## 1. Were any scheduled jobs skipped after CPU exhaustion?

**No skipped-job pattern is visible in production data.** A Vercel Hobby CPU-limit enforcement pauses function execution project-wide until the usage window resets; it does not skip individual invocations. Such a pause would produce multi-hour gaps in decision batches, snapshots, and candle ingestion. None exist:

| Signal | Window | Total runs | Avg interval | Max gap | Gaps > 30 min |
|---|---|---:|---:|---:|---:|
| AI decision batches | 72h (since Nov 1 07:20 UTC) | 863 | 5.00 min | 10.01 min | **0** |
| Portfolio snapshots | 72h (since Nov 1 16:17 UTC) | 758 | 4.99 min | 12.21 min | **0** |
| `1m` candle ingestion | 48h | every hour | — | none (no empty hour) | **0** |

Only three single-cycle misses exist in three days (see §3), each consistent with a normal `ANALYZING`-overlap skip or one failed invocation — not with a CPU-limit pause.

## 2. Gaps between the four pipelines

| Job | Expected cadence | Evidence source | Observed |
|---|---|---|---|
| Market Refresh | every 5 min | `AI_Crypto_Bot_Market_Data.captured_at` (latest-only; no history retained) | 102/102 rows at 07:15:24 UTC (53s old) ✅ |
| Candle Refresh | 125 cron-job.org jobs; ~38,954 req/day | `AI_Crypto_Bot_Candles` ingestion per hour | `1m` candles ingested every hour for 48h (62–99 markets/hour; illiquid markets legitimately produce no candles without trades) ✅ |
| AI Analysis | every 5 min | `AI_Crypto_Bot_AI_Decisions` batch timestamps + `AI_Crypto_Bot_Status.last_run` | 12 batches/hour for 48h straight (range 11–13); 102 decisions per batch ✅ |
| Paper Trading | every 5 min, after analysis | `AI_Crypto_Bot_Portfolio_Snapshots.captured_at` | 12 snapshots/hour for 72h straight ✅ |

Note: `AI_Crypto_Bot_Market_Data` retains only the latest snapshot per symbol, so historical market-refresh gaps cannot be reconstructed from the database. Its downstream consumers (AI analysis freshness gate, position revaluation) behaved continuously, and it is fresh now.

## 3. Periods longer than expected cadence

Three single-cycle misses in the entire retained history — all ~10 minutes (one missed 5-minute cycle), none longer:

| Pipeline | Gap start (UTC) | Gap end (UTC) | Duration |
|---|---|---|---|
| AI Analysis | 2026-11-02 20:46:17 | 2026-11-02 20:56:17 | 10.01 min |
| AI Analysis | 2026-11-02 21:06:17 | 2026-11-02 21:16:16 | 9.97 min |
| AI Analysis | 2026-11-04 01:16:16 | 2026-11-04 01:26:17 | 10.01 min |
| Paper Trading (snapshots) | 2026-11-01 16:23:03 | 2026-11-01 16:35:16 | 12.21 min |

The snapshot gap occurred on 2026-11-01 during the initial backfill/bring-up day, two days before the CPU-limit notification. The decision gaps are isolated single-cycle misses. A Hobby CPU-cap enforcement would appear as a **multi-hour to multi-day** gap ending only at a usage-window reset; nothing like that exists.

## 4. Expected vs actual execution frequency

| Job | Expected | Actual (measured) | Verdict |
|---|---|---|---|
| AI Analysis | 12 batches/hour | 12/hour sustained for 48h (11–13 range; 13 = one retry, 11 = one single-cycle miss) | On cadence |
| Paper Trading | 12 snapshots/hour | 12/hour sustained for 72h | On cadence |
| Market Refresh | 12/hour | latest-only data; currently fresh (53s) | On cadence (current) |
| Candle Refresh | ~1,623/hour (live schedule) | continuous ingestion every hour; Nov 3 request-log count 6,433 vs ~6,470 schedule-derived (−0.58%) | On cadence |

## 5. Do portfolio flat sections correspond to market inactivity, scheduler inactivity, or Vercel limits?

**Market inactivity — proven by three independent signals.**

The chart plots the last 100 `AI_Crypto_Bot_Portfolio_Snapshots` rows. Snapshots are written on every paper-trading run regardless of value change, so a scheduler stop would freeze the *timestamps*; market inactivity freezes only the *value*.

1. **Timestamps continue during flat sections.** Flattest hours: 2026-11-04 02:00 and 03:00 UTC show **1 distinct portfolio value across 12 snapshots** each — yet all 12 snapshots per hour were written on the 5-minute cadence. The scheduler ran; the value simply did not move.
2. **The only open position is WIN-EUR** (16,348,102.96 units, entry 0.0000610922, opened 2026-11-02 14:13 UTC; the BEAM-EUR position was sold 2026-11-04 01:48 UTC with −€246.71 realized PnL). Portfolio value = available balance + WIN-EUR mark-to-market, so it moves only when WIN-EUR's price moves.
3. **Bitvavo shows zero-trade periods for WIN-EUR exactly during the flat hours.** Only 11 `5m` candles exist for WIN-EUR in the last 8 hours (a liquid market produces ~96): no candles between 04:15→05:15, 05:20→05:50, 06:05→06:30, 06:30→06:45, 06:50→07:00 UTC. No trades → no price change → flat portfolio value.

Context: only 3 trades exist in total (BUY BEAM Nov 1, BUY WIN Nov 2, SELL BEAM Nov 4). With zero or one open low-liquidity positions, long flat chart sections are the **expected** state of the system, not a fault signature.

## 6. Did CPU exhaustion cause missed, delayed, or failed executions?

**No — none detectable in production data.**

- **Missed:** none beyond three isolated single-cycle misses in 3 days (§3), with normal operational explanations.
- **Delayed:** none — average intervals are 5.00/4.99 minutes against a 5-minute schedule.
- **Failed:** none visible — `AI_Crypto_Bot_Status` is `ACTIVE` with `error_message = null`; every hourly batch contains the full 102 decisions.

When Hobby enforcement does occur, Vercel pauses functions project-wide (no queuing, no retry, no delay — invocations fail until the ~30-day usage window resets). The expected signature would be: frozen `AI_Crypto_Bot_Status.last_run`, simultaneous stop of new decision batches, snapshots, and candle ingestion, plus failed executions in cron-job.org history and a drop to zero in Vercel function request logs. **None of these are present.**

## Current system state (2026-11-04 07:16 UTC)

| Component | State |
|---|---|
| Agent status | `ACTIVE`, last run 07:11:19 UTC, no error |
| Market data | 102/102 symbols refreshed 07:15:24 UTC |
| Candles | `1m`/`5m` latest 07:15 UTC (97/102 markets fresh < 2h); `15m`/`1h` latest 07:00; `4h` latest 04:00 (normal); `1d` latest Nov 3 00:00 (within 72h AI limit) |
| Open positions | 1 × WIN-EUR (+€11.59 unrealized) |
| Portfolio value | €9,764.88 (starting €10,000) |
| Decisions last 24h | 24,668 HOLD · 3,883 SELL · 561 WAIT · 162 BUY (4 symbols) |

## Verdict

**Did the Vercel CPU limit already impact CryptoPulse behavior? No.** Production execution data shows uninterrupted, on-cadence operation of all four scheduled pipelines through 2026-11-04 07:16 UTC. The flat portfolio chart sections are fully explained by WIN-EUR zero-trade periods on Bitvavo while snapshots continued every 5 minutes.

**However, the notification should be treated as an early warning, not a false alarm.** The live schedule (~39,800 scheduler invocations/day, ~4× the recommended cadence per [SCHEDULER_SIMPLIFICATION_REPORT.md](./SCHEDULER_SIMPLIFICATION_REPORT.md)) structurally exceeds what the 4 CPU-hour/month Hobby allowance can sustain. If enforcement begins, the impact will be a simultaneous stop of all schedulers and user-facing functions — immediately visible as gaps in the exact signals verified above. Reducing invocation volume toward the recommended cadence (9,723/day) remains the outstanding structural mitigation; it is documented in the existing scheduler reports and was out of scope for this diagnosis.

## Follow-up monitoring (read-only)

Re-run these to detect a future enforcement immediately:

```sql
-- Agent heartbeat: last_run should be ≤ 5 min old
SELECT status, last_run, now() - last_run AS age, error_message
FROM public."AI_Crypto_Bot_Status" WHERE singleton = true;

-- Snapshot gaps: any gap > 30 min indicates a paper-trading stop
SELECT captured_at,
       EXTRACT(EPOCH FROM (captured_at
         - LAG(captured_at) OVER (ORDER BY captured_at)))/60 AS gap_minutes
FROM public."AI_Crypto_Bot_Portfolio_Snapshots"
ORDER BY captured_at DESC LIMIT 50;
```

## Sources and limitations

- Live Supabase queries executed 2026-11-04 07:15–07:20 UTC (tables listed in the header).
- Snapshot/decision history begins 2026-11-01 (table creation/backfill); earlier behavior cannot be reconstructed from the database.
- `AI_Crypto_Bot_Market_Data` and `AI_Crypto_Bot_Status` retain latest state only; historical gap analysis for those two relies on downstream-consumer behavior.
- Vercel request/runtime logs and cron-job.org execution history were not re-inspected in this session; the Nov 3 request-log reconciliation is in [VERCEL_CPU_ATTRIBUTION_REPORT.md](./VERCEL_CPU_ATTRIBUTION_REPORT.md) and [SCHEDULER_CADENCE_VERIFICATION.md](./SCHEDULER_CADENCE_VERIFICATION.md).
- Vercel Hobby limit mechanics: [Hobby plan](https://vercel.com/docs/plans/hobby) (4 CPU-hours Active CPU/month; feature paused until the 30-day window resets) and [Fluid compute pricing](https://vercel.com/docs/functions/usage-and-pricing).
- No tests were run; this was a read-only diagnostic task.
