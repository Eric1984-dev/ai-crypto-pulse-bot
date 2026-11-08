import { createServer } from "node:http";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createPoolOptions, readArchiveConfig } from "./config.mjs";
import { createArchiveHealthHandler, getDiskUsagePercent } from "./health.mjs";

function probePostgresql(host, port, timeoutMs = 900) {
  return new Promise((resolveProbe) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (reachable) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolveProbe(reachable);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

export function createArchiveHealthServer({ env = process.env, Pool } = {}) {
  if (typeof Pool !== "function") {
    throw new TypeError("A PostgreSQL Pool implementation is required.");
  }
  const config = readArchiveConfig(env);
  const pool = new Pool(createPoolOptions(config));
  pool.on("error", () => {
    console.error("Archive PostgreSQL connection pool reported an error.");
  });
  const handler = createArchiveHealthHandler({
    expectedToken: config.healthToken,
    expectedDatabase: config.database,
    probePostgresql: () => probePostgresql(config.host, config.port),
    checkDatabase: async () => {
      const client = await pool.connect();
      try {
        const result = await client.query(
          "SELECT current_database() AS \"databaseName\", pg_database_size(current_database())::text AS \"sizeBytes\""
        );
        return result.rows[0] || null;
      } finally {
        client.release();
      }
    },
    getDiskUsage: () => getDiskUsagePercent(config.diskPath)
  });
  return {
    server: createServer(handler),
    pool,
    host: config.healthHost,
    port: config.healthPort
  };
}

async function start() {
  const { Pool } = await import("pg");
  const { server, pool, host, port } = createArchiveHealthServer({ Pool });
  server.on("error", () => {
    console.error("Archive health service failed to start.");
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    console.info("Archive health service is listening.");
  });

  const shutdown = () => {
    server.close(() => {
      pool.end().finally(() => {
        process.exit(0);
      });
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  start().catch(() => {
    console.error("Archive health service configuration or startup failed.");
    process.exitCode = 1;
  });
}
