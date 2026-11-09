# Database AI Analysis Timeout Fix Report

**Date:** 2026-11-09  
**Status:** Local implementation and validation complete; the user reports executing the production migration script; hosted runtime verification pending.

## Confirmed production cause

Supabase logs showed SQLSTATE `57014` for `AI_Crypto_Bot_Run_Database_AI_Analysis` while its candle-read query was executing. The logged PostgREST session used the `authenticator` role, which was configured with an 8-second `statement_timeout`. The RPC's 10-second client timeout cannot extend that server-side limit.

Read-only production checks found the existing unique `(symbol, interval, timestamp)` candle index, and `EXPLAIN` selected a backward scan on that index. The candle table had approximately 638,000 live rows and was about 138 MB. The prior function issued six separate PL/pgSQL candle queries for each market; at the previously observed 102 enabled markets, that meant 612 PL/pgSQL query executions per analysis. The recorded successful RPC mean was approximately 5.3 seconds, with a maximum of approximately 7.6 seconds, close to the role timeout.

## Implementation

The additive migration `20261109120000_ai_analysis_interval_batching.sql` replaces the existing analysis function without changing its signature, security mode, empty `search_path`, service-role-only grant, candle limit, or output. For each market, it retrieves and aggregates all six intervals in one ordered SQL statement using the existing candle index, reducing the function-level query executions from six per market to one. Each interval remains an independent indexed lookup capped at the newest 150 candles.

Freshness checks, interval ordering and weights, invalid-candle handling, indicators, confidence, decisions, persistence fields, and status behavior are unchanged. No table, index, endpoint, scheduler, timeout, paper-trading, or risk-control change was made. The optimization reduces repeated SQL statement overhead; it does not eliminate the six index lookups per market.

## Validation

- Focused PGlite AI-analysis parity tests: **2 passed**.
- Full database migration suite: **29 passed, 0 failed**.
- Full repository test suite: **359 passed, 0 failed**.
- `npm.cmd run build`: passed static project and database migration validation.
- The new 102-market regression compares every stored decision with JavaScript output. Existing single-market fixtures continue to cover the 150-candle bound and freshness/error cases.

## Production rollout

The user reports executing `20261109120000_ai_analysis_interval_batching.sql` in production on 2026-11-09. A successful hosted database-mode analysis run after execution has not yet been confirmed, so the timeout should remain under validation. Use the existing analysis scheduler and verify analyzed/stored market counts, runtime, and absence of SQLSTATE `57014`; the paper-trading endpoint is not required for this validation.
