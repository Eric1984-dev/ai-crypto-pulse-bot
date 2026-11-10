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
    DATABASE_SSL: "false"
  });
  return Object.freeze({
    ...config,
    api: Object.freeze({ host: "127.0.0.1", port: 0 })
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
  }

  async end() {
    this.ended = true;
  }

  async connect() {
    return {
      async query(sql) {
        if (sql === "BEGIN READ ONLY" || sql === "COMMIT") {
          return { rows: [] };
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
  let pool;
  const runtime = await startRuntime(runtimeConfig(), {
    Pool: class extends MockPool {
      constructor(options) {
        super(options);
        pool = this;
      }
    },
    validateContracts: async () => ({
      database: "connected",
      contracts: "valid",
      enabledMarkets: 100,
      requiredTables: 18
    })
  });

  try {
    assert.equal(runtime.validation.contracts, "valid");
    const response = await fetch(
      `http://127.0.0.1:${runtime.server.address().port}/api/v1/health/ready`
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      data: {
        status: "ready",
        database: "available",
        contracts: "valid",
        enabledMarkets: 100
      }
    });
  } finally {
    await runtime.close();
  }
  assert.equal(pool.ended, true);
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
