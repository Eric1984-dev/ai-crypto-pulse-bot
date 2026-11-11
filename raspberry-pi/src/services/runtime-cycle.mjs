export class RuntimeCycleError extends Error {
  constructor(stage, cause) {
    super(`The runtime cycle failed during ${stage}.`, { cause });
    this.name = "RuntimeCycleError";
    this.code = cause?.code === "RUNTIME_OWNERSHIP_LOCK_LOST"
      ? cause.code
      : "RUNTIME_CYCLE_FAILED";
    this.component = "runtime-cycle";
    this.stage = stage;
  }
}

export function createRuntimeCycle({
  ingestMarketData,
  analyzeMarkets,
  runPaperTrading,
  updateAgentStatus,
  retentionService,
  assertOwnership = async () => {},
  now = () => new Date(),
  logger = console
} = {}) {
  if (typeof ingestMarketData !== "function"
    || typeof analyzeMarkets !== "function"
    || typeof runPaperTrading !== "function"
    || typeof updateAgentStatus !== "function"
    || typeof assertOwnership !== "function"
    || !retentionService
    || typeof retentionService.plan !== "function"
    || typeof now !== "function") {
    throw new TypeError("All runtime cycle stages and status persistence are required.");
  }

  return Object.freeze({
    async run({ slot, intervals }) {
      const cycleTime = readTime(slot ?? now());
      let stage = "market-ingestion";
      const stages = {
        ingestion: null,
        aiAnalysis: null,
        paperTrading: null
      };
      try {
        await assertOwnership();
        await updateAgentStatus({
          status: "ACTIVE",
          lastRunAt: null,
          errorMessage: null,
          updatedAt: cycleTime
        });
        await assertOwnership();
        const ingestion = await ingestMarketData({ intervals });
        if (!["completed", "partial"].includes(ingestion?.status)) {
          throw new RuntimeCycleError(stage);
        }
        stages.ingestion = ingestion.status;

        stage = "ai-analysis";
        await assertOwnership();
        await updateAgentStatus({
          status: "ANALYZING",
          lastRunAt: null,
          errorMessage: null,
          updatedAt: cycleTime
        });
        await assertOwnership();
        const analysis = await analyzeMarkets();
        if (analysis?.status !== "completed") {
          throw new RuntimeCycleError(stage);
        }
        stages.aiAnalysis = analysis.status;

        await assertOwnership();
        await updateAgentStatus({
          status: "ACTIVE",
          lastRunAt: null,
          errorMessage: null,
          updatedAt: cycleTime
        });
        stage = "paper-trading";
        await assertOwnership();
        const trading = await runPaperTrading();
        if (!["COMPLETED", "SKIPPED"].includes(trading?.status)) {
          throw new RuntimeCycleError(stage);
        }
        stages.paperTrading = trading.status;

        stage = "data-retention";
        const retention = retentionService.plan();
        await assertOwnership();
        await updateAgentStatus({
          status: "IDLE",
          lastRunAt: cycleTime,
          errorMessage: null,
          updatedAt: cycleTime
        });
        const result = Object.freeze({
          status: "COMPLETED",
          cycleAt: cycleTime.toISOString(),
          stages: Object.freeze({ ...stages }),
          ingestion,
          analysis,
          trading,
          retention
        });
        logger.info(JSON.stringify({
          event: "runtime_cycle_completed",
          cycleAt: result.cycleAt,
          ingestionStatus: ingestion.status,
          analysisStatus: analysis.status,
          tradingStatus: trading.status,
          retentionDeletionEnabled: retention.deletionEnabled
        }));
        return result;
      } catch (error) {
        const failure = error instanceof RuntimeCycleError
          ? error
          : new RuntimeCycleError(stage, error);
        if (failure.code !== "RUNTIME_OWNERSHIP_LOCK_LOST") {
          try {
            await updateAgentStatus({
              status: "ERROR",
              lastRunAt: null,
              errorMessage: `Runtime cycle failed during ${failure.stage}.`,
              updatedAt: readTime(now())
            });
          } catch (statusError) {
            logger.error(JSON.stringify({
              event: "runtime_cycle_status_update_failed",
              code: safeCode(statusError?.code)
            }));
          }
        }
        const code = safeCode(failure.cause?.code || failure.code);
        logger.error(JSON.stringify({
          event: "runtime_cycle_failed",
          stage: failure.stage,
          code
        }));
        if (failure.code === "RUNTIME_OWNERSHIP_LOCK_LOST") {
          throw failure;
        }
        return Object.freeze({
          status: "FAILED",
          stage: failure.stage,
          code,
          stages: Object.freeze({
            ...stages,
            ...(failure.stage === "market-ingestion" ? { ingestion: "FAILED" } : {}),
            ...(failure.stage === "ai-analysis" ? { aiAnalysis: "FAILED" } : {}),
            ...(failure.stage === "paper-trading" ? { paperTrading: "FAILED" } : {})
          })
        });
      }
    }
  });
}

function readTime(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError("The runtime cycle clock returned an invalid timestamp.");
  }
  return date;
}

function safeCode(value) {
  return typeof value === "string" && /^[A-Z0-9_]{1,64}$/.test(value)
    ? value
    : "RUNTIME_CYCLE_FAILED";
}
