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
  runtimeStatus = null,
  processRef = process,
  osRef = os
}) {
  const memory = processRef.memoryUsage();
  return Object.freeze({
    status: runtimeStatus ? "running" : "foundation_only",
    runtime: Object.freeze({
      api: "running",
      scheduler: runtimeStatus?.scheduler || "not_implemented"
    }),
    lastCycle: safeCycle(runtimeStatus?.lastCycle),
    currentStage: runtimeStatus?.currentStage || null,
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

function safeCycle(cycle) {
  if (!cycle || typeof cycle !== "object") {
    return null;
  }
  const stages = cycle.stages && typeof cycle.stages === "object"
    ? Object.freeze({
      ingestion: safeStatus(cycle.stages.ingestion, ["completed", "partial", "FAILED"]),
      aiAnalysis: safeStatus(cycle.stages.aiAnalysis, ["completed", "FAILED"]),
      paperTrading: safeStatus(cycle.stages.paperTrading, ["COMPLETED", "SKIPPED", "FAILED"]),
      shadowExits: safeStatus(cycle.stages.shadowExits, ["COMPLETED", "SKIPPED", "FAILED"])
    })
    : undefined;
  return Object.freeze({
    status: typeof cycle.status === "string" ? cycle.status : null,
    ...(typeof cycle.cycleAt === "string" ? { cycleAt: cycle.cycleAt } : {}),
    ...(typeof cycle.stage === "string" ? { stage: cycle.stage } : {}),
    ...(typeof cycle.code === "string" ? { code: cycle.code } : {}),
    ...(stages ? { stages } : {})
  });
}

function safeStatus(value, allowed) {
  return typeof value === "string" && allowed.includes(value) ? value : null;
}
