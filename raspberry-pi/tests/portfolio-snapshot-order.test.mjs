import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const MIGRATION_PATH = new URL(
  "../migrations/phase-8.13-portfolio-snapshot-order.sql",
  import.meta.url
);

test("snapshot-order migration assigns stable same-time order and rollback-safe inserts", async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE TABLE public."AI_Crypto_Bot_Portfolio_Snapshots" (
        id uuid PRIMARY KEY,
        portfolio_id uuid NOT NULL,
        portfolio_value numeric NOT NULL,
        available_balance numeric NOT NULL,
        open_positions integer NOT NULL,
        captured_at timestamptz NOT NULL
      );
      INSERT INTO public."AI_Crypto_Bot_Portfolio_Snapshots"
        (id, portfolio_id, portfolio_value, available_balance, open_positions, captured_at)
      VALUES
        ('00000000-0000-4000-8000-000000000002',
         '00000000-0000-4000-8000-000000000100', 9900, 9900, 0,
         '2026-11-11T02:10:26.282Z'),
        ('00000000-0000-4000-8000-000000000001',
         '00000000-0000-4000-8000-000000000100', 9800, 9800, 0,
         '2026-11-11T02:10:26.282Z');
    `);
    await database.exec(await readFile(MIGRATION_PATH, "utf8"));
    const legacy = await database.query(`
      SELECT snapshot_order
      FROM public."AI_Crypto_Bot_Portfolio_Snapshots"
      ORDER BY captured_at, snapshot_order
    `);
    assert.deepEqual(legacy.rows.map(({ snapshot_order }) => Number(snapshot_order)), [1, 2]);

    await database.exec("BEGIN");
    await database.query(`
      INSERT INTO public."AI_Crypto_Bot_Portfolio_Snapshots"
        (id, portfolio_id, portfolio_value, available_balance, open_positions, captured_at)
      VALUES
        ('00000000-0000-4000-8000-000000000003',
         '00000000-0000-4000-8000-000000000100', 9700, 9700, 0,
         '2026-11-11T02:10:26.282Z'),
        ('00000000-0000-4000-8000-000000000004',
         '00000000-0000-4000-8000-000000000100', 9600, 9600, 0,
         '2026-11-11T02:10:26.282Z')
    `);
    const inserted = await database.query(`
      SELECT portfolio_value
      FROM public."AI_Crypto_Bot_Portfolio_Snapshots"
      WHERE portfolio_value IN (9700, 9600)
      ORDER BY snapshot_order
    `);
    assert.deepEqual(inserted.rows.map(({ portfolio_value }) => Number(portfolio_value)), [9700, 9600]);
    await database.exec("ROLLBACK");
    const rolledBack = await database.query(`
      SELECT COUNT(*)::integer AS count
      FROM public."AI_Crypto_Bot_Portfolio_Snapshots"
      WHERE portfolio_value IN (9700, 9600)
    `);
    assert.equal(rolledBack.rows[0].count, 0);

    const afterRollback = await database.query(`
      INSERT INTO public."AI_Crypto_Bot_Portfolio_Snapshots"
        (id, portfolio_id, portfolio_value, available_balance, open_positions, captured_at)
      VALUES
        ('00000000-0000-4000-8000-000000000005',
         '00000000-0000-4000-8000-000000000100', 9500, 9500, 0,
         '2026-11-11T02:10:26.282Z')
      RETURNING snapshot_order
    `);
    assert.ok(Number(afterRollback.rows[0].snapshot_order) > 2);
  } finally {
    await database.close();
  }
});
