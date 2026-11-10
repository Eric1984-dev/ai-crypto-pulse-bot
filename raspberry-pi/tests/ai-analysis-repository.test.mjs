import test from "node:test";
import assert from "node:assert/strict";
import {
  AI_DECISION_WRITE_BATCH_SIZE,
  AiAnalysisRepository
} from "../src/repositories/ai-analysis-repository.mjs";

const logger = { error() {} };

function createPool({ query } = {}) {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (query) {
        return query(sql, values);
      }
      return { rows: [], rowCount: 0 };
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

function decision(index = 1) {
  return {
    id: `00000000-0000-8000-8000-${String(index).padStart(12, "0")}`,
    symbol: "BTC-EUR",
    interval: "1d",
    decision: "BUY",
    confidence: 75.25,
    indicators: {
      interval: "1d",
      timeframes: { "1d": { trend: { direction: "bullish" } } }
    },
    reason: "Daily trend and confirmation are positive.",
    timestamp: "2026-03-20T12:00:00.000Z",
    strategy_name: "Deterministic Technical Analysis V2",
    strategy_version: "2.0.0"
  };
}

test("AI reads use bounded parameterized queries with explicit source columns", async () => {
  const pool = createPool({
    query: async (sql, values) => {
      if (sql.includes('FROM public."AI_Crypto_Bot_Watched_Markets" AS watched_market')) {
        return { rows: [{ symbol: "BTC-EUR", price: "100" }] };
      }
      if (sql.includes('FROM unnest($1::text[])')) {
        return { rows: [{ symbol: "BTC-EUR", interval: "1m", close: "100" }] };
      }
      return { rows: [] };
    }
  });
  const repository = new AiAnalysisRepository(pool, { logger });

  const snapshots = await repository.listSnapshots(["BTC-EUR"]);
  const candles = await repository.listLatestCandles(["BTC-EUR"], "1m");
  const snapshotQuery = pool.calls.find(({ sql }) =>
    sql.includes('FROM public."AI_Crypto_Bot_Watched_Markets" AS watched_market'));
  const candleQuery = pool.calls.find(({ sql }) => sql.includes("FROM unnest($1::text[])"));

  assert.equal(snapshots.length, 1);
  assert.equal(candles.length, 1);
  assert.deepEqual(snapshotQuery.values, [["BTC-EUR"], 500]);
  assert.deepEqual(candleQuery.values, [["BTC-EUR"], "1m", 150]);
  assert.match(snapshotQuery.sql, /watched_market\.enabled IS TRUE/);
  assert.match(candleQuery.sql, /stored_candle\."timestamp" DESC/);
  assert.match(candleQuery.sql, /LIMIT \$3/);
  assert.ok(pool.calls.every(({ sql }) => !/SELECT\s+\*/i.test(sql)));
});

test("AI decision writes use one bounded transaction and the existing primary key", async () => {
  const input = [decision(1)];
  const pool = createPool({
    query: async (sql, values) => {
      if (sql.includes('INSERT INTO public."AI_Crypto_Bot_AI_Decisions"')) {
        return { rows: [{ id: values[0] }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
  });
  const repository = new AiAnalysisRepository(pool, { logger });

  assert.deepEqual(await repository.insertDecisions(input), { stored: 1, duplicates: 0 });
  const insert = pool.calls.find(({ sql }) =>
    sql.includes('INSERT INTO public."AI_Crypto_Bot_AI_Decisions"'));
  assert.ok(pool.calls.some(({ sql }) => sql === "BEGIN READ WRITE"));
  assert.ok(pool.calls.some(({ sql }) => sql === "COMMIT"));
  assert.match(insert.sql, /\(id, symbol, decision, confidence, indicators, reason,/);
  assert.match(insert.sql, /strategy_name, strategy_version, created_at\)/);
  assert.match(insert.sql, /ON CONFLICT \(id\) DO NOTHING/);
  assert.doesNotMatch(insert.sql, /DO UPDATE|interval,/i);
  assert.equal(insert.values[0], input[0].id);
  assert.equal(insert.values[4], JSON.stringify(input[0].indicators));
  assert.equal(insert.values[8], input[0].timestamp);
  assert.doesNotMatch(insert.sql, /BTC-EUR|Daily trend/);
});

test("decision primary-key conflicts are accepted only for identical payloads", async () => {
  const original = decision(7);
  const pool = createPool({
    query: async (sql) => {
      if (sql.includes('INSERT INTO public."AI_Crypto_Bot_AI_Decisions"')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('FROM public."AI_Crypto_Bot_AI_Decisions"')) {
        return {
          rows: [{
            id: original.id,
            symbol: original.symbol,
            decision: original.decision,
            confidence: String(original.confidence),
            indicators: original.indicators,
            reason: original.reason,
            strategy_name: original.strategy_name,
            strategy_version: original.strategy_version
          }]
        };
      }
      return { rows: [], rowCount: 0 };
    }
  });
  const repository = new AiAnalysisRepository(pool, { logger });

  assert.deepEqual(await repository.insertDecisions([original]), { stored: 0, duplicates: 1 });
  const select = pool.calls.find(({ sql }) =>
    sql.includes('FROM public."AI_Crypto_Bot_AI_Decisions"'));
  assert.deepEqual(select.values, [[original.id]]);
  assert.match(select.sql, /id = ANY\(\$1::uuid\[\]\)/);
});

test("decision ID conflicts with a changed payload fail and roll back", async () => {
  const original = decision(8);
  const changed = { ...original, reason: "Different analysis result." };
  const pool = createPool({
    query: async (sql) => {
      if (sql.includes('INSERT INTO public."AI_Crypto_Bot_AI_Decisions"')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('FROM public."AI_Crypto_Bot_AI_Decisions"')) {
        return {
          rows: [{
            id: original.id,
            symbol: original.symbol,
            decision: original.decision,
            confidence: original.confidence,
            indicators: original.indicators,
            reason: original.reason,
            strategy_name: original.strategy_name,
            strategy_version: original.strategy_version
          }]
        };
      }
      return { rows: [], rowCount: 0 };
    }
  });
  const repository = new AiAnalysisRepository(pool, { logger });

  await assert.rejects(repository.insertDecisions([changed]), {
    code: "AI_DECISION_ID_COLLISION"
  });
  assert.ok(pool.calls.some(({ sql }) => sql === "ROLLBACK"));
  assert.ok(!pool.calls.some(({ sql }) => sql === "COMMIT"));
});

test("AI decision persistence splits writes into bounded batches", async () => {
  const decisions = Array.from({ length: AI_DECISION_WRITE_BATCH_SIZE + 1 }, (_, index) =>
    ({ ...decision(index + 20), symbol: `MARKET${index}-EUR` }));
  const pool = createPool({
    query: async (sql, values) => {
      if (sql.includes('INSERT INTO public."AI_Crypto_Bot_AI_Decisions"')) {
        return {
          rows: values.filter((_, index) => index % 9 === 0).map((id) => ({ id })),
          rowCount: values.length / 9
        };
      }
      return { rows: [], rowCount: 0 };
    }
  });
  const repository = new AiAnalysisRepository(pool, { logger });

  assert.deepEqual(await repository.insertDecisions(decisions), {
    stored: decisions.length,
    duplicates: 0
  });
  const writes = pool.calls.filter(({ sql }) =>
    sql.includes('INSERT INTO public."AI_Crypto_Bot_AI_Decisions"'));
  assert.equal(writes.length, 2);
  assert.deepEqual(writes.map(({ values }) => values.length), [
    AI_DECISION_WRITE_BATCH_SIZE * 9,
    9
  ]);
});

test("invalid AI decision input is rejected before opening a database transaction", async () => {
  const pool = createPool();
  const repository = new AiAnalysisRepository(pool, { logger });
  await assert.rejects(repository.insertDecisions([{ ...decision(), interval: "5m" }]), {
    code: "INVALID_STORED_DATA"
  });
  await assert.rejects(repository.insertDecisions([decision(1), decision(2)]), {
    code: "INVALID_STORED_DATA"
  });
  await assert.rejects(repository.listLatestCandles(["BTC-EUR"], "2h"), /supported AI analysis interval/);
  assert.equal(pool.calls.length, 0);
});
