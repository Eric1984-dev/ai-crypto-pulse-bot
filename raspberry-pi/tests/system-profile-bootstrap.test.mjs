import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL("../migrations/phase-7.7-system-profile-bootstrap.sql", import.meta.url);
const migrationSql = readFileSync(fileURLToPath(migrationUrl), "utf8");
const systemProfileId = "00000000-0000-4000-8000-000000000100";

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE TABLE public."AI_Crypto_Bot_Profiles" (
      id uuid PRIMARY KEY,
      email text
    );
    CREATE TABLE public."AI_Crypto_Bot_Portfolios" (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES public."AI_Crypto_Bot_Profiles"(id),
      starting_balance numeric NOT NULL,
      available_balance numeric NOT NULL,
      portfolio_value numeric NOT NULL
    );
    CREATE TABLE public."AI_Crypto_Bot_Positions" (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      portfolio_id uuid NOT NULL REFERENCES public."AI_Crypto_Bot_Portfolios"(id),
      status text NOT NULL
    );
    CREATE TABLE public."AI_Crypto_Bot_Portfolio_Snapshots" (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      portfolio_id uuid NOT NULL REFERENCES public."AI_Crypto_Bot_Portfolios"(id),
      portfolio_value numeric NOT NULL,
      available_balance numeric NOT NULL,
      open_positions integer NOT NULL,
      captured_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX "AI_Crypto_Bot_System_Profile_One_Portfolio"
      ON public."AI_Crypto_Bot_Portfolios" (user_id)
      WHERE user_id = '${systemProfileId}'::uuid;
  `);
  return database;
}

test("Phase 7.7 migration bootstraps the auth-independent system account and is repeat-safe", async () => {
  const database = await createDatabase();
  try {
    await database.exec(migrationSql);

    const initial = await database.query(`
      SELECT profile.email,
             portfolio.user_id,
             portfolio.starting_balance,
             portfolio.available_balance,
             portfolio.portfolio_value,
             snapshot.portfolio_value AS snapshot_value,
             snapshot.open_positions
      FROM public."AI_Crypto_Bot_Profiles" AS profile
      JOIN public."AI_Crypto_Bot_Portfolios" AS portfolio
        ON portfolio.user_id = profile.id
      JOIN public."AI_Crypto_Bot_Portfolio_Snapshots" AS snapshot
        ON snapshot.portfolio_id = portfolio.id
      WHERE profile.id = $1::uuid
    `, [systemProfileId]);
    assert.equal(initial.rows.length, 1);
    assert.equal(initial.rows[0].email, null);
    assert.equal(initial.rows[0].user_id, systemProfileId);
    assert.equal(initial.rows[0].starting_balance, "10000");
    assert.equal(initial.rows[0].available_balance, "10000");
    assert.equal(initial.rows[0].portfolio_value, "10000");
    assert.equal(initial.rows[0].snapshot_value, "10000");
    assert.equal(initial.rows[0].open_positions, 0);

    await database.exec(`
      UPDATE public."AI_Crypto_Bot_Portfolios"
      SET available_balance = 9250, portfolio_value = 9600
      WHERE user_id = '${systemProfileId}'::uuid;
    `);
    await database.exec(migrationSql);

    const repeated = await database.query(`
      SELECT portfolio.available_balance,
             portfolio.portfolio_value,
             count(snapshot.id)::integer AS snapshot_count
      FROM public."AI_Crypto_Bot_Portfolios" AS portfolio
      LEFT JOIN public."AI_Crypto_Bot_Portfolio_Snapshots" AS snapshot
        ON snapshot.portfolio_id = portfolio.id
      WHERE portfolio.user_id = $1::uuid
      GROUP BY portfolio.id
    `, [systemProfileId]);
    assert.deepEqual(repeated.rows, [{
      available_balance: "9250",
      portfolio_value: "9600",
      snapshot_count: 1
    }]);
  } finally {
    await database.close();
  }
});

test("Phase 7.7 migration creates a missing baseline snapshot without resetting an existing account", async () => {
  const database = await createDatabase();
  try {
    await database.query(
      `INSERT INTO public."AI_Crypto_Bot_Profiles" (id, email)
       VALUES ($1::uuid, NULL)`,
      [systemProfileId]
    );
    const portfolio = await database.query(
      `INSERT INTO public."AI_Crypto_Bot_Portfolios"
         (user_id, starting_balance, available_balance, portfolio_value)
       VALUES ($1::uuid, 10000, 8700, 9400)
       RETURNING id`,
      [systemProfileId]
    );
    await database.query(
      `INSERT INTO public."AI_Crypto_Bot_Positions" (portfolio_id, status)
       VALUES ($1::uuid, 'OPEN')`,
      [portfolio.rows[0].id]
    );

    await database.exec(migrationSql);

    const snapshot = await database.query(
      `SELECT portfolio_value, available_balance, open_positions
       FROM public."AI_Crypto_Bot_Portfolio_Snapshots"
       WHERE portfolio_id = $1::uuid`,
      [portfolio.rows[0].id]
    );
    assert.deepEqual(snapshot.rows, [{
      portfolio_value: "9400",
      available_balance: "8700",
      open_positions: 1
    }]);
  } finally {
    await database.close();
  }
});
