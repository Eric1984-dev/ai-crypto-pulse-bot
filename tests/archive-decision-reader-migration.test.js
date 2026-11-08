"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const migrationPath = path.join(
  __dirname,
  "..",
  "supabase",
  "migrations",
  "20261107120000_ai_decision_archive_reader.sql"
);
const migration = fs.readFileSync(migrationPath, "utf8");
const postflightMarker = "DO $postflight$";
const postflightIndex = migration.indexOf(postflightMarker);
const postflightSql = migration.slice(postflightIndex);

function usePgliteGrantor(sql) {
  // PGlite records postgres as grantor; production SQL still requires supabase_admin.
  const expectedGrantorLookup = "WHERE rolname = 'supabase_admin';";
  assert.ok(sql.includes(expectedGrantorLookup));
  return sql.replace(expectedGrantorLookup, "WHERE rolname = 'postgres';");
}

async function prepareMigration(additionalSetupSql = "") {
  const { PGlite } = await import("@electric-sql/pglite");
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE authenticated;
    CREATE ROLE supabase_admin;
    CREATE ROLE other_role;
    CREATE SCHEMA extensions;
    CREATE VIEW extensions.public_select_probe AS SELECT 1 AS value;
    GRANT SELECT ON extensions.public_select_probe TO PUBLIC;
    CREATE SEQUENCE extensions.public_sequence_probe;
    GRANT USAGE ON SEQUENCE extensions.public_sequence_probe TO PUBLIC;
    CREATE TABLE public."AI_Crypto_Bot_AI_Decisions" (
      id integer PRIMARY KEY
    );
    ALTER TABLE public."AI_Crypto_Bot_AI_Decisions" ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "AI_Crypto_Bot_AI_Decisions_select_authenticated"
      ON public."AI_Crypto_Bot_AI_Decisions"
      FOR SELECT TO authenticated USING (true);
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
  `);
  if (additionalSetupSql) {
    await database.exec(additionalSetupSql);
  }
  await database.exec(migration.slice(0, postflightIndex));
  return database;
}

async function addManagedMembership(database, options = "") {
  await database.exec(
    `GRANT "AI_Crypto_Bot_Archive_Decision_Reader" TO postgres ${options};`
  );
}

test("decision reader migration scopes effective relation checks by schema usage", async (t) => {
  assert.ok(postflightIndex > 0, "migration has a postflight block");
  assert.match(migration, /server_version_num'\)::integer < 160000/);
  assert.match(migration, /WHERE rolname = 'supabase_admin'/);
  assert.match(migration, /membership\.grantor = supabase_admin_oid/);
  assert.match(migration, /membership\.admin_option/);
  assert.match(migration, /NOT membership\.inherit_option/);
  assert.match(migration, /NOT membership\.set_option/);

  await t.test(
    "accepts PUBLIC SELECT in an inaccessible schema and preserves the authenticated policy",
    async () => {
      const database = await prepareMigration();
      try {
        await addManagedMembership(
          database,
          "WITH ADMIN OPTION, INHERIT FALSE, SET FALSE"
        );
        await database.exec(usePgliteGrantor(postflightSql));

        const membershipResult = await database.query(`
        SELECT granted_role.rolname AS granted_role,
               member_role.rolname AS member_role,
               membership.admin_option,
               membership.inherit_option,
               membership.set_option
        FROM pg_catalog.pg_auth_members AS membership
        JOIN pg_catalog.pg_roles AS granted_role
          ON granted_role.oid = membership.roleid
        JOIN pg_catalog.pg_roles AS member_role
          ON member_role.oid = membership.member
        WHERE granted_role.rolname = 'AI_Crypto_Bot_Archive_Decision_Reader'
           OR member_role.rolname = 'AI_Crypto_Bot_Archive_Decision_Reader'
      `);
        assert.deepEqual(membershipResult.rows, [{
          granted_role: "AI_Crypto_Bot_Archive_Decision_Reader",
          member_role: "postgres",
          admin_option: true,
          inherit_option: false,
          set_option: false
        }]);

        const policyResult = await database.query(`
        SELECT policyname
        FROM pg_catalog.pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'AI_Crypto_Bot_AI_Decisions'
        ORDER BY policyname
      `);
        assert.deepEqual(
          policyResult.rows.map((row) => row.policyname),
          [
            "AI_Crypto_Bot_AI_Decisions_Archive_Reader_Select",
            "AI_Crypto_Bot_AI_Decisions_select_authenticated"
          ]
        );

        const inaccessibleSchemaResult = await database.query(`
        SELECT pg_catalog.has_schema_privilege(
                 'AI_Crypto_Bot_Archive_Decision_Reader', 'extensions', 'USAGE'
               ) AS has_schema_usage,
               pg_catalog.has_table_privilege(
                 'AI_Crypto_Bot_Archive_Decision_Reader',
                 'extensions.public_select_probe',
                 'SELECT'
               ) AS has_relation_select,
               pg_catalog.has_sequence_privilege(
                 'AI_Crypto_Bot_Archive_Decision_Reader',
                 'extensions.public_sequence_probe',
                 'USAGE'
               ) AS has_sequence_usage
      `);
        assert.deepEqual(inaccessibleSchemaResult.rows, [{
          has_schema_usage: false,
          has_relation_select: true,
          has_sequence_usage: true
        }]);
      } finally {
        await database.close();
      }
    }
  );

  await t.test(
    "rejects the same PUBLIC SELECT grant when the reader has schema USAGE",
    async () => {
      const database = await prepareMigration();
      try {
        await addManagedMembership(
          database,
          "WITH ADMIN OPTION, INHERIT FALSE, SET FALSE"
        );
        await database.exec(
          'GRANT USAGE ON SCHEMA extensions TO "AI_Crypto_Bot_Archive_Decision_Reader";'
        );
        await assert.rejects(
          database.exec(usePgliteGrantor(postflightSql)),
          /USAGE on a non-approved schema/
        );
      } finally {
        await database.close();
      }
    }
  );

  const publicAccessFixtures = [
    {
      name: "continues rejecting relation-level PUBLIC access in public",
      setup: `
        CREATE TABLE public.public_relation_probe (value integer);
        GRANT SELECT ON public.public_relation_probe TO PUBLIC;
      `
    },
    {
      name: "continues rejecting column-level PUBLIC access in public",
      setup: `
        CREATE TABLE public.public_column_probe (hidden_value integer, visible_value integer);
        GRANT SELECT (visible_value) ON public.public_column_probe TO PUBLIC;
      `
    }
  ];

  for (const fixture of publicAccessFixtures) {
    await t.test(fixture.name, async () => {
      const database = await prepareMigration(fixture.setup);
      try {
        await addManagedMembership(
          database,
          "WITH ADMIN OPTION, INHERIT FALSE, SET FALSE"
        );
        await assert.rejects(
          database.exec(usePgliteGrantor(postflightSql)),
          /access to another non-system relation/
        );
      } finally {
        await database.close();
      }
    });
  }

  await t.test(
    "continues rejecting sequence privileges in the accessible public schema",
    async () => {
      const database = await prepareMigration(`
        CREATE SEQUENCE public.public_sequence_probe;
        GRANT USAGE ON SEQUENCE public.public_sequence_probe TO PUBLIC;
      `);
      try {
        await addManagedMembership(
          database,
          "WITH ADMIN OPTION, INHERIT FALSE, SET FALSE"
        );
        await assert.rejects(
          database.exec(usePgliteGrantor(postflightSql)),
          /privileges on a non-system sequence/
        );
      } finally {
        await database.close();
      }
    }
  );

  const rejectedMemberships = [
    {
      name: "requires the expected managed edge",
      setup: async () => {}
    },
    {
      name: "rejects the reader being a member of another role",
      setup: async (database) => {
        await addManagedMembership(
          database,
          "WITH ADMIN OPTION, INHERIT FALSE, SET FALSE"
        );
        await database.exec(
          'GRANT other_role TO "AI_Crypto_Bot_Archive_Decision_Reader";'
        );
      }
    },
    {
      name: "rejects another role being a member of the reader",
      setup: async (database) => {
        await addManagedMembership(
          database,
          "WITH ADMIN OPTION, INHERIT FALSE, SET FALSE"
        );
        await database.exec(
          'GRANT "AI_Crypto_Bot_Archive_Decision_Reader" TO other_role;'
        );
      }
    },
    {
      name: "rejects an edge with INHERIT enabled",
      setup: (database) => addManagedMembership(
        database,
        "WITH ADMIN OPTION, INHERIT TRUE, SET FALSE"
      )
    },
    {
      name: "rejects an edge with SET enabled",
      setup: (database) => addManagedMembership(
        database,
        "WITH ADMIN OPTION, INHERIT FALSE, SET TRUE"
      )
    },
    {
      name: "rejects an edge without ADMIN OPTION",
      setup: (database) => addManagedMembership(
        database,
        "WITH INHERIT FALSE, SET FALSE"
      )
    }
  ];

  for (const scenario of rejectedMemberships) {
    await t.test(scenario.name, async () => {
      const database = await prepareMigration();
      try {
        await scenario.setup(database);
        await assert.rejects(
          database.exec(usePgliteGrantor(postflightSql)),
          /Expected Supabase-managed postgres membership|unexpected role membership/
        );
      } finally {
        await database.close();
      }
    });
  }
});
