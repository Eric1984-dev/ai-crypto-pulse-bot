# CPU Attribution Impact Report

**Date:** 2026-11-04
**Scope:** Diagnosis only. No code, scheduler, or configuration changes were made.
**Question:** Will changing AI Analysis and Paper Trading from a 5-minute to a 10-minute cadence materially reduce Vercel Active CPU usage?
**Data sources:** Live Supabase (24h decision/snapshot/candle counts), Vercel production request logs from 2026-11-03 ([VERCEL_CPU_ATTRIBUTION_REPORT.md](./VERCEL_CPU_ATTRIBUTION_REPORT.md)), [SCHEDULER_CADENCE_VERIFICATION.md](./SCHEDULER_CADENCE_VERIFICATION.md), [DISK_IO_ANALYSIS_REPORT.md](./DISK_IO_ANALYSIS_REPORT.md), [AI_ANALYSIS_PRODUCTION_VERIFICATION_REPORT.md](./AI_ANALYSIS_PRODUCTION_VERIFICATION_REPORT.md), and Vercel Hobby plan documentation.

## Critical caveat (read first)

**Vercel Hobby does not expose route-level Active CPU or function-duration metrics.** The Vercel metrics query for Active CPU/duration was denied on 2026-11-03 (`payment_required` — Observability Plus is required and cannot be purchased on Hobby). Therefore **no exact CPU attribution per endpoint can be produced**. All CPU figures below are **estimates with stated assumptions**, derived from invocation counts, measured engine runtimes, and Vercel's definition of Active CPU (time actively executing code; I/O waits excluded). The request-log counts are exact; the CPU-per-request values are not.

## 1. Total invocation counts per endpoint

Two independent measurements agree closely:

**A. Vercel production request logs, 2026-11-03 17:46:08–21:45:19 UTC (~4h):**

| Endpoint | Requests (~4h) | Share of 5 routes | Extrapolated /day |
|---|---:|---:|---:|
| `/api/candle-refresh` | 6,433 | 97.65% | ~38,600 |
| `/api/ai-analysis` | 48 | 0.73% | ~289 |
| `/api/paper-trading` | 48 | 0.73% | ~289 |
| `/api/market-refresh` | 47 | 0.71% | ~283 |
| `/api/dashboard-data` | 12 | 0.18% | ~72 |

**B. Live Supabase, last 24h (2026-11-03 → 2026-11-04):**

| Signal | Count / 24h | Implied invocations /day |
|---|---:|---:|
| AI decision batches (102 markets each) | 286 | **286** AI Analysis runs |
| Portfolio snapshots (1 per paper-trading run) | 289 | **289** Paper Trading runs |
| Candle rows ingested | ~52,000 | consistent with ~38,954 candle-refresh calls/day (schedule-derived) |

Both sources confirm: **AI Analysis ≈ 288/day, Paper Trading ≈ 288/day, Market Refresh ≈ 288/day, Candle Refresh ≈ 38,954/day** (125 active cron-job.org jobs; see SCHEDULER_CADENCE_VERIFICATION.md).

## 2. Estimated execution duration per endpoint

| Endpoint | Wall-clock duration | Evidence | Active CPU estimate (assumption stated) |
|---|---|---|---|
| `/api/ai-analysis` | **9.6–11.5 s** (avg ~9.58s engine runtime; 6 recent completion logs) | VERCEL_CPU_ATTRIBUTION_REPORT; AI_ANALYSIS_PRODUCTION_VERIFICATION_REPORT | **~1.5–3.0 s** — ~0.8s measured synchronous decision-generation CPU + CPU for parsing/validating ~300k candle JSON rows; the rest is Supabase/Bitvavo I/O wait (not Active CPU) |
| `/api/candle-refresh` | Not logged; bounded by 8s per-request provider timeout, ≤4 workers, ≤5 markets, ≤500 candles | lib/market-data.mjs; SCHEDULING.md | **~0.1–0.3 s** — small JSON parse + upsert of ≤500 candles; dominated by Bitvavo/Supabase I/O wait |
| `/api/market-refresh` | Not logged; 102 ticker rows updated | DISK_IO_ANALYSIS_REPORT | **~0.05–0.15 s** — small payload, mostly I/O |
| `/api/paper-trading` | Not logged; DB-side `AI_Crypto_Bot_Run_Paper_Trading()` RPC | api/paper-trading.mjs | **~0.05–0.2 s** — thin HTTP wrapper; the heavy work runs in Postgres (not Vercel CPU) |

These are estimates. The only directly measured CPU-relevant figure is the ~0.8s `decisionGenerationMs` stage in AI Analysis.

## 3. Estimated CPU share per workload

Using the midpoint Active CPU estimates above (AI Analysis 2.25s, candle-refresh 0.2s, market-refresh 0.1s, paper-trading 0.1s) and the verified daily invocation counts:

| Workload | Invocations/day | Est. Active CPU/invocation | Est. Active CPU/day | Est. share |
|---|---:|---:|---:|---:|
| **Candle refresh** | 38,954 | 0.2 s | ~7,791 CPU-s (~2.16 CPU-h) | **~64%** |
| **AI Analysis** | 288 | 2.25 s | ~648 CPU-s (~0.18 CPU-h) | **~5%** |
| **Paper Trading** | 288 | 0.1 s | ~29 CPU-s (~0.008 CPU-h) | **~0.2%** |
| **Market Refresh** | 288 | 0.1 s | ~29 CPU-s (~0.008 CPU-h) | **~0.2%** |
| Dashboard/other | low | — | residual | remainder |
| **Total (these routes)** | ~39,818 | — | **~8,497 CPU-s (~2.36 CPU-h/day)** | 100% |

**Interpretation:** by invocation volume, candle refresh dominates (~97.7% of requests) and, even at a very low per-request CPU cost, is the largest estimated Active CPU consumer (~64%). AI Analysis is the **highest work-per-invocation** endpoint but runs only 288×/day, so its estimated share is small (~5%). Paper Trading is negligible (~0.2%) because its heavy logic executes in Postgres, not in the Vercel function.

**Sensitivity:** if candle-refresh per-request CPU is lower (0.1s) and AI Analysis higher (3s), the split shifts to roughly candle ~55% / AI ~9%. If candle-refresh is 0.3s and AI 1.5s, candle ~75% / AI ~3.5%. In all plausible cases **candle refresh is the dominant CPU consumer and AI Analysis is a single-digit percentage.**

## 4. Expected CPU reduction from 5m → 10m (AI Analysis + Paper Trading only)

Halving both from 288 to 144 invocations/day:

| Workload | Before CPU-s/day | After CPU-s/day | Saved CPU-s/day |
|---|---:|---:|---:|
| AI Analysis | ~648 | ~324 | **~324** |
| Paper Trading | ~29 | ~14 | **~14** |
| **Total saved** | — | — | **~338 CPU-s/day (~0.094 CPU-h/day)** |

Against an estimated total of ~8,497 CPU-s/day for these routes, that is a **~4.0% reduction** in estimated Active CPU. Per month (30 days): **~2.8 CPU-hours saved** against the 4 CPU-hour Hobby allowance — but only if the estimate holds (see §5).

## 5. Best / realistic / worst case CPU reduction

The range is driven almost entirely by the unknown true Active CPU per AI Analysis run (the only changed endpoint with non-trivial CPU):

| Scenario | Assumption (AI Analysis Active CPU/run) | AI+PT CPU saved/day | % of estimated total | Monthly saved |
|---|---|---:|---:|---:|
| **Best case** | 3.0 s (high parse/CPU cost) | ~446 CPU-s | **~5.2%** | ~3.7 CPU-h |
| **Realistic** | 2.25 s (midpoint) | ~338 CPU-s | **~4.0%** | ~2.8 CPU-h |
| **Worst case** | 1.5 s (mostly I/O-bound) | ~230 CPU-s | **~2.7%** | ~1.9 CPU-h |

Paper Trading's contribution to the saving is negligible in all scenarios (<0.2%). The reduction is bounded above by AI Analysis's small share of total Active CPU.

## 6. Conclusion

**Neutral — with a caveat.**

- **Neutral on CPU impact:** the 5m→10m change for AI Analysis + Paper Trading is estimated to reduce total Active CPU by only **~3–5%** (best ~5.2%, realistic ~4.0%, worst ~2.7%). It is **not** a material reduction in Vercel CPU usage, because the dominant consumer is the ~38,954/day candle-refresh workload (~64% of estimated Active CPU), which is unchanged by this plan.
- **Caveat — still worth doing, for other reasons:** the change is **low-risk and beneficial** for Supabase load (−43.3M candle-row reads/day, −50% decision writes) and is supported by the cadence audit (no material trading-behaviour difference, no missed executed trades, freshness-gate margin preserved). It is a sensible efficiency/cost-hygiene step — just not a CPU fix.
- **If the goal is materially lower Vercel Active CPU**, the lever is the **candle-refresh cadence/volume**, not AI Analysis. Reducing candle-refresh toward the recommended schedule (~9,723/day from ~38,954/day, per SCHEDULER_SIMPLIFICATION_REPORT.md) would address the dominant ~64% CPU share. That is a separate, larger decision and is out of scope here.

**Recommendation:** proceed with the 10-minute cadence for its Supabase/efficiency benefits and low risk, but do not expect it to resolve the Hobby Active CPU pressure on its own. Treat candle-refresh volume as the primary CPU-reduction target in a follow-up change.

## Sources and limitations

- Vercel production request logs, 2026-11-03 17:46–21:45 UTC (exact invocation counts; no duration/CPU fields).
- Live Supabase 24h counts: 286 decision batches, 289 portfolio snapshots, ~52k candle rows (2026-11-03→04).
- AI Analysis runtime: 9.58s avg engine runtime, ~0.8s decisionGenerationMs, ~300,849 candle rows/run (AI_ANALYSIS_PRODUCTION_VERIFICATION_REPORT.md, VERCEL_CPU_ATTRIBUTION_REPORT.md).
- Vercel Hobby: 4 CPU-hours Active CPU/month; route-level Function CPU Time unavailable on Hobby (Observability Plus required).
- **All Active CPU-per-request values are estimates with stated assumptions; no exact per-route CPU attribution is possible on Hobby.** No tests were run; this was a read-only diagnostic task.
