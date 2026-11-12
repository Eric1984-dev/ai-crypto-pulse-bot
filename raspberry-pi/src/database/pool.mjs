import pg from "pg";
import { createPoolOptions } from "../config/runtime-config.mjs";
import { createIngestionFailureDiagnostic } from "../services/ingestion-diagnostics.mjs";

export function createPostgresPool(config, {
  Pool = pg.Pool,
  logger = console,
  readOnly = true
} = {}) {
  if (typeof Pool !== "function") {
    throw new TypeError("A PostgreSQL Pool implementation is required.");
  }

  const options = createPoolOptions(config);
  if (!readOnly) {
    options.options = "-c default_transaction_read_only=off";
  }
  const pool = new Pool(options);
  pool.on("error", (error) => {
    logger.error(JSON.stringify({
      event: "postgres_pool_error",
      ...createIngestionFailureDiagnostic(error, { component: "postgres-pool" })
    }));
  });
  return pool;
}
