export const EXPORT_DEFINITIONS = Object.freeze({
  trades: Object.freeze({
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
    headers: ["Timestamp", "Symbol", "Decision", "Confidence", "Market Strength", "Reason"]
  }),
  positions: Object.freeze({
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

export class ExportDataError extends Error {}

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
