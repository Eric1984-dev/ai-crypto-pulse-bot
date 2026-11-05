"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const markets = require("../config/markets.js");
const { requiredTables, validateDatabase } = require("../scripts/validate-database.js");

const rootDirectory = path.resolve(__dirname, "..");
const migrationsDirectory = path.join(rootDirectory, "supabase", "migrations");
const migrationFiles = fs.readdirSync(migrationsDirectory)
  .filter((file) => file.endsWith(".sql"))
  .sort();
const migrationSql = migrationFiles
  .map((file) => fs.readFileSync(path.join(migrationsDirectory, file), "utf8"));
const schemaMigration = migrationSql.find((sql) => sql.includes('CREATE TABLE public."AI_Crypto_Bot_Profiles"'));
const seedMigration = migrationSql.find((sql) => sql.includes('INSERT INTO public."AI_Crypto_Bot_Watched_Markets"'));
const paperTradingMigration = migrationSql.find((sql) =>
  sql.includes('CREATE FUNCTION public."AI_Crypto_Bot_Run_Paper_Trading"')
);
const confidenceThresholdMigration = migrationSql.find((sql) =>
  sql.includes("v_decision.confidence < 67")
);
const tradeHistoryMigration = migrationSql.find((sql) =>
  sql.includes('CREATE FUNCTION public."AI_Crypto_Bot_Trade_History_Stats"')
);
const candleCheckpointMigration = migrationSql.find((sql) =>
  sql.includes('CREATE FUNCTION public."AI_Crypto_Bot_Get_Latest_Candle_Checkpoints"')
);
const aiCandleHistoryMigration = migrationSql.find((sql) =>
  sql.includes('CREATE FUNCTION public."AI_Crypto_Bot_Get_Latest_AI_Candles"')
);
const compactAiCandleMigration = migrationSql.find((sql) =>
  sql.includes('CREATE FUNCTION public."AI_Crypto_Bot_Get_Latest_AI_Candles_Compact"')
);
const shadowExitMigration = migrationSql.find((sql) =>
  sql.includes('CREATE FUNCTION public."AI_Crypto_Bot_Evaluate_Shadow_Exit_Scenarios"')
);
const realtimePublicationMigration = migrationSql.find((sql) =>
  sql.includes("ALTER PUBLICATION supabase_realtime")
);
const realtimeSurfaceSubscriptions = require("../js/realtime.js").surfaceSubscriptions;

async function createDatabase() {
  const { PGlite } = await import("@electric-sql/pglite");
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role WITH BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text UNIQUE
    );
    CREATE FUNCTION auth.uid()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
  `);
  await database.query(
    "INSERT INTO auth.users (id, email) VALUES ($1, $2)",
    ["10000000-0000-4000-8000-000000000001", "existing@example.test"]
  );
  await database.exec(schemaMigration);
  await database.exec(seedMigration);
  await database.exec(paperTradingMigration);
  await database.exec(confidenceThresholdMigration);
  await database.exec(tradeHistoryMigration);
  await database.exec(candleCheckpointMigration);
  await database.exec(shadowExitMigration);
  await database.exec(aiCandleHistoryMigration);
  await database.exec(compactAiCandleMigration);
  return database;
}

async function withRole(database, role, callback) {
  await database.exec(`SET ROLE ${role}`);
  try {
    return await callback();
  } finally {
    await database.exec("RESET ROLE");
  }
}

async function getInitialPortfolio(database) {
  const portfolio = await database.query(
    `SELECT id FROM public."AI_Crypto_Bot_Portfolios"
     WHERE user_id = $1 ORDER BY created_at LIMIT 1`,
    ["10000000-0000-4000-8000-000000000001"]
  );
  return portfolio.rows[0].id;
}

async function getInitialPortfolioForUser(database, userId) {
  const portfolio = await database.query(
    `SELECT id FROM public."AI_Crypto_Bot_Portfolios"
     WHERE user_id = $1 ORDER BY created_at LIMIT 1`,
    [userId]
  );
  return portfolio.rows[0].id;
}

test("Realtime publication includes the tables required by authenticated UI surfaces", () => {
  assert.ok(realtimePublicationMigration);
  assert.match(realtimePublicationMigration, /pg_catalog\.pg_publication/);
  assert.match(realtimePublicationMigration, /pg_catalog\.pg_publication_tables/);
  assert.match(realtimePublicationMigration, /RAISE EXCEPTION/);

  const requiredRealtimeTables = [...new Set(
    Object.values(realtimeSurfaceSubscriptions)
      .flat()
      .map((subscription) => subscription.table)
  )].sort();
  const configuredRealtimeTables = [...new Set(
    [...realtimePublicationMigration.matchAll(/'(AI_Crypto_Bot_[A-Za-z0-9_]+)'/g)]
      .map((match) => match[1])
  )].sort();
  assert.deepEqual(configuredRealtimeTables, requiredRealtimeTables);
  assert.equal(new Set(requiredRealtimeTables).size, requiredRealtimeTables.length);
});

async function setMarketPrice(database, symbol, price) {
  await database.query(
    `INSERT INTO public."AI_Crypto_Bot_Market_Data"
      (symbol, price, high_24h, low_24h, captured_at)
     VALUES ($1, $2, $2, $2, now())
     ON CONFLICT (symbol) DO UPDATE
       SET price = EXCLUDED.price,
           high_24h = EXCLUDED.high_24h,
           low_24h = EXCLUDED.low_24h,
           captured_at = EXCLUDED.captured_at`,
    [symbol, price]
  );
}

async function setMarketPriceAt(database, symbol, price, capturedAt) {
  await database.query(
    `INSERT INTO public."AI_Crypto_Bot_Market_Data"
      (symbol, price, high_24h, low_24h, captured_at)
     VALUES ($1, $2, $2, $2, $3)
     ON CONFLICT (symbol) DO UPDATE
       SET price = EXCLUDED.price,
           high_24h = EXCLUDED.high_24h,
           low_24h = EXCLUDED.low_24h,
           captured_at = EXCLUDED.captured_at`,
    [symbol, price, capturedAt]
  );
}

async function addDecision(database, symbol, decision, confidence = 80) {
  return database.query(
    `INSERT INTO public."AI_Crypto_Bot_AI_Decisions"
      (symbol, decision, confidence, reason, created_at)
     VALUES ($1, $2, $3, 'Paper trading integration fixture', now())
     RETURNING id`,
    [symbol, decision, confidence]
  );
}

async function addOpenPosition(database, portfolioId, symbol = "BTC-EUR", {
  amount = 1,
  entryPrice = 100
} = {}) {
  const result = await database.query(
    `INSERT INTO public."AI_Crypto_Bot_Positions"
      (portfolio_id, symbol, amount, entry_price, current_price)
     VALUES ($1, $2, $3, $4, $4)
     RETURNING id`,
    [portfolioId, symbol, amount, entryPrice]
  );
  return result.rows[0].id;
}

async function runPaperTrading(database) {
  const result = await database.query(
    `SELECT public."AI_Crypto_Bot_Run_Paper_Trading"() AS result`
  );
  return result.rows[0].result;
}

async function runShadowEvaluation(database) {
  const result = await database.query(
    `SELECT public."AI_Crypto_Bot_Evaluate_Shadow_Exit_Scenarios"() AS result`
  );
  return result.rows[0].result;
}

test("database migration contract covers all prefixed tables, RLS policies, and seed configuration", () => {
  assert.deepEqual(validateDatabase(), []);
  assert.equal(requiredTables.length, 18);
  assert.deepEqual(markets.slice(0, 5).map(({ symbol }) => symbol), [
    "BTC-EUR",
    "ETH-EUR",
    "SOL-EUR",
    "XRP-EUR",
    "ADA-EUR"
  ]);
  assert.equal(new Set(markets.map(({ symbol }) => symbol)).size, markets.length);
});

test("shadow exit migration adds prefixed, constrained, indexed, RLS-protected state and service RPC", async () => {
  assert.ok(shadowExitMigration);
  assert.match(shadowExitMigration, /AI_Crypto_Bot_Shadow_Exit_Scenarios_rule_key/);
  assert.match(shadowExitMigration, /AI_Crypto_Bot_Shadow_Exit_Scenarios_select_own/);
  assert.match(shadowExitMigration, /AI_Crypto_Bot_Shadow_Exit_Events_select_own/);
  assert.match(shadowExitMigration, /REVOKE ALL ON FUNCTION[\s\S]+FROM PUBLIC, anon, authenticated/);
  assert.match(shadowExitMigration, /GRANT EXECUTE ON FUNCTION[\s\S]+TO service_role/);
  assert.match(shadowExitMigration, /pg_try_advisory_xact_lock\(882018082\)/);

  const database = await createDatabase();
  try {
    const ownerId = "10000000-0000-4000-8000-000000000001";
    const otherId = "20000000-0000-4000-8000-000000000002";
    const ownerPortfolioId = await getInitialPortfolio(database);
    await database.query(
      "INSERT INTO auth.users (id, email) VALUES ($1, $2)",
      [otherId, "other@example.test"]
    );
    const otherPortfolioId = await getInitialPortfolioForUser(database, otherId);
    const positionId = await addOpenPosition(database, ownerPortfolioId);
    await setMarketPrice(database, "BTC-EUR", 100);
    await runShadowEvaluation(database);

    const privileges = await database.query(`
      SELECT
        has_function_privilege(
          'service_role',
          'public."AI_Crypto_Bot_Evaluate_Shadow_Exit_Scenarios"()',
          'EXECUTE'
        ) AS service_role_can_execute,
        has_function_privilege(
          'authenticated',
          'public."AI_Crypto_Bot_Evaluate_Shadow_Exit_Scenarios"()',
          'EXECUTE'
        ) AS authenticated_can_execute,
        (
          SELECT relrowsecurity
          FROM pg_catalog.pg_class
          WHERE oid = 'public."AI_Crypto_Bot_Shadow_Exit_Scenarios"'::regclass
        ) AS scenario_rls,
        (
          SELECT relrowsecurity
          FROM pg_catalog.pg_class
          WHERE oid = 'public."AI_Crypto_Bot_Shadow_Exit_Events"'::regclass
        ) AS event_rls
    `);
    assert.deepEqual(privileges.rows[0], {
      service_role_can_execute: true,
      authenticated_can_execute: false,
      scenario_rls: true,
      event_rls: true
    });

    const ownerRows = await withRole(database, "authenticated", async () => {
      await database.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
      const scenarios = await database.query(
        `SELECT position_id, rule_id
         FROM public."AI_Crypto_Bot_Shadow_Exit_Scenarios"
         ORDER BY rule_id`
      );
      const events = await database.query(
        `SELECT event_type FROM public."AI_Crypto_Bot_Shadow_Exit_Events"`
      );
      return { scenarios, events };
    });
    assert.equal(ownerRows.scenarios.rows.length, 7);
    assert.deepEqual(ownerRows.scenarios.rows.map(({ rule_id }) => rule_id).sort(), [
      "fixed_tp_10",
      "fixed_tp_15",
      "fixed_tp_20",
      "fixed_tp_5",
      "trailing_stop_10",
      "trailing_stop_15",
      "trailing_stop_5"
    ]);
    assert.ok(ownerRows.scenarios.rows.every(({ position_id }) => position_id === positionId));
    assert.equal(ownerRows.events.rows.length, 7);

    const otherRows = await withRole(database, "authenticated", async () => {
      await database.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [otherId]);
      return database.query(
        `SELECT id FROM public."AI_Crypto_Bot_Shadow_Exit_Scenarios"`
      );
    });
    assert.deepEqual(otherRows.rows, []);
    assert.equal(otherPortfolioId !== ownerPortfolioId, true);

    await assert.rejects(
      withRole(database, "anon", () =>
        database.query(`SELECT id FROM public."AI_Crypto_Bot_Shadow_Exit_Scenarios"`)
      ),
      { code: "42501" }
    );
    await assert.rejects(
      withRole(database, "authenticated", () =>
        database.query(
          `INSERT INTO public."AI_Crypto_Bot_Shadow_Exit_Events" (event_type, dedupe_key)
           VALUES ('EVALUATION_FAILED', 'client-write')`
        )
      ),
      { code: "42501" }
    );
    await assert.rejects(
      database.query(
        `INSERT INTO public."AI_Crypto_Bot_Shadow_Exit_Scenarios"
          (position_id, portfolio_id, symbol, position_opened_at, amount, entry_price,
           rule_id, rule_version, parameters)
         VALUES ($1, $2, 'BTC-EUR', now(), 1, 100, 'unknown_rule', '1.0.0', '{}'::jsonb)`,
        [positionId, ownerPortfolioId]
      ),
      { code: "23514" }
    );
    const indexes = await database.query(`
      SELECT indexname
      FROM pg_catalog.pg_indexes
      WHERE schemaname = 'public'
        AND indexname LIKE 'AI_Crypto_Bot_Shadow_Exit_%'
      ORDER BY indexname
    `);
    assert.deepEqual(indexes.rows.map(({ indexname }) => indexname), [
      "AI_Crypto_Bot_Shadow_Exit_Events_dedupe_key_key",
      "AI_Crypto_Bot_Shadow_Exit_Events_pkey",
      "AI_Crypto_Bot_Shadow_Exit_Events_position_event_idx",
      "AI_Crypto_Bot_Shadow_Exit_Events_scenario_event_idx",
      "AI_Crypto_Bot_Shadow_Exit_Scenarios_pkey",
      "AI_Crypto_Bot_Shadow_Exit_Scenarios_recent_closed_idx",
      "AI_Crypto_Bot_Shadow_Exit_Scenarios_rule_key"
    ]);
  } finally {
    await database.close();
  }
});

test("shadow fixed targets trigger only on a fresh observed mark and never mutate trading records", async () => {
  const database = await createDatabase();
  try {
    const portfolioId = await getInitialPortfolio(database);
    const positionId = await addOpenPosition(database, portfolioId);
    const baseTime = new Date(Date.now() - 60_000);
    await setMarketPriceAt(database, "BTC-EUR", 104.5, baseTime);
    const before = await database.query(
      `SELECT available_balance, portfolio_value
       FROM public."AI_Crypto_Bot_Portfolios" WHERE id = $1`,
      [portfolioId]
    );

    const initialized = await runShadowEvaluation(database);
    assert.equal(initialized.status, "COMPLETED");
    let scenarios = await database.query(
      `SELECT rule_id, status, tracking_started_at, last_mark, modeled_net_pnl
       FROM public."AI_Crypto_Bot_Shadow_Exit_Scenarios"
       WHERE position_id = $1 ORDER BY rule_id`,
      [positionId]
    );
    assert.equal(scenarios.rows.length, 7);
    assert.ok(scenarios.rows.every(({ status }) => status === "TRACKING"));
    assert.ok(scenarios.rows.every(({ tracking_started_at }) => (
      new Date(tracking_started_at).getTime() === baseTime.getTime()
    )));

    const nextMarkAt = new Date(baseTime.getTime() + 1000);
    await setMarketPriceAt(database, "BTC-EUR", 106, nextMarkAt);
    await runShadowEvaluation(database);
    scenarios = await database.query(
      `SELECT rule_id, status, triggered_at, trigger_mark, modeled_net_pnl
       FROM public."AI_Crypto_Bot_Shadow_Exit_Scenarios"
       WHERE position_id = $1 ORDER BY rule_id`,
      [positionId]
    );
    const fixedFive = scenarios.rows.find(({ rule_id }) => rule_id === "fixed_tp_5");
    assert.equal(fixedFive.status, "TRIGGERED");
    assert.equal(new Date(fixedFive.triggered_at).getTime(), nextMarkAt.getTime());
    assert.equal(Number(fixedFive.trigger_mark), 106);
    assert.ok(Math.abs(Number(fixedFive.modeled_net_pnl) - 5.629265) < 0.000001);
    assert.equal(
      scenarios.rows.find(({ rule_id }) => rule_id === "fixed_tp_10").status,
      "TRACKING"
    );
    assert.equal(
      scenarios.rows.find(({ rule_id }) => rule_id === "trailing_stop_5").status,
      "TRACKING"
    );

    const [trades, position, after] = await Promise.all([
      database.query(`SELECT count(*)::integer AS count FROM public."AI_Crypto_Bot_Trades"`),
      database.query(
        `SELECT status FROM public."AI_Crypto_Bot_Positions" WHERE id = $1`,
        [positionId]
      ),
      database.query(
        `SELECT available_balance, portfolio_value
         FROM public."AI_Crypto_Bot_Portfolios" WHERE id = $1`,
        [portfolioId]
      )
    ]);
    assert.equal(trades.rows[0].count, 0);
    assert.equal(position.rows[0].status, "OPEN");
    assert.deepEqual(after.rows, before.rows);
  } finally {
    await database.close();
  }
});

test("shadow trailing rules persist high-water marks and arm before testing retracements", async () => {
  const database = await createDatabase();
  try {
    const portfolioId = await getInitialPortfolio(database);
    const positionId = await addOpenPosition(database, portfolioId);
    const baseTime = new Date(Date.now() - 60_000);
    await setMarketPriceAt(database, "BTC-EUR", 100, baseTime);
    await runShadowEvaluation(database);

    await setMarketPriceAt(database, "BTC-EUR", 106, new Date(baseTime.getTime() + 1000));
    await runShadowEvaluation(database);
    let trailing = await database.query(
      `SELECT rule_id, trailing_armed, activated_at, high_water_mark
       FROM public."AI_Crypto_Bot_Shadow_Exit_Scenarios"
       WHERE position_id = $1 AND rule_id LIKE 'trailing_stop_%'
       ORDER BY rule_id`,
      [positionId]
    );
    assert.equal(trailing.rows.length, 3);
    assert.ok(trailing.rows.every(({ trailing_armed, high_water_mark }) => (
      trailing_armed && Number(high_water_mark) === 106
    )));
    assert.ok(trailing.rows.every(({ activated_at }) => activated_at !== null));

    await setMarketPriceAt(database, "BTC-EUR", 110, new Date(baseTime.getTime() + 2000));
    await runShadowEvaluation(database);
    trailing = await database.query(
      `SELECT rule_id, status, high_water_mark
       FROM public."AI_Crypto_Bot_Shadow_Exit_Scenarios"
       WHERE position_id = $1 AND rule_id LIKE 'trailing_stop_%'
       ORDER BY rule_id`,
      [positionId]
    );
    assert.ok(trailing.rows.every(({ high_water_mark }) => Number(high_water_mark) === 110));

    await setMarketPriceAt(database, "BTC-EUR", 101, new Date(baseTime.getTime() + 3000));
    await runShadowEvaluation(database);
    trailing = await database.query(
      `SELECT rule_id, status, high_water_mark
       FROM public."AI_Crypto_Bot_Shadow_Exit_Scenarios"
       WHERE position_id = $1 AND rule_id LIKE 'trailing_stop_%'
       ORDER BY rule_id`,
      [positionId]
    );
    assert.equal(trailing.rows.find(({ rule_id }) => rule_id === "trailing_stop_5").status, "TRIGGERED");
    assert.equal(trailing.rows.find(({ rule_id }) => rule_id === "trailing_stop_10").status, "TRACKING");
    assert.equal(trailing.rows.find(({ rule_id }) => rule_id === "trailing_stop_15").status, "TRACKING");
    assert.ok(trailing.rows.every(({ high_water_mark }) => Number(high_water_mark) === 110));
  } finally {
    await database.close();
  }
});

test("shadow tracking for pre-existing positions starts at the first fresh mark and stale or future marks cannot trigger", async () => {
  const database = await createDatabase();
  try {
    const portfolioId = await getInitialPortfolio(database);
    const positionId = await addOpenPosition(database, portfolioId);
    const staleAt = new Date(Date.now() - 16 * 60_000);
    await setMarketPriceAt(database, "BTC-EUR", 130, staleAt);
    await runShadowEvaluation(database);

    let scenarios = await database.query(
      `SELECT status, tracking_started_at, last_mark, data_quality_status
       FROM public."AI_Crypto_Bot_Shadow_Exit_Scenarios"
       WHERE position_id = $1`,
      [positionId]
    );
    assert.equal(scenarios.rows.length, 7);
    assert.ok(scenarios.rows.every(({ status, tracking_started_at, last_mark, data_quality_status }) => (
      status === "TRACKING"
      && tracking_started_at === null
      && last_mark === null
      && data_quality_status === "STALE"
    )));

    const futureAt = new Date(Date.now() + 2 * 60_000);
    await setMarketPriceAt(database, "BTC-EUR", 130, futureAt);
    await runShadowEvaluation(database);
    scenarios = await database.query(
      `SELECT status, tracking_started_at, last_mark, data_quality_status
       FROM public."AI_Crypto_Bot_Shadow_Exit_Scenarios"
       WHERE position_id = $1`,
      [positionId]
    );
    assert.ok(scenarios.rows.every(({ status, tracking_started_at, last_mark, data_quality_status }) => (
      status === "TRACKING"
      && tracking_started_at === null
      && last_mark === null
      && data_quality_status === "INVALID"
    )));

    const freshAt = new Date(Date.now() - 1000);
    await setMarketPriceAt(database, "BTC-EUR", 130, freshAt);
    await runShadowEvaluation(database);
    scenarios = await database.query(
      `SELECT rule_id, status, tracking_started_at, triggered_at, last_mark_captured_at
       FROM public."AI_Crypto_Bot_Shadow_Exit_Scenarios"
       WHERE position_id = $1 ORDER BY rule_id`,
      [positionId]
    );
    const fixedFive = scenarios.rows.find(({ rule_id }) => rule_id === "fixed_tp_5");
    assert.equal(fixedFive.status, "TRIGGERED");
    assert.equal(new Date(fixedFive.tracking_started_at).getTime(), freshAt.getTime());
    assert.equal(new Date(fixedFive.triggered_at).getTime(), freshAt.getTime());
    assert.equal(new Date(fixedFive.last_mark_captured_at).getTime(), freshAt.getTime());
    const events = await database.query(
      `SELECT event_type, event_at
       FROM public."AI_Crypto_Bot_Shadow_Exit_Events"
       WHERE position_id = $1 AND event_type = 'HYPOTHETICAL_TRIGGERED'`,
      [positionId]
    );
    assert.ok(events.rows.every(({ event_at }) => new Date(event_at).getTime() >= freshAt.getTime()));
  } finally {
    await database.close();
  }
});

test("shadow retries and overlapping evaluations do not duplicate scenarios or transition events", async () => {
  const database = await createDatabase();
  try {
    const portfolioId = await getInitialPortfolio(database);
    const positionId = await addOpenPosition(database, portfolioId);
    await setMarketPrice(database, "BTC-EUR", 100);
    await runShadowEvaluation(database);
    await runShadowEvaluation(database);
    await Promise.all([runShadowEvaluation(database), runShadowEvaluation(database)]);

    const scenarios = await database.query(
      `SELECT count(*)::integer AS count
       FROM public."AI_Crypto_Bot_Shadow_Exit_Scenarios"
       WHERE position_id = $1`,
      [positionId]
    );
    const events = await database.query(
      `SELECT event_type, count(*)::integer AS count
       FROM public."AI_Crypto_Bot_Shadow_Exit_Events"
       WHERE position_id = $1
       GROUP BY event_type`,
      [positionId]
    );
    assert.equal(scenarios.rows[0].count, 7);
    assert.deepEqual(events.rows, [{ event_type: "TRACKING_STARTED", count: 7 }]);
  } finally {
    await database.close();
  }
});

test("actual paper SELL finalizes shadow scenarios without changing trades or balances", async () => {
  const database = await createDatabase();
  try {
    const portfolioId = await getInitialPortfolio(database);
    await setMarketPrice(database, "BTC-EUR", 100);
    await addDecision(database, "BTC-EUR", "BUY", 80);
    await runPaperTrading(database);
    await runShadowEvaluation(database);

    await setMarketPrice(database, "BTC-EUR", 110);
    await runShadowEvaluation(database);
    await addDecision(database, "BTC-EUR", "SELL", 80);
    await runPaperTrading(database);
    const beforeFinalize = await database.query(
      `SELECT side, price, quantity, fees, slippage, realized_pnl, created_at
       FROM public."AI_Crypto_Bot_Trades"
       WHERE portfolio_id = $1 ORDER BY created_at, id`,
      [portfolioId]
    );
    const portfolioBeforeFinalize = await database.query(
      `SELECT available_balance, portfolio_value
       FROM public."AI_Crypto_Bot_Portfolios" WHERE id = $1`,
      [portfolioId]
    );
    await runShadowEvaluation(database);

    const sellTrade = beforeFinalize.rows.find(({ side }) => side === "SELL");
    assert.ok(sellTrade);
    const scenarios = await database.query(
      `SELECT rule_id, status, actual_closed_at, actual_close_price, actual_net_pnl, actual_trade_id
       FROM public."AI_Crypto_Bot_Shadow_Exit_Scenarios"
       ORDER BY rule_id`
    );
    assert.equal(scenarios.rows.length, 7);
    assert.equal(
      scenarios.rows.find(({ rule_id }) => rule_id === "fixed_tp_5").status,
      "TRIGGERED"
    );
    assert.ok(scenarios.rows
      .filter(({ rule_id }) => rule_id !== "fixed_tp_5")
      .every(({ status }) => status === "CLOSED_WITHOUT_TRIGGER"));
    assert.ok(scenarios.rows.every(({ actual_closed_at }) => (
      new Date(actual_closed_at).getTime() === new Date(sellTrade.created_at).getTime()
    )));
    assert.ok(scenarios.rows.every(({ actual_close_price }) => (
      Number(actual_close_price) === Number(sellTrade.price)
    )));
    assert.ok(scenarios.rows.every(({ actual_net_pnl }) => (
      Number(actual_net_pnl) === Number(sellTrade.realized_pnl)
    )));
    assert.ok(scenarios.rows.every(({ actual_trade_id }) => actual_trade_id !== null));

    const [tradesAfterFinalize, portfolioAfterFinalize] = await Promise.all([
      database.query(
        `SELECT side, price, quantity, fees, slippage, realized_pnl, created_at
         FROM public."AI_Crypto_Bot_Trades"
         WHERE portfolio_id = $1 ORDER BY created_at, id`,
        [portfolioId]
      ),
      database.query(
        `SELECT available_balance, portfolio_value
         FROM public."AI_Crypto_Bot_Portfolios" WHERE id = $1`,
        [portfolioId]
      )
    ]);
    assert.deepEqual(tradesAfterFinalize.rows, beforeFinalize.rows);
    assert.deepEqual(portfolioAfterFinalize.rows, portfolioBeforeFinalize.rows);
  } finally {
    await database.close();
  }
});

test("trade-history statistics aggregate stored SELL trades and remain scoped by RLS", async () => {
  const database = await createDatabase();
  try {
    const ownerId = "10000000-0000-4000-8000-000000000001";
    const ownerPortfolioId = await getInitialPortfolio(database);
    const emptyStats = await withRole(database, "authenticated", async () => {
      await database.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
      return database.query(
        `SELECT * FROM public."AI_Crypto_Bot_Trade_History_Stats"()`
      );
    });
    assert.equal(Number(emptyStats.rows[0].closed_trade_count), 0);
    assert.equal(emptyStats.rows[0].average_profit, null);
    assert.equal(emptyStats.rows[0].worst_trade, null);

    await database.query(
      `INSERT INTO public."AI_Crypto_Bot_Trades"
        (portfolio_id, idempotency_key, symbol, side, price, quantity, realized_pnl)
       VALUES
        ($1, '50000000-0000-4000-8000-000000000011', 'BTC-EUR', 'SELL', 100, 1, 12),
        ($1, '50000000-0000-4000-8000-000000000012', 'ETH-EUR', 'SELL', 100, 1, -4),
        ($1, '50000000-0000-4000-8000-000000000013', 'SOL-EUR', 'SELL', 100, 1, 0),
        ($1, '50000000-0000-4000-8000-000000000014', 'XRP-EUR', 'BUY', 100, 1, 999)`,
      [ownerPortfolioId]
    );

    const otherId = "20000000-0000-4000-8000-000000000002";
    await database.query(
      "INSERT INTO auth.users (id, email) VALUES ($1, $2)",
      [otherId, "other@example.test"]
    );
    const otherPortfolioId = await getInitialPortfolioForUser(database, otherId);
    await database.query(
      `INSERT INTO public."AI_Crypto_Bot_Trades"
        (portfolio_id, idempotency_key, symbol, side, price, quantity, realized_pnl)
       VALUES ($1, '50000000-0000-4000-8000-000000000015', 'BTC-EUR', 'SELL', 100, 1, 1000)`,
      [otherPortfolioId]
    );

    const stats = await withRole(database, "authenticated", async () => {
      await database.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
      return database.query(
        `SELECT * FROM public."AI_Crypto_Bot_Trade_History_Stats"()`
      );
    });
    assert.deepEqual(
      Object.fromEntries(Object.entries(stats.rows[0]).map(([key, value]) => [
        key,
        value === null ? null : Number(value)
      ])),
      {
        closed_trade_count: 3,
        winning_trade_count: 1,
        losing_trade_count: 1,
        average_profit: 12,
        average_loss: -4,
        best_trade: 12,
        worst_trade: -4
      }
    );

    await assert.rejects(
      withRole(database, "anon", () =>
        database.query(`SELECT * FROM public."AI_Crypto_Bot_Trade_History_Stats"()`)
      ),
      { code: "42501" }
    );
  } finally {
    await database.close();
  }
});

test("candle checkpoint RPC is service-role-only and returns each symbol's latest timestamp", async () => {
  assert.ok(candleCheckpointMigration);
  assert.match(candleCheckpointMigration, /LANGUAGE plpgsql\s+STABLE\s+SECURITY INVOKER/i);
  assert.match(candleCheckpointMigration, /SET search_path = ''/i);
  assert.match(candleCheckpointMigration, /REVOKE ALL ON FUNCTION[\s\S]+FROM PUBLIC, anon, authenticated/i);
  assert.match(candleCheckpointMigration, /GRANT EXECUTE ON FUNCTION[\s\S]+TO service_role/i);

  const database = await createDatabase();
  try {
    const olderTimestamp = "2026-03-20T11:00:00.000Z";
    const latestTimestamp = "2026-03-20T11:05:00.000Z";
    await database.query(
      `INSERT INTO public."AI_Crypto_Bot_Candles"
        (symbol, interval, timestamp, open, high, low, close, volume)
       VALUES
        ('BTC-EUR', '1m', $1, 100, 110, 90, 105, 10),
        ('BTC-EUR', '1m', $2, 105, 115, 100, 112, 12)`,
      [olderTimestamp, latestTimestamp]
    );

    const privileges = await database.query(`
      SELECT
        has_function_privilege(
          'service_role',
          'public."AI_Crypto_Bot_Get_Latest_Candle_Checkpoints"(text[],text)',
          'EXECUTE'
        ) AS service_role_can_execute,
        has_function_privilege(
          'anon',
          'public."AI_Crypto_Bot_Get_Latest_Candle_Checkpoints"(text[],text)',
          'EXECUTE'
        ) AS anon_can_execute,
        has_function_privilege(
          'authenticated',
          'public."AI_Crypto_Bot_Get_Latest_Candle_Checkpoints"(text[],text)',
          'EXECUTE'
        ) AS authenticated_can_execute
    `);
    assert.deepEqual(privileges.rows[0], {
      service_role_can_execute: true,
      anon_can_execute: false,
      authenticated_can_execute: false
    });

    const checkpoints = await database.query(
      `SELECT symbol, latest_timestamp
       FROM public."AI_Crypto_Bot_Get_Latest_Candle_Checkpoints"(
         ARRAY['BTC-EUR', 'ETH-EUR', 'BTC-EUR'],
         '1m'
       )`
    );
    assert.deepEqual(checkpoints.rows, [{
      symbol: "BTC-EUR",
      latest_timestamp: new Date(latestTimestamp)
    }]);

    await assert.rejects(
      database.query(
        `SELECT * FROM public."AI_Crypto_Bot_Get_Latest_Candle_Checkpoints"(
          ARRAY['BTC-EUR'],
          '2m'
        )`
      ),
      { code: "22023" }
    );
    await assert.rejects(
      withRole(database, "anon", () =>
        database.query(
          `SELECT * FROM public."AI_Crypto_Bot_Get_Latest_Candle_Checkpoints"(
            ARRAY['BTC-EUR'],
            '1m'
          )`
        )
      ),
      { code: "42501" }
    );
    await assert.rejects(
      withRole(database, "authenticated", () =>
        database.query(
          `SELECT * FROM public."AI_Crypto_Bot_Get_Latest_Candle_Checkpoints"(
            ARRAY['BTC-EUR'],
            '1m'
          )`
        )
      ),
      { code: "42501" }
    );

    const candleCount = await database.query(
      `SELECT count(*)::integer AS count FROM public."AI_Crypto_Bot_Candles"`
    );
    assert.equal(candleCount.rows[0].count, 2);
  } finally {
    await database.close();
  }
});

test("migrations apply, backfill auth profiles, and seed repeatably", async () => {
  const database = await createDatabase();
  try {
    const tables = await database.query(`
      SELECT relname
      FROM pg_catalog.pg_class
      WHERE relnamespace = 'public'::regnamespace
        AND relkind = 'r'
        AND relname LIKE 'AI_Crypto_Bot_%'
      ORDER BY relname
    `);
    assert.deepEqual(tables.rows.map(({ relname }) => relname).sort(), [...requiredTables].sort());

    const protectedTables = await database.query(`
      SELECT relname
      FROM pg_catalog.pg_class
      WHERE relnamespace = 'public'::regnamespace
        AND relkind = 'r'
        AND relname LIKE 'AI_Crypto_Bot_%'
        AND relrowsecurity
    `);
    assert.equal(protectedTables.rows.length, requiredTables.length);

    const backfilledProfile = await database.query(
      `SELECT email FROM public."AI_Crypto_Bot_Profiles" WHERE id = $1`,
      ["10000000-0000-4000-8000-000000000001"]
    );
    assert.equal(backfilledProfile.rows[0].email, "existing@example.test");
    const initialPortfolio = await database.query(
      `SELECT starting_balance, available_balance, portfolio_value
       FROM public."AI_Crypto_Bot_Portfolios"
       WHERE user_id = $1`,
      ["10000000-0000-4000-8000-000000000001"]
    );
    assert.deepEqual(
      Object.fromEntries(Object.entries(initialPortfolio.rows[0]).map(([key, value]) => [key, Number(value)])),
      {
        starting_balance: 10000,
        available_balance: 10000,
        portfolio_value: 10000
      }
    );

    await database.exec(seedMigration);
    const marketsCount = await database.query(
      `SELECT count(*)::integer AS count FROM public."AI_Crypto_Bot_Watched_Markets"`
    );
    const statusCount = await database.query(
      `SELECT count(*)::integer AS count FROM public."AI_Crypto_Bot_Status"`
    );
    const emergencyCount = await database.query(
      `SELECT count(*)::integer AS count FROM public."AI_Crypto_Bot_Emergency_State"`
    );
    const initialPortfolioCount = await database.query(
      `SELECT count(*)::integer AS count FROM public."AI_Crypto_Bot_Portfolios" WHERE user_id = $1`,
      ["10000000-0000-4000-8000-000000000001"]
    );
    assert.equal(marketsCount.rows[0].count, 5);
    assert.equal(statusCount.rows[0].count, 1);
    assert.equal(emergencyCount.rows[0].count, 1);
    assert.equal(initialPortfolioCount.rows[0].count, 1);
  } finally {
    await database.close();
  }
});

test("Agent Status and Emergency State remain independent and constrained", async () => {
  const database = await createDatabase();
  try {
    await assert.rejects(
      database.query(
        `UPDATE public."AI_Crypto_Bot_Status"
         SET status = 'ACTIVE'
         WHERE singleton`
      ),
      { code: "23514" }
    );
    await database.query(
      `UPDATE public."AI_Crypto_Bot_Status"
       SET status = 'ANALYZING', is_active = true, is_analyzing = true
       WHERE singleton`
    );
    await database.query(
      `INSERT INTO public."AI_Crypto_Bot_Emergency_State" (status, reason)
       VALUES ('EMERGENCY_STOP', 'Integration fixture')`
    );

    const status = await database.query(
      `SELECT status, is_active, is_analyzing
       FROM public."AI_Crypto_Bot_Status"
       WHERE singleton`
    );
    const emergency = await database.query(
      `SELECT status FROM public."AI_Crypto_Bot_Emergency_State"
       ORDER BY created_at DESC LIMIT 1`
    );
    assert.deepEqual(status.rows[0], {
      status: "ANALYZING",
      is_active: true,
      is_analyzing: true
    });
    assert.equal(emergency.rows[0].status, "EMERGENCY_STOP");
    await assert.rejects(
      database.query(
        `INSERT INTO public."AI_Crypto_Bot_Emergency_State" (status)
         VALUES ('ERROR')`
      ),
      { code: "23514" }
    );
  } finally {
    await database.close();
  }
});

test("Supabase Auth inserts provision profiles and synchronize email changes", async () => {
  const database = await createDatabase();
  try {
    const userId = "20000000-0000-4000-8000-000000000002";
    await database.query(
      "INSERT INTO auth.users (id, email) VALUES ($1, $2)",
      [userId, "new@example.test"]
    );
    let profile = await database.query(
      `SELECT email FROM public."AI_Crypto_Bot_Profiles" WHERE id = $1`,
      [userId]
    );
    assert.equal(profile.rows[0].email, "new@example.test");

    await database.query("UPDATE auth.users SET email = $2 WHERE id = $1", [userId, "updated@example.test"]);
    profile = await database.query(
      `SELECT email FROM public."AI_Crypto_Bot_Profiles" WHERE id = $1`,
      [userId]
    );
    assert.equal(profile.rows[0].email, "updated@example.test");
    const portfolio = await database.query(
      `SELECT starting_balance FROM public."AI_Crypto_Bot_Portfolios" WHERE user_id = $1`,
      [userId]
    );
    assert.equal(Number(portfolio.rows[0].starting_balance), 10000);
  } finally {
    await database.close();
  }
});

test("Auth user deletion cascades through owned database records", async () => {
  const database = await createDatabase();
  try {
    const userId = "10000000-0000-4000-8000-000000000001";
    const portfolioId = "30000000-0000-4000-8000-000000000003";
    await database.query(
      `INSERT INTO public."AI_Crypto_Bot_Portfolios"
        (id, user_id, starting_balance, available_balance, portfolio_value)
       VALUES ($1, $2, 1000, 1000, 1000)`,
      [portfolioId, userId]
    );
    await database.query(
      `INSERT INTO public."AI_Crypto_Bot_Positions"
        (portfolio_id, symbol, amount, entry_price, current_price)
       VALUES ($1, 'BTC-EUR', 1, 100, 100)`,
      [portfolioId]
    );

    await database.query("DELETE FROM auth.users WHERE id = $1", [userId]);

    const profiles = await database.query(
      `SELECT count(*)::integer AS count FROM public."AI_Crypto_Bot_Profiles" WHERE id = $1`,
      [userId]
    );
    const portfolios = await database.query(
      `SELECT count(*)::integer AS count FROM public."AI_Crypto_Bot_Portfolios" WHERE id = $1`,
      [portfolioId]
    );
    const positions = await database.query(
      `SELECT count(*)::integer AS count FROM public."AI_Crypto_Bot_Positions" WHERE portfolio_id = $1`,
      [portfolioId]
    );
    assert.equal(profiles.rows[0].count, 0);
    assert.equal(portfolios.rows[0].count, 0);
    assert.equal(positions.rows[0].count, 0);
  } finally {
    await database.close();
  }
});

test("authenticated reads are scoped to portfolio ownership while shared data is readable", async () => {
  const database = await createDatabase();
  try {
    const ownerId = "10000000-0000-4000-8000-000000000001";
    const otherId = "20000000-0000-4000-8000-000000000002";
    const ownerPortfolioId = "30000000-0000-4000-8000-000000000003";
    const otherPortfolioId = "40000000-0000-4000-8000-000000000004";
    await database.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [otherId, "other@example.test"]);
    await database.query(
      `DELETE FROM public."AI_Crypto_Bot_Portfolios" WHERE user_id IN ($1, $2)`,
      [ownerId, otherId]
    );
    await database.query(
      `INSERT INTO public."AI_Crypto_Bot_Portfolios"
        (id, user_id, starting_balance, available_balance, portfolio_value)
       VALUES ($1, $2, 1000, 1000, 1000), ($3, $4, 2000, 2000, 2000)`,
      [ownerPortfolioId, ownerId, otherPortfolioId, otherId]
    );
    await database.query(
      `INSERT INTO public."AI_Crypto_Bot_Positions"
        (portfolio_id, symbol, amount, entry_price, current_price)
       VALUES ($1, 'BTC-EUR', 1, 100, 100), ($2, 'ETH-EUR', 1, 50, 50)`,
      [ownerPortfolioId, otherPortfolioId]
    );
    await database.query(
      `INSERT INTO public."AI_Crypto_Bot_AI_Decisions"
        (symbol, decision, confidence, reason)
       VALUES ('BTC-EUR', 'HOLD', 75, 'Integration fixture')`
    );

    const visibleRows = await withRole(database, "authenticated", async () => {
      await database.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
      const profiles = await database.query(`SELECT id FROM public."AI_Crypto_Bot_Profiles" ORDER BY id`);
      const portfolios = await database.query(`SELECT id FROM public."AI_Crypto_Bot_Portfolios" ORDER BY id`);
      const positions = await database.query(`SELECT symbol FROM public."AI_Crypto_Bot_Positions" ORDER BY symbol`);
      const marketRows = await database.query(`SELECT symbol FROM public."AI_Crypto_Bot_Watched_Markets"`);
      const decisions = await database.query(`SELECT decision FROM public."AI_Crypto_Bot_AI_Decisions"`);
      return { profiles, portfolios, positions, marketRows, decisions };
    });

    assert.deepEqual(visibleRows.profiles.rows.map(({ id }) => id), [ownerId]);
    assert.deepEqual(visibleRows.portfolios.rows.map(({ id }) => id), [ownerPortfolioId]);
    assert.deepEqual(visibleRows.positions.rows.map(({ symbol }) => symbol), ["BTC-EUR"]);
    assert.equal(visibleRows.marketRows.rows.length, 5);
    assert.equal(visibleRows.decisions.rows.length, 1);
  } finally {
    await database.close();
  }
});

test("anonymous users cannot read data and authenticated users cannot write trading records", async () => {
  const database = await createDatabase();
  try {
    const userId = "10000000-0000-4000-8000-000000000001";
    const portfolioId = "30000000-0000-4000-8000-000000000003";
    await database.query(
      `INSERT INTO public."AI_Crypto_Bot_Portfolios"
        (id, user_id, starting_balance, available_balance, portfolio_value)
       VALUES ($1, $2, 1000, 1000, 1000)`,
      [portfolioId, userId]
    );

    await assert.rejects(
      withRole(database, "anon", () =>
        database.query(`SELECT * FROM public."AI_Crypto_Bot_Watched_Markets"`)
      ),
      { code: "42501" }
    );

    await withRole(database, "authenticated", async () => {
      await database.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
      await assert.rejects(
        database.query(
          `INSERT INTO public."AI_Crypto_Bot_Trades"
            (portfolio_id, idempotency_key, symbol, side, price, quantity)
           VALUES ($1, $2, 'BTC-EUR', 'BUY', 100, 1)`,
          [portfolioId, "50000000-0000-4000-8000-000000000005"]
        ),
        { code: "42501" }
      );
    });

    await withRole(database, "service_role", () => database.query(
      `INSERT INTO public."AI_Crypto_Bot_Trades"
        (portfolio_id, idempotency_key, symbol, side, price, quantity)
       VALUES ($1, $2, 'BTC-EUR', 'BUY', 100, 1)`,
      [portfolioId, "50000000-0000-4000-8000-000000000005"]
    ));

    const userTrades = await withRole(database, "authenticated", async () => {
      await database.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
      return database.query(
        `SELECT id FROM public."AI_Crypto_Bot_Trades" WHERE portfolio_id = $1`,
        [portfolioId]
      );
    });
    assert.equal(userTrades.rows.length, 1);
  } finally {
    await database.close();
  }
});

test("database constraints reject invalid trade, candle, and decision records", async () => {
  const database = await createDatabase();
  try {
    const portfolioId = "30000000-0000-4000-8000-000000000003";
    await database.query(
      `INSERT INTO public."AI_Crypto_Bot_Portfolios"
        (id, user_id, starting_balance, available_balance, portfolio_value)
       VALUES ($1, $2, 1000, 1000, 1000)`,
      [portfolioId, "10000000-0000-4000-8000-000000000001"]
    );

    await assert.rejects(
      database.query(
        `INSERT INTO public."AI_Crypto_Bot_Trades"
          (portfolio_id, idempotency_key, symbol, side, price, quantity)
         VALUES ($1, $2, 'BTC-EUR', 'HOLD', 100, 1)`,
        [portfolioId, "80000000-0000-4000-8000-000000000008"]
      ),
      { code: "23514" }
    );
    await assert.rejects(
      database.query(
        `INSERT INTO public."AI_Crypto_Bot_AI_Decisions"
          (symbol, decision, confidence, reason)
         VALUES ('BTC-EUR', 'BUY', 101, 'Invalid confidence')`
      ),
      { code: "23514" }
    );
    await assert.rejects(
      database.query(
        `INSERT INTO public."AI_Crypto_Bot_Candles"
          (symbol, interval, open, high, low, close, volume, "timestamp")
         VALUES ('UNKNOWN-EUR', '1m', 10, 11, 9, 10, 1, '2026-01-01T00:00:00Z')`
      ),
      { code: "23503" }
    );

    const idempotencyKey = "50000000-0000-4000-8000-000000000005";
    const trade = `INSERT INTO public."AI_Crypto_Bot_Trades"
      (portfolio_id, idempotency_key, symbol, side, price, quantity)
      VALUES ($1, $2, 'BTC-EUR', 'BUY', 100, 1)`;
    await database.query(trade, [portfolioId, idempotencyKey]);
    await assert.rejects(
      database.query(trade, [portfolioId, idempotencyKey]),
      { code: "23505" }
    );

    const strategyId = "60000000-0000-4000-8000-000000000006";
    await database.query(
      `INSERT INTO public."AI_Crypto_Bot_Strategies" (id, name, version)
       VALUES ($1, 'Momentum', '1.0.0')`,
      [strategyId]
    );
    const changeKey = "70000000-0000-4000-8000-000000000007";
    const strategyChange = `INSERT INTO public."AI_Crypto_Bot_Strategy_Changes"
      (strategy_id, idempotency_key, change_type, reason)
      VALUES ($1, $2, 'OPTIMIZATION', 'Integration fixture')`;
    await database.query(strategyChange, [strategyId, changeKey]);
    await assert.rejects(
      database.query(strategyChange, [strategyId, changeKey]),
      { code: "23505" }
    );
  } finally {
    await database.close();
  }
});

test("paper-trading RPC is service-role-only and internal execution functions stay private", async () => {
  const database = await createDatabase();
  try {
    await assert.rejects(
      withRole(database, "authenticated", () =>
        database.query(`SELECT public."AI_Crypto_Bot_Run_Paper_Trading"()`)
      ),
      { code: "42501" }
    );
    await withRole(database, "service_role", () =>
      database.query(`SELECT public."AI_Crypto_Bot_Run_Paper_Trading"()`)
    );
    await assert.rejects(
      withRole(database, "service_role", () =>
        database.query(
          `SELECT public."AI_Crypto_Bot_Apply_Paper_Decision"(
            gen_random_uuid(),
            gen_random_uuid()
          )`
        )
      ),
      { code: "42501" }
    );
  } finally {
    await database.close();
  }
});

test("AI candle history RPC matches legacy candle selection across markets and all intervals", async () => {
  const database = await createDatabase();
  try {
    await database.exec(`
      INSERT INTO public."AI_Crypto_Bot_Candles"
        (symbol, interval, open, high, low, close, volume, timestamp)
      SELECT markets.symbol,
             intervals.interval,
             series.n + markets.market_offset + intervals.interval_offset + 100,
             series.n + markets.market_offset + intervals.interval_offset + 102,
             series.n + markets.market_offset + intervals.interval_offset + 99,
             series.n + markets.market_offset + intervals.interval_offset + 101,
             (series.n + markets.market_offset + intervals.interval_offset + 100) * 10,
             now() - (180 - series.n) * interval '1 minute'
      FROM (VALUES ('BTC-EUR', 1000), ('ETH-EUR', 2000)) AS markets(symbol, market_offset)
      CROSS JOIN (VALUES
        ('1m', 0),
        ('5m', 10000),
        ('15m', 20000),
        ('1h', 30000),
        ('4h', 40000),
        ('1d', 50000)
      ) AS intervals(interval, interval_offset)
      CROSS JOIN generate_series(1, 200) AS series(n)
    `);

    const symbols = ["ETH-EUR", "BTC-EUR"];
    const intervals = ["1m", "5m", "15m", "1h", "4h", "1d"];
    const fields = 'symbol, "interval", open, high, low, close, volume, "timestamp"';
    for (const interval of intervals) {
      const legacy = await withRole(database, "service_role", () =>
        database.query(
          `SELECT ${fields}
           FROM public."AI_Crypto_Bot_Candles"
           WHERE symbol = ANY($1::text[]) AND "interval" = $2
           ORDER BY symbol ASC, "timestamp" DESC`,
          [symbols, interval]
        )
      );
      const rpc = await withRole(database, "service_role", () =>
        database.query(
          `SELECT symbol, candles
           FROM public."AI_Crypto_Bot_Get_Latest_AI_Candles_Compact"($1::text[], $2)`,
          [symbols, interval]
        )
      );

      assert.equal(rpc.rows.length, symbols.length);
      assert.deepEqual(rpc.rows.map(({ symbol }) => symbol), symbols);
      const decodedRows = rpc.rows.flatMap(({ symbol, candles }) => {
        assert.ok(Array.isArray(candles));
        assert.equal(candles.length, 150);
        assert.ok(candles.every((candle) => Array.isArray(candle) && candle.length === 6));
        assert.ok(candles.every((candle, index) => (
          index === 0 || Date.parse(candles[index - 1][0]) >= Date.parse(candle[0])
        )));
        return candles.map(([timestamp, open, high, low, close, volume]) => ({
          symbol,
          interval,
          open: Number(open),
          high: Number(high),
          low: Number(low),
          close: Number(close),
          volume: Number(volume),
          timestamp: new Date(timestamp).toISOString()
        }));
      });
      const expectedRows = symbols.flatMap((symbol) => legacy.rows
        .filter((row) => row.symbol === symbol)
        .slice(0, 150)
        .map((row) => ({
          symbol: row.symbol,
          interval: row.interval,
          open: Number(row.open),
          high: Number(row.high),
          low: Number(row.low),
          close: Number(row.close),
          volume: Number(row.volume),
          timestamp: new Date(row.timestamp).toISOString()
        })));
      assert.deepEqual(decodedRows, expectedRows);
      for (const symbol of symbols) {
        const actual = decodedRows.filter((row) => row.symbol === symbol);
        assert.equal(actual.length, 150);
        assert.equal(new Set(actual.map((row) => row.timestamp)).size, 150);
      }
      assert.notEqual(
        decodedRows.find((row) => row.symbol === symbols[0]).close,
        decodedRows.find((row) => row.symbol === symbols[1]).close
      );
    }

    const emptyResult = await withRole(database, "service_role", () =>
      database.query(
        `SELECT * FROM public."AI_Crypto_Bot_Get_Latest_AI_Candles_Compact"(
          ARRAY['SOL-EUR']::text[],
          '1m'
        )`
      )
    );
    assert.deepEqual(emptyResult.rows, [{ symbol: "SOL-EUR", candles: [] }]);

    async function callRpc(symbolExpression, intervalExpression = "'1m'") {
      return withRole(database, "service_role", () =>
        database.query(
          `SELECT * FROM public."AI_Crypto_Bot_Get_Latest_AI_Candles_Compact"(
            ${symbolExpression},
            ${intervalExpression}
          )`
        )
      );
    }

    const invalidCalls = [
      ["NULL::text[]", "'1m'"],
      ["ARRAY[NULL]::text[]", "'1m'"],
      ["ARRAY[]::text[]", "'1m'"],
      ["ARRAY['  ']::text[]", "'1m'"],
      ["ARRAY['BTC-EUR', 'BTC-EUR']::text[]", "'1m'"],
      ["ARRAY['btc-eur']::text[]", "'1m'"],
      ["ARRAY['BTC_USD']::text[]", "'1m'"],
      ["ARRAY['UNKNOWN-EUR']::text[]", "'1m'"],
      ["ARRAY['BTC-EUR', 'ETH-EUR', 'SOL-EUR', 'XRP-EUR', 'ADA-EUR']::text[]", "'1m'"],
      ["ARRAY['BTC-EUR']::text[]", "'2m'"],
      ["ARRAY['BTC-EUR']::text[]", "NULL::text"]
    ];
    for (const [symbolExpression, intervalExpression] of invalidCalls) {
      await assert.rejects(callRpc(symbolExpression, intervalExpression), { code: "22023" });
    }

    await database.query(
      `UPDATE public."AI_Crypto_Bot_Watched_Markets"
       SET enabled = false
       WHERE symbol = 'SOL-EUR'`
    );
    await assert.rejects(callRpc("ARRAY['SOL-EUR']::text[]"), { code: "22023" });

    assert.match(compactAiCandleMigration, /SECURITY INVOKER/i);
    assert.match(compactAiCandleMigration, /SET search_path = ''/i);
    assert.match(compactAiCandleMigration, /LIMIT 150/i);
    assert.match(compactAiCandleMigration, /jsonb_build_array/i);
    assert.match(compactAiCandleMigration, /ORDER BY latest\.timestamp DESC/i);
  } finally {
    await database.close();
  }
});

test("AI candle history RPC denies PUBLIC, anon, and authenticated and grants service_role", async () => {
  const database = await createDatabase();
  try {
    for (const functionName of [
      "AI_Crypto_Bot_Get_Latest_AI_Candles",
      "AI_Crypto_Bot_Get_Latest_AI_Candles_Compact"
    ]) {
      const publicPrivilege = await database.query(`
        SELECT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_proc AS proc
          CROSS JOIN LATERAL pg_catalog.aclexplode(proc.proacl) AS acl_entry
          WHERE proc.pronamespace = 'public'::regnamespace
            AND proc.proname = $1
            AND acl_entry.grantee = 0
            AND acl_entry.privilege_type = 'EXECUTE'
        ) AS public_can_execute
      `, [functionName]);
      assert.equal(publicPrivilege.rows[0].public_can_execute, false);

      for (const role of ["anon", "authenticated"]) {
        await assert.rejects(
          withRole(database, role, () =>
            database.query(
              `SELECT * FROM public."${functionName}"(
                ARRAY['BTC-EUR']::text[],
                '1m'
              )`
            )
          ),
          { code: "42501" }
        );
      }
      await withRole(database, "service_role", () =>
        database.query(
          `SELECT * FROM public."${functionName}"(
            ARRAY['BTC-EUR']::text[],
            '1m'
          )`
        )
      );
    }
  } finally {
    await database.close();
  }
});

test("paper trading buys from a stored confident AI decision with bounded fees and slippage", async () => {
  const database = await createDatabase();
  try {
    const portfolioId = await getInitialPortfolio(database);
    await setMarketPrice(database, "BTC-EUR", 100);
    const decision = await addDecision(database, "BTC-EUR", "BUY", 80);

    const result = await runPaperTrading(database);
    const trade = await database.query(
      `SELECT side, ai_decision_id, price, quantity, fees, slippage
       FROM public."AI_Crypto_Bot_Trades"
       WHERE portfolio_id = $1`,
      [portfolioId]
    );
    const position = await database.query(
      `SELECT status, amount, entry_price, current_price, unrealized_pnl
       FROM public."AI_Crypto_Bot_Positions"
       WHERE portfolio_id = $1`,
      [portfolioId]
    );
    const portfolio = await database.query(
      `SELECT available_balance, portfolio_value
       FROM public."AI_Crypto_Bot_Portfolios"
       WHERE id = $1`,
      [portfolioId]
    );

    assert.equal(result.tradesExecuted, 1);
    assert.equal(trade.rows.length, 1);
    assert.equal(trade.rows[0].side, "BUY");
    assert.equal(trade.rows[0].ai_decision_id, decision.rows[0].id);
    assert.ok(Number(trade.rows[0].price) > 100);
    assert.ok(Math.abs(Number(trade.rows[0].fees) - 2.5) < 0.000001);
    assert.ok(Math.abs(Number(trade.rows[0].slippage) - 0.999001) < 0.000001);
    assert.equal(position.rows[0].status, "OPEN");
    assert.ok(Number(position.rows[0].amount) > 0);
    assert.ok(Number(position.rows[0].amount) * Number(trade.rows[0].price) <= 1000.000001);
    assert.ok(Number(position.rows[0].entry_price) > Number(trade.rows[0].price));
    assert.ok(Number(position.rows[0].unrealized_pnl) < 0);
    assert.ok(
      Math.abs(
        Number(portfolio.rows[0].portfolio_value)
          - (Number(portfolio.rows[0].available_balance)
            + Number(position.rows[0].amount) * Number(position.rows[0].current_price))
      ) < 0.000001
    );
  } finally {
    await database.close();
  }
});

test("paper trading retries are idempotent and HOLD, WAIT, or below-threshold BUY decisions never trade", async () => {
  const database = await createDatabase();
  try {
    const portfolioId = await getInitialPortfolio(database);
    await setMarketPrice(database, "BTC-EUR", 100);
    await setMarketPrice(database, "ETH-EUR", 50);
    await setMarketPrice(database, "SOL-EUR", 20);
    await addDecision(database, "BTC-EUR", "BUY", 80);

    const firstRun = await runPaperTrading(database);
    const duplicateRun = await runPaperTrading(database);
    assert.equal(firstRun.tradesExecuted, 1);
    assert.equal(duplicateRun.tradesExecuted, 0);
    assert.equal(duplicateRun.duplicates, 1);

    await addDecision(database, "BTC-EUR", "WAIT", 95);
    await addDecision(database, "ETH-EUR", "HOLD", 95);
    await addDecision(database, "SOL-EUR", "BUY", 66);
    const noTradeRun = await runPaperTrading(database);
    const trades = await database.query(
      `SELECT count(*)::integer AS count
       FROM public."AI_Crypto_Bot_Trades"
       WHERE portfolio_id = $1`,
      [portfolioId]
    );
    assert.equal(noTradeRun.tradesExecuted, 0);
    assert.equal(trades.rows[0].count, 1);
  } finally {
    await database.close();
  }
});

test("paper trading accepts BUY confidence 67 and rejects confidence below 67", async () => {
  const database = await createDatabase();
  try {
    const portfolioId = await getInitialPortfolio(database);
    await setMarketPrice(database, "BTC-EUR", 100);
    await setMarketPrice(database, "ETH-EUR", 50);
    await addDecision(database, "BTC-EUR", "BUY", 66);

    const belowThreshold = await runPaperTrading(database);
    assert.equal(belowThreshold.tradesExecuted, 0);
    assert.equal(belowThreshold.skipped, 1);

    await addDecision(database, "ETH-EUR", "BUY", 67);
    const atThreshold = await runPaperTrading(database);
    const trades = await database.query(
      `SELECT symbol, side
       FROM public."AI_Crypto_Bot_Trades"
       WHERE portfolio_id = $1`,
      [portfolioId]
    );

    assert.equal(atThreshold.tradesExecuted, 1);
    assert.equal(atThreshold.skipped, 1);
    assert.deepEqual(trades.rows, [{ symbol: "ETH-EUR", side: "BUY" }]);
  } finally {
    await database.close();
  }
});

test("paper SELL closes positions and records realized P&L, fees, and slippage", async () => {
  const database = await createDatabase();
  try {
    const portfolioId = await getInitialPortfolio(database);
    await setMarketPrice(database, "BTC-EUR", 100);
    await addDecision(database, "BTC-EUR", "BUY", 80);
    await runPaperTrading(database);

    await setMarketPrice(database, "BTC-EUR", 110);
    await addDecision(database, "BTC-EUR", "SELL", 80);
    const result = await runPaperTrading(database);
    const position = await database.query(
      `SELECT status, unrealized_pnl
       FROM public."AI_Crypto_Bot_Positions"
       WHERE portfolio_id = $1`,
      [portfolioId]
    );
    const sellTrade = await database.query(
      `SELECT side, price, fees, slippage, realized_pnl
       FROM public."AI_Crypto_Bot_Trades"
       WHERE portfolio_id = $1 AND side = 'SELL'`,
      [portfolioId]
    );
    const portfolio = await database.query(
      `SELECT available_balance, portfolio_value
       FROM public."AI_Crypto_Bot_Portfolios"
       WHERE id = $1`,
      [portfolioId]
    );

    assert.equal(result.tradesExecuted, 1);
    assert.equal(position.rows[0].status, "CLOSED");
    assert.equal(Number(position.rows[0].unrealized_pnl), 0);
    assert.equal(sellTrade.rows[0].side, "SELL");
    assert.ok(Number(sellTrade.rows[0].price) < 110);
    assert.ok(Number(sellTrade.rows[0].fees) > 0);
    assert.ok(Number(sellTrade.rows[0].slippage) > 0);
    assert.ok(Number(sellTrade.rows[0].realized_pnl) > 0);
    assert.ok(Number(portfolio.rows[0].available_balance) > 10000);
    assert.equal(portfolio.rows[0].portfolio_value, portfolio.rows[0].available_balance);
  } finally {
    await database.close();
  }
});

test("paper trading blocks entries with insufficient funds and enforces the open-position limit", async () => {
  const database = await createDatabase();
  try {
    const portfolioId = await getInitialPortfolio(database);
    await database.query(
      `UPDATE public."AI_Crypto_Bot_Portfolios"
       SET available_balance = 0.000000000001
       WHERE id = $1`,
      [portfolioId]
    );
    await database.query(
      `INSERT INTO public."AI_Crypto_Bot_Positions"
        (portfolio_id, symbol, amount, entry_price, current_price)
       VALUES ($1, 'ETH-EUR', 99.999999, 100, 100)`,
      [portfolioId]
    );
    await setMarketPrice(database, "ETH-EUR", 100);
    await setMarketPrice(database, "BTC-EUR", 100);
    await addDecision(database, "BTC-EUR", "BUY", 80);

    const insufficientFunds = await runPaperTrading(database);
    assert.equal(insufficientFunds.tradesExecuted, 0);
    let trades = await database.query(
      `SELECT count(*)::integer AS count FROM public."AI_Crypto_Bot_Trades" WHERE portfolio_id = $1`,
      [portfolioId]
    );
    assert.equal(trades.rows[0].count, 0);

    const symbols = ["ETH-EUR", "SOL-EUR", "XRP-EUR", "ADA-EUR", "DOGE-EUR"];
    await database.query(
      `INSERT INTO public."AI_Crypto_Bot_Watched_Markets" (symbol, enabled, priority)
       VALUES ('DOGE-EUR', true, 6)`
    );
    await database.query(
      `UPDATE public."AI_Crypto_Bot_Portfolios"
       SET available_balance = 10000, portfolio_value = 10000
       WHERE id = $1`,
      [portfolioId]
    );
    for (const symbol of symbols) {
      await setMarketPrice(database, symbol, 100);
    }
    await database.query(
      `INSERT INTO public."AI_Crypto_Bot_Positions"
        (portfolio_id, symbol, amount, entry_price, current_price)
       VALUES
        ($1, 'SOL-EUR', 1, 100, 100),
        ($1, 'XRP-EUR', 1, 100, 100),
        ($1, 'ADA-EUR', 1, 100, 100),
        ($1, 'DOGE-EUR', 1, 100, 100)`,
      [portfolioId]
    );
    await addDecision(database, "BTC-EUR", "BUY", 80);
    const maxPositions = await runPaperTrading(database);
    trades = await database.query(
      `SELECT count(*)::integer AS count FROM public."AI_Crypto_Bot_Trades" WHERE portfolio_id = $1`,
      [portfolioId]
    );
    assert.equal(maxPositions.tradesExecuted, 0);
    assert.equal(trades.rows[0].count, 0);
  } finally {
    await database.close();
  }
});

test("paper trading enforces the per-market cooldown and refreshes portfolio valuation", async () => {
  const database = await createDatabase();
  try {
    const portfolioId = await getInitialPortfolio(database);
    await setMarketPrice(database, "BTC-EUR", 100);
    await addDecision(database, "BTC-EUR", "BUY", 80);
    await runPaperTrading(database);

    await setMarketPrice(database, "BTC-EUR", 105);
    await addDecision(database, "BTC-EUR", "SELL", 80);
    await runPaperTrading(database);
    await addDecision(database, "BTC-EUR", "BUY", 90);
    const cooldown = await runPaperTrading(database);
    const openPositions = await database.query(
      `SELECT count(*)::integer AS count
       FROM public."AI_Crypto_Bot_Positions"
       WHERE portfolio_id = $1 AND status = 'OPEN'`,
      [portfolioId]
    );
    const portfolio = await database.query(
      `SELECT portfolio_value, available_balance
       FROM public."AI_Crypto_Bot_Portfolios"
       WHERE id = $1`,
      [portfolioId]
    );
    const latestSnapshot = await database.query(
      `SELECT portfolio_value
       FROM public."AI_Crypto_Bot_Portfolio_Snapshots"
       WHERE portfolio_id = $1
       ORDER BY captured_at DESC, id DESC
       LIMIT 1`,
      [portfolioId]
    );

    assert.equal(cooldown.tradesExecuted, 0);
    assert.equal(openPositions.rows[0].count, 0);
    assert.ok(Number(portfolio.rows[0].available_balance) > 10000);
    assert.equal(portfolio.rows[0].portfolio_value, latestSnapshot.rows[0].portfolio_value);
  } finally {
    await database.close();
  }
});

test("paper trading enforces daily and maximum drawdown limits and activates the emergency stop", async () => {
  const database = await createDatabase();
  try {
    const portfolioId = await getInitialPortfolio(database);
    await database.query(
      `UPDATE public."AI_Crypto_Bot_Portfolio_Snapshots"
       SET captured_at = now() - INTERVAL '1 day'
       WHERE portfolio_id = $1`,
      [portfolioId]
    );
    await database.query(
      `UPDATE public."AI_Crypto_Bot_Portfolios"
       SET available_balance = 0
       WHERE id = $1`,
      [portfolioId]
    );
    await database.query(
      `INSERT INTO public."AI_Crypto_Bot_Positions"
        (portfolio_id, symbol, amount, entry_price, current_price)
       VALUES ($1, 'ETH-EUR', 100, 100, 100)`,
      [portfolioId]
    );
    await setMarketPrice(database, "BTC-EUR", 100);
    await setMarketPrice(database, "ETH-EUR", 94);
    const decision = await addDecision(database, "BTC-EUR", "BUY", 90);

    await database.query(
      `SELECT public."AI_Crypto_Bot_Refresh_Paper_Portfolio"($1)`,
      [portfolioId]
    );
    let result = await database.query(
      `SELECT public."AI_Crypto_Bot_Apply_Paper_Decision"($1, $2) AS result`,
      [portfolioId, decision.rows[0].id]
    );
    assert.equal(result.rows[0].result.status, "DAILY_DRAWDOWN_LIMIT");

    await database.query(
      `UPDATE public."AI_Crypto_Bot_Portfolio_Snapshots"
       SET portfolio_value = 8800
       WHERE id = (
         SELECT id
         FROM public."AI_Crypto_Bot_Portfolio_Snapshots"
         WHERE portfolio_id = $1
         ORDER BY captured_at, id
         LIMIT 1
       )`,
      [portfolioId]
    );
    await setMarketPrice(database, "ETH-EUR", 84);
    await database.query(
      `SELECT public."AI_Crypto_Bot_Refresh_Paper_Portfolio"($1)`,
      [portfolioId]
    );
    result = await database.query(
      `SELECT public."AI_Crypto_Bot_Apply_Paper_Decision"($1, $2) AS result`,
      [portfolioId, decision.rows[0].id]
    );
    assert.equal(result.rows[0].result.status, "MAX_DRAWDOWN_LIMIT");

    await setMarketPrice(database, "ETH-EUR", 79);
    await database.query(
      `SELECT public."AI_Crypto_Bot_Refresh_Paper_Portfolio"($1)`,
      [portfolioId]
    );
    result = await database.query(
      `SELECT public."AI_Crypto_Bot_Apply_Paper_Decision"($1, $2) AS result`,
      [portfolioId, decision.rows[0].id]
    );
    const emergency = await database.query(
      `SELECT status FROM public."AI_Crypto_Bot_Emergency_State"
       ORDER BY created_at DESC, id DESC LIMIT 1`
    );
    const agentStatus = await database.query(
      `SELECT status, is_active, is_analyzing
       FROM public."AI_Crypto_Bot_Status" WHERE singleton`
    );
    assert.equal(result.rows[0].result.status, "TRADING_PAUSED");
    assert.equal(emergency.rows[0].status, "EMERGENCY_STOP");
    assert.deepEqual(agentStatus.rows[0], {
      status: "STOPPED",
      is_active: false,
      is_analyzing: false
    });
  } finally {
    await database.close();
  }
});
