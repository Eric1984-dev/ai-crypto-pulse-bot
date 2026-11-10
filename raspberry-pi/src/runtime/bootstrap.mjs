import { createHealthApiServer } from "../api/server.mjs";
import { createPostgresPool } from "../database/pool.mjs";
import { createDiagnosticsSnapshot } from "../monitoring/diagnostics.mjs";
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
  validateContracts = validateRuntimeContracts
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
    const getDiagnostics = () => createDiagnosticsSnapshot({ pool, readiness });
    server = createHealthApiServer({
      readiness,
      getDiagnostics,
      logger,
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
