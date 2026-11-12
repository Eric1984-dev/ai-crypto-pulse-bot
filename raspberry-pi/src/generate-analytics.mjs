import { pathToFileURL } from "node:url";
import { DashboardRepository } from "./repositories/dashboard-repository.mjs";
import { persistAnalyticsRun } from "./repositories/analytics-run-writer.mjs";
import { readRuntimeConfig } from "./config/runtime-config.mjs";
import { createPostgresPool } from "./database/pool.mjs";
import { createAnalyticsInsights } from "./services/analytics-insights.mjs";

const PERIODS = new Set(["30d", "90d", "365d"]);

export class AnalyticsGenerationConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "AnalyticsGenerationConfigurationError";
    this.code = "ANALYTICS_GENERATION_CONFIGURATION_INVALID";
    this.component = "configuration";
  }
}

export function createAnalyticsWriterConfig(config, env = process.env) {
  const user = config.analytics?.databaseUser || "";
  const password = config.analytics?.databasePassword || "";
  if (!user || !password) {
    throw new AnalyticsGenerationConfigurationError(
      "ANALYTICS_DATABASE_USER and ANALYTICS_DATABASE_PASSWORD are required for analytics generation."
    );
  }
  const otherUsers = [
    config.database.user,
    env.INGESTION_DATABASE_USER?.trim() || "",
    config.aiAnalysis?.databaseUser || "",
    config.paperTrading?.databaseUser || ""
  ].filter(Boolean);
  if (otherUsers.includes(user)) {
    throw new AnalyticsGenerationConfigurationError(
      "ANALYTICS_DATABASE_USER must be distinct from every runtime database user."
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

export function parseAnalyticsGenerationOptions(args = []) {
  if (!Array.isArray(args)) {
    throw new TypeError("Analytics generation arguments must be an array.");
  }
  let period = "30d";
  let asOf = new Date();
  const seen = new Set();
  for (const arg of args) {
    const match = typeof arg === "string" && arg.match(/^--(period|as-of)=(.+)$/);
    if (!match || seen.has(match[1])) {
      throw new AnalyticsGenerationConfigurationError(
        "Use --period=30d|90d|365d and optional --as-of=<ISO timestamp>."
      );
    }
    seen.add(match[1]);
    if (match[1] === "period") {
      period = match[2];
      if (!PERIODS.has(period)) {
        throw new AnalyticsGenerationConfigurationError(
          "The analytics period must be 30d, 90d, or 365d."
        );
      }
    } else {
      const parsed = new Date(match[2]);
      if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== match[2]) {
        throw new AnalyticsGenerationConfigurationError(
          "--as-of must be an ISO timestamp with UTC Z notation."
        );
      }
      asOf = parsed;
    }
  }
  return Object.freeze({ period, asOf });
}

export async function runAnalyticsGeneration({
  env = process.env,
  args = process.argv.slice(2),
  Pool,
  logger = console
} = {}) {
  let readerPool;
  let writerPool;
  let operationError;
  try {
    const { period, asOf } = parseAnalyticsGenerationOptions(args);
    const config = readRuntimeConfig(env);
    const writerConfig = createAnalyticsWriterConfig(config, env);
    readerPool = createPostgresPool(config, { Pool, logger });
    writerPool = createPostgresPool(writerConfig, { Pool, logger, readOnly: false });

    const repository = new DashboardRepository(readerPool, { logger });
    const analytics = await repository.getAnalytics({ period, now: asOf });
    const previousRun = await repository.getLatestAnalyticsRun({ period, before: asOf });
    const insights = createAnalyticsInsights(analytics, previousRun);
    const persisted = await persistAnalyticsRun(writerPool, { analytics, insights, logger });
    const result = Object.freeze({
      ...persisted,
      insightCount: insights.recommendations.length,
      sourceCounts: analytics.sourceCounts
    });
    logger.info(JSON.stringify({
      event: "analytics_run_generated",
      ...result
    }));
    return result;
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    for (const [pool, component] of [
      [writerPool, "analytics-writer-pool-close"],
      [readerPool, "analytics-reader-pool-close"]
    ]) {
      if (!pool) {
        continue;
      }
      try {
        await pool.end();
      } catch (error) {
        if (operationError) {
          logger.error(JSON.stringify({
            event: "analytics_pool_close_failed",
            component,
            code: safeCode(error?.code)
          }));
        } else {
          throw error;
        }
      }
    }
  }
}

function safeCode(value) {
  return typeof value === "string" && /^[A-Z0-9_]{1,64}$/.test(value) ? value : null;
}

function isDirectExecution() {
  return process.argv[1]
    && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectExecution()) {
  runAnalyticsGeneration().catch((error) => {
    console.error(JSON.stringify({
      event: "analytics_run_generation_failed",
      code: safeCode(error?.code) || "ANALYTICS_GENERATION_FAILED",
      component: typeof error?.component === "string" ? error.component : "analytics-generation"
    }));
    process.exitCode = 1;
  });
}
