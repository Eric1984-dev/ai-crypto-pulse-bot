import test from "node:test";
import assert from "node:assert/strict";
import { createOperationalHealthSnapshot } from "../src/monitoring/operational-health.mjs";

test("operational health exposes bounded outcomes for each completed runtime stage", () => {
  const health = createOperationalHealthSnapshot({
    pool: { totalCount: 1, idleCount: 1, waitingCount: 0 },
    requestMetrics: { getSnapshot: () => ({ totalRequests: 0 }) },
    runtimeStatus: {
      scheduler: "running",
      lastCycle: {
        status: "COMPLETED",
        cycleAt: "2026-11-11T09:00:00.000Z",
        stages: {
          ingestion: "partial",
          aiAnalysis: "completed",
          paperTrading: "SKIPPED"
        }
      }
    },
    processRef: {
      memoryUsage: () => ({ rss: 1, heapUsed: 1 }),
      uptime: () => 1
    },
    osRef: { freemem: () => 1, totalmem: () => 1 }
  });

  assert.equal(health.runtime.scheduler, "running");
  assert.deepEqual(health.lastCycle.stages, {
    ingestion: "partial",
    aiAnalysis: "completed",
    paperTrading: "SKIPPED"
  });
});

test("operational health drops unrecognized stage status values", () => {
  const health = createOperationalHealthSnapshot({
    pool: { totalCount: 0, idleCount: 0, waitingCount: 0 },
    requestMetrics: { getSnapshot: () => ({}) },
    runtimeStatus: {
      scheduler: "running",
      lastCycle: {
        status: "FAILED",
        stages: {
          ingestion: "unexpected",
          aiAnalysis: "completed",
          paperTrading: "SKIPPED"
        }
      }
    },
    processRef: {
      memoryUsage: () => ({ rss: 1, heapUsed: 1 }),
      uptime: () => 1
    },
    osRef: { freemem: () => 1, totalmem: () => 1 }
  });

  assert.equal(health.lastCycle.stages.ingestion, null);
});
