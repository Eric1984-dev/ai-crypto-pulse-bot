export async function withReadOnlyTransaction(pool, operation, {
  logger = console
} = {}) {
  if (!pool || typeof pool.connect !== "function" || typeof operation !== "function") {
    throw new TypeError("A PostgreSQL pool and read-only operation are required.");
  }

  const client = await pool.connect();
  let began = false;
  let releaseError;
  try {
    await client.query("BEGIN READ ONLY");
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
          event: "postgres_read_only_rollback_failed",
          code: safeErrorCode(rollbackError)
        }));
      }
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}

function safeErrorCode(error) {
  return typeof error?.code === "string" && /^[A-Z0-9_]{1,32}$/.test(error.code)
    ? error.code
    : "UNKNOWN";
}
