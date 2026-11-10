import os from "node:os";

function finiteNonNegative(value) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

export function createDiagnosticsSnapshot({
  pool,
  readiness,
  processRef = process,
  osRef = os
}) {
  const memory = processRef.memoryUsage();
  const readinessSnapshot = readiness.getSnapshot();

  return Object.freeze({
    node: Object.freeze({
      version: processRef.version,
      platform: processRef.platform,
      architecture: processRef.arch,
      uptimeSeconds: finiteNonNegative(processRef.uptime())
    }),
    memory: Object.freeze({
      residentBytes: finiteNonNegative(memory.rss),
      heapUsedBytes: finiteNonNegative(memory.heapUsed),
      systemAvailableBytes: finiteNonNegative(osRef.freemem()),
      systemTotalBytes: finiteNonNegative(osRef.totalmem())
    }),
    databasePool: Object.freeze({
      total: finiteNonNegative(pool.totalCount),
      idle: finiteNonNegative(pool.idleCount),
      waiting: finiteNonNegative(pool.waitingCount)
    }),
    startup: Object.freeze({
      contracts: readinessSnapshot.contracts,
      enabledMarkets: readinessSnapshot.enabledMarkets
    }),
    databaseCheck: readinessSnapshot.database
  });
}
