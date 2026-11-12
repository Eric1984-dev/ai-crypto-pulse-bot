# Phase 7.7.2 — Live Raspberry Pi Validation Addendum

**Reported validation date:** 2026-11-11
**Scope:** Correct Phase 7.7 deployment assumptions with the operator's live Raspberry Pi results. No Phase 8 work.

## Evidence source

The results below were supplied after live validation on the Raspberry Pi. Raw SQL output, `systemctl` output, journal excerpts, and exact restart/reboot timestamps were not attached in this workspace. They are documented as operator-reported results, not independently reproduced here.

## Live database and runtime results

The operator reports:

- The standalone System Profile and System Portfolio exist.
- AI Decisions, Trades, Positions, and Portfolio Snapshots have been generated.
- `npm run validate` passed.
- `npm start` passed.
- PostgreSQL connected and runtime contracts validated.
- The runtime found 101 enabled markets.
- No live trading, exchange execution, or Bitvavo private API usage occurred.

The operator did not provide balance/P&L values or the execution status of the checked-in Phase 7.7 bootstrap SQL. The report therefore confirms the account and trading records exist, but does not claim that migration file was applied or independently reconcile financial calculations.

## systemd, restart, and reboot results

The operator reports that `cryptopulse-runtime.service` is installed and enabled, restart validation passed, and after reboot the runtime automatically started. This confirms the reported service is independent of SSH, an active terminal, and the Windows machine.

The reported reboot/restart checks do not establish recovery from an abrupt power interruption or a multi-week soak. PostgreSQL WAL recovery and backup restoration were not separately evidenced in the supplied results.

## Validated live deployment

The service configuration reported as passing runtime validation, restart validation, and reboot validation is:

```ini
User=eric
Group=eric
WorkingDirectory=/home/eric/ai-crypto-pulse-bot/raspberry-pi
EnvironmentFile=/home/eric/ai-crypto-pulse-bot/raspberry-pi/.env
ProtectHome=false
```

The checked-in `deploy/cryptopulse-runtime.service` retains these validated account and path values. It now also declares `StateDirectory=cryptopulse` for persistent dashboard sessions; that additional state-directory behavior has not yet been verified on the live Pi. These account and path values are specific to the current Raspberry Pi and should not be assumed for other installations.

Before this correction, the checked-in unit had these unvalidated assumptions:

```ini
User=cryptopulse
Group=cryptopulse
WorkingDirectory=/opt/cryptopulse/raspberry-pi
EnvironmentFile=/etc/cryptopulse/runtime.env
ProtectHome=true
```

`ProtectHome=true` prevented systemd from accessing the runtime under `/home/eric`, so the service could not start from that working directory. The live deployment resolved this by setting `ProtectHome=false`.

## Future recommended production deployment (not validated)

For a future hardening effort, migrate to:

```ini
User=cryptopulse
Group=cryptopulse
WorkingDirectory=/opt/cryptopulse/raspberry-pi
EnvironmentFile=/etc/cryptopulse/runtime.env
ProtectHome=true
```

This is a future recommendation, not the validated deployment. It would separate the service from a human home directory and allow stricter home-directory isolation. Provision a non-root service account and root-owned environment file with read access limited to the service group. Relocation, permissions, and this unit profile have not been validated; do not switch to them without a planned migration and fresh runtime, restart, and reboot checks.

## Deployment recommendations

1. Keep the currently installed unit aligned with the validated `eric` account and `/home/eric/ai-crypto-pulse-bot/raspberry-pi` checkout; preserve `ProtectHome=false` for that location.
2. Keep the live `.env` private and never commit its contents.
3. Treat the dedicated-user `/opt` profile above as future work, not as evidence about the current Pi.
4. After any unit change, run `systemctl daemon-reload`, restart the service, and verify `is-enabled`, `is-active`, restart behavior, journal output, and a reboot.
5. Preserve the existing profile, portfolio, and paper-trading history. Run the bootstrap migration only when account state requires it and after confirming Phase 7.6 schema compatibility.
6. Capture read-only SQL results and redacted service evidence in future operational reports. Do not include `.env` values or other secrets.

## Final Phase 7.7 assessment

Based on the operator-reported results, the System Profile/Portfolio and paper-trading records exist, the runtime passes validation and startup, the service is installed/enabled, and restart/reboot recovery succeeded. The earlier conclusion that live Pi/systemd validation remained wholly unverified is superseded by these results.

**Phase 8 readiness:** operational prerequisites are reported as met for database/contracts, 101-market startup, service enablement, restart, and reboot. A multi-week soak and abrupt power-loss recovery remain residual risks. Phase 8 is not started by this addendum.
