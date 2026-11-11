import { AiAnalysisRepository } from "../repositories/ai-analysis-repository.mjs";
import { MarketIngestionRepository } from "../repositories/market-ingestion-repository.mjs";
import { WatchedMarketsRepository } from "../repositories/watched-markets-repository.mjs";
import { createPostgresPool } from "../database/pool.mjs";
import { createAiAnalysisDatabaseConfig } from "../analyze-ai.mjs";
import { createIngestionDatabaseConfig } from "../ingest-market-data.mjs";
import { createBitvavoPublicClient } from "../services/bitvavo-public-client.mjs";
import { createAiAnalysisService } from "../services/ai-analysis-service.mjs";
import { createMarketDataIngestionService } from "../services/market-data-ingestion.mjs";
import { validateAIAnalysisRuntimeContracts } from "../services/ai-analysis-contract-validation.mjs";
import { validateIngestionRuntimeContracts } from "../services/contract-validation.mjs";

export async function runMarketIngestionStage({
  config,
  env = process.env,
  Pool,
  fetchImpl = globalThis.fetch,
  logger = console,
  intervals
}) {
  const stageConfig = createIngestionDatabaseConfig(config, env);
  const pool = createWorkerPool(stageConfig, Pool, logger);
  return runWithPool(pool, logger, async () => {
    await validateIngestionRuntimeContracts(pool, stageConfig, { logger });
    const ingestion = createMarketDataIngestionService({
      watchedMarketsRepository: new WatchedMarketsRepository(pool, { logger }),
      ingestionRepository: new MarketIngestionRepository(pool, { logger }),
      bitvavoClient: createBitvavoPublicClient({ fetchImpl }),
      logger
    });
    return ingestion.run({ intervals });
  });
}

export async function runAiAnalysisStage({
  config,
  env = process.env,
  Pool,
  logger = console
}) {
  const stageConfig = createAiAnalysisDatabaseConfig(config, env);
  const pool = createWorkerPool(stageConfig, Pool, logger);
  return runWithPool(pool, logger, async () => {
    await validateAIAnalysisRuntimeContracts(pool, stageConfig, { logger });
    const analysis = createAiAnalysisService({
      watchedMarketsRepository: new WatchedMarketsRepository(pool, { logger }),
      aiAnalysisRepository: new AiAnalysisRepository(pool, { logger })
    });
    return analysis.run();
  });
}

function createWorkerPool(config, Pool, logger) {
  const workerConfig = Object.freeze({
    ...config,
    database: Object.freeze({
      ...config.database,
      poolMax: 1
    })
  });
  return createPostgresPool(workerConfig, { Pool, logger });
}

async function runWithPool(pool, logger, operation) {
  let operationError;
  try {
    return await operation();
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await pool.end();
    } catch (error) {
      if (operationError) {
        logger.error(JSON.stringify({
          event: "runtime_worker_pool_close_failed",
          code: safeCode(error?.code)
        }));
      } else {
        throw error;
      }
    }
  }
}

function safeCode(value) {
  return typeof value === "string" && /^[A-Z0-9_]{1,64}$/.test(value)
    ? value
    : "POSTGRES_POOL_CLOSE_FAILED";
}
