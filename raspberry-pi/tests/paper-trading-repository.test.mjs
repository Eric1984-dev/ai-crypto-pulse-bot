import assert from "node:assert/strict";
import test from "node:test";
import {
  PaperTradingRepository,
  PAPER_TRADING_RUN_LOCK_ID,
  SYSTEM_PROFILE_ID
} from "../src/repositories/paper-trading-repository.mjs";

test("paper repository only reads the explicitly provisioned system portfolio", async () => {
  const statements = [];
  const repository = new PaperTradingRepository({
    connect: async () => ({
      query: async () => ({ rows: [] }),
      release() {}
    })
  });
  const client = {
    async query(sql, values) {
      statements.push({ sql, values });
      if (sql.includes("AI_Crypto_Bot_Profiles")) {
        return { rows: [{ id: SYSTEM_PROFILE_ID }] };
      }
      return {
        rows: [{
          id: "00000000-0000-4000-8000-000000000001",
          user_id: SYSTEM_PROFILE_ID,
          starting_balance: "10000",
          available_balance: "9900",
          portfolio_value: "10000"
        }]
      };
    }
  };

  const account = await repository.getSystemPortfolio(client);

  assert.equal(account.status, "READY");
  assert.equal(account.portfolio.available_balance, "9900");
  assert.equal(statements.length, 2);
  assert.deepEqual(statements.map(({ values }) => values), [
    [SYSTEM_PROFILE_ID],
    [SYSTEM_PROFILE_ID]
  ]);
  assert.ok(statements.every(({ sql }) => /^\s*SELECT/i.test(sql)));
  assert.ok(statements[1].sql.includes("FOR UPDATE"));
});

test("paper repository reports missing profile and portfolio without writes", async () => {
  const repository = new PaperTradingRepository({
    connect: async () => ({
      query: async () => ({ rows: [] }),
      release() {}
    })
  });
  let queryCount = 0;
  const missingProfile = await repository.getSystemPortfolio({
    async query() {
      queryCount += 1;
      return { rows: [] };
    }
  });
  assert.deepEqual(missingProfile, { status: "PROFILE_MISSING" });
  assert.equal(queryCount, 1);

  const missingPortfolio = await repository.getSystemPortfolio({
    async query(sql) {
      queryCount += 1;
      return sql.includes("AI_Crypto_Bot_Profiles")
        ? { rows: [{ id: SYSTEM_PROFILE_ID }] }
        : { rows: [] };
    }
  });
  assert.deepEqual(missingPortfolio, { status: "PORTFOLIO_MISSING" });
  assert.equal(queryCount, 3);
});

test("paper repository rejects multiple system portfolios", async () => {
  const repository = new PaperTradingRepository({
    connect: async () => ({
      query: async () => ({ rows: [] }),
      release() {}
    })
  });

  await assert.rejects(repository.getSystemPortfolio({
    async query(sql) {
      return sql.includes("AI_Crypto_Bot_Profiles")
        ? { rows: [{ id: SYSTEM_PROFILE_ID }] }
        : {
          rows: [
            {
              id: "00000000-0000-4000-8000-000000000001",
              user_id: SYSTEM_PROFILE_ID,
              starting_balance: "10000",
              available_balance: "10000",
              portfolio_value: "10000"
            },
            {
              id: "00000000-0000-4000-8000-000000000002",
              user_id: SYSTEM_PROFILE_ID,
              starting_balance: "10000",
              available_balance: "10000",
              portfolio_value: "10000"
            }
          ]
        };
    }
  }), { code: "PAPER_TRADING_SYSTEM_PORTFOLIO_INVALID" });
});

test("paper repository uses direct parameterized SQL for position aggregation", async () => {
  let captured;
  const repository = new PaperTradingRepository({
    connect: async () => ({
      query: async () => ({ rows: [] }),
      release() {}
    })
  });
  const client = {
    async query(sql, values) {
      captured = { sql, values };
      return { rows: [{ amount: "2.000000000000", entry_cost_basis: "200.000000000000" }] };
    }
  };

  const totals = await repository.getOpenPositionTotals(
    client,
    "00000000-0000-4000-8000-000000000001",
    "BTC-EUR"
  );

  assert.equal(totals.amount, "2.000000000000");
  assert.equal(totals.entryCostBasis, "200.000000000000");
  assert.match(captured.sql, /SUM\(position\.entry_price \* position\.amount\)/i);
  assert.deepEqual(captured.values, [
    "00000000-0000-4000-8000-000000000001",
    "BTC-EUR"
  ]);
});

test("paper repository acquires its transaction lock and status updates use distinct helpers", async () => {
  const statements = [];
  const client = {
    async query(sql, values) {
      statements.push({ sql, values });
      if (sql.includes("pg_try_advisory_xact_lock")) {
        return { rows: [{ locked: true }] };
      }
      if (sql.includes("AI_Crypto_Bot_Status") && sql.trimStart().startsWith("SELECT")) {
        return {
          rows: [{
            status: "ACTIVE",
            is_active: true,
            is_analyzing: false,
            last_run: null
          }]
        };
      }
      if (sql.includes("UPDATE public.\"AI_Crypto_Bot_Status\"")) {
        return { rows: [{ status: values[0] }] };
      }
      return { rows: [] };
    },
    release() {}
  };
  const repository = new PaperTradingRepository({
    connect: async () => client
  });

  assert.equal(await repository.withTransaction(async (transaction) => {
    assert.equal(await repository.tryAcquireRunLock(transaction), true);
    return repository.updateStatusInTransaction(transaction, {
      status: "IDLE",
      updatedAt: new Date("2026-01-01T00:00:00.000Z")
    });
  }), "IDLE");

  assert.equal(statements[1].values[0], PAPER_TRADING_RUN_LOCK_ID);
  assert.ok(statements.some(({ sql }) => sql.includes("UPDATE public.\"AI_Crypto_Bot_Status\"")));
  assert.equal(statements.at(-1).sql, "COMMIT");
});

test("paper repository attaches emergency-state SELECT context to SQLSTATE errors", async () => {
  const denied = Object.assign(
    new Error('permission denied for table "AI_Crypto_Bot_Emergency_State"'),
    { code: "42501" }
  );
  const client = {
    async query(sql) {
      if (sql.includes("AI_Crypto_Bot_Emergency_State")) {
        throw denied;
      }
      return { rows: [] };
    },
    release() {}
  };
  const repository = new PaperTradingRepository({
    connect: async () => client
  });

  await assert.rejects(
    repository.withTransaction((transaction) =>
      repository.getLatestEmergencyStatus(transaction)),
    (error) => {
      assert.equal(error.code, "42501");
      assert.deepEqual(error.paperTradingContext, {
        table: "AI_Crypto_Bot_Emergency_State",
        operation: "SELECT",
        requiredPrivilege: "SELECT",
        repositoryOperation: "getLatestEmergencyStatus"
      });
      return true;
    }
  );
});

test("paper repository reads emergency state without an UPDATE-dependent row lock", async () => {
  let capturedSql;
  const repository = new PaperTradingRepository({
    async connect() {
      return { async query() { return { rows: [] }; }, release() {} };
    }
  });

  assert.equal(await repository.getLatestEmergencyStatus({
    async query(sql) {
      capturedSql = sql;
      return { rows: [] };
    }
  }), "NORMAL");
  assert.match(capturedSql, /FROM public\."AI_Crypto_Bot_Emergency_State"/);
  assert.doesNotMatch(capturedSql, /FOR\s+UPDATE/i);
});

test("paper repository fails closed on malformed agent status", async () => {
  const repository = new PaperTradingRepository({
    async query() {
      return { rows: [{ status: "UNKNOWN", is_active: false, is_analyzing: false }] };
    },
    async connect() {
      return {
        async query() {
          return { rows: [{ status: "UNKNOWN", is_active: false, is_analyzing: false }] };
        },
        release() {}
      };
    }
  });

  await assert.rejects(repository.getAgentStatus({
    query: async () => ({
      rows: [{ status: "UNKNOWN", is_active: false, is_analyzing: false }]
    })
  }), { code: "PAPER_TRADING_STATUS_INVALID" });
});
