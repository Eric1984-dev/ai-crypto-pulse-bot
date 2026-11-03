# Vercel CPU Attribution Audit

**Observation date:** 2026-11-03  
**Request-log window:** 2026-11-03 17:46:08–21:45:19 UTC  
**Runtime-log sample:** Six successful AI Analysis completions in the most recent 30-minute retained window  
**Scope:** Read-only production Vercel logs, repository instrumentation, and Vercel metrics availability. No code, data, deployment, or project settings were changed.

## Executive finding

**The endpoint responsible for the majority of Vercel Fluid Active CPU cannot be determined from the available Hobby-plan telemetry.** Vercel request logs provide per-route request counts, but not route-level CPU time or function duration. The Vercel metrics query for Active CPU and duration was denied because the project is on Hobby and requires Observability Plus, which cannot be purchased on Hobby.

`/api/candle-refresh` is the clear request-volume leader: **6,433 requests in about four hours**, or 97.65% of requests across the five requested routes. This is not a CPU share. `/api/ai-analysis` runs far less often but performs substantial per-invocation work: six recent completion logs averaged 9.58 seconds of engine runtime and reported roughly 386,557 candle rows loaded per run. Its runtime includes Supabase I/O waits, so it is not a CPU-time measurement either.

Accordingly, candle refresh is the leading **volume-based candidate**, while AI analysis is a **high-work-per-invocation candidate**. Neither can be identified as the majority Active CPU consumer without Vercel's route-level Function CPU Time metric.

## Per-endpoint observations

The request counts below came from Vercel's production request-log source. All five paths were recorded as `streaming_func` routes. Their combined count was 6,588; the percentage column is request share among these five routes, **not CPU share**.

| Endpoint | Function-route requests, ~4h | Request share | Average runtime available | Active CPU and CPU share |
|---|---:|---:|---|---|
| `/api/ai-analysis` | 48 | 0.73% | Engine runtime: **9,576 ms average** across 6 recent successful completion logs; range 8,903–11,335 ms. This is not full Vercel duration. | Not available |
| `/api/candle-refresh` | 6,433 | 97.65% | Not available. `candleRefreshDurationMs` is returned in the HTTP response but successful durations are not persisted or logged. | Not available |
| `/api/market-refresh` | 47 | 0.71% | Not available. `marketRefreshDurationMs` is returned in the HTTP response but successful durations are not persisted or logged. | Not available |
| `/api/paper-trading` | 48 | 0.73% | Not available. `paperTradingDurationMs` is returned in the HTTP response but successful durations are not persisted or logged. | Not available |
| `dashboard-data` (`/api/dashboard-data`) | 12 | 0.18% | Not available; the handler has no successful-request duration instrumentation. | Not available |

The AI runtime sample also reported an average `decisionGenerationMs` of **803 ms**. This synchronous indicator/decision stage is CPU-oriented, but it does not account for CPU consumed during candle response parsing or other stages, and it is not Vercel's Active CPU metric. The engine's average overall runtime must not be substituted for Active CPU because it includes network and database waiting.

## Invocation volume and scheduler context

The four-hour request counts correspond to about **1,608 candle-refresh requests per hour**. If that rate persisted, it would extrapolate to approximately **38,600 requests per day**. This is an extrapolation from one recent window, not a daily total.

The observed candle-refresh rate is about four times the approximately 405 requests/hour recommended in the [Scheduler Simplification Report](./SCHEDULER_SIMPLIFICATION_REPORT.md). This suggests the live candle schedule is running more frequently than that report's recommended cadence. It may raise the endpoint's total compute contribution, but request counts alone cannot determine how much Active CPU each request consumes.

The other scheduled routes were close to their five-minute cadence in this window: AI Analysis and Paper Trading each had 48 requests, and Market Refresh had 47. Dashboard-data traffic was low at 12 requests.

## Why CPU share cannot be calculated

Vercel defines Active CPU as time spent actively executing code; it excludes time waiting on external I/O. Invocation duration is wall-clock time and includes that waiting. Therefore, dividing or comparing request counts and endpoint wall-clock runtimes does not produce an Active CPU attribution.

The Vercel CLI exposes the relevant route dimensions and metrics, including:

- `vercel.function_invocation.function_cpu_time_ms`
- `vercel.function_invocation.count`
- `vercel.function_invocation.function_duration_ms`

The attempted route-grouped Active CPU and duration queries were rejected with `payment_required`: **Observability Plus is required, is available on Pro and Enterprise, and cannot be purchased on Hobby.** Runtime logs requested for the full four-hour window were also rejected because Hobby does not retain runtime logs for that requested period. The available 30-minute runtime sample supports the AI Analysis estimate above, but contains no equivalent successful-duration series for the other four routes.

| Requested value | Evidence available | Result |
|---|---|---|
| Per-route request/invocation proxy | Vercel production request logs, last ~4h | Counts reported above |
| Per-route average function duration | Vercel metrics query unavailable on Hobby; request records have no duration field | Not measurable for these routes from current access |
| Per-route Active CPU | Vercel metrics query unavailable on Hobby | Not measurable |
| Estimated CPU share | Requires per-route Active CPU time over the same time range | No defensible percentage can be calculated |

## Answer

**No endpoint can be verified as responsible for the majority of Fluid Active CPU from the accessible data.** `/api/candle-refresh` accounts for almost all observed requests, but its CPU per request is unknown. `/api/ai-analysis` has much higher observed work per invocation, but its measured runtime is dominated by a mix of computation and external I/O, and its Active CPU is also unknown.

To settle the attribution, compare **Function CPU Time (sum)** by route with **Function Invocations** for the same project, production environment, and time window, then calculate:

`route CPU share = route Function CPU Time / total Function CPU Time across the five routes`

The calculation should use Vercel Observability/Query access that exposes those metrics. Do not treat the 97.65% candle-refresh request share as its CPU share.

## Sources and limitations

- Vercel production request logs for the observation window above.
- Vercel runtime logs: six successful `/api/ai-analysis` completion records in the most recent 30-minute retained window.
- [AI Engine](../../lib/ai-engine.mjs), [market-data service](../../lib/market-data.mjs), and the [paper-trading API](../../api/paper-trading.mjs), which identify where successful duration metrics are returned or logged.
- [Scheduling documentation](../SCHEDULING.md), [Scheduler Simplification Report](./SCHEDULER_SIMPLIFICATION_REPORT.md), [Disk IO Analysis Report](./DISK_IO_ANALYSIS_REPORT.md), and [AI Analysis Production Verification Report](./AI_ANALYSIS_PRODUCTION_VERIFICATION_REPORT.md).
- [Vercel Active CPU troubleshooting guide](https://vercel.com/kb/guide/optimize-active-cpu-on-fluid-compute), which distinguishes Active CPU from invocation duration and recommends route-level Function CPU Time and invocation comparisons.
- [Vercel Metrics CLI documentation](https://vercel.com/docs/cli/metrics), which documents route-grouped function CPU, invocation, and duration metrics.
- The endpoint counts are request-log records mapped to function routes; they are used as the available invocation proxy. Exact billed invocation counts and all-time averages were not established.
- No tests were run because this was a report-only diagnostic task.
