# Scheduling and Runtime Ownership

## Current owner

The Raspberry Pi Node.js runtime is the sole owner of scheduled market ingestion, AI analysis, portfolio updates, paper trading, and strategy evaluation. A single internal scheduler coordinates the ordered cycle and prevents overlapping executions. `cryptopulse-runtime.service` starts the process at boot and restarts it after process failure; systemd does not run a separate timer.

The operator reports the runtime and scheduler are operational. This repository does not independently inspect the live Pi scheduler or any external scheduling provider.

## Retired scheduler paths

Vercel Cron is not configured in `vercel.json`. The former Vercel functions for market refresh, candle refresh, AI analysis, and paper trading have been removed. The Pi runtime API does not expose those operations as scheduler endpoints.

Any previously configured third-party jobs cannot be verified or disabled from this repository. Confirm that no external provider still invokes the retired endpoints; stale jobs will receive `404` after deployment. Do not recreate them or schedule runtime operations through Vercel.

## Recovery and idempotency

The Pi runtime's scheduler, single-owner lock, cycle order, skipped-missed-cycle behavior, and failure recovery are described in the [runtime foundation](../raspberry-pi/docs/runtime-foundation.md) and [Phase 7.7 operational validation](../raspberry-pi/docs/phase-7.7-operational-validation.md). Do not run a second scheduler or manually invoke trading while the runtime owns execution.

## Optional archive copy

The separate archive CLI is manually invoked and is not scheduled. Its current use is not verified; it must not block or alter ingestion, AI, paper trading, or runtime monitoring. See the [archive reports](./reports/AI_DECISION_ARCHIVE_AGENT_INSTALLATION.md) for the retained copy-only utility.
