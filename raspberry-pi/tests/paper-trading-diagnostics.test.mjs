import assert from "node:assert/strict";
import test from "node:test";
import { PaperTradingRepositoryQueryError } from "../src/repositories/paper-trading-repository.mjs";
import { createPaperTradingFailureDiagnostic } from "../src/services/paper-trading-diagnostics.mjs";

function createQueryError(message, context) {
  const postgresError = Object.assign(new Error(message), { code: "42501" });
  return new PaperTradingRepositoryQueryError(postgresError, context);
}

test("paper trading diagnostics include operation, required privilege, and SQLSTATE", () => {
  const error = createQueryError(
    'permission denied for table "AI_Crypto_Bot_Emergency_State"',
    {
      table: "AI_Crypto_Bot_Emergency_State",
      operation: "SELECT",
      requiredPrivilege: "SELECT",
      repositoryOperation: "getLatestEmergencyStatus"
    }
  );

  assert.deepEqual(createPaperTradingFailureDiagnostic(error), {
    event: "paper_trading_failed",
    code: "42501",
    component: "paper-trading-service",
    table: "AI_Crypto_Bot_Emergency_State",
    operation: "SELECT",
    repositoryOperation: "getLatestEmergencyStatus",
    sqlState: "42501",
    requiredPrivilege: "SELECT",
    failureType: "PRIVILEGE_DENIED"
  });
});

test("paper trading diagnostics identify missing sequence privileges separately", () => {
  const error = createQueryError(
    'permission denied for sequence "AI_Crypto_Bot_Trades_id_seq"',
    {
      table: "AI_Crypto_Bot_Trades",
      operation: "INSERT",
      requiredPrivilege: "INSERT"
    }
  );

  const diagnostic = createPaperTradingFailureDiagnostic(error);

  assert.equal(diagnostic.failureType, "SEQUENCE_PRIVILEGE_MISSING");
  assert.equal(diagnostic.objectType, "SEQUENCE");
  assert.equal(diagnostic.sequence, "AI_Crypto_Bot_Trades_id_seq");
  assert.equal(diagnostic.requiredPrivilege, "USAGE or UPDATE");
  assert.equal(diagnostic.sqlState, "42501");
  assert.equal("message" in diagnostic, false);
});

test("paper trading diagnostics distinguish ownership failures without exposing database messages", () => {
  const error = createQueryError(
    'must be owner of table "AI_Crypto_Bot_Trades"',
    {
      table: "AI_Crypto_Bot_Trades",
      operation: "INSERT",
      requiredPrivilege: "INSERT"
    }
  );

  const diagnostic = createPaperTradingFailureDiagnostic(error);

  assert.equal(diagnostic.failureType, "OWNERSHIP_REQUIRED");
  assert.equal(diagnostic.objectType, "TABLE");
  assert.equal(diagnostic.databaseObject, "AI_Crypto_Bot_Trades");
  assert.equal(diagnostic.requiredPrivilege, "OWNERSHIP");
  assert.equal("message" in diagnostic, false);
});
