import { createIngestionFailureDiagnostic } from "../services/ingestion-diagnostics.mjs";

export async function withWriteTransaction(pool, operation, {
  logger = console
} = {}) {
  if (!pool || typeof pool.connect !== "function" || typeof operation !== "function") {
    throw new TypeError("A PostgreSQL pool and write operation are required.");
  }

  const client = await pool.connect();
  let began = false;
  let releaseError;
  try {
    await client.query("BEGIN READ WRITE");
    began = true;
    const result = await operation(client);
    await client.query("COMMIT");
    began = false;
    return result;
  } catch (error) {
    if (began) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        releaseError = rollbackError;
        logger.error(JSON.stringify({
          event: "postgres_write_rollback_failed",
          ...createIngestionFailureDiagnostic(rollbackError, {
            component: "postgres-write-transaction"
          })
        }));
      }
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}
