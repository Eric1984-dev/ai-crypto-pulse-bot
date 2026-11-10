import {
  queryReadOnly,
  RepositoryDataError,
  readTimestamp
} from "./postgres-read.mjs";

const STATUS_VALUES = new Set(["ACTIVE", "ANALYZING", "IDLE", "STOPPED", "ERROR"]);
const RUNTIME_STATUS_SQL = `
  SELECT status, is_active, is_analyzing, last_run, updated_at
  FROM public."AI_Crypto_Bot_Status"
  WHERE singleton IS TRUE
  LIMIT $1
`;

export class RuntimeStatusRepository {
  constructor(pool, { logger = console } = {}) {
    this.pool = pool;
    this.logger = logger;
  }

  async getStatus() {
    const result = await queryReadOnly(
      this.pool,
      RUNTIME_STATUS_SQL,
      [1],
      { logger: this.logger }
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    if (typeof row.is_active !== "boolean" || typeof row.is_analyzing !== "boolean") {
      throw new RepositoryDataError("invalid runtime status flags");
    }
    return {
      ...row,
      status: typeof row.status === "string" && STATUS_VALUES.has(row.status.toUpperCase())
        ? row.status.toUpperCase()
        : null,
      last_run: row.last_run === null ? null : readTimestamp(row.last_run, "runtime last-run timestamp"),
      updated_at: readTimestamp(row.updated_at, "runtime update timestamp")
    };
  }
}
