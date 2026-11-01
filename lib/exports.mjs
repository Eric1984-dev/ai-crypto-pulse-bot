const PAGE_SIZE = 500;
const SCALE = 12n;
const SCALE_FACTOR = 10n ** SCALE;
const PERIODS = Object.freeze({
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  all: null
});

export const EXPORT_DEFINITIONS = Object.freeze({
  trades: Object.freeze({
    table: "AI_Crypto_Bot_Trades",
    timestampColumn: "created_at",
    select: "id,symbol,side,price,quantity,fees,realized_pnl,created_at",
    order: "created_at.asc,id.asc",
    headers: [
      "Date",
      "Symbol",
      "Action",
      "Entry Price",
      "Quantity",
      "Invested Amount",
      "Fees",
      "Gross Value",
      "Net Value",
      "Realized PnL",
      "Status"
    ]
  }),
  portfolio: Object.freeze({
    table: "AI_Crypto_Bot_Portfolio_Snapshots",
    timestampColumn: "captured_at",
    select: "id,portfolio_id,portfolio_value,available_balance,open_positions,captured_at",
    order: "captured_at.asc,id.asc",
    headers: [
      "Timestamp",
      "Portfolio Value",
      "Available Balance",
      "Open Positions",
      "Total PnL",
      "Daily PnL"
    ]
  }),
  decisions: Object.freeze({
    table: "AI_Crypto_Bot_AI_Decisions",
    timestampColumn: "created_at",
    select: "id,symbol,decision,confidence,indicators,reason,created_at",
    order: "created_at.asc,id.asc",
    headers: ["Timestamp", "Symbol", "Decision", "Confidence", "Market Strength", "Reason"]
  }),
  positions: Object.freeze({
    table: "AI_Crypto_Bot_Positions",
    timestampColumn: "created_at",
    select: "id,symbol,amount,entry_price,current_price,unrealized_pnl,status,created_at",
    order: "created_at.asc,id.asc",
    headers: [
      "Open Date",
      "Symbol",
      "Entry Price",
      "Current Price",
      "Position Value",
      "Unrealized PnL",
      "Status"
    ]
  })
});

export class ExportRequestError extends Error {}
export class ExportSessionError extends Error {}
export class ExportDataError extends Error {}

export function createExportsService({ fetchImpl = globalThis.fetch } = {}) {
  async function getRecordCount({ config, accessToken, exportType, period = "all", now = new Date() }) {
    const selection = createSelection(exportType, period, now);
    return fetchExactCount({
      config,
      accessToken,
      fetchImpl,
      table: selection.definition.table,
      filters: selection.filters
    });
  }

  async function streamCsv({
    config,
    accessToken,
    exportType,
    period = "all",
    now = new Date(),
    response
  }) {
    const selection = createSelection(exportType, period, now);
    const count = await fetchExactCount({
      config,
      accessToken,
      fetchImpl,
      table: selection.definition.table,
      filters: selection.filters
    });
    const context = exportType === "portfolio"
      ? await loadPortfolioContext(config, accessToken, fetchImpl, selection, now)
      : null;
    const firstPage = count > 0
      ? await fetchPage({
        config,
        accessToken,
        fetchImpl,
        table: selection.definition.table,
        select: selection.definition.select,
        order: selection.definition.order,
        filters: selection.filters,
        offset: 0
      })
      : [];
    const firstCsv = firstPage.map((row) => serializeCsvRow(
      mapExportRecord(exportType, row, context)
    )).join("");

    response.statusCode = 200;
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="cryptopulse-${exportType}-${period}.csv"`);
    response.setHeader("X-Export-Record-Count", String(count));
    await writeChunk(response, `\uFEFF${serializeCsvRow(selection.definition.headers)}${firstCsv}`);

    let offset = firstPage.length;
    while (offset < count) {
      const rows = await fetchPage({
        config,
        accessToken,
        fetchImpl,
        table: selection.definition.table,
        select: selection.definition.select,
        order: selection.definition.order,
        filters: selection.filters,
        offset
      });
      if (rows.length === 0) {
        break;
      }
      const chunk = rows.map((row) => serializeCsvRow(
        mapExportRecord(exportType, row, context)
      )).join("");
      await writeChunk(response, chunk);
      offset += rows.length;
    }

    response.end();
    return { count };
  }

  return { getRecordCount, streamCsv };
}

export async function streamCsvRows(response, exportType, period, headers, rows) {
  const recordCount = rows.length;
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/csv; charset=utf-8");
  response.setHeader("Content-Disposition", `attachment; filename="cryptopulse-${exportType}-${period}.csv"`);
  response.setHeader("X-Export-Record-Count", String(recordCount));
  await writeChunk(response, `\uFEFF${serializeCsvRow(headers)}`);
  for (const row of rows) {
    await writeChunk(response, serializeCsvRow(row));
  }
  response.end();
  return { count: recordCount };
}

export function createSelection(exportType, period, now = new Date()) {
  if (typeof exportType !== "string" || !Object.hasOwn(EXPORT_DEFINITIONS, exportType)
    || !Object.hasOwn(PERIODS, period)) {
    throw new ExportRequestError("The export type or date filter is invalid.");
  }
  const definition = EXPORT_DEFINITIONS[exportType];
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new ExportRequestError("The export clock is invalid.");
  }

  const duration = PERIODS[period];
  const cutoff = duration === null ? null : new Date(now.getTime() - duration);
  return {
    exportType,
    period,
    definition,
    cutoff,
    filters: cutoff
      ? { [definition.timestampColumn]: `gte.${cutoff.toISOString()}` }
      : {}
  };
}

export function serializeCsvRow(values) {
  return `${values.map(serializeCsvCell).join(",")}\r\n`;
}

export function serializeCsvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[\u0000-\u0020]*[=+\-@]/.test(text) && !/^-?\d+(?:\.\d+)?$/.test(text)) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function mapExportRecord(exportType, row, context = null) {
  if (exportType === "trades") {
    const gross = multiplyDecimals(row.price, row.quantity, "trade value");
    const fee = normalizeDecimal(row.fees, "trade fees");
    const isBuy = row.side === "BUY";
    const isSell = row.side === "SELL";
    if (!isBuy && !isSell) {
      throw new ExportDataError("Supabase returned an invalid trade action.");
    }
    return [
      requiredText(row.created_at, "trade date"),
      requiredText(row.symbol, "trade symbol"),
      row.side,
      normalizeDecimal(row.price, "trade price"),
      normalizeDecimal(row.quantity, "trade quantity"),
      isBuy ? gross : "",
      fee,
      gross,
      isBuy ? addDecimals(gross, fee) : subtractDecimals(gross, fee),
      isSell ? normalizeDecimal(row.realized_pnl, "realized PnL") : "",
      "Executed · Paper Trade"
    ];
  }

  if (exportType === "portfolio") {
    const startingBalance = context && context.startingBalances.get(row.portfolio_id);
    if (startingBalance === undefined) {
      throw new ExportDataError("A portfolio snapshot has no visible starting balance.");
    }
    const timestamp = requiredText(row.captured_at, "snapshot timestamp");
    const day = readUtcDay(timestamp);
    return [
      timestamp,
      normalizeDecimal(row.portfolio_value, "portfolio value"),
      normalizeDecimal(row.available_balance, "available balance"),
      requiredInteger(row.open_positions, "open positions"),
      subtractDecimals(row.portfolio_value, startingBalance),
      context.dailyPnl.get(`${row.portfolio_id}:${day}`) || "0"
    ];
  }

  if (exportType === "decisions") {
    const indicators = readIndicators(row.indicators);
    const marketStrength = indicators.marketStrength;
    return [
      requiredText(row.created_at, "decision timestamp"),
      requiredText(row.symbol, "decision symbol"),
      requiredText(row.decision, "decision"),
      normalizeDecimal(row.confidence, "decision confidence"),
      marketStrength === null || marketStrength === undefined
        ? ""
        : normalizeDecimal(marketStrength, "market strength"),
      requiredText(row.reason, "decision reason")
    ];
  }

  if (exportType === "positions") {
    return [
      requiredText(row.created_at, "position open date"),
      requiredText(row.symbol, "position symbol"),
      normalizeDecimal(row.entry_price, "position entry price"),
      normalizeDecimal(row.current_price, "position current price"),
      multiplyDecimals(row.current_price, row.amount, "position value"),
      normalizeDecimal(row.unrealized_pnl, "unrealized PnL"),
      requiredText(row.status, "position status")
    ];
  }

  throw new ExportRequestError("The export type is invalid.");
}

async function loadPortfolioContext(config, accessToken, fetchImpl, selection, now) {
  const startingBalances = new Map();
  await forEachPage({
    config,
    accessToken,
    fetchImpl,
    table: "AI_Crypto_Bot_Portfolios",
    select: "id,starting_balance",
    order: "id.asc",
    filters: {},
    onRows: (rows) => {
      for (const row of rows) {
        startingBalances.set(
          requiredText(row.id, "portfolio ID"),
          normalizeDecimal(row.starting_balance, "portfolio starting balance")
        );
      }
    }
  });

  const dailyPnl = new Map();
  const tradeCutoff = selection.cutoff
    ? new Date(selection.cutoff)
    : null;
  if (tradeCutoff) {
    tradeCutoff.setUTCHours(0, 0, 0, 0);
  }
  await forEachPage({
    config,
    accessToken,
    fetchImpl,
    table: "AI_Crypto_Bot_Trades",
    select: "id,portfolio_id,realized_pnl,created_at",
    order: "created_at.asc,id.asc",
    filters: {
      side: "eq.SELL",
      ...(tradeCutoff ? { created_at: `gte.${tradeCutoff.toISOString()}` } : {})
    },
    onRows: (rows) => {
      for (const row of rows) {
        const key = `${requiredText(row.portfolio_id, "trade portfolio ID")}:${readUtcDay(row.created_at)}`;
        const current = dailyPnl.get(key) || "0";
        dailyPnl.set(key, addDecimals(current, normalizeDecimal(row.realized_pnl, "realized PnL")));
      }
    }
  });

  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new ExportRequestError("The export clock is invalid.");
  }
  return { startingBalances, dailyPnl };
}

async function forEachPage({
  config,
  accessToken,
  fetchImpl,
  table,
  select,
  order,
  filters,
  onRows
}) {
  let offset = 0;
  while (true) {
    const rows = await fetchPage({
      config,
      accessToken,
      fetchImpl,
      table,
      select,
      order,
      filters,
      offset
    });
    if (rows.length === 0) {
      return;
    }
    onRows(rows);
    offset += rows.length;
    if (rows.length < PAGE_SIZE) {
      return;
    }
  }
}

export function createPageIterator({
  config,
  accessToken,
  fetchImpl = globalThis.fetch,
  table,
  select,
  order,
  filters = {}
}) {
  let offset = 0;
  let page = [];
  let index = 0;
  let finished = false;

  return {
    async next() {
      if (index >= page.length) {
        if (finished) {
          return { done: true, value: undefined };
        }
        page = await fetchPage({
          config,
          accessToken,
          fetchImpl,
          table,
          select,
          order,
          filters,
          offset
        });
        index = 0;
        if (page.length === 0) {
          finished = true;
          return { done: true, value: undefined };
        }
        offset += page.length;
        finished = page.length < PAGE_SIZE;
      }

      return { done: false, value: page[index++] };
    },
    [Symbol.asyncIterator]() {
      return this;
    }
  };
}

async function fetchExactCount({ config, accessToken, fetchImpl, table, filters }) {
  const url = new URL(`/rest/v1/${table}`, config.supabaseUrl);
  url.searchParams.set("select", "id");
  url.searchParams.set("limit", "1");
  for (const [key, value] of Object.entries(filters)) {
    url.searchParams.set(key, value);
  }

  const response = await requestSupabase(fetchImpl, url.toString(), {
    method: "HEAD",
    headers: createReadHeaders(config, accessToken, true, "0-0"),
    cache: "no-store"
  });
  if (!response.ok) {
    throw new ExportDataError("Supabase rejected an export count request.");
  }
  return readExactCount(response.headers);
}

async function fetchPage({
  config,
  accessToken,
  fetchImpl,
  table,
  select,
  order,
  filters,
  offset
}) {
  const url = new URL(`/rest/v1/${table}`, config.supabaseUrl);
  url.searchParams.set("select", select);
  url.searchParams.set("order", order);
  url.searchParams.set("limit", String(PAGE_SIZE));
  for (const [key, value] of Object.entries(filters)) {
    url.searchParams.set(key, value);
  }

  const response = await requestSupabase(fetchImpl, url.toString(), {
    method: "GET",
    headers: createReadHeaders(config, accessToken, false, `${offset}-${offset + PAGE_SIZE - 1}`),
    cache: "no-store"
  });
  if (!response.ok) {
    throw new ExportDataError("Supabase rejected an export data request.");
  }

  let rows;
  try {
    rows = await response.json();
  } catch {
    throw new ExportDataError("Supabase returned invalid export data.");
  }
  if (!Array.isArray(rows)) {
    throw new ExportDataError("Supabase returned an unexpected export response.");
  }
  return rows;
}

async function requestSupabase(fetchImpl, url, options) {
  try {
    const response = await fetchImpl(url, options);
    if (response.status === 401) {
      throw new ExportSessionError("The authenticated export session is invalid.");
    }
    return response;
  } catch (error) {
    if (error instanceof ExportSessionError) {
      throw error;
    }
    throw new ExportDataError("The Supabase export request failed.");
  }
}

function createReadHeaders(config, accessToken, includeCount, range) {
  return {
    apikey: config.supabaseAnonKey,
    authorization: `Bearer ${accessToken}`,
    accept: "application/json",
    ...(includeCount ? { prefer: "count=exact" } : {}),
    range
  };
}

function readExactCount(headers) {
  const contentRange = headers && headers.get("content-range");
  const total = contentRange && contentRange.slice(contentRange.lastIndexOf("/") + 1);
  if (!total || total === "*" || !/^\d+$/.test(total)) {
    throw new ExportDataError("Supabase did not return an exact export count.");
  }
  const count = Number(total);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new ExportDataError("Supabase returned an invalid export count.");
  }
  return count;
}

async function writeChunk(response, chunk) {
  if (typeof response.write !== "function") {
    throw new ExportDataError("The response does not support CSV streaming.");
  }
  if (response.write(chunk) !== false) {
    return;
  }
  if (typeof response.once !== "function") {
    throw new ExportDataError("CSV stream backpressure cannot be handled.");
  }
  await new Promise((resolve, reject) => {
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new ExportDataError("The CSV response stream failed."));
    };
    const onClose = () => {
      cleanup();
      reject(new ExportDataError("The CSV response stream closed early."));
    };
    const cleanup = () => {
      response.removeListener("drain", onDrain);
      response.removeListener("error", onError);
      response.removeListener("close", onClose);
    };
    response.once("drain", onDrain);
    response.once("error", onError);
    response.once("close", onClose);
  });
}

function normalizeDecimal(value, field) {
  return unitsToDecimal(decimalToUnits(value, field));
}

function multiplyDecimals(left, right, field) {
  const product = decimalToUnits(left, field) * decimalToUnits(right, field);
  const half = SCALE_FACTOR / 2n;
  return unitsToDecimal((product + half) / SCALE_FACTOR);
}

function addDecimals(left, right) {
  return unitsToDecimal(decimalToUnits(left, "decimal") + decimalToUnits(right, "decimal"));
}

function subtractDecimals(left, right) {
  return unitsToDecimal(decimalToUnits(left, "decimal") - decimalToUnits(right, "decimal"));
}

function decimalToUnits(value, field) {
  let text;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ExportDataError(`Supabase returned an invalid numeric value for ${field}.`);
    }
    text = value.toFixed(Number(SCALE));
  } else if (typeof value === "string") {
    text = value.trim();
  } else {
    throw new ExportDataError(`Supabase returned an invalid numeric value for ${field}.`);
  }

  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) {
    throw new ExportDataError(`Supabase returned an invalid numeric value for ${field}.`);
  }
  const fraction = match[3] || "";
  const keptFraction = fraction.slice(0, Number(SCALE)).padEnd(Number(SCALE), "0");
  let units = BigInt(match[2]) * SCALE_FACTOR + BigInt(keptFraction);
  if (fraction.length > Number(SCALE) && fraction[Number(SCALE)] >= "5") {
    units += 1n;
  }
  return match[1] === "-" ? -units : units;
}

function unitsToDecimal(units) {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const integer = absolute / SCALE_FACTOR;
  const fraction = (absolute % SCALE_FACTOR).toString().padStart(Number(SCALE), "0").replace(/0+$/, "");
  const value = fraction ? `${integer}.${fraction}` : String(integer);
  return negative && absolute !== 0n ? `-${value}` : value;
}

function requiredText(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ExportDataError(`Supabase returned an invalid ${field}.`);
  }
  return value;
}

function requiredInteger(value, field) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new ExportDataError(`Supabase returned an invalid ${field}.`);
  }
  return String(number);
}

function readIndicators(value) {
  let indicators = value;
  if (typeof indicators === "string") {
    try {
      indicators = JSON.parse(indicators);
    } catch {
      throw new ExportDataError("Supabase returned invalid decision indicators.");
    }
  }
  if (!indicators || typeof indicators !== "object" || Array.isArray(indicators)) {
    throw new ExportDataError("Supabase returned invalid decision indicators.");
  }
  return indicators;
}

function readUtcDay(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) {
    throw new ExportDataError("Supabase returned an invalid export timestamp.");
  }
  return date.toISOString().slice(0, 10);
}
