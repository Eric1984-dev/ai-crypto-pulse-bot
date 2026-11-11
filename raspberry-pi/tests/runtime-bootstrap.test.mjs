import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { startRuntime, validateRuntime } from "../src/runtime/bootstrap.mjs";
import { readRuntimeConfig } from "../src/config/runtime-config.mjs";

function runtimeConfig() {
  const config = readRuntimeConfig({
    DATABASE_HOST: "127.0.0.1",
    DATABASE_NAME: "cryptopulse",
    DATABASE_USER: "runtime_reader",
    DATABASE_PASSWORD: "test-password",
    DATABASE_SSL: "false",
    CLOUDFLARE_ACCESS_ENABLED: "true",
    CLOUDFLARE_ACCESS_ISSUER: "https://team.cloudflareaccess.com",
    CLOUDFLARE_ACCESS_AUDIENCE: "runtime-bootstrap-test",
    ALLOWED_OPERATOR_EMAILS: "operator@example.com",
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
        if (sql === "SELECT 1" && pool.failSelectOne) {
          throw Object.assign(new Error("runtime lock connection lost"), {
            code: "ECONNRESET"
          });
        }
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

test("runtime refuses to start before opening the database if Cloudflare Access is disabled", async () => {
  const config = runtimeConfig();
  const unauthenticatedConfig = Object.freeze({
    ...config,
    api: Object.freeze({
      ...config.api,
      cloudflareAccess: Object.freeze({
        ...config.api.cloudflareAccess,
        enabled: false
      })
    })
  });
  let poolCreated = false;
  await assert.rejects(startRuntime(unauthenticatedConfig, {
    Pool: class {
      constructor() {
        poolCreated = true;
      }
    }
  }), (error) => error.code === "CLOUDFLARE_ACCESS_REQUIRED"
    && /Cloudflare Access authentication/.test(error.message));
  assert.equal(poolCreated, false);
});

test("runtime preflight refuses to validate production readiness without Cloudflare Access", async () => {
  const config = runtimeConfig();
  const unauthenticatedConfig = Object.freeze({
    ...config,
    api: Object.freeze({
      ...config.api,
      cloudflareAccess: Object.freeze({
        ...config.api.cloudflareAccess,
        enabled: false
      })
    })
  });
  let poolCreated = false;
  await assert.rejects(validateRuntime(unauthenticatedConfig, {
    Pool: class {
      constructor() {
        poolCreated = true;
      }
    }
  }), (error) => error.code === "CLOUDFLARE_ACCESS_REQUIRED");
  assert.equal(poolCreated, false);
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

test("runtime marks interrupted ACTIVE work as ERROR after a restart", async () => {
  const pools = [];
  const runtime = await startRuntime(runtimeConfig(), {
    Pool: class extends MockPool {
      constructor(options) {
        super(options);
        this.status = "ACTIVE";
        pools.push(this);
      }
    },
    validateContracts: async () => ({ contracts: "valid" }),
    validateIngestionContracts: async () => ({ contracts: "valid" }),
    validateAIContracts: async () => ({ contracts: "valid" }),
    validatePaperContracts: async () => ({ contracts: "valid" })
  });

  await runtime.close();

  assert.ok(pools.some((pool) =>
    pool.statements.some((sql) => sql.includes('UPDATE public."AI_Crypto_Bot_Status"'))));
});

test("runtime reports lock loss as fatal so the process can restart", async () => {
  const pools = [];
  let scheduledTimer;
  let fatalCode;
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, delay) => {
    scheduledTimer = { callback, delay, unref() {} };
    return scheduledTimer;
  };
  let runtime;
  try {
    runtime = await startRuntime(runtimeConfig(), {
      Pool: class extends MockPool {
        constructor(options) {
          super(options);
          pools.push(this);
        }
      },
      validateContracts: async () => ({ contracts: "valid" }),
      validateIngestionContracts: async () => ({ contracts: "valid" }),
      validateAIContracts: async () => ({ contracts: "valid" }),
      validatePaperContracts: async () => ({ contracts: "valid" }),
      onFatal(error) {
        fatalCode = error.code;
      }
    });
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }

  try {
    pools[0].failSelectOne = true;
    scheduledTimer.callback();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(fatalCode, "RUNTIME_OWNERSHIP_LOCK_LOST");
  } finally {
    await runtime.close();
  }
});
