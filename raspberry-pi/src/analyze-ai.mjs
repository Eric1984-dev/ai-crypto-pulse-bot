import { pathToFileURL } from "node:url";
import { AiAnalysisRepository } from "./repositories/ai-analysis-repository.mjs";
import { WatchedMarketsRepository } from "./repositories/watched-markets-repository.mjs";
import { readRuntimeConfig } from "./config/runtime-config.mjs";
import { createPostgresPool } from "./database/pool.mjs";
import { createAiAnalysisService } from "./services/ai-analysis-service.mjs";
import { validateAIAnalysisRuntimeContracts } from "./services/ai-analysis-contract-validation.mjs";
import { sanitizeDiagnosticText } from "./services/ingestion-diagnostics.mjs";

const SAFE_CODE_PATTERN = /^[A-Z0-9_]{1,64}$/;

export class AIAnalysisConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "AIAnalysisConfigurationError";
    this.code = "AI_ANALYSIS_CONFIGURATION_INVALID";
  }
}

export function createAiAnalysisDatabaseConfig(config, env = process.env) {
  const user = config.aiAnalysis?.databaseUser || "";
  const password = config.aiAnalysis?.databasePassword || "";
  if (!user || !password) {
    throw new AIAnalysisConfigurationError(
      "AI_DATABASE_USER and AI_DATABASE_PASSWORD are required for manual AI analysis."
    );
  }
  if (user === config.database.user
    || user === (env.INGESTION_DATABASE_USER?.trim() || "")) {
    throw new AIAnalysisConfigurationError(
      "AI_DATABASE_USER must be distinct from the API and ingestion database users."
    );
  }
  return Object.freeze({
    ...config,
    database: Object.freeze({
      ...config.database,
      user,
      password
    })
  });
}

export async function runAIAnalysisCommand({
  env = process.env,
  Pool,
  logger = console,
  now
} = {}) {
  let component = "configuration";
  let pool;
  let operationError;
  try {
    const config = createAiAnalysisDatabaseConfig(readRuntimeConfig(env), env);
    component = "postgres-pool";
    pool = createPostgresPool(config, { Pool, logger });

    component = "ai-analysis-contract";
    const validation = await validateAIAnalysisRuntimeContracts(pool, config, { logger });
    logger.info(JSON.stringify({
      event: "ai_analysis_preflight_passed",
      database: validation.database,
      requiredTables: validation.requiredTables
    }));

    component = "ai-analysis";
    const service = createAiAnalysisService({
      watchedMarketsRepository: new WatchedMarketsRepository(pool, { logger }),
      aiAnalysisRepository: new AiAnalysisRepository(pool, { logger }),
      ...(now ? { now } : {})
    });
    const result = await service.run();
    logger.info(JSON.stringify({
      event: "ai_analysis_completed",
      ...result
    }));
    return result;
  } catch (error) {
    operationError = withComponent(error, component);
    throw operationError;
  } finally {
    if (pool) {
      try {
        await pool.end();
      } catch (error) {
        if (operationError) {
          logger.error(JSON.stringify({
            event: "ai_analysis_pool_close_failed",
            ...createFailureDiagnostic(error, "postgres-pool-close", env)
          }));
        } else {
          throw withComponent(error, "postgres-pool-close");
        }
      }
    }
  }
}

function withComponent(error, component) {
  if (error instanceof Error) {
    if (!error.component) {
      error.component = error.code === "POSTGRES_READ_FAILED"
        ? "ai-analysis-repository"
        : component;
    }
    return error;
  }
  const wrapped = new Error("AI analysis failed with a non-Error value.");
  wrapped.name = "AIAnalysisCommandError";
  wrapped.code = "AI_ANALYSIS_FAILED";
  wrapped.component = component;
  wrapped.cause = error;
  return wrapped;
}

function createFailureDiagnostic(error, component, env) {
  const code = safeCode(error?.code) || "AI_ANALYSIS_FAILED";
  const causeCode = safeCode(error?.cause?.code);
  const category = component === "configuration" ? "configuration"
    : component === "ai-analysis-contract" ? "database_contract"
      : component === "ai-analysis-repository" || component === "postgres-pool"
        ? "database"
        : "ai_analysis";
  const diagnostic = {
    code,
    category,
    message: safeMessage(error, code),
    component,
    ...(causeCode ? { causeCode } : {})
  };
  if (Array.isArray(error?.errors)) {
    diagnostic.errors = error.errors
      .filter((item) => typeof item === "string")
      .map((item) => sanitizeDiagnosticText(item));
  }
  if (env.NODE_ENV === "development" && typeof error?.stack === "string") {
    diagnostic.stack = sanitizeDiagnosticText(error.stack, 12000);
  }
  return diagnostic;
}

function safeMessage(error, code) {
  if (typeof error?.message === "string"
    && (error.name === "AIAnalysisConfigurationError"
      || error.name === "AIAnalysisContractError"
      || error.name === "AIAnalysisServiceError"
      || error.name === "AiAnalysisRepositoryError"
      || error.component === "configuration")) {
    return sanitizeDiagnosticText(error.message);
  }
  if (code === "POSTGRES_READ_FAILED") {
    return "A PostgreSQL read operation failed.";
  }
  return "AI analysis failed; consult the error code and component.";
}

function isDirectExecution() {
  return process.argv[1]
    && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectExecution()) {
  runAIAnalysisCommand().catch((error) => {
    console.error(JSON.stringify({
      event: "ai_analysis_command_failed",
      ...createFailureDiagnostic(error, error.component || "ai-analysis", process.env)
    }));
    process.exitCode = 1;
  });
}
