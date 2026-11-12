import { createHash } from "node:crypto";
import { ANALYTICS_CALCULATION_VERSION } from "../services/dashboard-analytics.mjs";

const INSERT_ANALYTICS_RUN_SQL = `
  INSERT INTO public."AI_Crypto_Bot_Analytics_Runs" (
    id, calculation_version, period, period_start, period_end, generated_at,
    source_counts, analytics_summary, insights
  )
  VALUES (
    $1::uuid, $2::text, $3::text, $4::timestamptz, $5::timestamptz,
    $6::timestamptz, $7::jsonb, $8::jsonb, $9::jsonb
  )
  ON CONFLICT (id) DO NOTHING
`;

export class AnalyticsRunWriterError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = "AnalyticsRunWriterError";
    this.code = "ANALYTICS_RUN_WRITE_FAILED";
    this.component = "analytics-run-writer";
  }
}

export async function persistAnalyticsRun(pool, { analytics, insights, logger = console } = {}) {
  if (!pool || typeof pool.connect !== "function"
    || !analytics || typeof analytics !== "object"
    || analytics.calculationVersion !== ANALYTICS_CALCULATION_VERSION
    || !insights || typeof insights !== "object"
    || insights.calculationVersion !== ANALYTICS_CALCULATION_VERSION) {
    throw new TypeError("Validated analytics and insights are required.");
  }
  const periodStart = parseIsoTimestamp(analytics.periodStart, "period start");
  const periodEnd = parseIsoTimestamp(analytics.generatedAt, "generation time");
  if (!["30d", "90d", "365d"].includes(analytics.period)
    || Date.parse(periodStart) >= Date.parse(periodEnd)) {
    throw new TypeError("The analytics period is invalid.");
  }
  const id = createAnalyticsRunId({
    calculationVersion: analytics.calculationVersion,
    periodStart,
    periodEnd
  });
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const result = await client.query(INSERT_ANALYTICS_RUN_SQL, [
      id,
      analytics.calculationVersion,
      analytics.period,
      periodStart,
      periodEnd,
      periodEnd,
      JSON.stringify(analytics.sourceCounts || {}),
      JSON.stringify(analytics),
      JSON.stringify(insights)
    ]);
    await client.query("COMMIT");
    return Object.freeze({
      id,
      inserted: result.rowCount === 1,
      calculationVersion: analytics.calculationVersion,
      period: analytics.period,
      periodStart,
      periodEnd
    });
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        logger.error(JSON.stringify({
          event: "analytics_run_rollback_failed",
          component: "analytics-run-writer",
          code: safeCode(rollbackError?.code)
        }));
      }
    }
    throw new AnalyticsRunWriterError("The analytics run could not be persisted.", error);
  } finally {
    client?.release();
  }
}

export function createAnalyticsRunId({ calculationVersion, periodStart, periodEnd }) {
  for (const [field, value] of Object.entries({
    calculationVersion,
    periodStart,
    periodEnd
  })) {
    if (typeof value !== "string" || value.length === 0) {
      throw new TypeError(`The analytics run ${field} is invalid.`);
    }
  }
  const input = `${calculationVersion}\u0000${periodStart}\u0000${periodEnd}`;
  const bytes = [...createHash("sha256").update(input).digest().subarray(0, 16)];
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function parseIsoTimestamp(value, field) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    throw new TypeError(`The analytics run ${field} is invalid.`);
  }
  return value;
}

function safeCode(value) {
  return typeof value === "string" && /^[A-Z0-9_]{1,64}$/.test(value) ? value : null;
}
