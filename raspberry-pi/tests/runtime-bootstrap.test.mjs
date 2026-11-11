import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { startRuntime, validateRuntime } from "../src/runtime/bootstrap.mjs";
import { readRuntimeConfig } from "../src/config/runtime-config.mjs";

function runtimeConfig({ cloudflareAccessEnabled = true } = {}) {
  const config = readRuntimeConfig({
    DATABASE_HOST: "127.0.0.1",
    DATABASE_NAME: "cryptopulse",
    DATABASE_USER: "runtime_reader",
    DATABASE_PASSWORD: "test-password",
    DASHBOARD_USERNAME: "operator",
    DASHBOARD_PASSWORD_HASH: "$2a$10$mqVzXb8xEv/4khOjtskpme6LMSS9d/BQTwDX/LLAm7ig6xKOgptea",
    API_CORS_ORIGINS: "https://dashboard.example.com",
    DATABASE_SSL: "false",
    ...(cloudflareAccessEnabled ? {
      CLOUDFLARE_ACCESS_ENABLED: "true",
      CLOUDFLARE_ACCESS_ISSUER: "https://team.cloudflareaccess.com",
      CLOUDFLARE_ACCESS_AUDIENCE: "runtime-bootstrap-test",
      ALLOWED_OPERATOR_EMAILS: "operator@example.com"
    } : {}),
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
    this.statusUpdates = [];
    this.status = "IDLE";
  }

  async end() {
    this.ended = true;
  }

  async connect() {
    const pool = this;
    return {
      async query(sql, values) {
        pool.statements.push(sql);
        if (sql === "SELECT 1" && pool.failSelectOne) {
          throw Object.assign(new Error("runtime lock connection lost"), {
            code: "ECONNRESET"
          });
        }
        if (sql === "BEGIN READ ONLY" || sql === "BEGIN READ WRITE" || sql === "COMMIT") {
          return { rows: [] };
        }
        if (sql.includes('UPDATE public."AI_Crypto_Bot_Status"')) {
          pool.statusUpdates.push(values?.[0]);
          return { rows: [{ status: values?.[0] }] };
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
        if (sql.includes('FROM public."AI_Crypto_Bot_Watched_Markets"')) {
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

test("runtime protects read-only dashboard APIs with the local session when Cloudflare Access is disabled", async () => {
  const runtime = await startRuntime(runtimeConfig({ cloudflareAccessEnabled: false }), {
    Pool: MockPool,
    validateContracts: async () => ({ contracts: "valid" }),
    validateIngestionContracts: async () => ({ contracts: "valid" }),
    validateAIContracts: async () => ({ contracts: "valid" }),
    validatePaperContracts: async () => ({ contracts: "valid" })
  });
  try {
    const baseUrl = `http://127.0.0.1:${runtime.server.address().port}`;
    const anonymous = await fetch(`${baseUrl}/api/v1/markets`);
    assert.equal(anonymous.status, 401);

    const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        Origin: "https://dashboard.example.com",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ username: "operator", password: "unit-test-password" })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";", 1)[0];
    const markets = await fetch(
      `${baseUrl}/api/v1/markets`,
      { headers: { Cookie: cookie } }
    );
    assert.equal(markets.status, 200);
    assert.deepEqual(await markets.json(), { data: { count: 0, items: [] } });
  } finally {
    await runtime.close();
  }
});

test("runtime preflight validates successfully when Cloudflare Access is disabled", async () => {
  let pool;
  const result = await validateRuntime(runtimeConfig({ cloudflareAccessEnabled: false }), {
    Pool: class extends MockPool {
      constructor(options) {
        super(options);
        pool = this;
      }
    },
    validateContracts: async () => ({ contracts: "valid" })
  });
  assert.deepEqual(result, { contracts: "valid" });
  assert.equal(pool.ended, true);
});

test("healthy runtime startup reports ACTIVE while waiting for the first scheduled cycle", async () => {
  const pools = [];
  const runtime = await startRuntime(runtimeConfig(), {
    Pool: class extends MockPool {
      constructor(options) {
        super(options);
        pools.push(this);
      }
    },
    validateContracts: async () => ({ contracts: "valid" }),
    validateIngestionContracts: async () => ({ contracts: "valid" }),
    validateAIContracts: async () => ({ contracts: "valid" }),
    validatePaperContracts: async () => ({ contracts: "valid" })
  });

  assert.ok(pools.some((pool) => pool.statusUpdates[0] === "ACTIVE"));
  await runtime.close();
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
