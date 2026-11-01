# Database Design

## Phase 03 schema and Phase 08 runtime usage

Phase 03 adds the application schema to Supabase PostgreSQL through versioned migrations. Phase 06 consumes the existing market tables for public data ingestion; Phase 07 reads those tables and writes analysis decisions/status. Phase 08 uses the existing portfolio, position, trade, snapshot, decision, market-data, and status tables; it adds an auditable decision reference to trades and server-only functions/triggers, but no new table. Browser writes remain prohibited.

The application is installed in an existing Supabase database. The migrations create only the prefixed CryptoPulse objects and reference Supabase's managed `auth.users` table. They deliberately do not use `IF NOT EXISTS`: a conflicting object must stop the migration for review instead of hiding a schema mismatch.

## Naming

All application tables, functions, triggers, policies, and explicitly named indexes use the required `AI_Crypto_Bot_` prefix. Table and object identifiers preserve the required mixed-case spelling and therefore must be double-quoted in PostgreSQL SQL and PostgREST table names. Unquoted PostgreSQL identifiers fold to lowercase.

The objects live in the `public` schema. Supabase-managed objects such as `auth.users` are not renamed or altered beyond the profile synchronization trigger.

## Tables

| Table | Ownership and purpose |
|---|---|
| `AI_Crypto_Bot_Profiles` | User-owned profile; `id` is the Supabase Auth user ID. |
| `AI_Crypto_Bot_Portfolios` | User-owned paper portfolio and balances. |
| `AI_Crypto_Bot_Positions` | User-owned positions, scoped through their portfolio. |
| `AI_Crypto_Bot_Trades` | User-owned paper trade history, scoped through its portfolio. |
| `AI_Crypto_Bot_AI_Decisions` | Server-managed decision history; authenticated users may read it. |
| `AI_Crypto_Bot_Status` | Server-managed singleton containing the current agent status. |
| `AI_Crypto_Bot_Watched_Markets` | Global market universe; authenticated users may read it. |
| `AI_Crypto_Bot_Market_Data` | Latest market-data snapshot per watched symbol. |
| `AI_Crypto_Bot_Candles` | Historical OHLCV data for the supported intervals. |
| `AI_Crypto_Bot_Strategies` | Server-managed, versioned strategy catalog. |
| `AI_Crypto_Bot_Strategy_Changes` | Append-only history of strategy changes. |
| `AI_Crypto_Bot_Strategy_Performance` | Historical strategy metrics and ranking inputs. |
| `AI_Crypto_Bot_Backtests` | Backtest results, kept separate from paper-trading records. |
| `AI_Crypto_Bot_Portfolio_Snapshots` | User-owned portfolio history, scoped through its portfolio. |
| `AI_Crypto_Bot_Scanner_Events` | Server-managed scanner history; authenticated users may read it. |
| `AI_Crypto_Bot_Emergency_State` | Server-managed emergency-state event history. |

### User, portfolio, and trading tables

- `AI_Crypto_Bot_Profiles`: `id uuid` primary key and foreign key to `auth.users.id`; nullable unique `email`; `created_at` and `updated_at` timestamps.
- `AI_Crypto_Bot_Portfolios`: UUID ID, `user_id`, starting/available balances, portfolio value, and timestamps. Balances use exact numeric types and cannot be negative.
- `AI_Crypto_Bot_Positions`: portfolio and watched-market references, positive amount/prices, unrealized P&L, and `OPEN`/`CLOSED` status.
- `AI_Crypto_Bot_Trades`: portfolio and watched-market references, optional AI decision reference for legacy compatibility, required unique idempotency key, `BUY`/`SELL` side, positive price/quantity, nonnegative fees/slippage, realized P&L, and creation time.
- `AI_Crypto_Bot_Portfolio_Snapshots`: portfolio reference, portfolio value, available balance, nonnegative open-position count, and capture time.

### Agent, market, and strategy tables

- `AI_Crypto_Bot_AI_Decisions`: watched symbol, `BUY`/`SELL`/`HOLD`/`WAIT` decision, confidence from 0 to 100, JSON object of indicators, reason, optional strategy name/version snapshot, and creation time. Strategy text is an immutable historical snapshot, not a foreign key.
- `AI_Crypto_Bot_Status`: one row enforced by a singleton key; status is `ACTIVE`, `ANALYZING`, `IDLE`, `STOPPED`, or `ERROR`. Boolean status flags are constrained to agree with the status value.
- `AI_Crypto_Bot_Watched_Markets`: unique market symbol, enabled flag, positive priority, and timestamps. This table is the runtime market-universe source of truth.
- `AI_Crypto_Bot_Market_Data`: one latest row per watched symbol, with price, volume, daily change, 24-hour high/low, and capture time.
- `AI_Crypto_Bot_Candles`: watched symbol, interval (`1m`, `5m`, `15m`, `1h`, `4h`, `1d`), OHLCV values, and timestamp. OHLC consistency is checked and `(symbol, interval, timestamp)` is unique.
- `AI_Crypto_Bot_Strategies`: unique name/version, enabled flag, score, description, and timestamps.
- `AI_Crypto_Bot_Strategy_Changes`: strategy reference, required unique idempotency key, change type, old/new values, reason, and creation time. The key prevents duplicate scheduled changes/optimization events.
- `AI_Crypto_Bot_Strategy_Performance`: strategy reference, win rate, profit factor, average profit/loss, drawdown, score, trade count, net profit, risk-adjusted return, average trade duration, and creation time.
- `AI_Crypto_Bot_Backtests`: strategy reference, P&L and performance metrics, fees, slippage, spread, optional data range, reproducibility configuration, and creation time.
- `AI_Crypto_Bot_Scanner_Events`: watched symbol, event type, reason, optional confidence, and creation time.
- `AI_Crypto_Bot_Emergency_State`: append-only state events with `NORMAL`, `PAUSED`, or `EMERGENCY_STOP`, optional reason, and creation time. The newest event represents the current emergency state; this is independent of Agent Status.

Phase 09 Market Scanner adds no tables, columns, indexes, policies, or migrations. It performs authenticated read-only queries against enabled watched markets, snapshots, daily/hourly candles, and stored AI decisions. Candle and decision reads use bounded PostgREST range pagination so the default response cap does not silently omit later rows; scanner results are derived in memory and are not persisted.

Phase 10 Trade History adds no tables or columns. It pages stored trade rows through the existing authenticated dashboard API and relies on the existing `AI_Crypto_Bot_Trades` portfolio ownership policy. Its new stable `AI_Crypto_Bot_Trade_History_Stats()` SQL function is `SECURITY INVOKER`, reads only `SELL` rows visible under RLS, and computes all-time closed/winning/losing counts, average positive/negative realized P&L, and best/worst realized P&L in the database. `PUBLIC` and `anon` cannot execute it; `authenticated` can. The function avoids transferring the full history to the server or browser just to calculate statistics.

## Relationships and deletion behavior

- `AI_Crypto_Bot_Profiles.id` references `auth.users.id`; deleting an Auth user cascades to its profile.
- `AI_Crypto_Bot_Portfolios.user_id` references `AI_Crypto_Bot_Profiles.id`; deleting a profile cascades through its portfolios and their positions, trades, and snapshots.
- Positions, trades, and portfolio snapshots reference their portfolio and cascade with it.
- Market data, candles, positions, trades, AI decisions, and scanner events reference `AI_Crypto_Bot_Watched_Markets.symbol`. Market deletion is restricted while dependent history exists; disable a market instead of deleting it.
- Strategy changes, performance records, and backtests reference a strategy. Strategy deletion is restricted to preserve history.
- AI decision strategy name/version values are snapshots so old decisions remain interpretable if a strategy catalog entry changes.

All timestamps use `timestamptz` and represent UTC instants; no local-time conversion is written to the database. Browser display converts UTC values to `Europe/Brussels` without changing persisted data. UUIDs are generated by PostgreSQL except profile IDs, which come from Supabase Auth. Numeric financial and price values use `numeric`, not floating-point types. Checks reject invalid status, interval, confidence, range, and nonnegative-value inputs.

The paper-trading database function derives the idempotency UUID from the portfolio ID and stored AI-decision ID, and records the source in `AI_Crypto_Bot_Trades.ai_decision_id`. The unique database constraint is the final duplicate guard. A new decision is a distinct operation; the per-market cooldown and open-position check prevent repeated BUY decisions from stacking exposure.

## Supabase Auth integration

The migration backfills profiles for existing Auth users and installs prefixed triggers to create profiles at signup and synchronize email changes. Phase 08 backfills profiles without a portfolio with one simulated €10,000 portfolio and an initial snapshot; the profile-insert trigger provisions the same paper portfolio for new profiles. Existing portfolios are preserved. Profile identity always comes from `auth.users.id`; the browser cannot create or change profile identity records directly. Email is nullable to remain compatible with Supabase identities that do not have an email address.

Phase 02's Auth client and HttpOnly cookie continue to protect page delivery. The Phase 04 dashboard API and Phase 05 Agent Status API separately verify the access token and preserve the caller's JWT when querying through PostgREST, allowing RLS to remain authoritative. Phase 06 market APIs likewise verify the session and use the caller JWT for RLS reads. The scheduled refresh and server-side writes use `SUPABASE_SERVICE_ROLE_KEY`, which must remain server-only.

Phase 07's scheduler-protected AI analysis service reads enabled watched markets, stored market snapshots, candles, and the current agent status using the server-side service role. Candle reads are scoped to one market and one interval per request, with a bounded per-interval limit, so a PostgREST response cap cannot exclude other intervals. It inserts only generated rows into `AI_Crypto_Bot_AI_Decisions` and updates the singleton `AI_Crypto_Bot_Status` row, including `updated_at`. It does not write market data, candles, portfolios, positions, trades, or other tables. No migration or RLS policy change was required.

## Row Level Security and grants

RLS is enabled on all 16 application tables. `anon` and `PUBLIC` receive no table privileges. Authenticated users receive read-only `SELECT`; all direct user writes are denied so clients cannot edit balances, trades, positions, agent state, or risk controls.

| Table group | Authenticated read policy | Writes |
|---|---|---|
| Profiles | `auth.uid() = id` | Server only; signup/email trigger maintains the row. |
| Portfolios | `auth.uid() = user_id` | Server only. |
| Positions, trades, snapshots | Portfolio belongs to `auth.uid()` | Server only. |
| Watched markets, market data, candles | All authenticated users | Server only. |
| AI decisions, status, strategies, strategy changes, performance, backtests, scanner events, emergency state | All authenticated users | Server only. |

The scoped child-table policies resolve ownership through `portfolio_id`. They do not assume the child tables contain a `user_id` column. Tables with no matching read policy deny access under RLS. No client-side `INSERT`, `UPDATE`, or `DELETE` policy is created.

`service_role` is granted server-side CRUD access and bypasses RLS by Supabase design. It must never be exposed to the browser. Future server endpoints using it must derive the user identity from a verified Supabase session and perform explicit ownership and risk checks; possession of the service role alone is not user authorization.

## Indexes

Primary-key and unique constraints provide indexes for row IDs, profile email, watched-market symbol, market-data symbol, candle identity, strategy name/version, and the status singleton. Additional prefixed indexes support:

- Portfolio ownership lookups.
- Enabled-market priority ordering.
- Portfolio position/status and trade-history queries.
- Trade date filters and ordering reuse the existing portfolio/time index; statistics aggregate in PostgreSQL under the existing trade RLS policy. Page-size limits keep response transfers bounded.
- Market-data freshness.
- Strategy change, performance, and backtest history.
- AI decision and scanner-event history by symbol and time.
- Portfolio snapshot history.
- Emergency-state history.
- Latest-decision selection and per-portfolio/per-market trade cooldowns.

The candle uniqueness index is also the lookup index for symbol/interval/time-range reads; no duplicate index is added.

## Market seeds

`config/markets.js` is the centralized configured market universe. The original seed migration remains append-only and inserts the initial five markets (`BTC-EUR`, `ETH-EUR`, `SOL-EUR`, `XRP-EUR`, and `ADA-EUR`); build and test validation ensures those rows still match the configuration without requiring the original migration to be changed. Conflicts use `DO NOTHING`. Phase 06 validates configured symbols against Bitvavo's public catalog, inserts only valid missing markets, and never overwrites or removes existing enabled/priority settings. The initial Bitvavo validation excluded `SWEAT-EUR` because it was not listed as an available EUR market.

The scheduled refresh upserts ticker snapshots in `AI_Crypto_Bot_Market_Data` and incrementally refreshes all six supported intervals in `AI_Crypto_Bot_Candles`. It reads the latest stored candle timestamp per enabled market/interval, requests only due candles (with a one-candle overlap for updates), and uses a bounded 500-candle bootstrap only when an interval has no stored history. Upserts continue to use the existing `(symbol, interval, timestamp)` key. Authenticated market requests can also refresh a selected interval. Scanner/provider and missing-data failures are recorded in `AI_Crypto_Bot_Scanner_Events`. RLS remains read-only for authenticated browser users. No schema migration was added for Phase 06 or its scheduled-candle optimization.

The Phase 03 seed migration creates the initial `IDLE` agent status and `NORMAL` emergency-state event. Phase 08 creates only simulated starting balances and snapshots; it never seeds positions or trades.

## Migrations and operations

Migration files are stored in `supabase/migrations/` and run in timestamp order:

1. `20261031190000_create_agent_tables.sql` creates the prefixed schema, constraints, indexes, Auth synchronization triggers, RLS policies, and grants.
2. `20261031190100_seed_initial_data.sql` inserts default markets and initial agent/emergency states.
3. `20261101154600_phase08_paper_trading.sql` adds the trade-to-decision reference, provisions paper portfolios, and installs service-role-only valuation, risk, and execution functions.
4. `20261102120000_trade_history_stats.sql` adds the authenticated, RLS-preserving aggregate function for all-time stored SELL-trade statistics.

For local Supabase development, install the Supabase CLI and Docker, then run `supabase start` and `supabase db reset`. A linked project can apply reviewed pending migrations with `supabase db push`. Do not run remote migrations until the target database has been inspected for existing objects using this prefix and a backup/restore plan is available. The migrations fail on naming collisions rather than silently accepting an unknown schema.

Migrations are append-only. Corrective schema changes must use a new reviewed migration; do not edit an already-applied migration or modify production tables outside the migration history. Restoring a prior database state requires the approved backup/restore procedure.

The automated database suite executes all four SQL migrations and exercises them in an embedded PostgreSQL engine. It covers RLS ownership, role grants, Auth/profile/portfolio provisioning, seed idempotency, trade idempotency and aggregate-statistics isolation, real-decision execution, position limits, fees, slippage, cooldown, valuation, drawdowns, and emergency stop. It does not connect to a Supabase project. Local Supabase CLI reset/push and remote provider checks must be run separately where the CLI, Docker, and project access are available.

## Phase 08 paper-trading transaction

`AI_Crypto_Bot_Run_Paper_Trading()` is the only public RPC in the paper-trading migration and is executable only by `service_role`. It serializes scheduled invocations with a transaction-scoped advisory lock, selects the newest stored decision for each enabled market, and applies it to each user portfolio inside the database. Per-portfolio row locks protect risk checks and balance changes; the unique trade idempotency key protects retries. Internal valuation and decision functions are not executable by `anon` or `authenticated`.

The process reads `AI_Crypto_Bot_Market_Data` and `AI_Crypto_Bot_AI_Decisions`; stale or missing inputs are rejected. Buys debit simulated notional plus fees, store execution slippage, and open positions with fee-inclusive cost basis. Sells close all open positions for that market and credit proceeds after fees; realized P&L includes the entry cost basis and exit costs. Portfolio value is available balance plus the stored-market-price value of open positions. Every refresh/trade writes a real portfolio snapshot. No exchange order, account balance, private API, or live-trading permission is used.
