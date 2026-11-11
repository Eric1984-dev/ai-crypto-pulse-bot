# Phase 7.7 — Backend Operational Validation

## Result and evidence boundary

The Raspberry Pi runtime code, migration bootstrap, recovery behavior, monitoring fields, and systemd unit were reviewed and hardened. Automated tests passed in the Windows workspace. On 2026-11-11, the operator reported successful live Raspberry Pi validation described in the [Phase 7.7.2 addendum](./phase-7.7.2-live-validation-addendum.md).

The live database checks reportedly confirmed the system profile, system portfolio, AI decisions, trades, positions, and portfolio snapshots. `npm run validate` and `npm start` reportedly passed, with the database connected, contracts valid, and 101 enabled markets. systemd was reported installed and enabled; restart and reboot validation passed, and the service automatically started after reboot.

The raw Pi command output, journal excerpts, and timestamps for individual restart/reboot checks were not included with the report. These results are therefore recorded as operator-reported evidence, not independently reproduced from this Windows workspace. No power-interruption test or multi-week soak was reported.

## Architecture overview

```text
Bitvavo public market data
        ↓
Market ingestion → existing PostgreSQL (ai_crypto_bot_store)
        ↓
Deterministic AI analysis → AI decisions
        ↓
Risk-managed paper trading (simulated only)
        ↓
Single-owner five-minute UTC scheduler
        ↓
cryptopulse-runtime.service (systemd)
```

Ingestion and AI use separate short-lived worker pools. Paper trading uses a separate database identity and transaction advisory lock; the runtime holds its own PostgreSQL session advisory lock. The single Node process owns cycle sequencing. systemd starts and supervises the process, but does not schedule cycles. No UI, dashboard, live trading, private Bitvavo endpoint, real exchange order, withdrawal, or transfer was introduced.

## System profile and portfolio validation

The system account uses reserved profile UUID `00000000-0000-4000-8000-000000000100`, with a `NULL` email. It has no Supabase Auth or `auth.users` dependency. Paper trading already fails closed and skips if that profile or its portfolio is absent.

The new [Phase 7.7 bootstrap migration](../migrations/phase-7.7-system-profile-bootstrap.sql):

- Requires the Phase 7.6 schema and takes the existing paper-trading transaction advisory lock.
- Creates a missing system profile, 10,000 EUR virtual portfolio, and first snapshot in one transaction.
- Preserves an existing portfolio, balance, positions, trades, and snapshots. If an existing portfolio has no snapshots, it records a baseline using its current portfolio value, available balance, and open-position count.
- Rejects a reserved-ID collision, orphan portfolio, multiple system portfolios, or remaining profile FK to `auth.users`; it does not guess how to repair conflicting data.
- Adds no table, function, index, or column. The bootstrap test fixture has no `auth` schema and migration execution succeeds.
- Is repeat-safe: re-running does not reset changed balances or duplicate an existing snapshot.

For a future clean deployment using the recommended `/opt` layout, apply after Phase 7.6 as the authorized schema owner, with the runtime stopped. This example path is not the currently validated live checkout under `/home/eric`:

```sh
cd /opt/cryptopulse/raspberry-pi
psql --set ON_ERROR_STOP=1 --dbname ai_crypto_bot_store \
  --file migrations/phase-7.7-system-profile-bootstrap.sql
```

The migration bootstraps the account when applied; runtime startup intentionally does not create financial records or broaden the paper-writer role. Before restarting the service, run the read-only profile, portfolio-ownership, and snapshot checks in the [Phase 7.6 validation procedure](./phase-7.6-standalone-system-profile.md#validation-procedure). Do not re-provision a non-empty account.

**The operator reports that the live profile, portfolio, and snapshots exist.** The exact execution status of the Phase 7.7 migration file was not provided; the migration behavior remains locally validated and is not claimed to have been applied to production.

## Paper trading validation

Source and test review confirms that the paper service reads the latest decision for each enabled watched market and processes only the standalone system portfolio. It validates account ownership before any trade processing. BUY/SELL state changes occur inside the paper transaction with advisory lock and idempotency protection.

The lifecycle updates simulated cash/portfolio value, creates positions and trades for BUY decisions, closes positions on eligible SELL decisions without opening shorts, records realized P&L, and refreshes current marks and unrealized P&L. Portfolio snapshots, position/trade writes, and balance/value changes are transactionally persisted; database errors roll back rather than leaving partial fills. Existing rules for freshness, confidence, position caps, cooldown, fees, slippage, drawdown, and emergency stop remain in force.

The test suite includes repository/service coverage for eligible and rejected decisions, duplicate requests, missing accounts, BUY/SELL handling, position closure, lock behavior, and error rollback. The operator reports live trades, positions, and snapshots in the production database. No live balance or realized/unrealized P&L values were supplied for independent calculation or reconciliation.

| Failure scenario | Handling |
|---|---|
| Missing system account | Paper trading safely skips; the bootstrap migration provisions missing rows. |
| Conflicting or partial identity state | Migration/runtime fail closed; manual inspection is required. |
| Stale inputs or risk rejection | Decision is skipped and no new position is opened. |
| Ingestion/AI failure | Downstream paper trading is skipped for that cycle. |
| Paper database error | Transaction rolls back and the cycle reports failure. |
| Duplicate decision/run | Advisory locks and idempotency keys prevent duplicate execution. |

## Scheduler validation

Automated scheduler tests verify five-minute UTC alignment, interval scheduling, non-overlap, skipping missed slots instead of replaying a backlog, a second runtime failing to acquire the lock, lock-connection loss, and fatal notification. The pipeline preserves ingestion → AI → paper-trading order; downstream stages do not run after critical upstream failure. Partial per-market ingestion is allowed to proceed through existing freshness checks.

On owner-lock loss, the runtime now reports a fatal condition, closes resources, exits nonzero, and lets systemd restart a fresh process. Worker pools are recreated per stage/cycle; a lost session lock is not treated as an in-place reconnection.

Repository tests cover scheduler mechanics. The operator reports successful live runtime startup with 101 enabled markets and successful restart/reboot checks. No raw cycle timing, lock-contention output, missed-cycle evidence, or active external candle cadence was supplied; those details are not claimed as independently measured.

## Monitoring validation

The admin-protected operational health response includes scheduler state, last-cycle status/time/failure code, bounded ingestion/AI/paper stage outcomes, process uptime/RSS/heap, pool counters, and request failure counters. Existing `AI_Crypto_Bot_Status` transitions cover ACTIVE, ANALYZING, IDLE, ERROR, and STOPPED. Startup now marks interrupted ACTIVE or ANALYZING activity as ERROR, while preserving STOPPED/emergency state.

The stage outcomes describe only the latest in-memory cycle; they are not durable history. Missing monitoring metrics include stage durations and last-success timestamps, retry/missed-slot counts, durable per-stage history, PostgreSQL/WAL/replication state, disk free space, and systemd restart counts. The operator did not provide these production metrics.

## systemd validation

The checked-in unit now matches the reported live deployment that passed runtime, restart, and reboot validation:

```ini
User=eric
Group=eric
WorkingDirectory=/home/eric/ai-crypto-pulse-bot/raspberry-pi
EnvironmentFile=/home/eric/ai-crypto-pulse-bot/raspberry-pi/.env
ProtectHome=false
```

It enables boot installation through `WantedBy=multi-user.target`, orders after `network-online.target`, and uses `Restart=always` with a 10-second delay. Start-rate limiting is disabled to allow recovery after a prolonged database/network outage. Intentional `systemctl stop` remains stopped.

**Future recommended production deployment (not validated):** use a dedicated non-root `cryptopulse` account, install under `/opt/cryptopulse/raspberry-pi`, keep credentials in a root-owned `/etc/cryptopulse/runtime.env` readable by the service group, and consider `ProtectHome=true`. This is a future hardening recommendation, not the configuration that passed the reported Pi checks. Relocation requires fresh runtime, restart, and reboot validation.

On the Pi, install/verify the one service (no timer or cron):

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now cryptopulse-runtime.service
sudo systemctl is-enabled cryptopulse-runtime.service
sudo systemctl is-active cryptopulse-runtime.service
sudo systemctl show cryptopulse-runtime.service \
  --property=Restart,RestartUSec,ExecMainStatus,NRestarts
sudo journalctl -u cryptopulse-runtime.service --since today
```

A repository test asserts the unit settings. The operator reports that the live service is installed and enabled and that restart and reboot validation passed. Exact `systemctl`/`journalctl` output was not supplied, so host-side details are recorded in the addendum as reported rather than independently verified here.

Unlimited retry means a persistent invalid configuration or unavailable database will repeatedly restart and log every 10 seconds. This avoids exhausting a finite start budget during a long transient outage, but requires operator monitoring and correction of permanent failures.

## Reboot and power-failure recovery

Validated reboot behavior and expected recovery sequence:

1. The operator reports that after reboot, the enabled systemd service automatically started without SSH, a terminal, or Windows.
2. The operator reports successful `npm run validate` and `npm start`, database connectivity, valid contracts, and 101 enabled markets.
3. By design, runtime startup obtains the owner lock before starting the API and scheduler. If PostgreSQL is not ready, the process exits and systemd retries; no scheduler cycle runs before successful startup.
4. PostgreSQL data and trading records persist outside the Node process. The operator reports that profiles, portfolio, decisions, trades, positions, and snapshots are present after deployment validation.
5. Continue to verify PostgreSQL health, service activity/restart count, journal errors, and a fresh cycle after future maintenance. Do not reset a non-empty portfolio.

Reboot recovery is reported as tested; abrupt power-loss recovery is not. PostgreSQL service enablement, WAL recovery output, data-directory integrity, backups, restore procedures, storage health, and power-loss durability were not independently inspected. Use tested backups and suitable power protection; do not induce a production power cut as a test.

## Backend hardening

- **Lock-loss recovery:** ownership loss now shuts down the runtime with a failing exit so systemd can restart it.
- **Restart policy:** `Restart=always` covers clean process termination and failures; systemd's explicit stop action still suppresses restart.
- **Home-directory deployment:** the live unit runs from `/home/eric/ai-crypto-pulse-bot/raspberry-pi`. `ProtectHome=true` blocked systemd access to that path; the live and checked-in units use `ProtectHome=false`.
- **Stale runtime status:** interrupted ACTIVE/ANALYZING work is marked ERROR on startup; STOPPED is not cleared.
- **Monitoring:** last-cycle ingestion, AI, and paper outcomes are exposed with a strict status allowlist.
- **Memory and bounds:** ingestion, AI, decision, position, and API work is bounded; sequential worker pools are closed after each stage. The health endpoint reports memory and pool counts. No multi-week soak or heap-growth measurement was run.
- **Errors and promises:** cycle/worker errors are logged and surfaced; no process-level handler swallows uncaught errors or unhandled rejections. Node's fatal behavior allows systemd recovery.
- **Database reconnect:** worker pools are recreated per cycle. If the persistent owner-lock connection is lost, the runtime restarts rather than falsely continuing without ownership.

## Test results

Executed from the Windows workspace:

| Check | Result |
|---|---:|
| Repository `npm.cmd test` | 514 passed, 0 failed |
| Raspberry Pi `npm.cmd test` | 152 passed, 0 failed |
| PGlite bootstrap migration tests | Included in both suites; fresh creation, repeat safety, and missing-snapshot repair passed |
| Node syntax validation | Passed for 79 Raspberry Pi source/test files |
| `git diff --check` | Passed |
| Windows workspace `raspberry-pi` runtime `npm.cmd run validate` | Blocked: `raspberry-pi/.env` is absent |
| Live Pi `npm run validate` / `npm start` | Operator reports both passed; database connected, contracts valid, 101 enabled markets |
| Live Pi profile/portfolio/trades/positions/snapshots | Operator reports all present/generated |
| systemd installation and enablement | Operator reports installed and enabled |
| systemd restart validation | Operator reports passed; exact test procedure/output not supplied |
| Reboot validation | Operator reports service automatically started after reboot |
| Power interruption / multi-week soak | Not reported or independently tested |

## Assumptions, limitations, and risks

- The database and operational checks above are supplied as live operator results; raw SQL output, service logs, and restart/reboot timestamps were not attached.
- The exact execution status of the new bootstrap migration is unknown, although the operator reports the resulting account records exist.
- The prior checked-in unit's `cryptopulse` user, `/opt/cryptopulse` working directory, and `/etc/cryptopulse/runtime.env` did not match the reported live installation. The live service and current checked-in unit use `eric`, `/home/eric/ai-crypto-pulse-bot/raspberry-pi`, and that directory's `.env`.
- `ProtectHome=true` is incompatible with the validated service working from `/home/eric`; the live and checked-in units use `ProtectHome=false`. The recommended future `/opt` layout is not validated.
- Multi-week stability, ARM/Pi resource headroom, runtime duration at 200,000+ candles, abrupt power-loss recovery, PostgreSQL backup restoration, and durable monitoring remain untested or unreported.
- Operational health does not yet retain stage history, duration/last-success data, restart counts, or durable monitoring records.

## Recommendations and Phase 8 readiness

1. Keep the validated service user, working directory, and environment-file path aligned with the actual installation; retain `ProtectHome=false` while it runs under `/home/eric`. Treat the dedicated-user `/opt` layout as future work requiring new validation.
2. Preserve the existing profile, portfolio, trades, positions, and snapshots; apply the bootstrap migration only when needed and after confirming the Phase 7.6 schema.
3. Retain the successful restart/reboot checks as release evidence and capture `systemctl`, journal, and runtime-validation output on future maintenance.
4. Run a monitored soak at the actual market/candle volume; measure cycle duration, memory, pool usage, failures, retries, disk/WAL, and restarts.
5. Add stage duration/last-success, missed-cycle, restart, disk, and database health metrics before relying on unattended multi-week operation.

**Readiness: Phase 7.7 operational checks are reported successful for database startup/contracts, profile/trading records, systemd enablement, restart, and reboot recovery. This supports readiness to begin Phase 8, with multi-week soak, abrupt power-loss recovery, and detailed monitoring still residual risks. Phase 8 has not been started.**
