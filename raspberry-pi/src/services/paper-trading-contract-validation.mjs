import { inspectDatabaseContract } from "../repositories/contract-repository.mjs";
import { evaluatePaperTradingDatabaseContract } from "./database-contracts.mjs";

export class PaperTradingContractError extends Error {
  constructor(errors) {
    super("The PostgreSQL role or schema does not satisfy the paper trading contract.");
    this.name = "PaperTradingContractError";
    this.code = "PAPER_TRADING_CONTRACT_INVALID";
    this.errors = errors;
  }
}

export async function validatePaperTradingRuntimeContracts(pool, config, {
  logger = console
} = {}) {
  const snapshot = await inspectDatabaseContract(pool, config.database.user, { logger });
  const contract = evaluatePaperTradingDatabaseContract(snapshot, config.database.name);
  if (!contract.valid) {
    throw new PaperTradingContractError(contract.errors);
  }
  return Object.freeze({
    database: "connected",
    contracts: "valid",
    requiredTables: contract.requiredTables,
    requiredFunctions: contract.requiredFunctions
  });
}
