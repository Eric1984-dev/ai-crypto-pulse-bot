import { pathToFileURL } from "node:url";
import { createPostgresPool } from "./database/pool.mjs";
import { readRuntimeConfig } from "./config/runtime-config.mjs";
import { MarketIngestionRepository } from "./repositories/market-ingestion-repository.mjs";
import { WatchedMarketsRepository } from "./repositories/watched-markets-repository.mjs";
import { createBitvavoPublicClient } from "./services/bitvavo-public-client.mjs";
import { validateIngestionRuntimeContracts } from "./services/contract-validation.mjs";
import {
  createMarketDataIngestionService,
  SUPPORTED_INGESTION_INTERVALS
} from "./services/market-data-ingestion.mjs";
import {
  createIngestionFailureDiagnostic,
  sanitizeDiagnosticText,
  withIngestionDiagnosticComponent
} from "./services/ingestion-diagnostics.mjs";

export function parseIngestionArguments(args) {
  if (args.length === 0) {
    throw new TypeError("Select candle intervals explicitly with --intervals=all or a supported interval list.");
  }
  const intervalArgument = args.find((argument) => argument.startsWith("--intervals="));
  if (args.length > 1 || (args.length === 1 && !intervalArgument)) {
    throw new TypeError("Use only --intervals=all or a comma-separated supported interval list.");
  }
  const value = intervalArgument.slice("--intervals=".length);
  if (value === "all") {
    return Object.freeze([...SUPPORTED_INGESTION_INTERVALS]);
  }
  const intervals = value.split(",");
  if (intervals.length === 0 || intervals.some((interval) =>
    !SUPPORTED_INGESTION_INTERVALS.includes(interval))
  || new Set(intervals).size !== intervals.length) {
    throw new TypeError("The interval list must contain unique supported intervals.");
  }
  return Object.freeze(intervals);
}

export function createIngestionDatabaseConfig(config, env = process.env) {
  const user = env.INGESTION_DATABASE_USER?.trim() || "";
  const password = env.INGESTION_DATABASE_PASSWORD || "";
  if (Boolean(user) !== Boolean(password)) {
    throw new Error("INGESTION_DATABASE_USER and INGESTION_DATABASE_PASSWORD must be set together.");
  }
  if (config.ingestion?.allowTableOwner
    && (!user || user === config.database.user)) {
    throw new Error(
      "INGESTION_ALLOW_TABLE_OWNER=true requires a separate INGESTION_DATABASE_USER."
    );
  }
  if (!user) {
    return config;
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

export async function runMarketDataIngestionCommand({
  args = process.argv.slice(2),
  env = process.env,
  Pool,
  fetchImpl = globalThis.fetch,
  logger = console
} = {}) {
  let component = "configuration";
  try {
    const intervals = parseIngestionArguments(args);
    const config = createIngestionDatabaseConfig(readRuntimeConfig(env), env);
    component = "postgres-pool";
    const pool = createPostgresPool(config, { Pool, logger });
    try {
      component = "ingestion-contract";
      const validation = await validateIngestionRuntimeContracts(pool, config, { logger });
      logger.info(JSON.stringify({
        event: "market_data_ingestion_preflight_passed",
        database: validation.database,
        enabledMarkets: validation.enabledMarkets,
        warnings: validation.warnings
      }));

      component = "market-data-ingestion";
      const ingestion = createMarketDataIngestionService({
        watchedMarketsRepository: new WatchedMarketsRepository(pool, { logger }),
        ingestionRepository: new MarketIngestionRepository(pool, { logger }),
        bitvavoClient: createBitvavoPublicClient({ fetchImpl }),
        logger
      });
      const result = await ingestion.run({ intervals });
      logger.info(JSON.stringify({
        event: "market_data_ingestion_finished",
        ...result
      }));
      if (result.status !== "completed") {
        const failure = new Error(
          `The ingestion pass finished with status "${result.status}". See preceding failure events for root causes.`
        );
        failure.code = result.status === "partial"
          ? "INGESTION_RUN_PARTIAL"
          : "INGESTION_RUN_FAILED";
        failure.component = "market-data-ingestion";
        logger.error(JSON.stringify({
          event: "market_data_ingestion_command_failed",
          ...createIngestionFailureDiagnostic(failure, { env })
        }));
      }
      return result;
    } finally {
      try {
        await pool.end();
      } catch (error) {
        throw withIngestionDiagnosticComponent(error, "postgres-pool");
      }
    }
  } catch (error) {
    throw withIngestionDiagnosticComponent(error, component);
  }
}

function isDirectExecution() {
  return process.argv[1]
    && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectExecution()) {
  runMarketDataIngestionCommand().then((result) => {
    if (result.status !== "completed") {
      process.exitCode = 1;
    }
  }).catch((error) => {
    const safeErrors = Array.isArray(error.errors)
      ? error.errors.map((item) => sanitizeDiagnosticText(
        typeof item === "string" ? item : JSON.stringify(item)
      ))
      : undefined;
    console.error(JSON.stringify({
      event: "market_data_ingestion_command_failed",
      ...createIngestionFailureDiagnostic(error),
      ...(safeErrors ? { errors: safeErrors } : {})
    }));
    process.exitCode = 1;
  });
}
