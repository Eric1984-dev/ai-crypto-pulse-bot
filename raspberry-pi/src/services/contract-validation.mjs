import { inspectDatabaseContract } from "../repositories/contract-repository.mjs";
import {
  DASHBOARD_READ_TABLES,
  evaluateDatabaseContract,
  evaluateIngestionDatabaseContract
} from "./database-contracts.mjs";
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
  const contract = evaluateDatabaseContract(snapshot, config.database.name, {
    requiredReadTables: DASHBOARD_READ_TABLES
  });
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

export async function validateIngestionRuntimeContracts(pool, config, {
  logger = console
} = {}) {
  const snapshot = await inspectDatabaseContract(pool, config.database.user, { logger });
  const contract = evaluateIngestionDatabaseContract(snapshot, config.database.name, {
    allowTableOwner: config.ingestion?.allowTableOwner === true
  });
  if (!contract.valid) {
    throw new IngestionContractError(contract.errors);
  }

  const marketRows = await readEnabledWatchedMarkets(pool, { logger });
  const watchedMarkets = validateEnabledWatchedMarkets(marketRows);

  return Object.freeze({
    database: "connected",
    contracts: "valid",
    requiredTables: contract.requiredTables,
    enabledMarkets: watchedMarkets.length,
    warnings: contract.warnings
  });
}

export class IngestionContractError extends Error {
  constructor(errors) {
    super("The existing PostgreSQL database does not satisfy the market-data ingestion contract.");
    this.name = "IngestionContractError";
    this.code = "INGESTION_CONTRACT_INVALID";
    this.errors = errors;
  }
}
