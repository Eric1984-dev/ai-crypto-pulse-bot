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
