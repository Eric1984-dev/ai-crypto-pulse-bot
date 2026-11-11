import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { startRuntime } from "../src/runtime/bootstrap.mjs";
import { readRuntimeConfig } from "../src/config/runtime-config.mjs";

function runtimeConfig() {
  const config = readRuntimeConfig({
    DATABASE_HOST: "127.0.0.1",
    DATABASE_NAME: "cryptopulse",
    DATABASE_USER: "runtime_reader",
    DATABASE_PASSWORD: "test-password",
    DATABASE_SSL: "false",
    INGESTION_DATABASE_USER: "ingestion_writer",
    INGESTION_DATABASE_PASSWORD: "ingestion-password",
    AI_DATABASE_USER: "ai_writer",
    AI_DATABASE_PASSWORD: "ai-password",
    PAPER_DATABASE_USER: "paper_writer",
    PAPER_DATABASE_PASSWORD: "paper-password"
  });
  return Object.freeze({
    ...config,
    api: Object.freeze({ ...config.api, host: "127.0.0.1", port: 0 })
  });
}

class MockPool extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.totalCount = 0;
    this.idleCount = 0;
    this.waitingCount = 0;
    this.ended = false;
    this.statements = [];
    this.status = "IDLE";
  }

  async end() {
    this.ended = true;
  }

  async connect() {
    const pool = this;
    return {
      async query(sql) {
        pool.statements.push(sql);
        if (sql === "BEGIN READ ONLY" || sql === "BEGIN READ WRITE" || sql === "COMMIT") {
          return { rows: [] };
        }
        if (sql.includes("pg_try_advisory_lock")) {
          return { rows: [{ locked: true }] };
        }
        if (sql.includes("pg_advisory_unlock")) {
          return { rows: [{ unlocked: true }] };
        }
        if (sql.includes("AI_Crypto_Bot_Status")) {
          return {
            rows: [{
              status: pool.status,
              is_active: pool.status === "ACTIVE" || pool.status === "ANALYZING",
              is_analyzing: pool.status === "ANALYZING",
              last_run: null
            }]
          };
        }
        return {
          rows: [{
            database_matches: true,
            default_read_only: true,
            transaction_read_only: true
          }]
        };
      },
      release() {}
    };
  }
}

test("runtime starts only after contracts validate and closes cleanly", async () => {
  const pools = [];
  const runtime = await startRuntime(runtimeConfig(), {
    Pool: class extends MockPool {
      constructor(options) {
        super(options);
        pools.push(this);
      }
    },
    validateContracts: async () => ({
      database: "connected",
      contracts: "valid",
      enabledMarkets: 100,
      requiredTables: 18
    }),
    validateIngestionContracts: async () => ({ contracts: "valid" }),
    validateAIContracts: async () => ({ contracts: "valid" }),
    validatePaperContracts: async () => ({ contracts: "valid" })
  });

  try {
    assert.equal(runtime.validation.contracts, "valid");
    const response = await fetch(
      `http://127.0.0.1:${runtime.server.address().port}/api/v1/health/ready`
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      data: { status: "ready" }
    });
    const operational = await fetch(
      `http://127.0.0.1:${runtime.server.address().port}/api/v1/health/operational`
    );
    assert.equal(operational.status, 401);
  } finally {
    await runtime.close();
  }
  assert.ok(pools.length >= 4);
  assert.ok(pools.every((pool) => pool.ended));
});

test("runtime fails closed and releases database resources when validation fails", async () => {
  let pool;
  await assert.rejects(startRuntime(runtimeConfig(), {
    Pool: class extends MockPool {
      constructor(options) {
        super(options);
        pool = this;
      }
    },
    validateContracts: async () => {
      const error = new Error("contract mismatch");
      error.code = "RUNTIME_CONTRACT_INVALID";
      throw error;
    }
  }), { code: "RUNTIME_CONTRACT_INVALID" });

  assert.equal(pool.ended, true);
});

test("runtime startup and shutdown never clear an emergency STOPPED status", async () => {
  const pools = [];
  const runtime = await startRuntime(runtimeConfig(), {
    Pool: class extends MockPool {
      constructor(options) {
        super(options);
        this.status = "STOPPED";
        pools.push(this);
      }
    },
    validateContracts: async () => ({ contracts: "valid" }),
    validateIngestionContracts: async () => ({ contracts: "valid" }),
    validateAIContracts: async () => ({ contracts: "valid" }),
    validatePaperContracts: async () => ({ contracts: "valid" })
  });

  await runtime.close();

  assert.ok(pools.every((pool) =>
    pool.statements.every((sql) => !sql.includes("UPDATE public.\"AI_Crypto_Bot_Status\""))));
});
