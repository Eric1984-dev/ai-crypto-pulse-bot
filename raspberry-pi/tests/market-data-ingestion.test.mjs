import test from "node:test";
import assert from "node:assert/strict";
import {
  BitvavoProviderError
} from "../src/services/bitvavo-public-client.mjs";
import {
  createMarketDataIngestionService,
  parseCandleRows,
  parseTickerSnapshot,
  SUPPORTED_INGESTION_INTERVALS
} from "../src/services/market-data-ingestion.mjs";

const now = new Date("2026-11-10T12:00:00.000Z");
const nowMs = now.getTime();
const logger = { info() {}, error() {} };
const INTERVAL_MS = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000
};

function watchedMarkets(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`,
    symbol: `MKT${String(index).padStart(3, "0")}-EUR`,
    enabled: true,
    priority: index + 1
  }));
}

function ticker(market) {
  return {
    market,
    open: "100",
    last: "105",
    high: "110",
    low: "90",
    volume: "10"
  };
}

function rawCandle(interval, timestamp = Math.floor(nowMs / INTERVAL_MS[interval]) * INTERVAL_MS[interval]) {
  return [timestamp, "100", "110", "90", "105", "4"];
}

function createHarness({
  markets = watchedMarkets(2),
  checkpoints = new Map(),
  tickers = markets.map(({ symbol }) => ticker(symbol)),
  fetchCandles,
  failSnapshotWriteFor,
  loggerOverride = logger
} = {}) {
  const calls = {
    marketReads: 0,
    snapshots: [],
    snapshotBatches: [],
    candles: [],
    events: [],
    candleRequests: []
  };
  const watchedMarketsRepository = {
    async listEnabled() {
      calls.marketReads += 1;
      return markets;
    }
  };
  const ingestionRepository = {
    async getLatestCandleCheckpoints(symbols, interval) {
      assert.ok(symbols.length <= 5);
      return new Map(symbols
        .filter((symbol) => checkpoints.has(`${symbol}:${interval}`))
        .map((symbol) => [symbol, checkpoints.get(`${symbol}:${interval}`)]));
    },
    async upsertSnapshots(rows) {
      if (failSnapshotWriteFor && rows.some(({ symbol }) => symbol === failSnapshotWriteFor)) {
        throw Object.assign(new Error("constraint failure"), { code: "23514" });
      }
      calls.snapshotBatches.push(rows.length);
      calls.snapshots.push(...rows);
      return rows.length;
    },
    async upsertCandles(rows) {
      calls.candles.push(...rows);
      return rows.length;
    },
    async insertScannerEvents(events) {
      calls.events.push(...events);
      return events.length;
    }
  };
  const bitvavoClient = {
    async fetchTickers() {
      return tickers;
    },
    async fetchCandles(symbol, interval, options) {
      calls.candleRequests.push({ symbol, interval, ...options });
      if (fetchCandles) {
        return fetchCandles(symbol, interval, options, calls);
      }
      return [rawCandle(interval)];
    }
  };
  const service = createMarketDataIngestionService({
    watchedMarketsRepository,
    ingestionRepository,
    bitvavoClient,
    now: () => now,
    logger: loggerOverride
  });
  return { service, calls };
}

test("full 102-market ingestion completes every snapshot and interval batch with bounded concurrency", async () => {
  const markets = watchedMarkets(102);
  let activeRequests = 0;
  let maximumConcurrentRequests = 0;
  const harness = createHarness({
    markets,
    fetchCandles: async (symbol, interval) => {
      activeRequests += 1;
      maximumConcurrentRequests = Math.max(maximumConcurrentRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 1));
      activeRequests -= 1;
      return [rawCandle(interval)];
    }
  });

  const result = await harness.service.run();

  assert.equal(result.status, "completed");
  assert.equal(result.markets, 102);
  assert.equal(result.batchSize, 5);
  assert.equal(result.batchCount, 21);
  assert.equal(result.snapshots.persisted, 102);
  assert.equal(harness.calls.marketReads, 1);
  assert.equal(harness.calls.snapshots.length, 102);
  assert.equal(harness.calls.snapshotBatches.length, 21);
  assert.ok(harness.calls.snapshotBatches.every((size) => size <= 5));
  assert.equal(harness.calls.candleRequests.length, 102 * 6);
  assert.equal(harness.calls.candles.length, 102 * 6);
  assert.equal(maximumConcurrentRequests, 4);
  assert.deepEqual(result.candles.map(({ interval, batchCount, refreshed }) =>
    ({ interval, batchCount, refreshed })), SUPPORTED_INGESTION_INTERVALS.map((interval) =>
    ({ interval, batchCount: 21, refreshed: 102 })));
  assert.ok(harness.calls.candleRequests.every(({ limit, start }) => limit === 500 && start === null));
  assert.equal(harness.calls.events.length, 0);
});

test("checkpointed intervals resume from the latest stored timestamp and skip not-yet-due candles", async () => {
  const markets = watchedMarkets(2);
  const latest = nowMs - 3 * INTERVAL_MS["1m"];
  const recent = nowMs - 30_000;
  const harness = createHarness({
    markets,
    checkpoints: new Map([
      [`${markets[0].symbol}:1m`, latest],
      [`${markets[1].symbol}:1m`, recent]
    ]),
    fetchCandles: async (_symbol, _interval, { start }) => [
      rawCandle("1m", start),
      rawCandle("1m", start + INTERVAL_MS["1m"]),
      rawCandle("1m", start + 2 * INTERVAL_MS["1m"])
    ]
  });

  const result = await harness.service.run({ intervals: ["1m"] });

  assert.equal(result.status, "completed");
  assert.equal(result.candles[0].refreshed, 1);
  assert.equal(result.candles[0].unchanged, 1);
  assert.equal(harness.calls.candleRequests.length, 1);
  assert.deepEqual(
    { start: harness.calls.candleRequests[0].start, limit: harness.calls.candleRequests[0].limit },
    { start: latest, limit: 4 }
  );
  assert.equal(harness.calls.candles.length, 3);
});

test("a market-specific provider failure does not block other markets or persist stale replacements", async () => {
  const markets = watchedMarkets(3);
  const failingSymbol = markets[1].symbol;
  const harness = createHarness({
    markets,
    fetchCandles: async (symbol, interval) => {
      if (symbol === failingSymbol) {
        throw new BitvavoProviderError("MARKET_NOT_FOUND", "not found");
      }
      return [rawCandle(interval)];
    }
  });

  const result = await harness.service.run({ intervals: ["5m"] });

  assert.equal(result.status, "partial");
  assert.equal(result.candles[0].refreshed, 2);
  assert.equal(result.candles[0].failed, 1);
  assert.equal(harness.calls.candles.length, 2);
  assert.ok(harness.calls.events.some(({ symbol, event_type }) =>
    symbol === failingSymbol && event_type === "MARKET_NOT_FOUND"));
});

test("one invalid snapshot does not discard other watched-market snapshots", async () => {
  const markets = watchedMarkets(2);
  const harness = createHarness({
    markets,
    tickers: [
      ticker(markets[0].symbol),
      { ...ticker(markets[1].symbol), high: "101" }
    ],
    fetchCandles: async (_symbol, interval) => [rawCandle(interval)]
  });

  const result = await harness.service.run({ intervals: ["1m"] });

  assert.equal(result.status, "partial");
  assert.equal(result.snapshots.persisted, 1);
  assert.equal(result.snapshots.failed, 1);
  assert.deepEqual(harness.calls.snapshots.map(({ symbol }) => symbol), [markets[0].symbol]);
  assert.equal(result.candles[0].refreshed, 2);
});

test("a storage failure is retried per market and a failing market does not discard its batch peers", async () => {
  const markets = watchedMarkets(3);
  const harness = createHarness({
    markets,
    failSnapshotWriteFor: markets[1].symbol
  });

  const result = await harness.service.run({ intervals: ["1m"] });

  assert.equal(result.snapshots.persisted, 2);
  assert.equal(result.snapshots.failed, 1);
  assert.equal(result.candles[0].refreshed, 3);
  assert.ok(harness.calls.events.some(({ symbol, event_type }) =>
    symbol === markets[1].symbol && event_type === "MARKET_DATA_STORAGE_ERROR"));
});

test("unsupported intervals fail before market or provider access", async () => {
  const harness = createHarness();

  await assert.rejects(harness.service.run({ intervals: ["3m"] }), /supported intervals/);
  assert.equal(harness.calls.marketReads, 0);
  assert.equal(harness.calls.candleRequests.length, 0);
});

test("ticker and candle parsers reject invalid values and collapse identical duplicate candles", () => {
  assert.equal(parseTickerSnapshot({ ...ticker("BTC-EUR"), open: "0" }, now.toISOString()), null);
  const timestamp = Math.floor(nowMs / INTERVAL_MS["1m"]) * INTERVAL_MS["1m"];
  const parsed = parseCandleRows([
    rawCandle("1m", timestamp),
    rawCandle("1m", timestamp),
    [timestamp + 1, "100", "110", "90", "105", "4"]
  ], {
    symbol: "BTC-EUR",
    interval: "1m",
    limit: 3,
    nowMs
  });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].timestamp, new Date(timestamp).toISOString());
});

test("conflicting duplicate provider candles fail the affected market", () => {
  const timestamp = Math.floor(nowMs / INTERVAL_MS["1m"]) * INTERVAL_MS["1m"];
  assert.throws(() => parseCandleRows([
    rawCandle("1m", timestamp),
    [timestamp, "100", "110", "90", "106", "4"]
  ], {
    symbol: "BTC-EUR",
    interval: "1m",
    limit: 2,
    nowMs
  }), { code: "INVALID_PROVIDER_RESPONSE" });
});
