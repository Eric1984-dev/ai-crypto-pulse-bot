# Phase 7.3 — Paper Trading Privilege Diagnostics

## Outcome

Paper-trading SQL failures now carry safe repository context to the runtime error logger. A PostgreSQL privilege error includes the affected table, operation, required privilege, and SQLSTATE where the failed statement provides that information. Sequence privilege failures and ownership failures are reported as distinct categories.

No grants, schema, trading rules, paper execution behavior, or database data were changed. No live Pi database was queried and no trade was executed.

## Failure identified by static review

The paper repository's `getLatestEmergencyStatus` operation runs:

```sql
SELECT emergency.status
FROM public."AI_Crypto_Bot_Emergency_State" AS emergency
ORDER BY emergency.created_at DESC, emergency.id DESC
LIMIT 1
FOR UPDATE
```

PostgreSQL requires `UPDATE` privilege to lock rows with `SELECT ... FOR UPDATE`, in addition to the `SELECT` privilege. The documented paper-role grants provide `SELECT` and `INSERT` on `AI_Crypto_Bot_Emergency_State`, but not `UPDATE`. The paper contract likewise does not grant or require `UPDATE` on that table. A local PGlite check reproduced SQLSTATE `42501` with a role granted only `SELECT`, returning `permission denied for table AI_Crypto_Bot_Emergency_State`.

This makes `getLatestEmergencyStatus` the likely source of the reported live failure under the stated grants. The Pi database was not available for a direct confirmation. This phase deliberately does not add `UPDATE` on emergency state or remove its row lock: either change affects the emergency-control safety model and requires a separate approved resolution.

## Diagnostics implemented

- Transactional paper repository queries now attach table, SQL operation, and required privilege context when PostgreSQL rejects a statement.
- `SELECT ... FOR UPDATE` is identified as requiring `UPDATE`.
- The paper-trading failure event includes `sqlState` and available query context without logging raw database messages or SQL parameter values.
- PostgreSQL sequence denials are tagged `SEQUENCE_PRIVILEGE_MISSING`, with the sequence name and `USAGE or UPDATE` requirement.
- Ownership errors are tagged `OWNERSHIP_REQUIRED`, with the affected object type and name.
- Existing error codes, transaction rollback, and contract safety checks are preserved.

Example diagnostic for the identified operation:

```json
{
  "event": "paper_trading_failed",
  "code": "42501",
  "component": "paper-trading-service",
  "table": "AI_Crypto_Bot_Emergency_State",
  "operation": "SELECT FOR UPDATE",
  "repositoryOperation": "getLatestEmergencyStatus",
  "sqlState": "42501",
  "requiredPrivilege": "UPDATE",
  "failureType": "PRIVILEGE_DENIED"
}
```

## Validation

| Check | Result |
|---|---|
| Raspberry Pi package tests (`npm.cmd --prefix raspberry-pi test`) | Passed: 137 tests, 0 failures. |
| Repository tests (`npm.cmd test`) | Passed: 499 tests, 0 failures. |
| Syntax validation (`node --check` across Raspberry Pi source and tests) | Passed: 76 modules checked. |
| PGlite emergency-row-lock privilege reproduction | Confirmed SQLSTATE `42501` without `UPDATE` on the emergency-state table. |
| Live Raspberry Pi paper-trading run | Not run. No production connection or trade was performed. |

## Files changed

- `src/repositories/paper-trading-repository.mjs`
- `src/services/paper-trading-service.mjs`
- `src/services/paper-trading-diagnostics.mjs`
- `tests/paper-trading-repository.test.mjs`
- `tests/paper-trading-service.test.mjs`
- `tests/paper-trading-diagnostics.test.mjs`
- `docs/phase-7.3-paper-privilege-diagnostics.md`

Phase 7.3 stops here. No subsequent phase was started.
