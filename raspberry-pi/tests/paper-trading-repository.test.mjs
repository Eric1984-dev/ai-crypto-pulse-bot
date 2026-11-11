import assert from "node:assert/strict";
import test from "node:test";
import {
  PaperTradingRepository,
  PAPER_TRADING_RUN_LOCK_ID
} from "../src/repositories/paper-trading-repository.mjs";

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
