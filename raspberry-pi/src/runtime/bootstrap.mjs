import { createApiServer } from "../api/server.mjs";
import { createSessionStore } from "../auth/session-store.mjs";
import { createPostgresPool } from "../database/pool.mjs";
import { createOperationalHealthSnapshot } from "../monitoring/operational-health.mjs";
import { createRequestMetrics } from "../monitoring/request-metrics.mjs";
import { AiDecisionsRepository } from "../repositories/ai-decisions-repository.mjs";
import { MarketDataRepository } from "../repositories/market-data-repository.mjs";
import { RuntimeStatusRepository } from "../repositories/runtime-status-repository.mjs";
import { WatchedMarketsRepository } from "../repositories/watched-markets-repository.mjs";
import { createReadinessService } from "../services/readiness-service.mjs";
import { validateRuntimeContracts } from "../services/contract-validation.mjs";

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
  authenticationProvider
} = {}) {
  const pool = createPostgresPool(config, { Pool, logger });
  let server;
  try {
    const validation = await validateContracts(pool, config, { logger });
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
      requestMetrics
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
    logger.info(JSON.stringify({
      event: "runtime_started",
      host: config.api.host,
      port: config.api.port,
      validation
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
        await closeServer(server);
        await pool.end();
      }
    });
  } catch (error) {
    if (server) {
      await closeServer(server).catch((closeError) => {
        logger.error(JSON.stringify({
          event: "runtime_server_close_failed",
          code: safeErrorCode(closeError)
        }));
      });
    }
    await pool.end();
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
