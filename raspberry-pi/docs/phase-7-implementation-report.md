# Phase 7 — Paper Trading Runtime, Scheduler, and Retention

## Outcome

Implemented the Phase 7 runtime inside `raspberry-pi/`. The integrated runtime now owns an in-process UTC scheduler and orders the stages as market ingestion, AI analysis, paper trading, and a non-destructive retention plan. Paper trades use only the existing PostgreSQL schema and direct parameterized SQL.

No file outside `raspberry-pi/` was modified. No database was connected to for trading or retention, no schema/data was changed, no migration or Vercel deployment was run, and no exchange order was placed. Live trading remains disabled.

## Implemented components

- `src/services/runtime-scheduler.mjs` aligns cycles to five-minute UTC slots, skips missed slots instead of catching up, calculates due candle intervals, and uses the dedicated PostgreSQL session advisory lock `882018082`. Ownership is checked at cycle-stage boundaries; a lost lock stops scheduling. The paper repository retains its separate transaction advisory lock `882018081`.
- `src/runtime/worker-stages.mjs` runs ingestion and AI sequentially using their existing role-specific contract validators and one-connection worker pools. Each stage closes its pool before the next stage.
- `src/services/runtime-cycle.mjs` orchestrates ingestion → AI → paper trading → retention planning. Database/provider failures in ingestion (`failed`) or incomplete AI runs mark the status `ERROR` and skip downstream stages; safely partial per-market ingestion is allowed to proceed through the existing AI freshness checks.
- `src/repositories/paper-trading-repository.mjs` performs bounded, direct SQL reads and writes for existing portfolios, positions, trades, snapshots, status, market data, watched markets, decisions, and emergency state. SQL uses parameterized values and explicit columns. Portfolio/position financial calculations remain PostgreSQL `numeric` operations.
- `src/services/paper-trading-service.mjs` applies the existing paper rules, idempotency, position/cooldown checks, emergency stop, and transaction rollback behavior. It never calls a Bitvavo private API.
- `src/services/data-retention-service.mjs` calculates retention cutoffs and reports a plan only. No deletion SQL or data-removal behavior is implemented or invoked.
- `src/runtime/bootstrap.mjs` validates the API, ingestion, AI, and paper database roles before listening, obtains the runtime lock, recovers a stale `ANALYZING` state to `ERROR`, then starts the API and scheduler. `STOPPED` is not automatically cleared.
- `deploy/cryptopulse-runtime.service` provides a single service unit. systemd starts and monitors the Node process; it does not schedule cycles.
- `.env.example`, `README.md`, and `docs/runtime-foundation.md` document the Phase 7 runtime, role configuration, and operating assumptions.

## Scheduler and batch strategy

The nominal runtime cycle is every five minutes. It starts at the next UTC five-minute boundary after startup; it does not immediately run or replay missed slots. The scheduler does not overlap cycles. A PostgreSQL session advisory lock prevents a second runtime process from running.

| Interval | Implemented cadence | Basis |
|---|---|---|
| `1m` | Every five-minute cycle | Runtime execution specification |
| `5m` | Every 15 minutes | Runtime execution specification |
| `15m` | Every 30 minutes | Runtime execution specification |
| `1h` | Hourly | Explicit implementation assumption; production schedule unverified |
| `4h` | Every four hours | Explicit implementation assumption; production schedule unverified |
| `1d` | Daily at 00:00 UTC | Explicit implementation assumption; production schedule unverified |

The existing ingestion service retains its five-market batches, at most four bounded provider workers, per-request candle limits, database write chunks, and checkpoint behavior. AI retains its four-market read groups and 150-candle-per-interval bound. At most four PostgreSQL connections can be active: the API pool is capped at two including the retained owner-lock connection, the paper pool at one, and the sequential ingestion/AI worker pool at one.

The exact active external cadences for `1h`, `4h`, and `1d` were not verified in this phase. They must be confirmed read-only and aligned with the runtime defaults before production cutover; this implementation does not claim cadence parity for those intervals.

## Paper trading and risk management

- The engine reads enabled markets only through `AI_Crypto_Bot_Watched_Markets`; it creates, edits, or deletes no market.
- It selects the latest AI decision for each enabled symbol and rejects stale decisions and snapshots.
- Missing portfolios are initialized for existing profiles with the established virtual starting balance of 10,000. No user/profile rows are created.
- BUY and SELL execution, position changes, trade journal entries, portfolio totals, and snapshots are committed atomically. The deterministic portfolio/decision idempotency key and paper-run lock prevent duplicate execution.
- BUY decisions require confidence ≥70, a fresh market snapshot, no existing same-symbol position, fewer than five open positions, no active cooldown/emergency pause, fresh pricing for existing positions, and drawdown limits.
- Position notional is capped at 10% of portfolio value and available funds. Fee is 0.25%; slippage is 0.10%. The cooldown is 15 minutes.
- A 5% daily drawdown blocks new buys; a 15% portfolio drawdown blocks new buys. A 20% drawdown from peak writes the existing emergency-state record and sets the existing agent status to `STOPPED`. Existing positions remain visible and may still be closed by a SELL decision.
- `STOPPED` is preserved on normal cycle and shutdown status updates. No live-trading code path, authenticated Bitvavo endpoint, order, withdrawal, or transfer is present.

The paper writer role is distinct from the API, ingestion, and AI logins. Its contract rejects elevated attributes, table ownership, DELETE/TRUNCATE, sequence privileges, and writes outside the exact paper tables. The API remains read-only.

### Required privileges for an already provisioned paper writer

These are documentation-only grants for an administrator to apply to the existing database; they were not executed. The role must already exist and must be a non-owner, non-superuser login with no unsafe memberships or schema-creation rights.

```sql
GRANT CONNECT ON DATABASE ai_crypto_bot_store
  TO ai_crypto_bot_paper_writer;

GRANT USAGE ON SCHEMA public
  TO ai_crypto_bot_paper_writer;

GRANT SELECT ON TABLE
  public."AI_Crypto_Bot_Profiles",
  public."AI_Crypto_Bot_Portfolios",
  public."AI_Crypto_Bot_Positions",
  public."AI_Crypto_Bot_Trades",
  public."AI_Crypto_Bot_AI_Decisions",
  public."AI_Crypto_Bot_Status",
  public."AI_Crypto_Bot_Watched_Markets",
  public."AI_Crypto_Bot_Market_Data",
  public."AI_Crypto_Bot_Portfolio_Snapshots",
  public."AI_Crypto_Bot_Emergency_State"
  TO ai_crypto_bot_paper_writer;

GRANT INSERT ON TABLE
  public."AI_Crypto_Bot_Portfolios",
  public."AI_Crypto_Bot_Positions",
  public."AI_Crypto_Bot_Trades",
  public."AI_Crypto_Bot_Portfolio_Snapshots",
  public."AI_Crypto_Bot_Emergency_State"
  TO ai_crypto_bot_paper_writer;

GRANT UPDATE ON TABLE
  public."AI_Crypto_Bot_Portfolios",
  public."AI_Crypto_Bot_Positions",
  public."AI_Crypto_Bot_Status"
  TO ai_crypto_bot_paper_writer;
```

The runtime expects paired `PAPER_DATABASE_USER` and `PAPER_DATABASE_PASSWORD` values in the Pi's local environment. It does not provision roles or modify PostgreSQL grants. Retain the pre-existing API, ingestion, and AI role requirements described in the earlier reports.

## Retention framework

| Data | Retention plan |
|---|---:|
| 1m candles | 30 days |
| 5m candles | 90 days |
| 15m candles | 180 days |
| 1h candles | 365 days |
| 4h candles | Indefinite |
| 1d candles | Indefinite |
| AI decisions | 180 days |

The service returns cutoff timestamps only, with `deletionEnabled: false` and `deletedRows: 0`. It does not count, delete, archive, or mutate data. A future retention execution requires separate authorization and validation.

## systemd deployment

### Validated Raspberry Pi deployment

The checked-in `deploy/cryptopulse-runtime.service` now reflects the reported live deployment that passed runtime validation, restart validation, and reboot validation:

```ini
User=eric
Group=eric
WorkingDirectory=/home/eric/ai-crypto-pulse-bot/raspberry-pi
EnvironmentFile=/home/eric/ai-crypto-pulse-bot/raspberry-pi/.env
ProtectHome=false
```

The environment file is local to the validated checkout; protect it from access by other users and never commit it. The paths and account are specific to this Pi. Reload systemd after installing unit changes, then verify the single service's status and journald output. Do not configure a timer or cron job.

### Future recommended production deployment (not validated)

For a future hardening/migration effort, use a dedicated non-root `cryptopulse` account, install the runtime under `/opt/cryptopulse/raspberry-pi`, and store credentials in `/etc/cryptopulse/runtime.env`, owned by root and readable only by the service group. A runtime located outside `/home` may use `ProtectHome=true`. This layout is a recommendation only: it is not the deployment that passed the reported checks, and it has not been installed or validated. Plan the relocation and repeat runtime, restart, and reboot validation before adopting it.

The unit uses a fixed 10-second restart delay with restart-rate limiting disabled. Graceful shutdown waits up to 120 seconds; if an active cycle exceeds that boundary, its lock connection is discarded, preventing downstream stages from starting without ownership. On process restart, PostgreSQL also releases any session lock held by a crashed process. Startup marks a leftover `ANALYZING` status as `ERROR`; it does not clear `STOPPED`. The next normal cycle refreshes current data rather than replaying missed cycles.

## Validation

| Check | Result |
|---|---|
| Raspberry Pi package tests: `npm.cmd --prefix raspberry-pi test` | Passed: 132 tests, 0 failures. |
| Repository tests: `npm.cmd test` | Passed: 494 tests, 0 failures. |
| Syntax validation: `node --check` across Raspberry Pi source and tests | Passed: 74 modules checked. |
| `git diff --check` | Passed. |
| Build | No build script is configured; runtime consists of Node.js ES modules. |
| Live PostgreSQL trade / retention validation | Not run. No production data was written or deleted. |
| Vercel deployment / live order / private Bitvavo API | Not run. |

## Assumptions, limitations, and remaining work

- The prior phase reports' Pi database facts and market/candle counts were not re-queried. This phase tested against local mocks and did not verify live role grants, table defaults, PostgreSQL numeric bounds, or production consistency.
- The production `1h`, `4h`, and `1d` schedules remain unverified. Confirm them before enabling the scheduler in production.
- The provided systemd restart policy is fixed-delay rather than exponential; repeated failures are bounded by systemd's five-start/ten-minute limit.
- The retention framework is intentionally non-destructive and will not enforce retention until a future approved phase.
- The existing API/dashboard remains unchanged and is not cut over. Its response is still intentionally partial.
- Phase 8 should validate the runtime on the Pi with real grants and a monitored paper-only cycle, verify all active candle cadences and the bounded connection count, and then separately plan dashboard/API cutover. No live trading may be activated.

Phase 7 stops here. No Phase 8 work was started.
