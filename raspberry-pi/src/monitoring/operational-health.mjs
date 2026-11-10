import os from "node:os";

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeBytes(value) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

export function createOperationalHealthSnapshot({
  pool,
  requestMetrics,
  processRef = process,
  osRef = os
}) {
  const memory = processRef.memoryUsage();
  return Object.freeze({
    status: "foundation_only",
    runtime: Object.freeze({
      api: "running",
      scheduler: "not_implemented"
    }),
    lastCycle: null,
    currentStage: null,
    resources: Object.freeze({
      uptimeSeconds: safeBytes(processRef.uptime()),
      residentBytes: safeBytes(memory.rss),
      heapUsedBytes: safeBytes(memory.heapUsed),
      systemAvailableBytes: safeBytes(osRef.freemem()),
      systemTotalBytes: safeBytes(osRef.totalmem()),
      databasePool: Object.freeze({
        total: safeCount(pool.totalCount),
        idle: safeCount(pool.idleCount),
        waiting: safeCount(pool.waitingCount)
      })
    }),
    failureCounts: requestMetrics.getSnapshot()
  });
}
