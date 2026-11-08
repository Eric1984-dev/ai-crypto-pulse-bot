import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptUrl = new URL(
  "../archive-server/sql/prepare-archive-decision-writer.sql",
  import.meta.url
);
const sql = readFileSync(fileURLToPath(scriptUrl), "utf8");
const rollbackIndex = sql.indexOf("-- Rollback procedure");
const provisionSql = sql.slice(0, rollbackIndex);
const rollbackSql = sql.slice(rollbackIndex);
const schemaComparisonStart = provisionSql.indexOf("WITH expected(");
const schemaComparisonError = provisionSql.indexOf(
  "RAISE EXCEPTION 'Archive decision table does not match the agent column contract';",
  schemaComparisonStart
);
const schemaComparisonEnd = provisionSql.lastIndexOf(
  "\n  ) THEN",
  schemaComparisonError
);
const schemaComparisonSql = provisionSql
  .slice(schemaComparisonStart, schemaComparisonEnd)
  .trim();

async function evaluateSchemaContract(database, {
  confidenceType = "numeric(5,2)",
  includeStrategyVersion = true,
  includeExtraColumn = false
} = {}) {
  const strategyVersionColumn = includeStrategyVersion
    ? "strategy_version text,"
    : "";
  const extraColumn = includeExtraColumn ? "extra_column text," : "";
  await database.exec(
    'DROP TABLE IF EXISTS public."AI_Crypto_Bot_AI_Decisions"'
  );
  await database.exec(`
    CREATE TABLE public."AI_Crypto_Bot_AI_Decisions" (
      id uuid NOT NULL,
      symbol text NOT NULL,
      decision text NOT NULL,
      confidence ${confidenceType} NOT NULL,
      indicators jsonb NOT NULL,
      reason text NOT NULL,
      strategy_name text,
      ${strategyVersionColumn}
      created_at timestamptz NOT NULL,
      ${extraColumn}
      PRIMARY KEY (id)
    );
  `);
  return database.query(schemaComparisonSql);
}

async function createPrivilegeFixture() {
  const { PGlite } = await import("@electric-sql/pglite");
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE writer_probe NOLOGIN;
    CREATE SCHEMA inaccessible_probe;
    CREATE TABLE inaccessible_probe.probe_relation (id integer);
    CREATE SEQUENCE inaccessible_probe.probe_sequence;
    GRANT SELECT ON inaccessible_probe.probe_relation TO PUBLIC;
    GRANT USAGE ON SEQUENCE inaccessible_probe.probe_sequence TO PUBLIC;

    CREATE TABLE public.probe_relation (id integer);
    CREATE SEQUENCE public.probe_sequence;
    GRANT USAGE ON SCHEMA public TO PUBLIC;
    GRANT SELECT ON public.probe_relation TO PUBLIC;
    GRANT USAGE ON SEQUENCE public.probe_sequence TO PUBLIC;
  `);
  return database;
}

async function createConstraintFixture(database, {
  primaryKeyColumn = "id",
  foreignKeyTarget = 'public."AI_Crypto_Bot_Watched_Markets"(symbol)',
  deleteAction = "RESTRICT",
  extraForeignKey = false
} = {}) {
  await database.exec(`
    DROP TABLE IF EXISTS public."AI_Crypto_Bot_AI_Decisions" CASCADE;
    DROP TABLE IF EXISTS public."AI_Crypto_Bot_Watched_Markets" CASCADE;
    DROP TABLE IF EXISTS public.other_markets CASCADE;
    DROP TABLE IF EXISTS public.extra_parent CASCADE;
    CREATE TABLE public."AI_Crypto_Bot_Watched_Markets" (
      symbol text PRIMARY KEY
    );
    CREATE TABLE public.other_markets (symbol text PRIMARY KEY);
    CREATE TABLE public.extra_parent (id uuid PRIMARY KEY);
    CREATE TABLE public."AI_Crypto_Bot_AI_Decisions" (
      id uuid NOT NULL,
      symbol text NOT NULL,
      PRIMARY KEY (${primaryKeyColumn}),
      FOREIGN KEY (symbol) REFERENCES ${foreignKeyTarget} ON DELETE ${deleteAction}
    );
  `);
  if (extraForeignKey) {
    await database.exec(`
      ALTER TABLE public."AI_Crypto_Bot_AI_Decisions"
      ADD CONSTRAINT extra_decision_fk
      FOREIGN KEY (id) REFERENCES public.extra_parent (id);
    `);
  }
}

async function readConstraintContract(database) {
  const relations = await database.query(`
    SELECT
      'public."AI_Crypto_Bot_AI_Decisions"'::regclass::oid AS decision_oid,
      'public."AI_Crypto_Bot_Watched_Markets"'::regclass::oid AS market_oid
  `);
  const { decision_oid: decisionOid, market_oid: marketOid } = relations.rows[0];
  const result = await database.query(
    `SELECT
       count(*) FILTER (WHERE key_constraint.contype = 'p') AS primary_key_count,
       count(*) FILTER (WHERE key_constraint.contype = 'f') AS foreign_key_count,
       EXISTS (
         SELECT 1
         FROM pg_catalog.pg_constraint AS key_constraint
         JOIN pg_catalog.pg_attribute AS key_column
           ON key_column.attrelid = $1::oid
          AND key_column.attname = 'id'
          AND key_column.attnum > 0
          AND NOT key_column.attisdropped
         WHERE key_constraint.conrelid = $1::oid
           AND key_constraint.contype = 'p'
           AND key_constraint.convalidated
           AND key_constraint.conkey = ARRAY[key_column.attnum]::smallint[]
       ) AS primary_key_valid,
       EXISTS (
         SELECT 1
         FROM pg_catalog.pg_constraint AS key_constraint
         JOIN pg_catalog.pg_attribute AS source_column
           ON source_column.attrelid = $1::oid
          AND source_column.attname = 'symbol'
          AND source_column.attnum > 0
          AND NOT source_column.attisdropped
         JOIN pg_catalog.pg_attribute AS target_column
           ON target_column.attrelid = $2::oid
          AND target_column.attname = 'symbol'
          AND target_column.attnum > 0
          AND NOT target_column.attisdropped
         WHERE key_constraint.conrelid = $1::oid
           AND key_constraint.contype = 'f'
           AND key_constraint.convalidated
           AND key_constraint.confrelid = $2::oid
           AND key_constraint.conkey = ARRAY[source_column.attnum]::smallint[]
           AND key_constraint.confkey = ARRAY[target_column.attnum]::smallint[]
           AND key_constraint.confdeltype = 'r'
       ) AS foreign_key_valid
     FROM pg_catalog.pg_constraint AS key_constraint
     WHERE key_constraint.conrelid = $1::oid
       AND key_constraint.contype IN ('p', 'f')`,
    [decisionOid, marketOid]
  );
  const constraint = result.rows[0];
  return {
    ...constraint,
    valid: Number(constraint.primary_key_count) === 1
      && Number(constraint.foreign_key_count) === 1
      && constraint.primary_key_valid
      && constraint.foreign_key_valid
  };
}

async function checkUnrelatedAccess(database, schemaName) {
  const result = await database.query(
    `SELECT
       pg_catalog.has_schema_privilege('writer_probe', $1, 'USAGE')
         AS schema_usage,
       EXISTS (
         SELECT 1
         FROM pg_catalog.pg_class AS relation
         JOIN pg_catalog.pg_namespace AS namespace
           ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = $1
           AND namespace.nspname NOT IN ('pg_catalog', 'information_schema')
           AND left(namespace.nspname, 3) <> 'pg_'
           AND pg_catalog.has_schema_privilege('writer_probe', namespace.oid, 'USAGE')
           AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
           AND relation.relname = 'probe_relation'
           AND (
             pg_catalog.has_table_privilege('writer_probe', relation.oid, 'SELECT')
             OR pg_catalog.has_table_privilege('writer_probe', relation.oid, 'INSERT')
             OR pg_catalog.has_table_privilege('writer_probe', relation.oid, 'UPDATE')
             OR pg_catalog.has_table_privilege('writer_probe', relation.oid, 'DELETE')
             OR pg_catalog.has_table_privilege('writer_probe', relation.oid, 'TRUNCATE')
             OR pg_catalog.has_table_privilege('writer_probe', relation.oid, 'REFERENCES')
             OR pg_catalog.has_table_privilege('writer_probe', relation.oid, 'TRIGGER')
             OR pg_catalog.has_any_column_privilege('writer_probe', relation.oid, 'SELECT')
             OR pg_catalog.has_any_column_privilege('writer_probe', relation.oid, 'INSERT')
             OR pg_catalog.has_any_column_privilege('writer_probe', relation.oid, 'UPDATE')
             OR pg_catalog.has_any_column_privilege('writer_probe', relation.oid, 'REFERENCES')
           )
       ) AS relation_access,
       EXISTS (
         SELECT 1
         FROM pg_catalog.pg_class AS relation
         JOIN pg_catalog.pg_namespace AS namespace
           ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = $1
           AND namespace.nspname NOT IN ('pg_catalog', 'information_schema')
           AND left(namespace.nspname, 3) <> 'pg_'
           AND pg_catalog.has_schema_privilege('writer_probe', namespace.oid, 'USAGE')
           AND relation.relkind = 'S'
           AND relation.relname = 'probe_sequence'
           AND (
             pg_catalog.has_sequence_privilege('writer_probe', relation.oid, 'USAGE')
             OR pg_catalog.has_sequence_privilege('writer_probe', relation.oid, 'SELECT')
             OR pg_catalog.has_sequence_privilege('writer_probe', relation.oid, 'UPDATE')
           )
       ) AS sequence_access`,
    [schemaName]
  );
  return result.rows[0];
}

test("archive writer SQL is scoped to the Pi archive and leaves login disabled", () => {
  assert.ok(rollbackIndex > 0);
  assert.match(provisionSql, /current_database\(\) <> 'ai_crypto_bot_archive'/);
  assert.match(provisionSql, /CREATE ROLE "AI_Crypto_Bot_Archive_Decision_Writer"/);
  assert.match(provisionSql, /NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE/);
  assert.match(provisionSql, /NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1/);
  assert.doesNotMatch(provisionSql, /\bPASSWORD\b|\bALTER\s+ROLE\b/i);
});

test("archive key contract uses catalogs and accepts an unqualified PostgreSQL FK definition", async (t) => {
  const { PGlite } = await import("@electric-sql/pglite");
  const database = new PGlite();
  try {
    assert.match(provisionSql, /key_constraint\.conrelid = decision_oid/);
    assert.match(provisionSql, /key_constraint\.confrelid = market_oid/);
    assert.match(provisionSql, /key_constraint\.conkey = ARRAY\[source_column\.attnum\]/);
    assert.match(provisionSql, /key_constraint\.confkey = ARRAY\[target_column\.attnum\]/);
    assert.match(provisionSql, /key_constraint\.confdeltype = 'r'/);
    assert.doesNotMatch(provisionSql, /pg_get_constraintdef/);

    await createConstraintFixture(database);
    const definition = await database.query(`
      SELECT pg_catalog.pg_get_constraintdef(oid) AS definition
      FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public."AI_Crypto_Bot_AI_Decisions"'::regclass
        AND contype = 'f'
    `);
    assert.match(
      definition.rows[0].definition,
      /REFERENCES "?AI_Crypto_Bot_Watched_Markets"?\(symbol\) ON DELETE RESTRICT/i
    );
    assert.doesNotMatch(definition.rows[0].definition, /\bpublic\./i);
    assert.equal((await readConstraintContract(database)).valid, true);

    await t.test("rejects a primary key on a column other than id", async () => {
      await createConstraintFixture(database, { primaryKeyColumn: "symbol" });
      assert.equal((await readConstraintContract(database)).valid, false);
    });

    await t.test("rejects an FK to a relation other than the resolved market table", async () => {
      await createConstraintFixture(database, {
        foreignKeyTarget: "public.other_markets(symbol)"
      });
      assert.equal((await readConstraintContract(database)).valid, false);
    });

    await t.test("rejects an FK whose delete action is not RESTRICT", async () => {
      await createConstraintFixture(database, { deleteAction: "CASCADE" });
      assert.equal((await readConstraintContract(database)).valid, false);
    });

    await t.test("rejects an extra foreign key", async () => {
      await createConstraintFixture(database, { extraForeignKey: true });
      assert.equal((await readConstraintContract(database)).valid, false);
    });
  } finally {
    await database.close();
  }
});

test("archive decision schema comparison handles exact, mismatched, missing, and extra columns", async (t) => {
  const { PGlite } = await import("@electric-sql/pglite");
  const database = new PGlite();
  try {
  assert.ok(schemaComparisonStart >= 0);
  assert.ok(schemaComparisonEnd > schemaComparisonStart);
  assert.match(
    schemaComparisonSql,
    /FULL JOIN actual\s+ON actual\.ordinal_position = expected\.ordinal_position/
  );
  assert.match(schemaComparisonSql, /numeric_precision IS DISTINCT FROM actual\.numeric_precision/);
  assert.match(schemaComparisonSql, /numeric_scale IS DISTINCT FROM actual\.numeric_scale/);
  assert.match(schemaComparisonSql, /datetime_precision IS DISTINCT FROM actual\.datetime_precision/);

  const exactSchema = await evaluateSchemaContract(database);
  assert.deepEqual(exactSchema.rows, []);

  await t.test("rejects a confidence precision mismatch", async () => {
    const result = await evaluateSchemaContract(database, {
      confidenceType: "numeric(6,2)"
    });
    assert.notEqual(result.rows.length, 0);
  });

  await t.test("rejects a missing expected column", async () => {
    const result = await evaluateSchemaContract(database, {
      includeStrategyVersion: false
    });
    assert.notEqual(result.rows.length, 0);
  });

  await t.test("rejects an extra column", async () => {
    const result = await evaluateSchemaContract(database, {
      includeExtraColumn: true
    });
    assert.notEqual(result.rows.length, 0);
  });
  } finally {
    await database.close();
  }
});

test("archive writer SQL grants only the required database, schema, and table privileges", () => {
  assert.match(provisionSql, /GRANT CONNECT ON DATABASE ai_crypto_bot_archive/);
  assert.match(provisionSql, /GRANT USAGE ON SCHEMA public/);
  assert.match(
    provisionSql,
    /'GRANT SELECT, INSERT, UPDATE ON TABLE '\s*\|\|\s*'public\."AI_Crypto_Bot_AI_Decisions"/
  );
  assert.match(
    provisionSql,
    /'GRANT SELECT ON TABLE public\."AI_Crypto_Bot_Watched_Markets"/
  );
  assert.equal((provisionSql.match(/EXECUTE 'GRANT /g) ?? []).length, 4);
  assert.match(provisionSql, /pg_auth_members/);
  assert.match(provisionSql, /has_database_privilege\(writer_oid, current_database\(\), 'CREATE'\)/);
  assert.match(provisionSql, /has_any_column_privilege/);
  assert.match(provisionSql, /has_sequence_privilege/);
  assert.match(provisionSql, /aclexplode/);

  const relationError = provisionSql.indexOf(
    "RAISE EXCEPTION 'Writer has effective privileges on an unrelated relation'"
  );
  const relationGuard = provisionSql.slice(
    provisionSql.lastIndexOf("IF EXISTS (", relationError),
    relationError
  );
  assert.match(
    relationGuard,
    /has_schema_privilege\(writer_oid, namespace\.oid, 'USAGE'\)/
  );

  const sequenceError = provisionSql.indexOf(
    "RAISE EXCEPTION 'Writer has an unexpected sequence privilege'"
  );
  const sequenceGuard = provisionSql.slice(
    provisionSql.lastIndexOf("IF EXISTS (", sequenceError),
    sequenceError
  );
  assert.match(
    sequenceGuard,
    /has_schema_privilege\(writer_oid, namespace\.oid, 'USAGE'\)/
  );
});

test("PUBLIC relation and sequence grants are filtered by effective schema USAGE", async (t) => {
  const database = await createPrivilegeFixture();
  try {
    await t.test("ignores PUBLIC relation and sequence grants in an inaccessible schema", async () => {
      const grants = await database.query(`
        SELECT
          pg_catalog.has_table_privilege(
            'writer_probe', 'inaccessible_probe.probe_relation', 'SELECT'
          ) AS relation_granted,
          pg_catalog.has_sequence_privilege(
            'writer_probe', 'inaccessible_probe.probe_sequence', 'USAGE'
          ) AS sequence_granted
      `);
      assert.deepEqual(grants.rows[0], {
        relation_granted: true,
        sequence_granted: true
      });

      const check = await checkUnrelatedAccess(database, "inaccessible_probe");
      assert.equal(check.schema_usage, false);
      assert.equal(check.relation_access, false);
      assert.equal(check.sequence_access, false);
    });

    await database.exec("GRANT USAGE ON SCHEMA inaccessible_probe TO writer_probe");
    await t.test("rejects the same grants after the writer gets schema USAGE", async () => {
      const check = await checkUnrelatedAccess(database, "inaccessible_probe");
      assert.equal(check.schema_usage, true);
      assert.equal(check.relation_access, true);
      assert.equal(check.sequence_access, true);
    });

    await t.test("continues rejecting PUBLIC relation and sequence grants in public", async () => {
      const check = await checkUnrelatedAccess(database, "public");
      assert.equal(check.schema_usage, true);
      assert.equal(check.relation_access, true);
      assert.equal(check.sequence_access, true);
    });
  } finally {
    await database.close();
  }
});

test("archive writer SQL verifies the agent schema and preserves existing ownership", () => {
  assert.match(provisionSql, /Archive decision table does not match the agent column contract/);
  assert.match(provisionSql, /key_constraint\.conkey = ARRAY\[key_column\.attnum\]/);
  assert.match(provisionSql, /key_constraint\.confrelid = market_oid/);
  assert.match(provisionSql, /key_constraint\.confkey = ARRAY\[target_column\.attnum\]/);
  assert.match(provisionSql, /key_constraint\.confdeltype = 'r'/);
  assert.doesNotMatch(provisionSql, /pg_get_constraintdef/);
  assert.match(provisionSql, /relation_owners_before/);
  assert.match(provisionSql, /legacy_relations_before/);
  assert.match(provisionSql, /legacy_relations_after/);
  assert.match(provisionSql, /Relation ownership changed; rolling back writer-role setup/);
  assert.doesNotMatch(provisionSql, /ai_crypto_bot_archive_user"\s+(?:OWNER|TO)|ALTER\s+OWNER/i);
});

test("archive writer rollback is explicit, non-cascading, and does not touch the legacy role", () => {
  assert.match(rollbackSql, /ALTER ROLE "AI_Crypto_Bot_Archive_Decision_Writer" NOLOGIN/);
  assert.match(rollbackSql, /DROP ROLE "AI_Crypto_Bot_Archive_Decision_Writer"/);
  assert.doesNotMatch(rollbackSql, /\bCASCADE\s*;/i);
  assert.doesNotMatch(rollbackSql, /ai_crypto_bot_archive_user/i);
});
