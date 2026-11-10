import { inspectDatabaseContract } from "../repositories/contract-repository.mjs";
import { evaluateDatabaseContract } from "./database-contracts.mjs";
import { readEnabledWatchedMarkets } from "../repositories/watched-markets-repository.mjs";
import { validateEnabledWatchedMarkets } from "./watched-markets.mjs";

export class RuntimeContractError extends Error {
  constructor(errors) {
    super("The existing PostgreSQL database does not satisfy the read-only runtime contract.");
    this.name = "RuntimeContractError";
    this.code = "RUNTIME_CONTRACT_INVALID";
    this.errors = errors;
  }
}

export async function validateRuntimeContracts(pool, config, {
  logger = console
} = {}) {
  const snapshot = await inspectDatabaseContract(pool, config.database.user, { logger });
  const contract = evaluateDatabaseContract(snapshot, config.database.name);
  if (!contract.valid) {
    throw new RuntimeContractError(contract.errors);
  }

  const marketRows = await readEnabledWatchedMarkets(pool, { logger });
  const watchedMarkets = validateEnabledWatchedMarkets(marketRows);

  return Object.freeze({
    database: "connected",
    contracts: "valid",
    requiredTables: contract.requiredTables,
    requiredFunctions: contract.requiredFunctions,
    optionalFunctions: contract.optionalFunctions,
    enabledMarkets: watchedMarkets.length
  });
}
