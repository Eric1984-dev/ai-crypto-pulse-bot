import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("shadow-exit permission migration grants execution only to the configured paper role", async (t) => {
  const database = new PGlite();
  t.after(() => database.close());
  await database.exec(`
    CREATE ROLE paper_runtime LOGIN;
    CREATE ROLE unrelated_runtime LOGIN;
    CREATE FUNCTION public."AI_Crypto_Bot_Evaluate_Shadow_Exit_Scenarios"()
      RETURNS jsonb
      LANGUAGE sql
      SECURITY DEFINER
      SET search_path = ''
      AS $$ SELECT '{}'::jsonb $$;
    SELECT pg_catalog.set_config(
      'cryptopulse.paper_database_user',
      'paper_runtime',
      false
    );
  `);

  const migration = await readFile(
    new URL("../migrations/phase-8.9-shadow-exit-runtime-permissions.sql", import.meta.url),
    "utf8"
  );
  await database.exec(migration);
  const result = await database.query(`
    SELECT pg_catalog.has_function_privilege(
             'paper_runtime',
             'public."AI_Crypto_Bot_Evaluate_Shadow_Exit_Scenarios"()',
             'EXECUTE'
           ) AS paper_can_execute,
           pg_catalog.has_function_privilege(
             'unrelated_runtime',
             'public."AI_Crypto_Bot_Evaluate_Shadow_Exit_Scenarios"()',
             'EXECUTE'
           ) AS unrelated_can_execute
  `);

  assert.deepEqual(result.rows, [{
    paper_can_execute: true,
    unrelated_can_execute: false
  }]);
});

test("Pi evaluator migration installs a restricted evaluator that creates scenarios and events", async (t) => {
  const database = new PGlite();
  t.after(() => database.close());
  await database.exec(`
    CREATE ROLE paper_runtime LOGIN;
    CREATE ROLE unrelated_runtime LOGIN;
    CREATE TABLE public."AI_Crypto_Bot_Positions" (
      id uuid PRIMARY KEY,
      portfolio_id uuid NOT NULL,
      symbol text NOT NULL,
      amount numeric NOT NULL,
      entry_price numeric NOT NULL,
      created_at timestamptz NOT NULL,
      status text NOT NULL,
      current_price numeric,
      updated_at timestamptz NOT NULL
    );
    CREATE TABLE public."AI_Crypto_Bot_Trades" (
      id uuid PRIMARY KEY,
      portfolio_id uuid,
      symbol text,
      side text,
      created_at timestamptz,
      price numeric,
      realized_pnl numeric
    );
    CREATE TABLE public."AI_Crypto_Bot_Market_Data" (
      symbol text PRIMARY KEY,
      price numeric,
      captured_at timestamptz
    );
    CREATE TABLE public."AI_Crypto_Bot_Shadow_Exit_Scenarios" (
      id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
      position_id uuid NOT NULL,
      portfolio_id uuid NOT NULL,
      symbol text NOT NULL,
      position_opened_at timestamptz NOT NULL,
      amount numeric NOT NULL,
      entry_price numeric NOT NULL,
      rule_id text NOT NULL,
      rule_version text NOT NULL,
      parameters jsonb NOT NULL,
      status text NOT NULL DEFAULT 'TRACKING',
      data_quality_status text NOT NULL DEFAULT 'AWAITING_FIRST_FRESH_MARK',
      tracking_started_at timestamptz,
      last_evaluated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
      last_mark numeric,
      last_mark_captured_at timestamptz,
      high_water_mark numeric,
      trailing_armed boolean NOT NULL DEFAULT false,
      activated_at timestamptz,
      triggered_at timestamptz,
      trigger_mark numeric,
      modeled_exit_price numeric,
      modeled_net_pnl numeric,
      actual_trade_id uuid,
      actual_closed_at timestamptz,
      actual_close_price numeric,
      actual_net_pnl numeric,
      finalized_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
      updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
      UNIQUE (position_id, rule_id, rule_version)
    );
    CREATE TABLE public."AI_Crypto_Bot_Shadow_Exit_Events" (
      id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
      position_id uuid,
      scenario_id uuid,
      symbol text,
      event_type text NOT NULL,
      event_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
      observed_mark numeric,
      data_quality_status text,
      error_code text,
      details jsonb NOT NULL DEFAULT '{}'::jsonb,
      dedupe_key text NOT NULL UNIQUE
    );
    ALTER TABLE public."AI_Crypto_Bot_Shadow_Exit_Scenarios" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public."AI_Crypto_Bot_Shadow_Exit_Events" ENABLE ROW LEVEL SECURITY;
    INSERT INTO public."AI_Crypto_Bot_Positions" (
      id, portfolio_id, symbol, amount, entry_price, created_at, status, updated_at
    )
    VALUES (
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      'BTC-EUR',
      1,
      100,
      pg_catalog.clock_timestamp(),
      'OPEN',
      pg_catalog.clock_timestamp()
    );
    INSERT INTO public."AI_Crypto_Bot_Market_Data" (symbol, price, captured_at)
    VALUES ('BTC-EUR', 100, pg_catalog.clock_timestamp());
    SELECT pg_catalog.set_config(
      'cryptopulse.paper_database_user',
      'paper_runtime',
      false
    );
  `);

  const migration = await readFile(
    new URL("../migrations/phase-8.11-shadow-exit-evaluator-installation.sql", import.meta.url),
    "utf8"
  );
  await database.exec(migration);
  await database.exec("SET ROLE paper_runtime");
  const evaluation = await database.query(`
    SELECT public."AI_Crypto_Bot_Evaluate_Shadow_Exit_Scenarios"() AS result
  `);
  await database.exec("RESET ROLE");

  assert.equal(evaluation.rows[0].result.status, "COMPLETED");
  assert.equal(evaluation.rows[0].result.positionsEvaluated, 1);
  assert.equal(evaluation.rows[0].result.scenariosCreated, 7);
  const result = await database.query(`
    SELECT
      (SELECT count(*)::integer
       FROM public."AI_Crypto_Bot_Shadow_Exit_Scenarios") AS scenario_count,
      (SELECT count(*)::integer
       FROM public."AI_Crypto_Bot_Shadow_Exit_Events") AS event_count,
      pg_catalog.has_function_privilege(
        'unrelated_runtime',
        'public."AI_Crypto_Bot_Evaluate_Shadow_Exit_Scenarios"()',
        'EXECUTE'
      ) AS unrelated_can_execute,
      pg_catalog.has_table_privilege(
        'paper_runtime',
        'public."AI_Crypto_Bot_Shadow_Exit_Scenarios"',
        'INSERT'
      ) AS paper_can_write_scenarios
  `);

  assert.deepEqual(result.rows, [{
    scenario_count: 7,
    event_count: 7,
    unrelated_can_execute: false,
    paper_can_write_scenarios: false
  }]);
});

test("shadow-exit dashboard migration grants read-only access to the configured API role", async (t) => {
  const database = new PGlite();
  t.after(() => database.close());
  await database.exec(`
    CREATE ROLE dashboard_runtime LOGIN;
    CREATE ROLE unrelated_runtime LOGIN;
    CREATE TABLE public."AI_Crypto_Bot_Shadow_Exit_Scenarios" (id uuid);
    CREATE TABLE public."AI_Crypto_Bot_Shadow_Exit_Events" (id uuid);
    SELECT pg_catalog.set_config(
      'cryptopulse.dashboard_database_user',
      'dashboard_runtime',
      false
    );
  `);

  const migration = await readFile(
    new URL("../migrations/phase-8.10-shadow-exit-dashboard-read.sql", import.meta.url),
    "utf8"
  );
  await database.exec(migration);
  const result = await database.query(`
    SELECT pg_catalog.has_table_privilege(
             'dashboard_runtime',
             'public."AI_Crypto_Bot_Shadow_Exit_Scenarios"',
             'SELECT'
           ) AS can_read_scenarios,
           pg_catalog.has_table_privilege(
             'dashboard_runtime',
             'public."AI_Crypto_Bot_Shadow_Exit_Events"',
             'SELECT'
           ) AS can_read_events,
           pg_catalog.has_table_privilege(
             'dashboard_runtime',
             'public."AI_Crypto_Bot_Shadow_Exit_Scenarios"',
             'INSERT'
           ) AS can_write_scenarios,
           pg_catalog.has_table_privilege(
             'unrelated_runtime',
             'public."AI_Crypto_Bot_Shadow_Exit_Scenarios"',
             'SELECT'
           ) AS unrelated_can_read
  `);

  assert.deepEqual(result.rows, [{
    can_read_scenarios: true,
    can_read_events: true,
    can_write_scenarios: false,
    unrelated_can_read: false
  }]);
});
