import assert from "node:assert/strict";
import test from "node:test";
import { createHandler } from "../api/dashboard-data.mjs";
import {
  createExportsService,
  EXPORT_DEFINITIONS,
  serializeCsvCell,
  serializeCsvRow
} from "../lib/exports.mjs";

const now = new Date("2026-03-20T12:00:00.000Z");
const config = {
  supabaseUrl: "https://project.supabase.co",
  supabaseAnonKey: "test-anon-key"
};
const accessToken = "header.payload.signature";
const rowsByTable = {
  AI_Crypto_Bot_Trades: [
    {
      id: "trade-buy",
      portfolio_id: "portfolio-1",
      symbol: "BTC-EUR",
      side: "BUY",
      price: "100.25",
      quantity: "2",
      fees: "0.5",
      realized_pnl: "0",
      created_at: "2026-03-20T10:00:00.000Z"
    },
    {
      id: "trade-sell",
      portfolio_id: "portfolio-1",
      symbol: "BTC-EUR",
      side: "SELL",
      price: "120",
      quantity: "2",
      fees: "0.6",
      realized_pnl: "38",
      created_at: "2026-03-20T11:00:00.000Z"
    }
  ],
  AI_Crypto_Bot_Portfolios: [
    { id: "portfolio-1", starting_balance: "1000" }
  ],
  AI_Crypto_Bot_Portfolio_Snapshots: [
    {
      id: "snapshot-1",
      portfolio_id: "portfolio-1",
      portfolio_value: "1200",
      available_balance: "800",
      open_positions: 1,
      captured_at: "2026-03-20T10:30:00.000Z"
    },
    {
      id: "snapshot-2",
      portfolio_id: "portfolio-1",
      portfolio_value: "1190",
      available_balance: "790",
      open_positions: 1,
      captured_at: "2026-03-20T11:30:00.000Z"
    }
  ],
  AI_Crypto_Bot_AI_Decisions: [
    {
      id: "decision-1",
      symbol: "BTC-EUR",
      decision: "BUY",
      confidence: "82.5",
      indicators: { marketStrength: -34 },
      reason: "Trend, volume, and volatility validated.",
      created_at: "2026-03-20T09:00:00.000Z"
    }
  ],
  AI_Crypto_Bot_Positions: [
    {
      id: "position-1",
      symbol: "BTC-EUR",
      amount: "2.5",
      entry_price: "100",
      current_price: "110",
      unrealized_pnl: "25",
      status: "OPEN",
      created_at: "2026-03-20T08:00:00.000Z"
    }
  ]
};

function createSupabaseFetch({ rows = rowsByTable, calls = [] } = {}) {
  return async (url, options) => {
    const parsedUrl = new URL(url);
    const table = parsedUrl.pathname.split("/").pop();
    const query = parsedUrl.searchParams;
    calls.push({ table, query: new URLSearchParams(query), options });

    let matchingRows = [...(rows[table] || [])];
    for (const [field, filter] of query.entries()) {
      if (filter.startsWith("eq.")) {
        const expected = filter.slice(3);
        matchingRows = matchingRows.filter((row) => String(row[field]) === expected);
      } else if (filter.startsWith("gte.")) {
        const cutoff = Date.parse(filter.slice(4));
        matchingRows = matchingRows.filter((row) => Date.parse(row[field]) >= cutoff);
      }
    }

    const order = query.get("order");
    if (order) {
      const [field, direction] = order.split(".");
      matchingRows.sort((left, right) => {
        const comparison = String(left[field] ?? left.id).localeCompare(String(right[field] ?? right.id));
        return direction === "desc" ? -comparison : comparison;
      });
    }

    if (options.method === "HEAD") {
      return {
        status: 200,
        ok: true,
        headers: { get: (name) => name.toLowerCase() === "content-range" ? `*/${matchingRows.length}` : null }
      };
    }

    const range = options.headers.range;
    const [start, end] = range.split("-").map(Number);
    const pageRows = matchingRows.slice(start, end + 1);
    return {
      status: 200,
      ok: true,
      headers: { get: () => null },
      async json() { return pageRows; }
    };
  };
}

function createStreamResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    headersSent: false,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    write(chunk) {
      this.headersSent = true;
      this.body += chunk;
      return true;
    },
    end(chunk = "") {
      this.body += chunk;
      this.ended = true;
    },
    destroy() {
      this.destroyed = true;
    }
  };
}

test("CSV escaping quotes delimiters and neutralizes spreadsheet formulas", () => {
  assert.equal(serializeCsvCell('A "quote", B'), '"A ""quote"", B"');
  assert.equal(serializeCsvCell("=1+1"), "'=1+1");
  assert.equal(serializeCsvCell(" -run-command"), "' -run-command");
  assert.equal(serializeCsvCell("-12.50"), "-12.50");
  assert.equal(serializeCsvRow(["one", "two\nlines"]), 'one,"two\nlines"\r\n');
});

test("export definitions expose the requested CSV columns", () => {
  assert.deepEqual(EXPORT_DEFINITIONS.trades.headers, [
    "Date", "Symbol", "Action", "Entry Price", "Quantity", "Invested Amount",
    "Fees", "Gross Value", "Net Value", "Realized PnL", "Status"
  ]);
  assert.deepEqual(EXPORT_DEFINITIONS.portfolio.headers, [
    "Timestamp", "Portfolio Value", "Available Balance", "Open Positions", "Total PnL", "Daily PnL"
  ]);
  assert.deepEqual(EXPORT_DEFINITIONS.decisions.headers, [
    "Timestamp", "Symbol", "Decision", "Confidence", "Market Strength", "Reason"
  ]);
  assert.deepEqual(EXPORT_DEFINITIONS.positions.headers, [
    "Open Date", "Symbol", "Entry Price", "Current Price", "Position Value", "Unrealized PnL", "Status"
  ]);
});

test("trade CSV calculates BUY costs and SELL proceeds from stored execution data", async () => {
  const calls = [];
  const service = createExportsService({ fetchImpl: createSupabaseFetch({ calls }) });
  const response = createStreamResponse();

  const result = await service.streamCsv({
    config,
    accessToken,
    exportType: "trades",
    period: "all",
    now,
    response
  });

  assert.equal(result.count, 2);
  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"], /^text\/csv/);
  assert.match(response.headers["content-disposition"], /cryptopulse-trades-all\.csv/);
  assert.match(response.body, /BTC-EUR,BUY,100\.25,2,200\.5,0\.5,200\.5,201,,Executed · Paper Trade/);
  assert.match(response.body, /BTC-EUR,SELL,120,2,,0\.6,240,239\.4,38,Executed · Paper Trade/);
  assert.equal(response.body.startsWith("\uFEFF"), true);
  assert.equal(response.ended, true);
  assert.ok(calls.every(({ options }) => options.cache === "no-store"));
  assert.ok(calls.every(({ options }) => options.headers.authorization === `Bearer ${accessToken}`));
});

test("portfolio CSV derives total PnL and UTC daily realized SELL PnL", async () => {
  const service = createExportsService({ fetchImpl: createSupabaseFetch() });
  const response = createStreamResponse();

  await service.streamCsv({
    config,
    accessToken,
    exportType: "portfolio",
    period: "all",
    now,
    response
  });

  assert.match(response.body, /2026-03-20T10:30:00\.000Z,1200,800,1,200,38/);
  assert.match(response.body, /2026-03-20T11:30:00\.000Z,1190,790,1,190,38/);
});

test("AI decision and position CSVs include stored and derived fields", async () => {
  const service = createExportsService({ fetchImpl: createSupabaseFetch() });
  const decisionResponse = createStreamResponse();
  await service.streamCsv({
    config,
    accessToken,
    exportType: "decisions",
    period: "all",
    now,
    response: decisionResponse
  });
  assert.match(decisionResponse.body, /2026-03-20T09:00:00\.000Z,BTC-EUR,BUY,82\.5,-34,"Trend, volume, and volatility validated\."/);

  const positionResponse = createStreamResponse();
  await service.streamCsv({
    config,
    accessToken,
    exportType: "positions",
    period: "all",
    now,
    response: positionResponse
  });
  assert.match(positionResponse.body, /2026-03-20T08:00:00\.000Z,BTC-EUR,100,110,275,25,OPEN/);
});

test("empty exports produce a header-only CSV", async () => {
  const service = createExportsService({ fetchImpl: createSupabaseFetch({ rows: {} }) });
  const response = createStreamResponse();
  const result = await service.streamCsv({
    config,
    accessToken,
    exportType: "decisions",
    period: "all",
    now,
    response
  });

  assert.equal(result.count, 0);
  assert.equal(response.body, `\uFEFF${serializeCsvRow(EXPORT_DEFINITIONS.decisions.headers)}`);
});

test("rolling date filters are applied to count and export queries", async () => {
  const calls = [];
  const service = createExportsService({ fetchImpl: createSupabaseFetch({ calls }) });
  const count = await service.getRecordCount({
    config,
    accessToken,
    exportType: "trades",
    period: "24h",
    now
  });

  assert.equal(count, 2);
  const countCall = calls[0];
  assert.equal(countCall.query.get("created_at"), "gte.2026-03-19T12:00:00.000Z");
  assert.equal(countCall.options.method, "HEAD");
  assert.equal(countCall.options.headers.prefer, "count=exact");
  assert.equal(countCall.options.headers.range, "0-0");
});

test("large exports use bounded pages and stream every record", async () => {
  const largeTrades = Array.from({ length: 1201 }, (_, index) => ({
    id: `trade-${String(index).padStart(4, "0")}`,
    symbol: "BTC-EUR",
    side: "BUY",
    price: "10",
    quantity: "1",
    fees: "0.1",
    realized_pnl: "0",
    created_at: new Date(Date.UTC(2026, 2, 1, 0, index)).toISOString()
  }));
  const calls = [];
  const service = createExportsService({
    fetchImpl: createSupabaseFetch({ rows: { AI_Crypto_Bot_Trades: largeTrades }, calls })
  });
  const response = createStreamResponse();

  const result = await service.streamCsv({
    config,
    accessToken,
    exportType: "trades",
    period: "all",
    now,
    response
  });
  const pageCalls = calls.filter(({ options }) => options.method === "GET");

  assert.equal(result.count, 1201);
  assert.equal(pageCalls.length, 3);
  assert.deepEqual(pageCalls.map(({ options }) => options.headers.range), ["0-499", "500-999", "1000-1499"]);
  assert.equal(response.body.split("\r\n").length - 2, 1201);
  assert.equal(response.body.includes("2026-03-01T20:00:00.000Z"), true);
});

test("exports reuse the authenticated dashboard function and reject invalid requests", async () => {
  const handler = createHandler({
    env: {
      SUPABASE_URL: config.supabaseUrl,
      SUPABASE_ANON_KEY: config.supabaseAnonKey
    },
    verify: async (token) => token === accessToken,
    fetchImpl: createSupabaseFetch(),
    now: () => now
  });
  const countResponse = createStreamResponse();
  await handler({
    method: "GET",
    url: "/api/dashboard-data?view=export-count&type=trades&period=7d",
    headers: { cookie: `cp_access_token=${accessToken}` }
  }, countResponse);

  assert.equal(countResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(countResponse.body).data, {
    exportType: "trades",
    period: "7d",
    recordCount: 2
  });

  const invalidResponse = createStreamResponse();
  await handler({
    method: "GET",
    url: "/api/dashboard-data?view=export-count&type=unknown&period=all",
    headers: { cookie: `cp_access_token=${accessToken}` }
  }, invalidResponse);
  assert.equal(invalidResponse.statusCode, 400);
  assert.equal(JSON.parse(invalidResponse.body).error.code, "INVALID_EXPORT_QUERY");

  const downloadResponse = createStreamResponse();
  await handler({
    method: "GET",
    url: "/api/dashboard-data?view=export&type=trades&period=all",
    headers: { cookie: `cp_access_token=${accessToken}` }
  }, downloadResponse);
  assert.equal(downloadResponse.statusCode, 200);
  assert.match(downloadResponse.headers["content-type"], /^text\/csv/);
  assert.match(downloadResponse.body, /Executed · Paper Trade/);
  assert.equal(downloadResponse.ended, true);
});
