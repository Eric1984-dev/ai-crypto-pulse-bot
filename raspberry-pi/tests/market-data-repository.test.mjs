import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { MarketDataRepository } from "../src/repositories/market-data-repository.mjs";

test("recent candle reads return only the newest bounded rows for enabled requested markets", async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE TABLE public."AI_Crypto_Bot_Watched_Markets" (
        symbol text PRIMARY KEY,
        enabled boolean NOT NULL
      );
      CREATE TABLE public."AI_Crypto_Bot_Candles" (
        symbol text NOT NULL,
        interval text NOT NULL,
        open numeric NOT NULL,
        high numeric NOT NULL,
        low numeric NOT NULL,
        close numeric NOT NULL,
        volume numeric NOT NULL,
        "timestamp" timestamptz NOT NULL
      );
      CREATE UNIQUE INDEX "AI_Crypto_Bot_Candles_symbol_interval_timestamp_key"
        ON public."AI_Crypto_Bot_Candles" (symbol, interval, "timestamp");
      INSERT INTO public."AI_Crypto_Bot_Watched_Markets" (symbol, enabled)
      VALUES
        ('BTC-EUR', TRUE),
        ('ETH-EUR', TRUE),
        ('SOL-EUR', TRUE),
        ('DOGE-EUR', FALSE),
        ('ADA-EUR', TRUE);
      INSERT INTO public."AI_Crypto_Bot_Candles"
        (symbol, interval, open, high, low, close, volume, "timestamp")
      SELECT 'BTC-EUR', '1d', 100 + candle_index, 102 + candle_index,
             98 + candle_index, 101 + candle_index, 5,
             '2026-11-01T00:00:00Z'::timestamptz + candle_index * INTERVAL '1 day'
      FROM generate_series(0, 39) AS series(candle_index);
      INSERT INTO public."AI_Crypto_Bot_Candles"
        (symbol, interval, open, high, low, close, volume, "timestamp")
      SELECT 'ETH-EUR', '1d', 100 + candle_index, 102 + candle_index,
             98 + candle_index, 101 + candle_index, 5,
             '2026-11-01T00:00:00Z'::timestamptz + candle_index * INTERVAL '1 day'
      FROM generate_series(0, 14) AS series(candle_index);
      INSERT INTO public."AI_Crypto_Bot_Candles"
        (symbol, interval, open, high, low, close, volume, "timestamp")
      SELECT 'SOL-EUR', '1d', 100 + candle_index, 102 + candle_index,
             98 + candle_index, 101 + candle_index, 5,
             '2026-11-01T00:00:00Z'::timestamptz + candle_index * INTERVAL '1 day'
      FROM generate_series(0, 4) AS series(candle_index);
      INSERT INTO public."AI_Crypto_Bot_Candles"
        (symbol, interval, open, high, low, close, volume, "timestamp")
      SELECT 'DOGE-EUR', '1d', 100 + candle_index, 102 + candle_index,
             98 + candle_index, 101 + candle_index, 5,
             '2026-11-01T00:00:00Z'::timestamptz + candle_index * INTERVAL '1 day'
      FROM generate_series(0, 39) AS series(candle_index);
      INSERT INTO public."AI_Crypto_Bot_Candles"
        (symbol, interval, open, high, low, close, volume, "timestamp")
      VALUES ('BTC-EUR', '1h', 100, 102, 98, 101, 5, '2026-12-31T00:00:00Z');
    `);
    const repository = new MarketDataRepository({
      async connect() {
        return {
          query: (sql, values) => database.query(sql, values),
          release() {}
        };
      }
    }, { logger: { error() {} } });

    const candles = await repository.listRecentCandlesForEnabledMarkets([
      { symbol: "BTC-EUR" },
      { symbol: "DOGE-EUR" },
      { symbol: "ADA-EUR" },
      { symbol: "ETH-EUR" },
      { symbol: "BTC-EUR" },
      { symbol: "SOL-EUR" }
    ], "1d", { perMarket: 12 });

    assert.equal(candles.length, 29);
    assert.deepEqual(
      [...new Set(candles.map(({ symbol }) => symbol))],
      ["BTC-EUR", "ETH-EUR", "SOL-EUR"]
    );
    assert.deepEqual(
      candles.filter(({ symbol }) => symbol === "BTC-EUR").map(({ timestamp }) => timestamp),
      Array.from({ length: 12 }, (_, index) =>
        new Date(Date.parse("2026-11-01T00:00:00Z") + (index + 28) * 86400000).toISOString())
    );
    assert.deepEqual(
      candles.filter(({ symbol }) => symbol === "ETH-EUR").map(({ timestamp }) => timestamp),
      Array.from({ length: 12 }, (_, index) =>
        new Date(Date.parse("2026-11-01T00:00:00Z") + (index + 3) * 86400000).toISOString())
    );
    assert.equal(candles.filter(({ symbol }) => symbol === "SOL-EUR").length, 5);
    assert.ok(candles.every(({ interval }) => interval === "1d"));
  } finally {
    await database.close();
  }
});
