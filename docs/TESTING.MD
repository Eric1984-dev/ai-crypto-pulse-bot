# Testing Strategy

Testing is mandatory.

All implemented functionality must be validated before a phase can be completed.

## Phase 02 validation

Phase 02 uses the built-in Node.js test runner. Auth SDK operations are tested with a fake Supabase client; Vercel route handlers are tested with mocked Supabase verification responses. No package installation is required.

```powershell
npm.cmd test
npm.cmd run build
```

The tests cover registration, login, logout, password reset and update, persistent-session configuration, anonymous and authenticated `getSession()` results, safe redirects, session cookies, all protected routes, and unauthorized redirects. Reset-page coverage checks anonymous visibility, recovery-link and recovery-event detection, password update, and the exact `https://<deployment-host>/reset-password.html` email redirect. A protected-page logout interaction test exercises the button listener, Supabase sign-out, `DELETE /api/auth-session`, the clearing `Set-Cookie` header, and the login redirect. Anonymous session lookup must return `null`, so public auth pages do not request server-side session verification before sign-in. The build command validates required pages and directories, local references, auth endpoints, protected Vercel rewrites, and environment defaults. It does not generate build artifacts.

No Supabase project credentials are present in the repository, so live-provider integration tests were not run. Configure `.env` and use the Vercel development runtime for a real Supabase smoke test. Database, market data, AI, risk, and paper-trading tests remain outside Phase 02.

---

# Testing Types

## Unit Testing

Validate:

- Indicator calculations
- AI Engine logic
- Risk Manager logic
- Portfolio calculations
- PnL calculations
- Fees and slippage calculations

---

## Integration Testing

Validate:

- Supabase connectivity
- Authentication
- Database access
- Realtime subscriptions
- Bitvavo integration

---

## API Testing

Validate:

- Success responses
- Invalid requests
- Missing parameters
- Error responses
- Timeouts

---

## UI Testing

Validate:

- Dashboard
- Portfolio
- Market Scanner
- Trade History
- Settings
- Agent Brain

---

## Mobile Testing

Validate:

- iPhone
- Android
- Tablet

---

## AI Testing

Validate:

- BUY decisions
- SELL decisions
- HOLD decisions
- WAIT decisions

Validate confidence calculations.

---

## Risk Management Testing

Validate:

- Maximum Position Size
- Maximum Open Positions
- Drawdown limits
- Emergency Stop
- Cooldown rules

---

## Paper Trading Testing

Validate:

- Paper Buy
- Paper Sell
- Position Closing
- Portfolio Updates
- Fee Calculations
- Slippage Calculations

---

## Regression Testing

Every completed phase must be followed by regression testing.

New functionality may not break existing functionality.

---

# Test Reporting

Every phase report must contain:

- Implemented
- Files Changed
- Tests Executed
- Test Results
- Build Status
- Documentation Updated
- Outstanding Issues
- Acceptance Criteria Status