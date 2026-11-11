const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;
const SAFE_CODE_PATTERN = /^[A-Z0-9_]{1,64}$/;
const DATABASE_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_$]*(?:\.[A-Za-z_][A-Za-z0-9_$]*)?$/;

export function createPaperTradingFailureDiagnostic(error) {
  const chain = errorChain(error);
  const sqlState = chain
    .map(({ code }) => code)
    .find((code) => typeof code === "string" && SQLSTATE_PATTERN.test(code));
  const context = chain.find(({ paperTradingContext }) =>
    paperTradingContext && typeof paperTradingContext === "object")
    ?.paperTradingContext || {};
  const rootMessage = [...chain]
    .reverse()
    .map(({ message }) => message)
    .find((message) => typeof message === "string") || "";
  const sequence = rootMessage.match(/permission denied for sequence\s+"?([^"\s"]+)"?/i);
  const ownership = rootMessage.match(
    /must be owner of (table|relation|sequence|schema|function)\s+"?([^"\s"]+)"?/i
  );
  const deniedTable = rootMessage.match(
    /permission denied for (?:table|relation)\s+"?([^"\s"]+)"?/i
  );
  const sequenceName = sequence && safeDatabaseIdentifier(sequence[1]);
  const ownershipObject = ownership && safeDatabaseIdentifier(ownership[2]);
  const tableName = safeDatabaseIdentifier(deniedTable?.[1])
    || safeDatabaseIdentifier(context.table);
  const failureType = sequenceName
    ? "SEQUENCE_PRIVILEGE_MISSING"
    : ownershipObject
      ? "OWNERSHIP_REQUIRED"
      : sqlState === "42501"
        ? "PRIVILEGE_DENIED"
        : undefined;

  return Object.freeze({
    event: "paper_trading_failed",
    code: safeCode(error?.code),
    component: "paper-trading-service",
    ...(tableName ? { table: tableName } : {}),
    ...(typeof context.operation === "string" ? { operation: context.operation } : {}),
    ...(typeof context.repositoryOperation === "string"
      ? { repositoryOperation: context.repositoryOperation }
      : {}),
    ...(sqlState ? { sqlState } : {}),
    ...(sequenceName ? {
      objectType: "SEQUENCE",
      sequence: sequenceName,
      requiredPrivilege: "USAGE or UPDATE"
    } : ownershipObject ? {
      objectType: ownership[1].toUpperCase(),
      databaseObject: ownershipObject,
      requiredPrivilege: "OWNERSHIP"
    } : context.requiredPrivilege ? {
      requiredPrivilege: context.requiredPrivilege
    } : {}),
    ...(failureType ? { failureType } : {})
  });
}

function errorChain(error) {
  const chain = [];
  const seen = new Set();
  let current = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    current = current.cause;
  }
  return chain;
}

function safeCode(value) {
  return typeof value === "string" && SAFE_CODE_PATTERN.test(value)
    ? value
    : "PAPER_TRADING_FAILED";
}

function safeDatabaseIdentifier(value) {
  return typeof value === "string" && DATABASE_IDENTIFIER_PATTERN.test(value)
    ? value
    : undefined;
}
