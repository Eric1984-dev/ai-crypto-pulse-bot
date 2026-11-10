import test from "node:test";
import assert from "node:assert/strict";
import {
  BitvavoProviderError,
  createBitvavoPublicClient
} from "../src/services/bitvavo-public-client.mjs";
import {
  createIngestionDatabaseConfig,
  parseIngestionArguments
} from "../src/ingest-market-data.mjs";

function response(payload, {
  status = 200,
  ok = status >= 200 && status < 300,
  contentLength
} = {}) {
  return {
    status,
    ok,
    headers: {
      get(name) {
        return name === "content-length" ? contentLength ?? null : null;
      }
    },
    async json() {
      return payload;
    }
  };
}

test("Bitvavo client requests public tickers without credentials", async () => {
  const calls = [];
  const client = createBitvavoPublicClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response([{ market: "BTC-EUR" }]);
    }
  });

  assert.deepEqual(await client.fetchTickers(), [{ market: "BTC-EUR" }]);
  assert.equal(calls[0].url, "https://api.bitvavo.com/v2/ticker/24h");
  assert.equal(calls[0].options.method, "GET");
  assert.deepEqual(calls[0].options.headers, { Accept: "application/json" });
  assert.equal(calls[0].options.cache, "no-store");
  assert.ok(calls[0].options.signal instanceof AbortSignal);
});

test("Bitvavo candle requests validate and bound symbols, intervals, limits, and checkpoints", async () => {
  const calls = [];
  const client = createBitvavoPublicClient({
    fetchImpl: async (url) => {
      calls.push(new URL(url));
      return response([]);
    }
  });

  await client.fetchCandles("BTC-EUR", "5m", { limit: 500, start: 123000 });
  assert.equal(calls[0].pathname, "/v2/BTC-EUR/candles");
  assert.equal(calls[0].searchParams.get("interval"), "5m");
  assert.equal(calls[0].searchParams.get("limit"), "500");
  assert.equal(calls[0].searchParams.get("start"), "123000");

  await assert.rejects(client.fetchCandles("BAD/SYMBOL", "5m", { limit: 1 }), TypeError);
  await assert.rejects(client.fetchCandles("BTC-EUR", "3m", { limit: 1 }), TypeError);
  await assert.rejects(client.fetchCandles("BTC-EUR", "1m", { limit: 501 }), RangeError);
  await assert.rejects(client.fetchCandles("BTC-EUR", "1m", { limit: 1, start: -1 }), TypeError);
});

test("provider HTTP errors, timeouts, malformed JSON, and oversized payloads are explicit", async (t) => {
  const cases = [
    { name: "empty ticker response", response: response([]), code: "PROVIDER_EMPTY" },
    { name: "rate limit", response: response({}, { status: 429 }), code: "RATE_LIMITED" },
    { name: "provider outage", response: response({}, { status: 503 }), code: "PROVIDER_UNAVAILABLE" },
    { name: "missing market", response: response({}, { status: 404 }), code: "MARKET_NOT_FOUND" },
    {
      name: "oversized declared body",
      response: response([], { contentLength: "2048" }),
      code: "PROVIDER_RESPONSE_TOO_LARGE",
      maxResponseBytes: 1024
    },
    {
      name: "oversized decoded body",
      response: response([{ data: "x".repeat(1100) }]),
      code: "PROVIDER_RESPONSE_TOO_LARGE",
      maxResponseBytes: 1024
    },
    {
      name: "malformed JSON",
      response: { status: 200, ok: true, async json() { throw new SyntaxError("bad json"); } },
      code: "INVALID_PROVIDER_RESPONSE"
    }
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const client = createBitvavoPublicClient({
        fetchImpl: async () => item.response,
        ...(item.maxResponseBytes ? { maxResponseBytes: item.maxResponseBytes } : {})
      });
      await assert.rejects(client.fetchTickers(), { code: item.code });
    });
  }

  const timeoutClient = createBitvavoPublicClient({
    fetchImpl: async () => {
      throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
    }
  });
  await assert.rejects(timeoutClient.fetchTickers(), { code: "PROVIDER_TIMEOUT" });
});

test("Bitvavo client rejects unbounded ticker and candle arrays", async () => {
  const tickerClient = createBitvavoPublicClient({
    fetchImpl: async () => response(Array.from({ length: 2001 }, () => ({ market: "BTC-EUR" })))
  });
  await assert.rejects(tickerClient.fetchTickers(), { code: "INVALID_PROVIDER_RESPONSE" });

  const candleClient = createBitvavoPublicClient({
    fetchImpl: async () => response(Array.from({ length: 2 }, () => [0, 1, 1, 1, 1, 1]))
  });
  await assert.rejects(
    candleClient.fetchCandles("BTC-EUR", "1m", { limit: 1 }),
    BitvavoProviderError
  );
});

test("manual ingestion command accepts only an explicit supported interval set", () => {
  assert.throws(parseIngestionArguments.bind(null, []), /Select candle intervals explicitly/);
  assert.deepEqual(parseIngestionArguments(["--intervals=1m,1h"]), ["1m", "1h"]);
  assert.deepEqual(parseIngestionArguments(["--intervals=all"]), ["1m", "5m", "15m", "1h", "4h", "1d"]);
  assert.throws(() => parseIngestionArguments(["--intervals=3m"]), /supported intervals/);
  assert.throws(() => parseIngestionArguments(["--intervals=1m,1m"]), /unique supported/);
  assert.throws(() => parseIngestionArguments(["--intervals=1m", "--other"]), /Use only/);
});

test("manual ingestion can use an optional writer identity without changing API database settings", () => {
  const config = {
    database: Object.freeze({ host: "127.0.0.1", name: "existing", user: "reader", password: "read-secret" }),
    api: Object.freeze({ host: "127.0.0.1" })
  };
  const writerConfig = createIngestionDatabaseConfig(config, {
    INGESTION_DATABASE_USER: "writer",
    INGESTION_DATABASE_PASSWORD: "write-secret"
  });

  assert.equal(writerConfig.database.host, "127.0.0.1");
  assert.equal(writerConfig.database.name, "existing");
  assert.equal(writerConfig.database.user, "writer");
  assert.equal(writerConfig.database.password, "write-secret");
  assert.equal(writerConfig.api, config.api);
  assert.equal(config.database.user, "reader");
  assert.throws(
    () => createIngestionDatabaseConfig(config, { INGESTION_DATABASE_USER: "writer" }),
    /must be set together/
  );
  const ownerModeConfig = {
    ...config,
    ingestion: Object.freeze({ allowTableOwner: true })
  };
  assert.throws(
    () => createIngestionDatabaseConfig(ownerModeConfig, {}),
    /requires a separate INGESTION_DATABASE_USER/
  );
  assert.throws(
    () => createIngestionDatabaseConfig(ownerModeConfig, {
      INGESTION_DATABASE_USER: "reader",
      INGESTION_DATABASE_PASSWORD: "write-secret"
    }),
    /requires a separate INGESTION_DATABASE_USER/
  );
});
