# Active Market Universe and Infrastructure Usage Investigation

**Observation date:** 2026-11-05
**Scope:** Read-only production and public-market investigation. No code, market settings, scheduler settings, database data, migrations, deployment, or trading behavior were changed.

## Executive summary

**Recommendation: do not reduce the enabled universe yet.** The current evidence supports estimating infrastructure reductions for candidate universes, but it does not support a performance-based shortlist. The common AI-decision history covers about 4 days and 7 hours, and only **one position has closed**. Risk Management explicitly calls for reviewing the 67-confidence experiment at 25 closed trades and, if it continues, at 50. The present sample is far below either point.

At the read-only Supabase observation, all **102/102** watched markets were enabled. There were **five open positions**, equal to the configured five-position limit. Every candidate set below retains all five symbols so existing positions can still receive enabled-market SELL decisions:

- `ARX-EUR`
- `MEGA-EUR`
- `POL-EUR`
- `SXT-EUR`
- `WIN-EUR`

In the trailing 24 hours, each market had 285 stored decisions (29,070 total). There were 1,560 BUY and 617 SELL decisions; 841 BUY decisions met the **67 confidence threshold**. This is only confidence-threshold eligibility, not proof that 841 decisions passed all executor controls. The database does not durably record per-decision rejection outcomes, and the portfolio is currently at its open-position limit.

The latest complete run recorded **91,674 candle rows** across 102 markets and six intervals, using 156 bounded AI-candle RPC calls by the documented batch formula. Illustrative 10/25/50-market universes would lower latest-run candle rows to 8,986 / 22,468 / 44,968 respectively, and AI candle RPC calls to 18 / 42 / 78 per analysis run. These are row/request-count estimates, not measured egress-byte or CPU savings.

The observed production analysis cadence remains approximately **five minutes**, not ten. The 10-minute change remains a separate scheduler-only option; its recent validation report was explicitly inconclusive and noted a possible 95-minute delay to an observed BUY in the alternate phase.

No shortlist or market reduction is recommended from the current trading sample. If a later paper-only infrastructure pilot is approved, first decide the candidate set, retain every open-position market, and resize the external candle-refresh jobs in the same rollout. Leaving old batch jobs unchanged can cause out-of-range batches to fail.

## Observation scope and source

- **Supabase observation:** read-only connection identity was confirmed as database `postgres`, role `supabase_read_only_user`, PostgreSQL 17.6 at **2026-11-05 12:39:45 UTC**. The project identifier and external scheduler configuration were not re-verified in this investigation.
- **Enabled universe:** read from `public."AI_Crypto_Bot_Watched_Markets"` at **12:47:39 UTC**: 102 rows, all enabled, priorities 1–102, no disabled rows.
- **Decision history:** exact run batches from **2026-11-01 05:57:38.832659 UTC through 2026-11-05 12:46:14.668686 UTC**. All 1,232 observed batches contained exactly 102 decisions for 102 distinct symbols; median gap was 5.0001 minutes and maximum gap was 10.0886 minutes. This is approximately **4 days, 6 hours, 49 minutes** of common decision coverage. No candle-history gap-free claim is made.
- **Trailing-24-hour decision window:** the database query at **12:49:13 UTC** returned 285 rows per enabled market, 29,070 decisions total. Per-market decision metrics in the evidence table use this window.
- **Candle coverage:** latest stored candle bars and interval freshness were queried at approximately **12:42:37 UTC**. Per-market candle freshness limits match the AI Engine: 30 minutes (`1m`), 2 hours (`5m`), 6 hours (`15m`), 12 hours (`1h`), 24 hours (`4h`), and 72 hours (`1d`).
- **Market snapshots:** all 102 stored snapshots had `captured_at = 2026-11-05 12:40:21.282 UTC`; their oldest age was 2.27 minutes at the 12:42:37 query. This is a point-in-time freshness check, not scheduler verification.
- **Public Bitvavo data:** unauthenticated GETs to `/v2/ticker/24h` and `/v2/ticker/book` were read between **12:46:20.285 and 12:46:20.610 UTC**. Each returned 437 records; all 102 watched EUR markets appeared in both responses. `volumeQuote` was used as 24-hour EUR quote turnover. Top-of-book spread was calculated as `(ask - bid) / ((ask + bid) / 2) * 10,000` basis points. This is one observation, not historical liquidity or order-book-depth evidence.
- **Trades and positions:** read at approximately **12:47:39 UTC**. P&L, age, and sample limitations are described below.

## Current market coverage and freshness

All six intervals had stored candles for every enabled symbol; no market/interval combination was missing. There were 483,190 stored candle rows in total. Of 612 market/interval pairs, **581 were fresh and 31 stale** at the query time.

| Interval | Fresh / enabled | Stale | Stored candle rows | Latest-bar range across markets (UTC) | Oldest stored bar |
|---|---:|---:|---:|---|---|
| `1m` | 82 / 102 | 20 | 145,964 | Nov 5 07:48–12:40 | Oct 13 18:29 |
| `5m` | 94 / 102 | 8 | 103,302 | Nov 5 00:35–12:30 | Oct 7 15:40 |
| `15m` | 100 / 102 | 2 | 77,317 | Nov 5 00:30–12:30 | Sep 28 00:00 |
| `1h` | 101 / 102 | 1 | 56,260 | Nov 5 00:00–12:00 | Oct 9 09:00 |
| `4h` | 102 / 102 | 0 | 53,050 | Nov 5 00:00–08:00 | Aug 1 12:00 |
| `1d` | 102 / 102 | 0 | 47,297 | Nov 4 00:00 | Jun 13, 2025 00:00 |

Freshness counts by market were: 80 markets at 6/6, 14 at 5/6, seven at 4/6, and one at 3/6. `STRAX-EUR` was the only market below four fresh intervals (`5m`, `15m`, and `1h` were stale). The AI Engine requires two valid intervals for analysis and caps confidence at 64 when fewer than four are valid; consequently, at this observation it could not reach the 67 BUY-entry threshold from `STRAX-EUR` until more intervals became fresh. This is not a permanent market-quality judgment.

The November 3 [candle coverage report](./CANDLE_REFRESH_COVERAGE_REPORT.md) documented substantially worse freshness at its earlier observation. Current stored bars show materially better coverage, but do not identify which external scheduler jobs ran or establish continuous history.

## Decision activity, execution, and performance sample

The current paper-entry confidence threshold of **67** was verified in the connected Supabase database's `AI_Crypto_Bot_Apply_Paper_Decision` function using a read-only function-definition check. The documented Risk Manager also enforces freshness, enabled-market, open-position, cooldown, funds, drawdown, and emergency controls. A SELL can close exposure without the BUY-entry confidence threshold.

| Decision in trailing 24h | Count | Mean confidence | Mean Market Strength |
|---|---:|---:|---:|
| BUY | 1,560 | 67.87 | +36.18 |
| SELL | 617 | 67.51 | -34.76 |
| HOLD | 26,893 | 57.66 | +1.70 |
| WAIT | 0 | - | - |
| **Total** | **29,070** | | |

Of the 1,560 BUY decisions, **841 had confidence >= 67**. They met the numeric confidence threshold only; the database does not retain a durable per-decision record proving that each passed the full paper-execution gate. Open positions, cooldowns, stale input, funds, portfolio limits, and emergency state can independently block execution.

There were **seven trade rows** since the first trade on November 1: six BUYs and one SELL. The only closed position was `BEAM-EUR`, with a realized net loss of **EUR 246.71** after the recorded paper costs; its holding period was about **55 hours 40 minutes**. That is one closed sample and cannot establish strategy or market profitability.

The five current open positions equal the configured limit. Their values below use the stored mark at the 12:47:39 UTC query; open unrealized P&L does not include hypothetical exit fees/slippage.

| Symbol | Open age (hours) | Stored unrealized P&L (EUR) |
|---|---:|---:|
| `ARX-EUR` | 25.74 | -4.13 |
| `MEGA-EUR` | 25.74 | -50.97 |
| `POL-EUR` | 25.74 | +1.12 |
| `SXT-EUR` | 21.99 | -91.57 |
| `WIN-EUR` | 70.57 | -21.93 |
| **Total** | | **-167.47** |

All five are currently enabled and must stay in every proposed universe until their positions close. [ROADMAP.md](../ROADMAP.md) identifies the missing durable execution-outcome audit as backlog; therefore, raw BUY counts and confidence-qualified counts are not actual executed or rejected-trade counts.

## Per-market evidence

`BUY/SELL/BUY>=67` contains the trailing-24-hour decision counts. The two `mean C/strength` columns are average confidence and signed Market Strength for that decision direction; `-` means no such decisions. Paper-trade counts and realized P&L cover all stored trades, not only the 24-hour window. The final column is the current open-position mark at approximately 12:47:39 UTC. Candle freshness is `fresh intervals / 6`, followed by stale interval names when applicable.

| Market | 24h EUR volume | Spread (bps) | Candle freshness | BUY/SELL/BUY>=67 | Mean BUY C/strength | Mean SELL C/strength | Trades BUY/SELL/closed | Realized net EUR | Open unrealized EUR |
|---|---:|---:|---|---:|---:|---:|---:|---:|---:|
| 1INCH-EUR | 12993 | 21.94 | 5/6 (1m) | 0/0/0 | - | - | 0/0/0 | - | - |
| AAVE-EUR | 380512 | 8.58 | 6/6 | 3/0/0 | 65.34/29.84 | - | 0/0/0 | - | - |
| ACU-EUR | 130059 | 9.30 | 6/6 | 0/51/0 | - | 65.74/-27.96 | 0/0/0 | - | - |
| ADA-EUR | 9096368 | 1.15 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| ADX-EUR | 516 | 218.70 | 4/6 (1m,5m) | 0/0/0 | - | - | 0/0/0 | - | - |
| ALGO-EUR | 254863 | 14.75 | 6/6 | 53/0/0 | 65.59/27.59 | - | 0/0/0 | - | - |
| ALICE-EUR | 3570 | 22.34 | 5/6 (1m) | 0/0/0 | - | - | 0/0/0 | - | - |
| ARB-EUR | 246843 | 6.95 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| ARX-EUR | 329813 | 32.47 | 6/6 | 52/0/32 | 68.02/42.61 | - | 1/0/0 | - | -4.13 |
| ATOM-EUR | 84690 | 20.64 | 6/6 | 6/0/0 | 65.10/25.70 | - | 0/0/0 | - | - |
| AUDIO-EUR | 775 | 166.23 | 4/6 (1m,5m) | 0/0/0 | - | - | 0/0/0 | - | - |
| AVAX-EUR | 1439963 | 4.41 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| AXS-EUR | 89469 | 10.34 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| AZTEC-EUR | 64568 | 25.52 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| BCH-EUR | 691480 | 5.05 | 6/6 | 1/0/0 | 65.26/22.62 | - | 0/0/0 | - | - |
| BEAM-EUR | 731495 | 40.56 | 6/6 | 14/0/0 | 65.61/35.57 | - | 1/1/1 | -246.71 | - |
| BILL-EUR | 223796 | 14.14 | 6/6 | 0/261/0 | - | 68.56/-38.83 | 0/0/0 | - | - |
| BNT-EUR | 21455 | 16.13 | 6/6 | 7/0/0 | 66.04/26.41 | - | 0/0/0 | - | - |
| BTC-EUR | 46832299 | 0.14 | 6/6 | 46/0/0 | 65.56/23.42 | - | 0/0/0 | - | - |
| CAP-EUR | 1630437 | 39.65 | 6/6 | 215/0/174 | 70.07/47.94 | - | 0/0/0 | - | - |
| CHR-EUR | 5188 | 27.57 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| CNPY-EUR | 62400 | 42.97 | 6/6 | 0/57/0 | - | 68.70/-41.94 | 0/0/0 | - | - |
| COMP-EUR | 25936 | 17.22 | 5/6 (1m) | 0/0/0 | - | - | 0/0/0 | - | - |
| COTI-EUR | 45926 | 26.97 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| CRO-EUR | 22562 | 44.80 | 5/6 (1m) | 0/0/0 | - | - | 0/0/0 | - | - |
| CRV-EUR | 109981 | 17.77 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| CTC-EUR | 629 | 136.57 | 5/6 (1m) | 0/8/0 | - | 65.80/-29.30 | 0/0/0 | - | - |
| DOT-EUR | 367501 | 7.20 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| DRIFT-EUR | 41524 | 8.68 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| ENJ-EUR | 6863 | 34.49 | 5/6 (1m) | 0/0/0 | - | - | 0/0/0 | - | - |
| ENS-EUR | 80413 | 16.79 | 6/6 | 7/0/0 | 65.65/30.16 | - | 0/0/0 | - | - |
| ENSO-EUR | 37200 | 40.03 | 5/6 (1m) | 0/15/0 | - | 65.66/-28.58 | 0/0/0 | - | - |
| ETH-EUR | 25998916 | 1.41 | 6/6 | 236/0/153 | 67.64/29.29 | - | 0/0/0 | - | - |
| EURC-EUR | 10063 | 9.90 | 5/6 (1m) | 0/0/0 | - | - | 0/0/0 | - | - |
| FIL-EUR | 70246 | 16.74 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| FUN-EUR | 10761 | 23.57 | 5/6 (1m) | 0/0/0 | - | - | 0/0/0 | - | - |
| GALA-EUR | 31136 | 17.66 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| GLMR-EUR | 15594 | 23.47 | 6/6 | 0/15/0 | - | 66.02/-31.27 | 0/0/0 | - | - |
| GRASS-EUR | 225841 | 25.21 | 6/6 | 0/69/0 | - | 67.74/-33.56 | 0/0/0 | - | - |
| GRT-EUR | 40357 | 19.98 | 5/6 (1m) | 0/0/0 | - | - | 0/0/0 | - | - |
| HBAR-EUR | 749282 | 5.18 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| HEI-EUR | 86974 | 29.79 | 6/6 | 0/17/0 | - | 67.81/-32.83 | 0/0/0 | - | - |
| HNT-EUR | 24179 | 68.48 | 6/6 | 0/23/0 | - | 65.78/-31.77 | 0/0/0 | - | - |
| ICP-EUR | 144355 | 9.92 | 6/6 | 68/0/3 | 65.92/24.88 | - | 0/0/0 | - | - |
| IKA-EUR | 477220 | 181.16 | 6/6 | 62/0/30 | 67.15/46.62 | - | 0/0/0 | - | - |
| IMX-EUR | 13366 | 24.76 | 5/6 (1m) | 0/0/0 | - | - | 0/0/0 | - | - |
| INJ-EUR | 1014647 | 8.40 | 6/6 | 246/0/198 | 69.37/38.92 | - | 0/0/0 | - | - |
| IQ-EUR | 1231 | 84.92 | 4/6 (5m,15m) | 0/0/0 | - | - | 0/0/0 | - | - |
| JASMY-EUR | 27164 | 27.97 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| JTO-EUR | 45158 | 13.56 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| LDO-EUR | 43469 | 18.40 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| LINK-EUR | 1753245 | 1.97 | 6/6 | 9/0/0 | 65.32/29.60 | - | 0/0/0 | - | - |
| LMWR-EUR | 12028 | 80.75 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| LRC-EUR | 1978 | 83.32 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| LSK-EUR | 860428 | 29.15 | 6/6 | 5/0/0 | 65.97/38.51 | - | 0/0/0 | - | - |
| LTC-EUR | 317844 | 5.89 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| MAGIC-EUR | 27815 | 20.16 | 5/6 (1m) | 15/0/1 | 65.77/30.86 | - | 0/0/0 | - | - |
| MASK-EUR | 42390 | 18.16 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| MEGA-EUR | 79143 | 12.13 | 6/6 | 0/0/0 | - | - | 1/0/0 | - | -50.97 |
| MIOTA-EUR | 22317 | 30.60 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| MLN-EUR | 13534 | 133.11 | 4/6 (1m,5m) | 0/0/0 | - | - | 0/0/0 | - | - |
| MON-EUR | 54474 | 11.38 | 6/6 | 0/29/0 | - | 65.62/-27.06 | 0/0/0 | - | - |
| MORPHO-EUR | 61327 | 15.44 | 6/6 | 13/0/0 | 65.75/27.43 | - | 0/0/0 | - | - |
| MOVR-EUR | 66112 | 19.66 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| NEAR-EUR | 3819580 | 9.94 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| NOM-EUR | 13541 | 42.41 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| OGN-EUR | 6813 | 28.56 | 4/6 (1m,5m) | 0/0/0 | - | - | 0/0/0 | - | - |
| OP-EUR | 173360 | 7.20 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| ORCA-EUR | 78603 | 14.10 | 6/6 | 0/11/0 | - | 65.73/-27.35 | 0/0/0 | - | - |
| PHA-EUR | 121726 | 21.68 | 6/6 | 0/23/0 | - | 66.51/-29.56 | 0/0/0 | - | - |
| PIXEL-EUR | 22365 | 21.85 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| POL-EUR | 119340 | 10.52 | 6/6 | 9/0/0 | 65.39/25.29 | - | 1/0/0 | - | +1.12 |
| PTB-EUR | 317102 | 162.11 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| QNT-EUR | 2608912 | 5.27 | 6/6 | 101/0/21 | 66.35/31.37 | - | 0/0/0 | - | - |
| RENDER-EUR | 282722 | 6.38 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| RON-EUR | 13396 | 32.85 | 5/6 (1m) | 0/0/0 | - | - | 0/0/0 | - | - |
| SAND-EUR | 84322 | 10.12 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| SEI-EUR | 135206 | 7.46 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| SKY-EUR | 35842 | 11.99 | 5/6 (1m) | 0/0/0 | - | - | 0/0/0 | - | - |
| SLX-EUR | 23920 | 14.06 | 6/6 | 0/5/0 | - | 65.66/-28.95 | 0/0/0 | - | - |
| SNX-EUR | 80246 | 21.82 | 6/6 | 0/23/0 | - | 65.70/-24.98 | 0/0/0 | - | - |
| SOL-EUR | 16446164 | 1.18 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| STRAX-EUR | 467 | 41.12 | 3/6 (5m,15m,1h) | 0/0/0 | - | - | 0/0/0 | - | - |
| STRK-EUR | 109680 | 16.51 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| SUI-EUR | 3205397 | 4.44 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| SXT-EUR | 330522 | 47.09 | 6/6 | 55/0/22 | 67.29/42.69 | - | 1/0/0 | - | -91.57 |
| SYN-EUR | 66005 | 32.53 | 6/6 | 0/4/0 | - | 65.10/-27.44 | 0/0/0 | - | - |
| TIA-EUR | 252926 | 24.89 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| TOWNS-EUR | 14800 | 18.13 | 4/6 (1m,5m) | 0/5/0 | - | 65.09/-27.42 | 0/0/0 | - | - |
| TRAC-EUR | 42846 | 0.32 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| UNI-EUR | 1036837 | 6.78 | 6/6 | 164/0/119 | 68.22/35.94 | - | 0/0/0 | - | - |
| USDC-EUR | 2089087 | 1.12 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| VELO-EUR | 55483 | 44.99 | 6/6 | 125/0/73 | 67.80/36.95 | - | 0/0/0 | - | - |
| WIN-EUR | 17708 | 60.47 | 6/6 | 0/0/0 | - | - | 1/0/0 | - | -21.93 |
| XAI-EUR | 13456 | 22.93 | 6/6 | 0/1/0 | - | 65.14/-31.07 | 0/0/0 | - | - |
| XDC-EUR | 22726 | 14.52 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| XLM-EUR | 867317 | 6.16 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| XPL-EUR | 264826 | 8.09 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |
| XRP-EUR | 23931704 | 0.95 | 6/6 | 16/0/0 | 65.61/26.49 | - | 0/0/0 | - | - |
| XTZ-EUR | 324471 | 59.01 | 6/6 | 32/0/15 | 67.35/37.28 | - | 0/0/0 | - | - |
| XYO-EUR | 691 | 41.11 | 4/6 (1m,5m) | 0/0/0 | - | - | 0/0/0 | - | - |
| ZIG-EUR | 131091 | 20.31 | 6/6 | 0/0/0 | - | - | 0/0/0 | - | - |

### Reading the evidence

- A market with no recent BUY/SELL signal is **inactive in this 24-hour sample**, not proven low quality.
- The volume-ranked candidates include wide-spread markets such as `IKA-EUR` (181.16 bps), `PTB-EUR` (162.11 bps), and `CAP-EUR` (39.65 bps). The public book response provides only a top-of-book snapshot; it does not show depth or persistent executable liquidity.
- A volume-only candidate set would exclude `VELO-EUR`, which had 125 BUY decisions and 73 at confidence >=67 in this sample. Those signals are not proof of actual entry eligibility or profitability. This illustrates why liquidity-only ranking must not be presented as a trading-quality ranking.
- No market is called profitable or unprofitable from the one closed trade. Open P&L is a mark, not realized outcome.

## Candidate universes for comparison

These are **illustrative infrastructure scenarios**, not enabled-market recommendations. The criteria are reproducible and intentionally do not use raw P&L:

1. Retain all five open-position symbols.
2. Fill the remaining slots by descending single-snapshot Bitvavo `volumeQuote` among the other enabled markets; use narrower spread only as a tie-breaker.
3. Do not apply an arbitrary volume or spread cutoff. The one-time liquidity view is insufficient to establish a safe permanent cutoff.
4. All symbols in each illustrative candidate set had 6/6 fresh intervals in the observed candle snapshot. This is current evidence only.

| Size | Illustrative symbols |
|---:|---|
| **10** | `ARX-EUR, MEGA-EUR, POL-EUR, SXT-EUR, WIN-EUR, BTC-EUR, ETH-EUR, XRP-EUR, SOL-EUR, ADA-EUR` |
| **25** | 10 above, plus `NEAR-EUR, SUI-EUR, QNT-EUR, USDC-EUR, LINK-EUR, CAP-EUR, AVAX-EUR, UNI-EUR, INJ-EUR, XLM-EUR, LSK-EUR, HBAR-EUR, BEAM-EUR, BCH-EUR, IKA-EUR` |
| **50** | 25 above, plus `AAVE-EUR, DOT-EUR, XTZ-EUR, LTC-EUR, PTB-EUR, RENDER-EUR, XPL-EUR, ALGO-EUR, TIA-EUR, ARB-EUR, GRASS-EUR, BILL-EUR, OP-EUR, ICP-EUR, SEI-EUR, ZIG-EUR, ACU-EUR, PHA-EUR, CRV-EUR, STRK-EUR, AXS-EUR, HEI-EUR, ATOM-EUR, SAND-EUR, ENS-EUR` |

**Shortlist decision:** none is recommended for adoption yet. The lists are candidate sets for later review only. The sample is too short to judge market performance, the only closed trade lost money, several current open positions are at the position cap, and activity-based ranking would be confounded by unrecorded executor rejection reasons. Before choosing a long-term universe, collect at least the documented 25 closed-trade review sample (and 50 if continuing the threshold experiment), a multi-week liquidity/spread sample, and durable execution outcomes or equivalent attributable paper-trading evidence.

## Estimated workload effects

The current implementation uses six independent intervals, at most 150 candles per market/interval, and groups up to four markets per AI-candle RPC. The latest stored complete analysis run at **12:46:14 UTC** represented 91,674 candles in its per-market timeframe inputs; the theoretical cap is 91,800 for 102 markets. Candidate row values below are the measured per-market row counts for the same latest run, summed over the illustrative sets. Daily decision volumes use the observed 285 runs/day and assume the same cadence and one decision per enabled market per run.

| Enabled markets | AI candle RPCs / run (`6 * ceil(N/4)`) | Latest-run candle rows (measured subset) | Maximum rows / run | Decisions / day at 285 runs | Candle batches per six-interval full pass if scheduler is resized (`6 * ceil(N/5)`) |
|---:|---:|---:|---:|---:|---:|
| 102 (current) | 156 | 91,674 | 91,800 | 29,070 | 126 |
| 50 | 78 | 44,968 | 45,000 | 14,250 | 60 |
| 25 | 42 | 22,468 | 22,500 | 7,125 | 30 |
| 10 | 18 | 8,986 | 9,000 | 2,850 | 12 |

Interpretation and constraints:

- AI candle RPCs, returned candle rows, AI decisions written, and per-market candle work scale approximately with the active universe. The RPC count has batch-rounding effects.
- At unchanged five-minute cadence, the 50/25/10 sets imply about 51.0% / 75.5% / 90.2% fewer decision rows and latest-run candle rows than the current 102-market run. These are workload projections, not measured latency, bytes, egress, CPU, or cost savings.
- The external candle scheduler invokes one interval and one five-market batch per request. A market reduction does **not** by itself reduce configured scheduler request count. The latest repository evidence of live cron-job.org settings is the November 3 [scheduler verification report](./SCHEDULER_CADENCE_VERIFICATION.md), which recorded 126 definitions, 125 active, and approximately 38,954 invocations/day. That scheduler state was not re-verified now. If those old batch indexes remain configured after shrinking the universe, indexes outside the endpoint's new `batchCount` are rejected; a later pilot must resize and verify the external jobs as a separate approved step.
- With a resized schedule, the number of non-empty batch/interval invocations per full pass would be 60/30/12 for 50/25/10 markets. Candle provider requests and writes should fall with active markets, but actual calls depend on due intervals, cache hits, stored checkpoints, and provider/storage failures; no daily ingestion-byte total was measured.
- The market-refresh endpoint and AI-analysis/paper-trading scheduler invocations remain scheduled at their existing cadence. Fewer markets reduce the per-market data and decision work, not the number of scheduled endpoint invocations. The 24-hour portfolio-snapshot query returned 287 rows at 286 distinct timestamps; portfolio-level snapshot work is largely fixed per run.
- Reducing enabled markets does not delete existing decisions or candles and therefore does not immediately shrink database storage. It reduces future per-market writes only. Historical rows must remain available for audit and future analysis/backtesting.
- No Supabase Network Traffic response-byte breakdown or comparable Vercel byte telemetry was available. No production egress reduction is claimed.

## Separate option: reduce AI-analysis cadence to 10 minutes

The 10-minute cadence is not active in the observed production decisions:

- The full decision history contained 1,232 complete 102-market batches with a median spacing of 5.0001 minutes.
- The trailing 24 hours contained 285 complete batches; the cadence query found 279 gaps between 4.5 and 5.5 minutes and three between 9 and 11 minutes. The largest observed gap was about 10.09 minutes. Those occasional long gaps are not a regular 10-minute schedule.
- The [10-minute implementation plan](./AI_ANALYSIS_10MIN_IMPLEMENTATION_PLAN.md) is marked plan-only. The [validation report](./AI_ANALYSIS_10MIN_CADENCE_VALIDATION.md) returned **Verdict B: additional validation required**, covered only about 5.5 hours, and found that an alternate phase could delay an observed BUY by about 95 minutes. The earlier 24-hour [cadence audit](./AI_ANALYSIS_CADENCE_AUDIT.md) recommended 10 minutes, but that recommendation does not show that the external jobs were changed.

At the current 102-market universe, a regular 10-minute schedule would mean approximately 144 instead of 285 runs/day, about 22,464 instead of 44,460 AI candle RPC calls/day, and roughly half as many decision rows. Applying the latest run's 91,674 candle rows to those run counts gives an estimated 13.2 million versus 26.1 million candle inputs/day; the per-run input count varies, so this is not a measured daily total. Market-refresh and candle-refresh jobs are separate and would not be reduced by this cadence change. The paper executor's 15-minute freshness gate remains binding; scheduler failures or sequencing delays can suspend execution safely. No cadence change was made or is recommended solely from this short replay evidence.

## Prior report findings and status

| Report | Prior evidence / recommendation | Status against this investigation |
|---|---|---|
| [AI Analysis 10-Minute Cadence Validation](./AI_ANALYSIS_10MIN_CADENCE_VALIDATION.md) | 5.5-hour stored-decision replay; verdict B; one alternate phase delayed an observed BUY by about 95 minutes. | Current rows still show approximately five-minute production decisions. No 10-minute rollout is evidenced. |
| [AI Analysis 10-Minute Implementation Plan](./AI_ANALYSIS_10MIN_IMPLEMENTATION_PLAN.md) | Plan-only scheduler change; no code/configuration change. | Still not active, consistent with current decision timestamps. |
| [Strategy Health Audit](./STRATEGY_HEALTH_AUDIT.md) | Nov 4 RED verdict after repeated stale-market-snapshot WAITs. | No WAIT decisions in the latest 24-hour sample and all 102 market snapshots were fresh at the current query. The earlier incident is not present in this observed window; recurrence is not ruled out. |
| [Post-Fix Trade Generation Audit](./POST_FIX_TRADE_GENERATION_AUDIT.md) | Entry threshold was the principal observed blocker; durable per-decision executor outcomes were unavailable. | Threshold 67 remains active; current trade sample is still only one closed position. The attribution gap remains. |
| [Candle Freshness Protection Report](./CANDLE_FRESHNESS_PROTECTION_REPORT.md) | Documents six interval age limits and fail-safe stale handling. | Current SQL freshness measurements use those documented limits; 31/612 market-interval pairs were stale, none missing. |
| [Candle Refresh Coverage Report](./CANDLE_REFRESH_COVERAGE_REPORT.md) | Nov 3 observation showed broad stale coverage and unknown external scheduler cause. | Current candle freshness is materially better, but SQL data still does not verify the current external scheduler configuration. |
| [Scheduler Cadence Verification](./SCHEDULER_CADENCE_VERIFICATION.md) | Nov 3 external job inventory: 125 active of 126, about 38,954 requests/day; one daily batch inactive. | Dated evidence only; not re-verified for this observation. Must be rechecked before a universe pilot. |
| [Scheduler Simplification Report](./SCHEDULER_SIMPLIFICATION_REPORT.md) and [Refresh Frequency Impact Report](./REFRESH_FREQUENCY_IMPACT_REPORT.md) | Recommended lower interval-specific candle refresh cadence and complete batch coverage. | Useful operational proposals, not evidence that current job settings match them. |
| [Supabase Egress and Database Size Optimization Report](./SUPABASE_EGRESS_AND_DATABASE_SIZE_OPTIMIZATION_REPORT.md) | Response bytes and billed egress were unavailable; bounded AI-candle RPC reduced unnecessary row reads in local comparisons. | Current row-count estimates are available, but this investigation still cannot attribute billed egress or claim byte savings. |

## Controlled paper-only pilot and rollback steps

No pilot was started. If the owner later approves one:

1. Record/export the exact current 102-symbol enabled set and priorities from `AI_Crypto_Bot_Watched_Markets`. Keep the five open-position symbols enabled until those positions close; never remove a market still needed for a fresh SELL.
2. Choose a candidate universe explicitly. Review quote-volume and spread observations over multiple days and verify candle freshness for all six intervals. Do not treat the illustrative volume-ranked sets as profitability rankings.
3. Before changing the universe, re-verify the intended Supabase project and current external scheduler jobs. Resize candle-refresh batch indexes to the endpoint's returned `batchCount` for every scheduled interval; verify complete market coverage and successful candle advancement. Keep the existing AI-analysis/paper-trading cadence unchanged for this pilot.
4. Run paper-only and monitor per-market decision counts, threshold-qualified BUYs, actual trade links and rejection outcomes if available, open-position management, candle freshness, spread, candle rows/RPC calls, endpoint errors, Supabase egress bytes, and Vercel CPU. Compare with the baseline windows and keep request count, rows, bytes, database size, WAL, latency, CPU, and cost as separate measures.
5. To roll back, restore the saved original 102 enabled symbols and their original priorities in `AI_Crypto_Bot_Watched_Markets`, then restore/verify the corresponding external batch schedule. Confirm all open positions remain enabled and can receive fresh SELL decisions. Do not delete historical rows during rollback.

## Read-only queries and methods used

All Supabase SQL in this investigation was `SELECT`/CTE-only. Representative exact queries follow; table names are project-prefixed and no production writes were issued.

### Universe count

```sql
SELECT now() AT TIME ZONE 'UTC' AS observed_at_utc,
       count(*) AS watched_rows,
       count(*) FILTER (WHERE enabled) AS enabled_rows,
       count(*) FILTER (WHERE NOT enabled) AS disabled_rows,
       min(priority) FILTER (WHERE enabled) AS min_enabled_priority,
       max(priority) FILTER (WHERE enabled) AS max_enabled_priority
FROM public."AI_Crypto_Bot_Watched_Markets";
```

Result: 102 watched, 102 enabled, zero disabled, priorities 1–102.

### Complete decision-batch coverage and spacing

```sql
WITH batches AS (
  SELECT created_at AS run_at,
         count(*) AS decision_rows,
         count(DISTINCT symbol) AS market_count
  FROM public."AI_Crypto_Bot_AI_Decisions"
  GROUP BY created_at
),
gaps AS (
  SELECT run_at, decision_rows, market_count,
         extract(epoch FROM (run_at - lag(run_at) OVER (ORDER BY run_at))) / 60.0 AS gap_minutes
  FROM batches
)
SELECT now() AT TIME ZONE 'UTC' AS observed_at_utc,
       min(run_at) AS first_run, max(run_at) AS last_run,
       count(*) AS observed_run_batches,
       min(decision_rows) AS min_decisions_per_run,
       max(decision_rows) AS max_decisions_per_run,
       min(market_count) AS min_markets_per_run,
       max(market_count) AS max_markets_per_run,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_minutes)
         FILTER (WHERE gap_minutes IS NOT NULL) AS median_gap_minutes,
       max(gap_minutes) AS max_gap_minutes,
       count(*) FILTER (WHERE decision_rows = 102 AND market_count = 102)
         AS complete_102_market_batches
FROM gaps;
```

The separate trailing-24-hour run query grouped the same two counts by `created_at`, filtered `created_at >= now() - interval '24 hours'`, and measured `lag(run_at)` over those batches. It returned 285 runs, 102 markets/run, 29,070 rows, a 5.0016-minute median gap, and a 10.05-minute maximum gap.

### Per-market decision metrics

```sql
WITH recent AS (
  SELECT symbol,
         count(*) AS decisions,
         count(*) FILTER (WHERE decision = 'BUY') AS buys,
         count(*) FILTER (WHERE decision = 'SELL') AS sells,
         count(*) FILTER (WHERE decision = 'BUY' AND confidence >= 67)
           AS buys_confidence_ge_67,
         round(avg(confidence) FILTER (WHERE decision = 'BUY'), 2)
           AS avg_buy_confidence,
         round(avg((indicators->>'marketStrength')::numeric)
           FILTER (WHERE decision = 'BUY'), 2) AS avg_buy_strength,
         round(avg(confidence) FILTER (WHERE decision = 'SELL'), 2)
           AS avg_sell_confidence,
         round(avg((indicators->>'marketStrength')::numeric)
           FILTER (WHERE decision = 'SELL'), 2) AS avg_sell_strength
  FROM public."AI_Crypto_Bot_AI_Decisions"
  WHERE created_at >= now() - interval '24 hours'
  GROUP BY symbol
)
SELECT wm.symbol, coalesce(r.decisions, 0) AS decisions_24h,
       coalesce(r.buys, 0) AS buys_24h,
       coalesce(r.sells, 0) AS sells_24h,
       coalesce(r.buys_confidence_ge_67, 0) AS buys_confidence_ge_67_24h,
       r.avg_buy_confidence, r.avg_buy_strength,
       r.avg_sell_confidence, r.avg_sell_strength
FROM public."AI_Crypto_Bot_Watched_Markets" wm
LEFT JOIN recent r USING (symbol)
WHERE wm.enabled
ORDER BY wm.symbol;
```

### Candle freshness by market and interval

```sql
WITH interval_limits(ord, interval_name, max_age) AS (
  VALUES (1, '1m'::text, interval '30 minutes'),
         (2, '5m', interval '2 hours'),
         (3, '15m', interval '6 hours'),
         (4, '1h', interval '12 hours'),
         (5, '4h', interval '24 hours'),
         (6, '1d', interval '72 hours')
),
per_market_interval AS (
  SELECT wm.symbol, i.ord, i.interval_name, i.max_age,
         count(c.id)::bigint AS candle_rows,
         min(c."timestamp") AS oldest_bar,
         max(c."timestamp") AS latest_bar
  FROM public."AI_Crypto_Bot_Watched_Markets" wm
  CROSS JOIN interval_limits i
  LEFT JOIN public."AI_Crypto_Bot_Candles" c
    ON c.symbol = wm.symbol AND c."interval" = i.interval_name
  WHERE wm.enabled
  GROUP BY wm.symbol, i.ord, i.interval_name, i.max_age
)
SELECT interval_name,
       count(*) AS enabled_markets,
       count(*) FILTER (WHERE latest_bar >= now() - max_age AND latest_bar <= now())
         AS fresh_markets,
       count(*) FILTER (WHERE latest_bar IS NULL) AS missing_markets,
       count(*) FILTER (WHERE latest_bar < now() - max_age) AS stale_markets,
       min(latest_bar) AS oldest_latest_bar,
       max(latest_bar) AS newest_latest_bar,
       sum(candle_rows)::bigint AS candle_rows,
       min(oldest_bar) AS oldest_stored_bar
FROM per_market_interval
GROUP BY interval_name
ORDER BY CASE interval_name WHEN '1m' THEN 1 WHEN '5m' THEN 2
  WHEN '15m' THEN 3 WHEN '1h' THEN 4 WHEN '4h' THEN 5 WHEN '1d' THEN 6 END;
```

The per-market freshness query used the same `interval_limits` and join, grouped by market, and returned fresh/missing interval counts plus each interval's `FRESH`, `STALE`, or `MISSING` state and latest-bar age.

### Positions, trades, and market snapshots

The open/closed position query selected `symbol`, `status`, `created_at`, `updated_at`, `entry_price`, `current_price`, `amount`, and `unrealized_pnl` from `public."AI_Crypto_Bot_Positions"`, with `extract(epoch FROM (now() - created_at)) / 3600.0` for holding age. Trades were read from `public."AI_Crypto_Bot_Trades"` by symbol, side, timestamp, fees, slippage, realized P&L, and linked decision ID; no write statements were run.

The 24-hour portfolio snapshot query used:

```sql
SELECT now() AT TIME ZONE 'UTC' AS observed_at_utc,
       count(*) AS snapshots_24h,
       min(captured_at) AS first_snapshot_24h,
       max(captured_at) AS last_snapshot_24h,
       count(DISTINCT captured_at) AS distinct_snapshot_timestamps
FROM public."AI_Crypto_Bot_Portfolio_Snapshots"
WHERE captured_at >= now() - interval '24 hours';
```

### Public Bitvavo GET methods

```js
const [tickersResponse, booksResponse] = await Promise.all([
  fetch("https://api.bitvavo.com/v2/ticker/24h"),
  fetch("https://api.bitvavo.com/v2/ticker/book")
]);
```

The two responses were joined by `market`; only the 102 enabled watched symbols were summarized. Spread uses the formula stated above. No authenticated API, order placement, or private exchange endpoint was used.

## Validation and changes

- No application tests or build were run; this was a read-only investigation and report-only change.
- `git diff --check` passed for tracked changes. The new report was checked with `git diff --no-index --check -- /dev/null docs/reports/ACTIVE_MARKET_UNIVERSE_USAGE_INVESTIGATION.md`; no whitespace errors were reported.
- **Files changed:** `docs/reports/ACTIVE_MARKET_UNIVERSE_USAGE_INVESTIGATION.md`.
- No markets were enabled or disabled; no production data, settings, schedules, migration, or deployment were changed.
- `ENABLE_LIVE_TRADING` was not changed; no live trade or real-money behavior was used.
