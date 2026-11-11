# Phase 7.4 — Emergency State Lock Resolution

## Root cause and design contradiction

`getLatestEmergencyStatus` used `SELECT ... FOR UPDATE` on `AI_Crypto_Bot_Emergency_State`. PostgreSQL requires `UPDATE` privilege for that row lock. The paper role's least-privilege contract intentionally excludes `UPDATE` on emergency state, so granting it made startup correctly fail with `PAPER_TRADING_DATABASE_ROLE_UNSAFE_UPDATE_PRIVILEGE`.

The row lock was also not the mechanism serializing paper cycles. Each paper cycle already obtains transaction-scoped advisory lock `PAPER_TRADING_RUN_LOCK_ID` (`882018081`) before reading emergency state. The lock remains held until the whole paper transaction commits or rolls back, so a second paper cycle cannot overlap emergency-state reads or writes.

The row lock was not sufficient for concurrent emergency-state inserts either: it locks an existing row, not a row that another transaction may insert. In the current Raspberry Pi runtime, the only application writer inserts emergency-stop records from within the paper transaction already protected by the advisory lock.

## Chosen solution

Removed `FOR UPDATE` from the emergency-state read. It remains a normal `SELECT` inside the existing paper transaction and reads the latest committed state visible under that transaction's isolation level. The existing paper-cycle advisory lock continues to serialize paper transactions. No additional lock or privilege is required.

The paper-trading contract is unchanged. It still rejects `UPDATE` on `AI_Crypto_Bot_Emergency_State`, and tests explicitly verify that this privilege remains unsafe. All other paper-trading row locks, risk checks, emergency-stop writes, transaction boundaries, and rollback behavior are unchanged.

Future emergency-control writers outside the paper cycle must coordinate through the existing advisory-lock protocol or introduce and document an explicit concurrency design. The removed row lock was not a safe substitute for that protocol, especially for append-only inserts.

## Least-privilege and deployment notes

- The paper role needs only its existing `SELECT` and `INSERT` grants on emergency state; it does not need `UPDATE`.
- No grant, schema, or database data was changed in this phase.
- The temporary `UPDATE` grant reported on the Pi should be removed by the database operator after verifying how it was granted. This phase did not connect to or alter the Pi database.

## Validation

| Check | Result |
|---|---|
| Raspberry Pi package tests (`npm.cmd --prefix raspberry-pi test`) | Passed: 139 tests, 0 failures. |
| Repository tests (`npm.cmd test`) | Passed: 501 tests, 0 failures. |
| Syntax validation (`node --check` across Raspberry Pi source and tests) | Passed: 76 modules checked. |
| `git diff --check` | Passed. |
| Restricted-role PGlite check | A role with only `SELECT` can read the latest emergency state with the updated query. |
| Live Raspberry Pi validation | Not run. No production connection, grant change, or paper trade was performed. |

## Files changed

- `src/repositories/paper-trading-repository.mjs`
- `tests/paper-trading-repository.test.mjs`
- `tests/paper-trading-contract.test.mjs`
- `docs/phase-7.4-emergency-lock-resolution.md`

Phase 7.4 stops here. No Phase 8 work was started.
