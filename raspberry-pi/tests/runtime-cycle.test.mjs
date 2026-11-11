import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimeCycle } from "../src/services/runtime-cycle.mjs";
import {
  createDataRetentionService,
  DATA_RETENTION_POLICIES
} from "../src/services/data-retention-service.mjs";

function makeCycle(overrides = {}) {
  const calls = [];
  const statusUpdates = [];
  const cycle = createRuntimeCycle({
    ingestMarketData: async () => {
      calls.push("ingestion");
      return { status: "partial" };
    },
    analyzeMarkets: async () => {
      calls.push("analysis");
      return { status: "completed" };
    },
    runPaperTrading: async () => {
      calls.push("paper");
      return { status: "COMPLETED" };
    },
    updateAgentStatus: async (status) => statusUpdates.push(status),
    retentionService: { plan: () => ({ deletionEnabled: false }) },
    now: () => new Date("2026-01-01T12:00:00.000Z"),
    logger: { info() {}, error() {} },
    ...overrides
  });
  return { cycle, calls, statusUpdates };
}

test("runtime cycle allows per-market partial ingestion and preserves stage order", async () => {
  const { cycle, calls, statusUpdates } = makeCycle();

  const result = await cycle.run({
    slot: new Date("2026-01-01T12:00:00.000Z"),
    intervals: ["1m", "1h"]
  });

  assert.equal(result.status, "COMPLETED");
  assert.deepEqual(result.stages, {
    ingestion: "partial",
    aiAnalysis: "completed",
    paperTrading: "COMPLETED"
  });
  assert.deepEqual(calls, ["ingestion", "analysis", "paper"]);
  assert.deepEqual(statusUpdates.map(({ status }) => status), [
    "ACTIVE",
    "ANALYZING",
    "ACTIVE",
    "ACTIVE"
  ]);
});

test("critical ingestion failures mark ERROR and skip downstream stages", async () => {
  const { cycle, calls, statusUpdates } = makeCycle({
    ingestMarketData: async () => {
      calls.push("ingestion");
      return { status: "failed" };
    }
  });

  const result = await cycle.run({ slot: new Date("2026-01-01T12:00:00.000Z") });

  assert.equal(result.status, "FAILED");
  assert.equal(result.stage, "market-ingestion");
  assert.deepEqual(calls, ["ingestion"]);
  assert.equal(statusUpdates.at(-1).status, "ERROR");
});

test("lost runtime ownership stops downstream work without writing status", async () => {
  let ownershipChecks = 0;
  const { cycle, calls, statusUpdates } = makeCycle({
    assertOwnership: async () => {
      ownershipChecks += 1;
      if (ownershipChecks === 3) {
        throw Object.assign(new Error("lock connection lost"), {
          code: "RUNTIME_OWNERSHIP_LOCK_LOST"
        });
      }
    }
  });

  await assert.rejects(cycle.run({
    slot: new Date("2026-01-01T12:00:00.000Z")
  }), { code: "RUNTIME_OWNERSHIP_LOCK_LOST" });
  assert.deepEqual(calls, ["ingestion"]);
  assert.deepEqual(statusUpdates.map(({ status }) => status), ["ACTIVE"]);
});

test("retention planner describes exact cutoffs but never deletes data", () => {
  const retention = createDataRetentionService({
    now: () => new Date("2026-01-01T00:00:00.000Z")
  });
  const plan = retention.plan();

  assert.equal(plan.deletionEnabled, false);
  assert.equal(plan.deletedRows, 0);
  assert.equal(plan.policies.length, 7);
  assert.equal(plan.policies.find(({ interval }) => interval === "1m").cutoffAt,
    "2025-12-02T00:00:00.000Z");
  assert.equal(plan.policies.find(({ interval }) => interval === "5m").cutoffAt,
    "2025-10-03T00:00:00.000Z");
  assert.equal(plan.policies.find(({ interval }) => interval === "4h").cutoffAt, null);
  assert.equal(DATA_RETENTION_POLICIES.find(({ table }) =>
    table === "AI_Crypto_Bot_AI_Decisions").days, 180);
});
