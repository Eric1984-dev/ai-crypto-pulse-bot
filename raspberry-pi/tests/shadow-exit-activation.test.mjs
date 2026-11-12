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
