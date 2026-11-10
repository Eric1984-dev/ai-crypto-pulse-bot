import { withReadOnlyTransaction } from "../database/read-only-transaction.mjs";
import { createIngestionFailureDiagnostic } from "../services/ingestion-diagnostics.mjs";

export class RepositoryUnavailableError extends Error {
  constructor(cause) {
    super("A PostgreSQL read operation failed.", { cause });
    this.name = "RepositoryUnavailableError";
    this.code = "POSTGRES_READ_FAILED";
  }
}

export class RepositoryDataError extends Error {
  constructor(reason) {
    super("PostgreSQL returned data that does not satisfy the API contract.");
    this.name = "RepositoryDataError";
    this.code = "INVALID_STORED_DATA";
    this.reason = reason;
  }
}

export async function queryReadOnly(pool, sql, values = [], { logger = console } = {}) {
  try {
    return await withReadOnlyTransaction(
      pool,
      (client) => client.query(sql, values),
      { logger }
    );
  } catch (error) {
    if (logger && typeof logger.error === "function") {
      logger.error(JSON.stringify({
        event: "postgres_read_api_failed",
        ...createIngestionFailureDiagnostic(error, { component: "postgres-read" })
      }));
    }
    throw new RepositoryUnavailableError(error);
  }
}

export function readPositiveLimit(value, max, fallback) {
  const limit = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > max) {
    throw new RangeError(`A limit between 1 and ${max} is required.`);
  }
  return limit;
}

export function readFiniteNumber(value, field) {
  if (value === null || value === undefined || value === "") {
    throw new RepositoryDataError(`invalid ${field}`);
  }
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) {
    throw new RepositoryDataError(`invalid ${field}`);
  }
  return number;
}

export function readTimestamp(value, field) {
  if (value === null || value === undefined || value === "") {
    throw new RepositoryDataError(`invalid ${field}`);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new RepositoryDataError(`invalid ${field}`);
  }
  return date.toISOString();
}

export function safeErrorCode(error) {
  return typeof error?.code === "string" && /^[A-Z0-9_]{1,32}$/.test(error.code)
    ? error.code
    : "POSTGRES_QUERY_FAILED";
}
