import test from "node:test";
import assert from "node:assert/strict";
import {
  MarketIngestionRepository
} from "../src/repositories/market-ingestion-repository.mjs";
import { withWriteTransaction } from "../src/database/write-transaction.mjs";

const logger = { error() {} };

function createPool({ query } = {}) {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (query) {
        return query(sql, values);
      }
      return { rows: [], rowCount: 1 };
    },
    release(error) {
      calls.push({ sql: "RELEASE", values: error ? [error.code] : [] });
    }
  };
  return {
    calls,
    async connect() {
      return client;
    }
  };
}

function snapshot(symbol = "BTC-EUR") {
  return {
    symbol,
    price: 100,
    volume: 3,
    daily_change: 2,
    high_24h: 110,
    low_24h: 90,
    captured_at: "2026-11-10T12:00:00.000Z"
  };
}

function candle(symbol = "BTC-EUR", timestamp = "2026-11-10T12:00:00.000Z") {
  return {
    symbol,
    interval: "1m",
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: 3,
    timestamp
  };
}

test("write transactions explicitly enable writes, commit success, and roll back failures", async () => {
  const successPool = createPool();
  await withWriteTransaction(successPool, async (client) => {
    await client.query("SELECT 1");
  }, { logger });
  assert.equal(successPool.calls[0].sql, "BEGIN READ WRITE");
  assert.equal(successPool.calls.at(-1).sql, "RELEASE");
  assert.ok(successPool.calls.some(({ sql }) => sql === "COMMIT"));

  const failurePool = createPool({
    query: async (sql) => {
      if (sql === "SELECT 1") {
        throw Object.assign(new Error("failure"), { code: "XX000" });
      }
      return { rows: [], rowCount: 0 };
    }
  });
  await assert.rejects(withWriteTransaction(failurePool, (client) => client.query("SELECT 1"), { logger }));
  assert.ok(failurePool.calls.some(({ sql }) => sql === "ROLLBACK"));
});

test("candle checkpoint reads are bounded, parameterized, and accept missing history", async () => {
  const pool = createPool({
    query: async (sql, values) => ({
      rows: [{ symbol: "BTC-EUR", latest_timestamp: new Date("2026-11-10T12:00:00Z") }],
      rowCount: 1
    })
  });
  const repository = new MarketIngestionRepository(pool, { logger });
  const checkpoints = await repository.getLatestCandleCheckpoints(
    ["BTC-EUR", "ETH-EUR"],
    "1m"
  );
  assert.equal(checkpoints.get("BTC-EUR"), Date.parse("2026-11-10T12:00:00Z"));
  assert.equal(checkpoints.has("ETH-EUR"), false);
  const query = pool.calls.find(({ sql }) => sql.includes("MAX(candle.\"timestamp\")"));
  assert.deepEqual(query.values, [["BTC-EUR", "ETH-EUR"], "1m"]);
  assert.match(query.sql, /WHERE candle\.symbol = ANY\(\$1::text\[\]\)/);
  assert.match(query.sql, /candle\.interval = \$2/);
  assert.doesNotMatch(query.sql, /SELECT\s+\*/i);
});

test("snapshot persistence uses explicit columns and the existing symbol key", async () => {
  const pool = createPool();
  const repository = new MarketIngestionRepository(pool, { logger });
  assert.equal(await repository.upsertSnapshots([snapshot()]), 1);

  const query = pool.calls.find(({ sql }) => sql.startsWith("\n  INSERT INTO"));
  assert.match(query.sql, /AI_Crypto_Bot_Market_Data/);
  assert.match(query.sql, /ON CONFLICT \(symbol\) DO UPDATE/);
  assert.match(query.sql, /\(symbol, price, volume, daily_change, high_24h, low_24h, captured_at\)/);
  assert.equal(query.values[0], "BTC-EUR");
  assert.doesNotMatch(query.sql, /BTC-EUR/);
});

test("snapshot persistence falls back safely when the legacy unique constraint is absent", async () => {
  let rejectedConflictTarget = false;
  const pool = createPool({
    query: async (sql) => {
      if (sql.includes("ON CONFLICT (symbol)")) {
        rejectedConflictTarget = true;
        throw Object.assign(new Error("missing unique key"), { code: "42P10" });
      }
      if (sql.includes("LOCK TABLE")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("\n    UPDATE")) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("\n    INSERT")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    }
  });
  const repository = new MarketIngestionRepository(pool, { logger });
  assert.equal(await repository.upsertSnapshots([snapshot()]), 1);
  assert.equal(rejectedConflictTarget, true);
  assert.ok(pool.calls.some(({ sql }) => sql.includes("LOCK TABLE")
    && sql.includes("SHARE ROW EXCLUSIVE MODE")));
  assert.ok(pool.calls.some(({ sql }) => sql.includes("WHERE NOT EXISTS")));
  assert.ok(pool.calls.filter(({ sql }) => sql === "BEGIN READ WRITE").length === 2);
});

test("candle persistence is idempotent and splits a market response into bounded writes", async () => {
  const pool = createPool();
  const repository = new MarketIngestionRepository(pool, { logger });
  const candles = Array.from({ length: 205 }, (_, index) =>
    candle("BTC-EUR", new Date(Date.parse("2026-11-10T12:00:00Z") + index * 60000).toISOString()));

  assert.equal(await repository.upsertCandles(candles), 3);
  const writes = pool.calls.filter(({ sql }) => sql.includes("ON CONFLICT (symbol, interval, \"timestamp\")"));
  assert.equal(writes.length, 3);
  assert.deepEqual(writes.map(({ values }) => values.length), [800, 800, 40]);
  assert.ok(writes.every(({ sql }) => /DO UPDATE/.test(sql)));
});

test("duplicate candle inputs are rejected before any database connection", async () => {
  const pool = createPool();
  const repository = new MarketIngestionRepository(pool, { logger });

  await assert.rejects(repository.upsertCandles([candle(), candle()]), {
    code: "INVALID_STORED_DATA"
  });
  assert.equal(pool.calls.length, 0);
});

test("scanner event inserts are bounded and use only explicit event columns", async () => {
  const pool = createPool();
  const repository = new MarketIngestionRepository(pool, { logger });
  assert.equal(await repository.insertScannerEvents([{
    symbol: "BTC-EUR",
    event_type: "CANDLE_DATA_MISSING",
    reason: "No valid candles were returned."
  }]), 1);

  const query = pool.calls.find(({ sql }) => sql.includes("AI_Crypto_Bot_Scanner_Events"));
  assert.match(query.sql, /\(symbol, event_type, reason\)/);
  assert.deepEqual(query.values, [
    "BTC-EUR",
    "CANDLE_DATA_MISSING",
    "No valid candles were returned."
  ]);
});
