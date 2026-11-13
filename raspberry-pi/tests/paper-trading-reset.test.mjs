import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const resetUrl = new URL("../sql/reset-system-paper-data.sql", import.meta.url);
const startUrl = new URL("../sql/start-system-paper-portfolio-2000.sql", import.meta.url);
const systemProfileId = "00000000-0000-4000-8000-000000000100";

function executableSql(url) {
  return readFileSync(fileURLToPath(url), "utf8")
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("\\"))
    .join("\n")
    .replaceAll("'ai_crypto_bot_store'", "'postgres'");
}

const resetSql = executableSql(resetUrl);
const startSql = executableSql(startUrl);

async function createDatabase({ externalDecisionReference = false } = {}) {
  const database = new PGlite();
  await database.exec(`
    CREATE TABLE public."AI_Crypto_Bot_Profiles" (
      id uuid PRIMARY KEY,
      email text
    );
    CREATE TABLE public."AI_Crypto_Bot_Portfolios" (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES public."AI_Crypto_Bot_Profiles"(id),
      starting_balance numeric NOT NULL,
      available_balance numeric NOT NULL,
      portfolio_value numeric NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public."AI_Crypto_Bot_Watched_Markets" (
      symbol text PRIMARY KEY
    );
    CREATE TABLE public."AI_Crypto_Bot_AI_Decisions" (
      id uuid PRIMARY KEY,
      symbol text NOT NULL REFERENCES public."AI_Crypto_Bot_Watched_Markets"(symbol)
    );
    CREATE TABLE public."AI_Crypto_Bot_Positions" (
      id uuid PRIMARY KEY,
      portfolio_id uuid NOT NULL REFERENCES public."AI_Crypto_Bot_Portfolios"(id),
      symbol text NOT NULL REFERENCES public."AI_Crypto_Bot_Watched_Markets"(symbol)
    );
    CREATE TABLE public."AI_Crypto_Bot_Trades" (
      id uuid PRIMARY KEY,
      portfolio_id uuid NOT NULL REFERENCES public."AI_Crypto_Bot_Portfolios"(id),
      ai_decision_id uuid REFERENCES public."AI_Crypto_Bot_AI_Decisions"(id)
        ON DELETE RESTRICT
    );
    CREATE TABLE public."AI_Crypto_Bot_Portfolio_Snapshots" (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      portfolio_id uuid NOT NULL REFERENCES public."AI_Crypto_Bot_Portfolios"(id),
      portfolio_value numeric NOT NULL,
      available_balance numeric NOT NULL,
      open_positions integer NOT NULL,
      captured_at timestamptz NOT NULL DEFAULT now(),
      snapshot_order bigint GENERATED ALWAYS AS IDENTITY
    );
    CREATE TABLE public."AI_Crypto_Bot_Shadow_Exit_Scenarios" (
      id uuid PRIMARY KEY,
      portfolio_id uuid NOT NULL REFERENCES public."AI_Crypto_Bot_Portfolios"(id)
    );
    CREATE TABLE public."AI_Crypto_Bot_Shadow_Exit_Events" (
      id uuid PRIMARY KEY,
      position_id uuid REFERENCES public."AI_Crypto_Bot_Positions"(id)
        ON DELETE CASCADE,
      scenario_id uuid REFERENCES public."AI_Crypto_Bot_Shadow_Exit_Scenarios"(id)
        ON DELETE CASCADE
    );
    CREATE TABLE public."AI_Crypto_Bot_Analytics_Runs" (
      id uuid PRIMARY KEY
    );
    INSERT INTO public."AI_Crypto_Bot_Profiles" (id, email)
    VALUES ('${systemProfileId}'::uuid, NULL), ('00000000-0000-4000-8000-000000000200', NULL);
    INSERT INTO public."AI_Crypto_Bot_Portfolios"
      (id, user_id, starting_balance, available_balance, portfolio_value)
    VALUES
      ('00000000-0000-4000-8000-000000000300', '${systemProfileId}'::uuid, 10000, 8500, 9000),
      ('00000000-0000-4000-8000-000000000400',
       '00000000-0000-4000-8000-000000000200', 1000, 1000, 1000);
    INSERT INTO public."AI_Crypto_Bot_Watched_Markets" (symbol)
    VALUES ('BTC-EUR');
    INSERT INTO public."AI_Crypto_Bot_AI_Decisions" (id, symbol)
    VALUES ('00000000-0000-4000-8000-000000000500', 'BTC-EUR');
    INSERT INTO public."AI_Crypto_Bot_Positions" (id, portfolio_id, symbol)
    VALUES ('00000000-0000-4000-8000-000000000600',
            '00000000-0000-4000-8000-000000000300', 'BTC-EUR');
    INSERT INTO public."AI_Crypto_Bot_Trades" (id, portfolio_id, ai_decision_id)
    VALUES ('00000000-0000-4000-8000-000000000700',
            '00000000-0000-4000-8000-000000000300',
            '00000000-0000-4000-8000-000000000500');
    INSERT INTO public."AI_Crypto_Bot_Portfolio_Snapshots"
      (portfolio_id, portfolio_value, available_balance, open_positions)
    VALUES ('00000000-0000-4000-8000-000000000300', 9000, 8500, 1);
    INSERT INTO public."AI_Crypto_Bot_Shadow_Exit_Scenarios" (id, portfolio_id)
    VALUES ('00000000-0000-4000-8000-000000000800',
            '00000000-0000-4000-8000-000000000300');
    INSERT INTO public."AI_Crypto_Bot_Shadow_Exit_Events" (id, position_id, scenario_id)
    VALUES ('00000000-0000-4000-8000-000000000900',
            '00000000-0000-4000-8000-000000000600',
            '00000000-0000-4000-8000-000000000800');
    INSERT INTO public."AI_Crypto_Bot_Analytics_Runs" (id)
    VALUES ('00000000-0000-4000-8000-000000001000');
  `);
  if (externalDecisionReference) {
    await database.query(`
      INSERT INTO public."AI_Crypto_Bot_Trades" (id, portfolio_id, ai_decision_id)
      VALUES (
        '00000000-0000-4000-8000-000000001100',
        '00000000-0000-4000-8000-000000000400',
        '00000000-0000-4000-8000-000000000500'
      )
    `);
  }
  return database;
}

test("paper reset preserves markets and unrelated portfolios, then starts the system portfolio at EUR 2000", async () => {
  const database = await createDatabase();
  try {
    await database.exec(resetSql);
    await database.exec(startSql);

    const result = await database.query(`
      SELECT portfolio.starting_balance,
             portfolio.available_balance,
             portfolio.portfolio_value,
             snapshot.portfolio_value AS snapshot_value,
             snapshot.available_balance AS snapshot_balance,
             snapshot.open_positions
      FROM public."AI_Crypto_Bot_Portfolios" AS portfolio
      JOIN public."AI_Crypto_Bot_Portfolio_Snapshots" AS snapshot
        ON snapshot.portfolio_id = portfolio.id
      WHERE portfolio.user_id = $1::uuid
    `, [systemProfileId]);
    assert.deepEqual(result.rows, [{
      starting_balance: "2000",
      available_balance: "2000",
      portfolio_value: "2000",
      snapshot_value: "2000",
      snapshot_balance: "2000",
      open_positions: 0
    }]);

    const preserved = await database.query(`
      SELECT
        (SELECT count(*)::integer
         FROM public."AI_Crypto_Bot_Watched_Markets") AS market_count,
        (SELECT count(*)::integer
         FROM public."AI_Crypto_Bot_Portfolios"
         WHERE user_id = '00000000-0000-4000-8000-000000000200') AS other_portfolio_count,
        (SELECT count(*)::integer
         FROM public."AI_Crypto_Bot_Trades") AS trade_count,
        (SELECT count(*)::integer
         FROM public."AI_Crypto_Bot_Positions") AS position_count,
        (SELECT count(*)::integer
         FROM public."AI_Crypto_Bot_AI_Decisions") AS decision_count,
        (SELECT count(*)::integer
         FROM public."AI_Crypto_Bot_Analytics_Runs") AS analytics_count,
        (SELECT count(*)::integer
         FROM public."AI_Crypto_Bot_Shadow_Exit_Events") AS shadow_event_count
    `);
    assert.deepEqual(preserved.rows, [{
      market_count: 1,
      other_portfolio_count: 1,
      trade_count: 0,
      position_count: 0,
      decision_count: 0,
      analytics_count: 0,
      shadow_event_count: 0
    }]);
  } finally {
    await database.close();
  }
});

test("paper reset fails closed when another portfolio references an AI decision", async () => {
  const database = await createDatabase({ externalDecisionReference: true });
  try {
    await assert.rejects(database.exec(resetSql), /outside the system portfolio/);
    await database.exec("ROLLBACK");
    const remaining = await database.query(`
      SELECT
        (SELECT count(*)::integer FROM public."AI_Crypto_Bot_Trades") AS trade_count,
        (SELECT count(*)::integer FROM public."AI_Crypto_Bot_Positions") AS position_count,
        (SELECT count(*)::integer
         FROM public."AI_Crypto_Bot_Portfolio_Snapshots") AS snapshot_count
    `);
    assert.deepEqual(remaining.rows, [{
      trade_count: 2,
      position_count: 1,
      snapshot_count: 1
    }]);
  } finally {
    await database.close();
  }
});
