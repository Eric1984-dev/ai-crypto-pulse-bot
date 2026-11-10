import pg from "pg";
import { createPoolOptions } from "../config/runtime-config.mjs";

function safeErrorCode(error) {
  return typeof error?.code === "string" && /^[A-Z0-9_]{1,32}$/.test(error.code)
    ? error.code
    : "UNKNOWN";
}

export function createPostgresPool(config, {
  Pool = pg.Pool,
  logger = console
} = {}) {
  if (typeof Pool !== "function") {
    throw new TypeError("A PostgreSQL Pool implementation is required.");
  }

  const pool = new Pool(createPoolOptions(config));
  pool.on("error", (error) => {
    logger.error(JSON.stringify({
      event: "postgres_pool_error",
      code: safeErrorCode(error)
    }));
  });
  return pool;
}
