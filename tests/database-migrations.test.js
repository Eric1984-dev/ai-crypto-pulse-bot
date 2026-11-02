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

async function addDecision(database, symbol, decision, confidence = 80) {
  return database.query(
    `INSERT INTO public."AI_Crypto_Bot_AI_Decisions"
      (symbol, decision, confidence, reason, created_at)
     VALUES ($1, $2, $3, 'Paper trading integration fixture', now())
     RETURNING id`,
    [symbol, decision, confidence]
  );
}

async function runPaperTrading(database) {
  const result = await database.query(
    `SELECT public."AI_Crypto_Bot_Run_Paper_Trading"() AS result`
  );
  return result.rows[0].result;
}

test("database migration contract covers all prefixed tables, RLS policies, and seed configuration", () => {
  assert.deepEqual(validateDatabase(), []);
  assert.equal(requiredTables.length, 16);
  assert.deepEqual(markets.slice(0, 5).map(({ symbol }) => symbol), [
    "BTC-EUR",
    "ETH-EUR",
    "SOL-EUR",
    "XRP-EUR",
    "ADA-EUR"
  ]);
  assert.equal(new Set(markets.map(({ symbol }) => symbol)).size, markets.length);
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
