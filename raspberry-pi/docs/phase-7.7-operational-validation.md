# Phase 7.7 — Backend Operational Validation

## Result and evidence boundary

The Raspberry Pi runtime code, migration bootstrap, recovery behavior, monitoring fields, and systemd unit were reviewed and hardened. Automated tests passed in the Windows workspace. The latest operator-provided state reports PostgreSQL, ingestion, AI analysis, scheduler, and paper trading running on the Pi, with more than 200 AI decisions and 200,000 candles; those production figures were not independently queried in this validation.

This workspace has no `raspberry-pi/.env`, live PostgreSQL connection, Raspberry Pi host, or Linux systemd. The actual system profile/portfolio/snapshot counts, live cycles, unit enablement, process restart, reboot, and power-failure recovery remain unverified. No production migration, restart, trade, deployment, reboot, or power interruption was performed.

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

For a clean deployment, apply after Phase 7.6 as the authorized schema owner, with the runtime stopped:

```sh
cd /opt/cryptopulse/raspberry-pi
psql --set ON_ERROR_STOP=1 --dbname ai_crypto_bot_store \
  --file migrations/phase-7.7-system-profile-bootstrap.sql
```

The migration bootstraps the account when applied; runtime startup intentionally does not create financial records or broaden the paper-writer role. Before restarting the service, run the read-only profile, portfolio-ownership, and snapshot checks in the [Phase 7.6 validation procedure](./phase-7.6-standalone-system-profile.md#validation-procedure). Do not re-provision a non-empty account.

**Production profile/portfolio/snapshot existence and ownership were not queried.** The migration behavior is locally validated, not applied to production.

## Paper trading validation

Source and test review confirms that the paper service reads the latest decision for each enabled watched market and processes only the standalone system portfolio. It validates account ownership before any trade processing. BUY/SELL state changes occur inside the paper transaction with advisory lock and idempotency protection.

The lifecycle updates simulated cash/portfolio value, creates positions and trades for BUY decisions, closes positions on eligible SELL decisions without opening shorts, records realized P&L, and refreshes current marks and unrealized P&L. Portfolio snapshots, position/trade writes, and balance/value changes are transactionally persisted; database errors roll back rather than leaving partial fills. Existing rules for freshness, confidence, position caps, cooldown, fees, slippage, drawdown, and emergency stop remain in force.

The test suite includes repository/service coverage for eligible and rejected decisions, duplicate requests, missing accounts, BUY/SELL handling, position closure, lock behavior, and error rollback. These tests use isolated mocks/PGlite; no live balance, P&L, trade, or position was validated on the Pi.

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

This is deterministic repository evidence only. Live advisory-lock contention, cycle duration at the reported data volume, missed-cycle behavior on the Pi, and active external candle cadences were not measured.

## Monitoring validation

The admin-protected operational health response includes scheduler state, last-cycle status/time/failure code, bounded ingestion/AI/paper stage outcomes, process uptime/RSS/heap, pool counters, and request failure counters. Existing `AI_Crypto_Bot_Status` transitions cover ACTIVE, ANALYZING, IDLE, ERROR, and STOPPED. Startup now marks interrupted ACTIVE or ANALYZING activity as ERROR, while preserving STOPPED/emergency state.

The stage outcomes describe only the latest in-memory cycle; they are not durable history. Missing monitoring metrics include stage durations and last-success timestamps, retry/missed-slot counts, durable per-stage history, PostgreSQL/WAL/replication state, disk free space, and systemd restart counts. No production metrics were read.

## systemd validation

The checked-in unit statically enables boot installation through `WantedBy=multi-user.target`, orders after `network-online.target`, and now uses `Restart=always` with a 10-second delay. Start-rate limiting is disabled to allow recovery after a prolonged database/network outage. Intentional `systemctl stop` remains stopped.

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

A repository test asserts these unit settings. No `systemctl`, `systemd-analyze`, process-kill, crash-injection, or host boot test was possible from Windows. Confirm enablement and recovery behavior on the Pi.

Unlimited retry means a persistent invalid configuration or unavailable database will repeatedly restart and log every 10 seconds. This avoids exhausting a finite start budget during a long transient outage, but requires operator monitoring and correction of permanent failures.

## Reboot and power-failure recovery

Expected recovery sequence:

1. On power restoration/reboot, systemd starts the enabled runtime service independently of SSH, terminals, and Windows.
2. Runtime startup validates configuration/database contracts and obtains the owner lock before starting the API and scheduler. If PostgreSQL is not ready, the process exits and systemd retries; no scheduler cycle runs before successful startup.
3. PostgreSQL performs its normal WAL recovery from persistent storage. Profile, portfolio, positions, trades, snapshots, decisions, and runtime configuration are stored outside the Node process.
4. Verify PostgreSQL, service activity/restart count, journald errors, and the read-only system-profile/portfolio/snapshot queries. Confirm a fresh cycle completes before treating the service as healthy. Do not reset a non-empty portfolio.

This behavior is reviewed, not physically exercised. PostgreSQL being enabled, its data directory's persistence/integrity, backups, restore procedures, storage health, and power-loss durability have not been independently checked. Use tested backups and suitable power protection; do not induce a production power cut as a test.

## Backend hardening

- **Lock-loss recovery:** ownership loss now shuts down the runtime with a failing exit so systemd can restart it.
- **Restart policy:** `Restart=always` covers clean process termination and failures; systemd's explicit stop action still suppresses restart.
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
| `raspberry-pi` runtime `npm.cmd run validate` | Blocked: `raspberry-pi/.env` is absent |
| Live PostgreSQL/systemd/reboot/power-failure/soak validation | Not run; Pi is not accessible from this workspace |

## Assumptions, limitations, and risks

- The user's reported `ai_crypto_bot_store`, scheduler/runtime activity, decision/candle counts, and paper-only mode are treated as supplied context, not independent evidence.
- The new migration has not been applied to the Pi. Confirm current counts and ownership before applying it.
- systemd auto-start requires the service to be enabled on the Pi; this was not verified. PostgreSQL readiness is handled by startup retry, not a systemd dependency on a specific PostgreSQL unit.
- Multi-week stability, ARM/Pi resource headroom, runtime duration at 200,000+ candles, database recovery, and backup restoration remain untested.
- Operational health does not yet retain stage history, duration/last-success data, restart counts, or durable monitoring records.

## Recommendations and Phase 8 readiness

1. On the Pi, inspect system-profile/portfolio/snapshot state read-only; apply Phase 7.7 migration only after confirming the Phase 7.6 schema.
2. Verify systemd enablement, restart settings/counts, and PostgreSQL service/persistent-storage health.
3. Perform an operator-controlled process restart and reboot check, then confirm one complete scheduler cycle and unchanged paper-only safeguards.
4. Run a monitored soak at the actual market/candle volume; measure cycle duration, memory, pool usage, failures, retries, disk/WAL, and restarts.
5. Add stage duration/last-success, missed-cycle, restart, disk, and database health metrics before relying on unattended multi-week operation.

**Readiness: code-level validation passed, but Phase 8 is not certified ready.** Live database/profile state, on-Pi runtime validation, systemd operation, restart/reboot recovery, and soak criteria remain open. No Phase 8, dashboard, or frontend work was started.
