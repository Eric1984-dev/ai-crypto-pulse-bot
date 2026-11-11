import { createApiServer } from "../api/server.mjs";
import { createSessionStore } from "../auth/session-store.mjs";
import { createPostgresPool } from "../database/pool.mjs";
import { createOperationalHealthSnapshot } from "../monitoring/operational-health.mjs";
import { createRequestMetrics } from "../monitoring/request-metrics.mjs";
import { AiDecisionsRepository } from "../repositories/ai-decisions-repository.mjs";
import { MarketDataRepository } from "../repositories/market-data-repository.mjs";
import { PaperTradingRepository } from "../repositories/paper-trading-repository.mjs";
import { RuntimeStatusRepository } from "../repositories/runtime-status-repository.mjs";
import { WatchedMarketsRepository } from "../repositories/watched-markets-repository.mjs";
import { createAiAnalysisDatabaseConfig } from "../analyze-ai.mjs";
import { createIngestionDatabaseConfig } from "../ingest-market-data.mjs";
import { createDataRetentionService } from "../services/data-retention-service.mjs";
import {
  createPaperTradingDatabaseConfig,
  createPaperTradingService
} from "../services/paper-trading-service.mjs";
import { createRuntimeCycle } from "../services/runtime-cycle.mjs";
import {
  acquireRuntimeOwnershipLock,
  createRuntimeScheduler
} from "../services/runtime-scheduler.mjs";
import { validateAIAnalysisRuntimeContracts } from "../services/ai-analysis-contract-validation.mjs";
import { validateIngestionRuntimeContracts } from "../services/contract-validation.mjs";
import { validatePaperTradingRuntimeContracts } from "../services/paper-trading-contract-validation.mjs";
import { createReadinessService } from "../services/readiness-service.mjs";
import { validateRuntimeContracts } from "../services/contract-validation.mjs";
import {
  runAiAnalysisStage,
  runMarketIngestionStage
} from "./worker-stages.mjs";

function waitForListening(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

export async function startRuntime(config, {
  Pool,
  logger = console,
  createServerImpl,
  validateContracts = validateRuntimeContracts,
  validateIngestionContracts = validateIngestionRuntimeContracts,
  validateAIContracts = validateAIAnalysisRuntimeContracts,
  validatePaperContracts = validatePaperTradingRuntimeContracts,
  authenticationProvider,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const apiConfig = withPoolMax(config, 2);
  const pool = createPostgresPool(apiConfig, { Pool, logger });
  let server;
  let paperPool;
  let ownershipLock;
  let scheduler;
  try {
    ownershipLock = await acquireRuntimeOwnershipLock(pool);
    const validation = await validateContracts(pool, config, { logger });
    const ingestionConfig = createIngestionDatabaseConfig(config, env);
    await validateWorkerConfig(
      ingestionConfig,
      Pool,
      logger,
      (workerPool, workerConfig) =>
        validateIngestionContracts(workerPool, workerConfig, { logger })
    );
    const aiConfig = createAiAnalysisDatabaseConfig(config, env);
    await validateWorkerConfig(
      aiConfig,
      Pool,
      logger,
      (workerPool, workerConfig) =>
        validateAIContracts(workerPool, workerConfig, { logger })
    );
    const paperConfig = createPaperTradingDatabaseConfig(config, env);
    paperPool = createPostgresPool(withPoolMax(paperConfig, 1), { Pool, logger });
    const paperValidation = await validatePaperContracts(paperPool, paperConfig, { logger });
    const paperRepository = new PaperTradingRepository(paperPool, { logger });
    const paperTrading = createPaperTradingService({
      repository: paperRepository,
      logger
    });
    const existingStatus = await paperTrading.readAgentStatus();
    if (!existingStatus) {
      const error = new Error("The existing singleton runtime status row is missing.");
      error.code = "PAPER_TRADING_STATUS_ROW_MISSING";
      throw error;
    }
    if (existingStatus.status !== "STOPPED"
      && (existingStatus.status === "ANALYZING" || existingStatus.is_analyzing)) {
      await paperTrading.updateAgentStatus({
        status: "ERROR",
        errorMessage: "An interrupted AI analysis was detected during runtime startup.",
        updatedAt: new Date()
      });
      logger.warn(JSON.stringify({
        event: "runtime_interrupted_analysis_recovered",
        code: "RUNTIME_ANALYSIS_INTERRUPTED"
      }));
    }

    const retentionService = createDataRetentionService();
    const runtimeCycle = createRuntimeCycle({
      ingestMarketData: ({ intervals }) => runMarketIngestionStage({
        config,
        env,
        Pool,
        fetchImpl,
        logger,
        intervals
      }),
      analyzeMarkets: () => runAiAnalysisStage({
        config,
        env,
        Pool,
        logger
      }),
      runPaperTrading: () => paperTrading.run(),
      updateAgentStatus: (status) => paperTrading.updateAgentStatus(status),
      assertOwnership: () => ownershipLock.assertHeld(),
      retentionService,
      logger
    });
    const runtimeHealth = {
      scheduler: "starting",
      lastCycle: null,
      currentStage: null
    };
    scheduler = createRuntimeScheduler({
      runCycle: async (cycle) => {
        await ownershipLock.assertHeld();
        runtimeHealth.currentStage = "pipeline";
        const result = await runtimeCycle.run(cycle);
        runtimeHealth.currentStage = null;
        runtimeHealth.lastCycle = result;
        return result;
      },
      onFatal: () => {
        runtimeHealth.scheduler = "error";
        runtimeHealth.currentStage = null;
      },
      logger
    });
    const readiness = createReadinessService({
      pool,
      databaseName: config.database.name,
      startupValidation: validation,
      logger
    });
    const requestMetrics = createRequestMetrics();
    const sessionStore = createSessionStore({
      ttlMs: config.api.sessionTtlMs,
      maxSessions: config.api.sessionMax
    });
    const getOperationalHealth = () => createOperationalHealthSnapshot({
      pool,
      requestMetrics,
      runtimeStatus: runtimeHealth
    });
    const dataRepositories = Object.freeze({
      watchedMarkets: new WatchedMarketsRepository(pool, { logger }),
      marketData: new MarketDataRepository(pool, { logger }),
      aiDecisions: new AiDecisionsRepository(pool, { logger }),
      runtimeStatus: new RuntimeStatusRepository(pool, { logger })
    });
    server = createApiServer({
      readiness,
      getOperationalHealth,
      dataRepositories,
      authenticationProvider,
      allowedOrigins: config.api.corsOrigins,
      rateLimitMaxRequests: config.api.rateLimitMaxRequests,
      rateLimitWindowMs: config.api.rateLimitWindowMs,
      logger,
      metrics: requestMetrics,
      ...(createServerImpl ? { createServerImpl } : {})
    });
    await waitForListening(server, config.api.host, config.api.port);
    scheduler.start();
    runtimeHealth.scheduler = "running";
    logger.info(JSON.stringify({
      event: "runtime_started",
      host: config.api.host,
      port: config.api.port,
      validation,
      paperTrading: paperValidation
    }));

    let closed = false;
    return Object.freeze({
      server,
      pool,
      validation,
      sessionStore,
      requestMetrics,
      async close() {
        if (closed) {
          return;
        }
        closed = true;
        runtimeHealth.scheduler = "stopping";
        let closeError;
        let cycleStopped = false;
        try {
          cycleStopped = await scheduler.stop();
        } catch (error) {
          closeError = error;
          logger.error(JSON.stringify({
            event: "runtime_scheduler_shutdown_failed",
            code: safeErrorCode(error)
          }));
        }
        if (!cycleStopped) {
          ownershipLock.abandon();
        }
        if (cycleStopped) {
          try {
            const status = await paperTrading.readAgentStatus();
            if (status && status.status !== "STOPPED") {
              await paperTrading.updateAgentStatus({
                status: "IDLE",
                errorMessage: null,
                updatedAt: new Date()
              });
            }
          } catch (error) {
            logger.error(JSON.stringify({
              event: "runtime_shutdown_status_update_failed",
              code: safeErrorCode(error)
            }));
          }
        }
        try {
          await closeServer(server);
        } catch (error) {
          closeError ||= error;
        }
        await closePool(paperPool, logger, "paper-trading");
        try {
          if (cycleStopped) {
            await ownershipLock.release();
          }
        } catch (error) {
          closeError ||= error;
          logger.error(JSON.stringify({
            event: "runtime_lock_release_failed",
            code: safeErrorCode(error)
          }));
        }
        try {
          await pool.end();
        } catch (error) {
          closeError ||= error;
          logger.error(JSON.stringify({
            event: "runtime_api_pool_close_failed",
            code: safeErrorCode(error)
          }));
        }
        if (closeError) {
          throw closeError;
        }
      }
    });
  } catch (error) {
    if (scheduler) {
      await scheduler.stop().catch((stopError) => {
        logger.error(JSON.stringify({
          event: "runtime_scheduler_close_failed",
          code: safeErrorCode(stopError)
        }));
      });
    }
    if (server) {
      await closeServer(server).catch((closeError) => {
        logger.error(JSON.stringify({
          event: "runtime_server_close_failed",
          code: safeErrorCode(closeError)
        }));
      });
    }
    await closePool(paperPool, logger, "paper-trading");
    if (ownershipLock) {
      await ownershipLock.release().catch((lockError) => {
        logger.error(JSON.stringify({
          event: "runtime_lock_release_failed",
          code: safeErrorCode(lockError)
        }));
      });
    }
    try {
      await pool.end();
    } catch (poolError) {
      logger.error(JSON.stringify({
        event: "runtime_api_pool_close_failed",
        code: safeErrorCode(poolError)
      }));
    }
    throw error;
  }
}

export async function validateRuntime(config, {
  Pool,
  logger = console,
  validateContracts = validateRuntimeContracts
} = {}) {
  const pool = createPostgresPool(config, { Pool, logger });
  try {
    return await validateContracts(pool, config, { logger });
  } finally {
    await pool.end();
  }
}

function safeErrorCode(error) {
  return typeof error?.code === "string" && /^[A-Z0-9_]{1,32}$/.test(error.code)
    ? error.code
    : "UNKNOWN";
}

async function validateWorkerConfig(config, Pool, logger, validate) {
  const workerPool = createPostgresPool(withPoolMax(config, 1), { Pool, logger });
  let validationError;
  try {
    await validate(workerPool, config);
  } catch (error) {
    validationError = error;
    throw error;
  } finally {
    try {
      await workerPool.end();
    } catch (error) {
      if (validationError) {
        logger.error(JSON.stringify({
          event: "runtime_preflight_pool_close_failed",
          code: safeErrorCode(error)
        }));
      } else {
        throw error;
      }
    }
  }
}

function withPoolMax(config, poolMax) {
  return Object.freeze({
    ...config,
    database: Object.freeze({
      ...config.database,
      poolMax
    })
  });
}

async function closePool(pool, logger, component) {
  if (!pool) {
    return;
  }
  try {
    await pool.end();
  } catch (error) {
    logger.error(JSON.stringify({
      event: "runtime_pool_close_failed",
      component,
      code: safeErrorCode(error)
    }));
  }
}
