# Testing

## Repository

The root project uses Node's built-in test runner and local PGlite for migration/schema checks. These tests do not connect to a production database.

```powershell
npm.cmd test
npm.cmd run build
```

`npm run build` generates the public runtime API configuration and validates project structure, the three active Vercel functions, protected-page routing, root environment variables, and checked-in SQL migration contracts.

## Raspberry Pi package

```powershell
npm.cmd test --prefix raspberry-pi
npm.cmd run validate --prefix raspberry-pi
```

The Pi tests cover the active API, authentication, PostgreSQL repositories, scheduler, market ingestion, AI engine, paper trading, monitoring, and runtime lifecycle. Tests use controlled local fixtures and do not claim that a live Pi/database was reached.

Paper-trading hardening regressions can be run with:

```powershell
node --test raspberry-pi/tests/ai-analysis.test.mjs raspberry-pi/tests/market-data-ingestion.test.mjs raspberry-pi/tests/portfolio-snapshot-order.test.mjs raspberry-pi/tests/dashboard-analytics.test.mjs raspberry-pi/tests/dashboard-repository.test.mjs raspberry-pi/tests/paper-trading-service.test.mjs raspberry-pi/tests/paper-trading-repository.test.mjs
```

The snapshot-order migration test runs against local PGlite only. It does not apply the migration to the Raspberry Pi database.

Paper execution attribution regressions cover reason-coded directional outcomes, duplicate and repeated-cycle identity, executed-trade linkage, automatic-exit exclusion, the Phase 8.15/8.16 migration/schema/grant contract, paper-writer `ON CONFLICT` insertion, runtime preflight of conflict-key column grants, and paginated export as-of handling:

```powershell
node --test raspberry-pi/tests/paper-trading-service.test.mjs raspberry-pi/tests/paper-trading-repository.test.mjs raspberry-pi/tests/paper-trading-contract.test.mjs raspberry-pi/tests/dashboard-repository.test.mjs tests/exports-ui.test.js
```

The Phase 8.15/8.16 migration tests use local PGlite and do not apply migrations to the live Pi database.

Position-exit regressions cover the single active 1.5 × 5-minute-ATR ratchet, the fee/slippage-adjusted €3 net floor, stale/incomplete/gapped candle rejection, persisted-stop behavior without ATR, idempotent trade attribution, and decision-analytics isolation:

```powershell
node --test raspberry-pi/tests/position-exit-policy.test.mjs raspberry-pi/tests/paper-trading-service.test.mjs raspberry-pi/tests/paper-trading-repository.test.mjs raspberry-pi/tests/dashboard-analytics.test.mjs raspberry-pi/tests/dashboard-repository.test.mjs raspberry-pi/tests/runtime-cycle.test.mjs raspberry-pi/tests/operational-health.test.mjs tests/trade-history.test.js
```

The Phase 8.14, 8.15, and 8.16 migrations are exercised only inside isolated local PGlite fixtures; no test applies them to the live Pi database. Do not start the Pi runtime with this code until the operator has reviewed/applied the required migrations.

The full-history export regressions cover source keyset pagination including paper-execution attempts, deduplicated trade/decision candle anchors, fixed as-of filtering, bounded sequential browser requests, `Retry-After` handling, JSONL file-size splitting, and cancellation manifests. The UI requires a browser with the File System Access API; the automated tests use an in-memory implementation and do not verify a physical browser or Raspberry Pi transfer.

## Dashboard and authentication

```powershell
node --test tests/dashboard.test.js tests/trade-history.test.js tests/auth.test.js tests/runtime-api-proxy.test.mjs tests/admin.test.js
node --test raspberry-pi/tests/auth-routes.test.mjs raspberry-pi/tests/runtime-bootstrap.test.mjs
```

These checks cover dashboard rendering/polling, trade-history display and query construction, login/session behavior, protected pages, the same-origin proxy, and the absence of dashboard execution controls.

## Syntax and patch checks

From the repository root in PowerShell:

```powershell
Get-ChildItem -Recurse -File -Include *.js,*.mjs |
  Where-Object { $_.FullName -notmatch '\\node_modules\\|\\.git\\' } |
  ForEach-Object {
    node --check $_.FullName
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }
git diff --check
```

Tests, builds, syntax checks, and `git diff --check` are local evidence only. They do not prove a Vercel deployment, live Pi connectivity, Cloudflare routing, authentication configuration, or production database state.
