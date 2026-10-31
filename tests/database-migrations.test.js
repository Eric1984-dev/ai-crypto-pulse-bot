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

test("database migration contract covers all prefixed tables, RLS policies, and seed configuration", () => {
  assert.deepEqual(validateDatabase(), []);
  assert.equal(requiredTables.length, 16);
  assert.deepEqual(markets.map(({ symbol }) => symbol), [
    "BTC-EUR",
    "ETH-EUR",
    "SOL-EUR",
    "XRP-EUR",
    "ADA-EUR"
  ]);
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
    assert.equal(marketsCount.rows[0].count, markets.length);
    assert.equal(statusCount.rows[0].count, 1);
    assert.equal(emergencyCount.rows[0].count, 1);
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
    assert.equal(visibleRows.marketRows.rows.length, markets.length);
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
