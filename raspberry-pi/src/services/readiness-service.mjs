import { withReadOnlyTransaction } from "../database/read-only-transaction.mjs";

const READINESS_SQL = `
  SELECT current_database() = $1 AS database_matches,
         current_setting('default_transaction_read_only') = 'on' AS default_read_only,
         current_setting('transaction_read_only') = 'on' AS transaction_read_only
`;

function safeErrorCode(error) {
  return typeof error?.code === "string" && /^[A-Z0-9_]{1,32}$/.test(error.code)
    ? error.code
    : "UNKNOWN";
}

export function createReadinessService({
  pool,
  databaseName,
  startupValidation,
  logger = console,
  now = () => new Date()
}) {
  let lastDatabaseCheck = null;

  return Object.freeze({
    async check() {
      try {
        const row = await withReadOnlyTransaction(pool, async (client) => {
          const result = await client.query(READINESS_SQL, [databaseName]);
          return result.rows[0] || null;
        }, { logger });
        const ready = Boolean(row
          && row.database_matches
          && row.default_read_only
          && row.transaction_read_only
          && startupValidation?.contracts === "valid");
        lastDatabaseCheck = Object.freeze({
          status: ready ? "available" : "unavailable",
          checkedAt: now().toISOString()
        });
        return ready;
      } catch (error) {
        lastDatabaseCheck = Object.freeze({
          status: "unavailable",
          checkedAt: now().toISOString()
        });
        logger.error(JSON.stringify({
          event: "readiness_database_check_failed",
          code: safeErrorCode(error)
        }));
        return false;
      }
    },
    getSnapshot() {
      return Object.freeze({
        contracts: startupValidation?.contracts === "valid" ? "valid" : "invalid",
        enabledMarkets: startupValidation?.enabledMarkets ?? null,
        database: lastDatabaseCheck
      });
    }
  });
}
