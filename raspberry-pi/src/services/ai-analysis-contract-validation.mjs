import { inspectDatabaseContract } from "../repositories/contract-repository.mjs";
import { evaluateAIAnalysisDatabaseContract } from "./database-contracts.mjs";

export class AIAnalysisContractError extends Error {
  constructor(errors) {
    super("The PostgreSQL role or schema does not satisfy the AI analysis contract.");
    this.name = "AIAnalysisContractError";
    this.code = "AI_ANALYSIS_CONTRACT_INVALID";
    this.errors = errors;
  }
}

export async function validateAIAnalysisRuntimeContracts(pool, config, {
  logger = console
} = {}) {
  const snapshot = await inspectDatabaseContract(pool, config.database.user, { logger });
  const contract = evaluateAIAnalysisDatabaseContract(snapshot, config.database.name);
  if (!contract.valid) {
    throw new AIAnalysisContractError(contract.errors);
  }
  return Object.freeze({
    database: "connected",
    contracts: "valid",
    requiredTables: contract.requiredTables,
    requiredFunctions: contract.requiredFunctions
  });
}
