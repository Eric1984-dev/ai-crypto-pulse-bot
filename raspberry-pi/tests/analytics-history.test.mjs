import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  createAnalyticsRunId,
  persistAnalyticsRun
} from "../src/repositories/analytics-run-writer.mjs";
import {
  createAnalyticsWriterConfig,
  parseAnalyticsGenerationOptions
} from "../src/generate-analytics.mjs";

const migrationUrl = new URL("../migrations/phase-11-analytics-history.sql", import.meta.url);
const analytics = Object.freeze({
  calculationVersion: "phase-11.1",
  period: "30d",
  periodStart: "2026-03-01T00:00:00.000Z",
  generatedAt: "2026-03-31T00:00:00.000Z",
  sourceCounts: { trades: 4, decisions: 10 },
  tradePerformance: { closedTrades: 2 },
  strategyVersionPerformance: { versions: [] }
});
const insights = Object.freeze({
  calculationVersion: "phase-11.1",
  generatedAt: analytics.generatedAt,
  recommendations: []
});

async function createMigratedDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE dashboard_runtime LOGIN;
    CREATE ROLE analytics_writer LOGIN;
    CREATE ROLE paper_runtime LOGIN;
  `);
  await database.query(
    `SELECT set_config('cryptopulse.dashboard_database_user', $1, false),
            set_config('cryptopulse.analytics_database_user', $2, false),
            set_config('cryptopulse.paper_trading_database_user', $3, false)`,
    ["dashboard_runtime", "analytics_writer", "paper_runtime"]
  );
  await database.exec(await readFile(migrationUrl, "utf8"));
  return database;
}

test("Phase 11 migration creates prefixed history with isolated role privileges", async () => {
  const database = await createMigratedDatabase();
  try {
    const privileges = await database.query(`
      SELECT
        pg_catalog.has_table_privilege(
          'dashboard_runtime', 'public."AI_Crypto_Bot_Analytics_Runs"', 'SELECT'
        ) AS dashboard_select,
        pg_catalog.has_table_privilege(
          'dashboard_runtime', 'public."AI_Crypto_Bot_Analytics_Runs"', 'INSERT'
        ) AS dashboard_insert,
        pg_catalog.has_table_privilege(
          'analytics_writer', 'public."AI_Crypto_Bot_Analytics_Runs"', 'INSERT'
        ) AS writer_insert,
        pg_catalog.has_table_privilege(
          'analytics_writer', 'public."AI_Crypto_Bot_Analytics_Runs"', 'SELECT'
        ) AS writer_select,
        pg_catalog.has_table_privilege(
          'analytics_writer', 'public."AI_Crypto_Bot_Analytics_Runs"', 'UPDATE'
        ) AS writer_update,
        pg_catalog.has_table_privilege(
          'paper_runtime', 'public."AI_Crypto_Bot_Analytics_Runs"', 'SELECT'
        ) AS paper_select
    `);
    assert.deepEqual(privileges.rows[0], {
      dashboard_select: true,
      dashboard_insert: false,
      writer_insert: true,
      writer_select: false,
      writer_update: false,
      paper_select: false
    });

    await database.exec("SET ROLE analytics_writer");
    const result = await persistAnalyticsRun(
      { async connect() {
        return {
          query: database.query.bind(database),
          release() {}
        };
      } },
      { analytics, insights, logger: { error() {} } }
    );
    assert.equal(result.inserted, true);
    const duplicate = await persistAnalyticsRun(
      { async connect() {
        return {
          query: database.query.bind(database),
          release() {}
        };
      } },
      { analytics, insights, logger: { error() {} } }
    );
    assert.equal(duplicate.inserted, false);
    assert.equal(duplicate.id, result.id);
    await database.exec("RESET ROLE");
    const saved = await database.query(
      'SELECT calculation_version, period, source_counts, analytics_summary, insights '
        + 'FROM public."AI_Crypto_Bot_Analytics_Runs"'
    );
    assert.equal(saved.rows.length, 1);
    assert.equal(saved.rows[0].calculation_version, "phase-11.1");
    assert.equal(saved.rows[0].period, "30d");
    assert.equal(saved.rows[0].source_counts.trades, 4);
  } finally {
    await database.close();
  }
});

test("analytics run IDs and generation options are reproducible and bounded", () => {
  const fields = {
    calculationVersion: analytics.calculationVersion,
    periodStart: analytics.periodStart,
    periodEnd: analytics.generatedAt
  };
  assert.equal(createAnalyticsRunId(fields), createAnalyticsRunId(fields));
  assert.equal(parseAnalyticsGenerationOptions([
    "--period=90d",
    "--as-of=2026-03-31T00:00:00.000Z"
  ]).period, "90d");
  assert.throws(() => parseAnalyticsGenerationOptions(["--period=all"]));
  assert.throws(() => parseAnalyticsGenerationOptions([
    "--period=30d",
    "--period=90d"
  ]));
  assert.throws(() => parseAnalyticsGenerationOptions([
    "--as-of=2026-03-31"
  ]));
});

test("analytics writer requires credentials distinct from all runtime roles", () => {
  const config = {
    database: { user: "api", password: "api-password" },
    analytics: { databaseUser: "writer", databasePassword: "writer-password" },
    aiAnalysis: { databaseUser: "ai" },
    paperTrading: { databaseUser: "paper" }
  };
  assert.equal(createAnalyticsWriterConfig(config, {
    INGESTION_DATABASE_USER: "ingestion"
  }).database.user, "writer");
  assert.throws(() => createAnalyticsWriterConfig({
    ...config,
    analytics: { databaseUser: "paper", databasePassword: "writer-password" }
  }, { INGESTION_DATABASE_USER: "ingestion" }), /must be distinct/);
});

test("analytics writer errors expose a safe cause code without logging database messages", async () => {
  const databaseFailure = Object.assign(new Error("sensitive database detail"), {
    code: "42501"
  });
  const pool = {
    async connect() {
      return {
        async query(sql) {
          if (sql.includes("INSERT INTO public.\"AI_Crypto_Bot_Analytics_Runs\"")) {
            throw databaseFailure;
          }
          return { rowCount: 0 };
        },
        release() {}
      };
    }
  };

  await assert.rejects(
    persistAnalyticsRun(pool, { analytics, insights, logger: { error() {} } }),
    (error) => {
      assert.equal(error.code, "ANALYTICS_RUN_WRITE_FAILED");
      assert.equal(error.causeCode, "42501");
      assert.equal(error.cause.message, "sensitive database detail");
      return true;
    }
  );
});
