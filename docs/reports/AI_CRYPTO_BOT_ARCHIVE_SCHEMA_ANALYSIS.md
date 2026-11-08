# AI Crypto Bot Archive Schema Analysis

## Scope and source

This analysis and [AI_CRYPTO_BOT_ARCHIVE_SCHEMA.sql](../../AI_CRYPTO_BOT_ARCHIVE_SCHEMA.sql) are derived from the production schema migrations:

- [`20261031190000_create_agent_tables.sql`](../../supabase/migrations/20261031190000_create_agent_tables.sql)
- [`20261101154600_phase08_paper_trading.sql`](../../supabase/migrations/20261101154600_phase08_paper_trading.sql)
- [`20261105104400_shadow_exit_scenarios.sql`](../../supabase/migrations/20261105104400_shadow_exit_scenarios.sql)
- [`DATABASE.md`](../DATABASE.md), for the documented inventory and Supabase-managed Auth dependency.

The generated SQL contains all 18 `AI_Crypto_Bot_` tables, including the five priority tables and the supporting tables needed to preserve their referential dependencies and related historical data. It includes the production columns, types, defaults, primary/foreign/unique/check constraints, and explicit indexes. The later-added `Trades.ai_decision_id` column is kept at the end of the trade columns, matching its production addition order.

The production `Profiles.id` foreign key targets Supabase-managed `auth.users`. To keep that foreign key executable on standalone PostgreSQL 17, the SQL creates a minimal `auth.users(id uuid PRIMARY KEY)` compatibility anchor. It is not a Supabase Auth replica and must not be used to store credentials or as an authentication service. If profile rows are imported, their UUIDs must first exist in this anchor table.

This is a relational archive schema, not a behavioral clone of Supabase. It does not reproduce Supabase Auth internals, RLS policies, grants, triggers, RPC functions, publications, or other Supabase-managed objects. Those objects have platform-specific roles or behavior and were outside the requested table/constraint/index schema. In particular, archive writes will not automatically receive the production `updated_at` trigger behavior.

No SQL was executed, and no database or production object was changed.

## 1. Table inventory

| Table | Role | Direct table dependencies |
|---|---|---|
| `AI_Crypto_Bot_Candles` | Priority: historical OHLCV by symbol and interval | `AI_Crypto_Bot_Watched_Markets` |
| `AI_Crypto_Bot_AI_Decisions` | Priority: AI decision history | `AI_Crypto_Bot_Watched_Markets` |
| `AI_Crypto_Bot_Watched_Markets` | Priority: market identity and enabled/priority state | None |
| `AI_Crypto_Bot_Positions` | Priority: paper positions and their market/portfolio references | `AI_Crypto_Bot_Portfolios`, `AI_Crypto_Bot_Watched_Markets` |
| `AI_Crypto_Bot_Trades` | Priority: paper trade history and optional decision reference | `AI_Crypto_Bot_Portfolios`, `AI_Crypto_Bot_Watched_Markets`, `AI_Crypto_Bot_AI_Decisions` |
| `AI_Crypto_Bot_Profiles` | Supports portfolio ownership and preserves profile identity | External `auth.users` key anchor |
| `AI_Crypto_Bot_Portfolios` | Supports positions, trades, and portfolio history | `AI_Crypto_Bot_Profiles` |
| `AI_Crypto_Bot_Market_Data` | Latest market-data snapshot per watched symbol | `AI_Crypto_Bot_Watched_Markets` |
| `AI_Crypto_Bot_Strategies` | Strategy catalog referenced by strategy history | None |
| `AI_Crypto_Bot_Strategy_Changes` | Strategy-change history | `AI_Crypto_Bot_Strategies` |
| `AI_Crypto_Bot_Strategy_Performance` | Historical strategy metrics | `AI_Crypto_Bot_Strategies` |
| `AI_Crypto_Bot_Backtests` | Backtest results and run configuration | `AI_Crypto_Bot_Strategies` |
| `AI_Crypto_Bot_Status` | Agent status singleton | None |
| `AI_Crypto_Bot_Portfolio_Snapshots` | Portfolio value history | `AI_Crypto_Bot_Portfolios` |
| `AI_Crypto_Bot_Scanner_Events` | Market scanner event history | `AI_Crypto_Bot_Watched_Markets` |
| `AI_Crypto_Bot_Emergency_State` | Emergency-state event history | None |
| `AI_Crypto_Bot_Shadow_Exit_Scenarios` | Durable hypothetical exit scenarios | `AI_Crypto_Bot_Positions`, `AI_Crypto_Bot_Portfolios`, `AI_Crypto_Bot_Watched_Markets`, `AI_Crypto_Bot_Trades` |
| `AI_Crypto_Bot_Shadow_Exit_Events` | Scenario and data-quality event history | `AI_Crypto_Bot_Positions`, `AI_Crypto_Bot_Shadow_Exit_Scenarios` |

The 13 additional prefixed tables are included to provide the complete project-table schema and preserve foreign-key closure, not because each is required to store candles or decisions by itself. `Profiles`, `Portfolios`, and `Watched_Markets` are direct supporting references for the priority trading tables; the remaining tables retain related strategy, portfolio, scanner, status, emergency, and shadow-exit history.

## 2. Dependency order

The following is a valid table creation order for the generated SQL:

1. `auth.users` compatibility anchor
2. `AI_Crypto_Bot_Profiles`
3. `AI_Crypto_Bot_Watched_Markets`
4. `AI_Crypto_Bot_Strategies`
5. `AI_Crypto_Bot_Portfolios`
6. `AI_Crypto_Bot_Positions`
7. `AI_Crypto_Bot_Market_Data`
8. `AI_Crypto_Bot_Candles`
9. `AI_Crypto_Bot_AI_Decisions`
10. `AI_Crypto_Bot_Trades`
11. `AI_Crypto_Bot_Strategy_Changes`
12. `AI_Crypto_Bot_Strategy_Performance`
13. `AI_Crypto_Bot_Backtests`
14. `AI_Crypto_Bot_Status`
15. `AI_Crypto_Bot_Portfolio_Snapshots`
16. `AI_Crypto_Bot_Scanner_Events`
17. `AI_Crypto_Bot_Emergency_State`
18. `AI_Crypto_Bot_Shadow_Exit_Scenarios`
19. `AI_Crypto_Bot_Shadow_Exit_Events`

Independent tables may be created in another order, but every referenced table must exist before its dependent table's foreign key is declared. The SQL creates all tables before creating the 20 explicit indexes.

## 3. Foreign-key map

| Source column | Referenced column | Delete behavior |
|---|---|---|
| `AI_Crypto_Bot_Profiles.id` | `auth.users.id` | CASCADE |
| `AI_Crypto_Bot_Portfolios.user_id` | `AI_Crypto_Bot_Profiles.id` | CASCADE |
| `AI_Crypto_Bot_Positions.portfolio_id` | `AI_Crypto_Bot_Portfolios.id` | CASCADE |
| `AI_Crypto_Bot_Positions.symbol` | `AI_Crypto_Bot_Watched_Markets.symbol` | RESTRICT |
| `AI_Crypto_Bot_Trades.portfolio_id` | `AI_Crypto_Bot_Portfolios.id` | CASCADE |
| `AI_Crypto_Bot_Trades.symbol` | `AI_Crypto_Bot_Watched_Markets.symbol` | RESTRICT |
| `AI_Crypto_Bot_Trades.ai_decision_id` | `AI_Crypto_Bot_AI_Decisions.id` | RESTRICT |
| `AI_Crypto_Bot_Market_Data.symbol` | `AI_Crypto_Bot_Watched_Markets.symbol` | RESTRICT |
| `AI_Crypto_Bot_Candles.symbol` | `AI_Crypto_Bot_Watched_Markets.symbol` | RESTRICT |
| `AI_Crypto_Bot_AI_Decisions.symbol` | `AI_Crypto_Bot_Watched_Markets.symbol` | RESTRICT |
| `AI_Crypto_Bot_Strategy_Changes.strategy_id` | `AI_Crypto_Bot_Strategies.id` | RESTRICT |
| `AI_Crypto_Bot_Strategy_Performance.strategy_id` | `AI_Crypto_Bot_Strategies.id` | RESTRICT |
| `AI_Crypto_Bot_Backtests.strategy_id` | `AI_Crypto_Bot_Strategies.id` | RESTRICT |
| `AI_Crypto_Bot_Portfolio_Snapshots.portfolio_id` | `AI_Crypto_Bot_Portfolios.id` | CASCADE |
| `AI_Crypto_Bot_Scanner_Events.symbol` | `AI_Crypto_Bot_Watched_Markets.symbol` | RESTRICT |
| `AI_Crypto_Bot_Shadow_Exit_Scenarios.position_id` | `AI_Crypto_Bot_Positions.id` | CASCADE |
| `AI_Crypto_Bot_Shadow_Exit_Scenarios.portfolio_id` | `AI_Crypto_Bot_Portfolios.id` | CASCADE |
| `AI_Crypto_Bot_Shadow_Exit_Scenarios.symbol` | `AI_Crypto_Bot_Watched_Markets.symbol` | RESTRICT |
| `AI_Crypto_Bot_Shadow_Exit_Scenarios.actual_trade_id` | `AI_Crypto_Bot_Trades.id` | SET NULL |
| `AI_Crypto_Bot_Shadow_Exit_Events.position_id` | `AI_Crypto_Bot_Positions.id` | CASCADE |
| `AI_Crypto_Bot_Shadow_Exit_Events.scenario_id` | `AI_Crypto_Bot_Shadow_Exit_Scenarios.id` | CASCADE |

There are 20 foreign keys between project tables, plus the profile-to-Auth foreign key, for 21 total. The trade-to-decision reference is nullable to retain compatibility with trades created before that column was added.

## 4. Index inventory

### Explicit indexes

The migrations define 20 non-constraint indexes; all are included in the SQL:

1. `AI_Crypto_Bot_Portfolios_user_id_idx`
2. `AI_Crypto_Bot_Watched_Markets_enabled_priority_idx` (partial: enabled rows)
3. `AI_Crypto_Bot_Positions_portfolio_status_created_idx`
4. `AI_Crypto_Bot_Trades_portfolio_created_idx`
5. `AI_Crypto_Bot_Market_Data_captured_at_idx`
6. `AI_Crypto_Bot_Strategy_Changes_strategy_created_idx`
7. `AI_Crypto_Bot_Strategy_Performance_strategy_created_idx`
8. `AI_Crypto_Bot_Backtests_strategy_created_idx`
9. `AI_Crypto_Bot_AI_Decisions_symbol_created_idx`
10. `AI_Crypto_Bot_AI_Decisions_created_at_idx`
11. `AI_Crypto_Bot_Portfolio_Snapshots_portfolio_captured_idx`
12. `AI_Crypto_Bot_Scanner_Events_symbol_created_idx`
13. `AI_Crypto_Bot_Scanner_Events_created_at_idx`
14. `AI_Crypto_Bot_Emergency_State_created_at_idx`
15. `AI_Crypto_Bot_AI_Decisions_symbol_created_id_idx`
16. `AI_Crypto_Bot_Trades_portfolio_symbol_created_idx`
17. `AI_Crypto_Bot_Trades_ai_decision_id_idx`
18. `AI_Crypto_Bot_Shadow_Exit_Scenarios_recent_closed_idx` (partial: rows with `actual_closed_at`)
19. `AI_Crypto_Bot_Shadow_Exit_Events_position_event_idx`
20. `AI_Crypto_Bot_Shadow_Exit_Events_scenario_event_idx`

### Constraint-backed indexes

PostgreSQL creates indexes for each primary-key and unique constraint. The project schema has 18 primary keys (all on `id`) and 10 additional unique constraints:

| Table | Unique key |
|---|---|
| `AI_Crypto_Bot_Profiles` | `email` |
| `AI_Crypto_Bot_Watched_Markets` | `symbol` |
| `AI_Crypto_Bot_Trades` | `idempotency_key` |
| `AI_Crypto_Bot_Market_Data` | `symbol` |
| `AI_Crypto_Bot_Candles` | `(symbol, interval, timestamp)` |
| `AI_Crypto_Bot_Strategies` | `(name, version)` |
| `AI_Crypto_Bot_Strategy_Changes` | `idempotency_key` |
| `AI_Crypto_Bot_Status` | `singleton` |
| `AI_Crypto_Bot_Shadow_Exit_Scenarios` | `(position_id, rule_id, rule_version)` |
| `AI_Crypto_Bot_Shadow_Exit_Events` | `dedupe_key` |

Thus, the project tables define 48 indexes in total: 20 explicit indexes plus 28 indexes backing primary-key/unique constraints. The `auth.users` compatibility anchor adds one separate primary-key index; it is not part of the production project-table count.

## 5. Sequence and identity inventory

No sequence-backed columns, standalone sequences, or identity columns are defined in the inspected project table migrations. UUID primary keys use `DEFAULT gen_random_uuid()` where the application schema generates IDs. `Profiles.id` has no generated default because it is the Supabase Auth user ID; the compatibility `auth.users.id` anchor also has no default.

PostgreSQL 17 provides `gen_random_uuid()` without requiring a project-specific sequence. The archive DDL creates no sequence objects.

## 6. Archive growth considerations

No production row counts, table sizes, or measured archive sizes were collected for this schema-only task. Exact byte estimates require representative data and should be measured on the populated archive using PostgreSQL relation-size functions; row payload alone does not include indexes, TOAST, free space, or WAL.

If all six supported candle intervals are populated continuously, the theoretical candle rate is:

`1,440 + 288 + 96 + 24 + 6 + 1 = 1,855 candles per market per day`

| Continuously tracked markets | Approximate candle rows per year |
|---:|---:|
| 1 | 676,075 |
| 10 | 6,770,750 |
| 20 | 13,541,500 |

These are row-count illustrations, not observed production volume; actual growth depends on enabled markets, interval coverage, refresh success, and retention. Decision history grows according to analysis cadence and market count. JSONB indicator payloads, timestamp/UUID indexes, and the candles' unique key can add substantial storage beyond raw column payload. Portfolio, trade, strategy, scanner, and shadow-event growth depends on runtime activity.

For capacity planning, measure each table and its indexes separately on a representative archive, include backup/WAL headroom, and monitor growth over a full operational cycle before setting retention or disk thresholds.

## 7. Recommended table creation order

Use the numbered dependency order in section 2. In particular:

- Create the minimal `auth.users` key anchor before `AI_Crypto_Bot_Profiles`.
- Create profiles before portfolios, and portfolios before positions, trades, and snapshots.
- Create watched markets before all symbol-referencing tables.
- Create AI decisions before trades so the optional decision foreign key can be declared.
- Create trades before shadow-exit scenarios; create scenarios before shadow-exit events.
- Create strategies before strategy changes, performance, and backtest records.

## 8. Recommended index creation order

The SQL first creates all table-level primary-key, unique, check, and foreign-key constraints, then creates the 20 explicit indexes in migration order. This ensures uniqueness and referential integrity are present as part of the schema.

For a large initial data load, building the explicit non-unique indexes after bulk import can reduce load time. If that operational optimization is used, retain the primary-key and unique constraints, load rows in foreign-key dependency order, then create the explicit indexes from the SQL file and verify index validity. The delivered file remains a single complete schema script; it does not include a data loader or archive job.
