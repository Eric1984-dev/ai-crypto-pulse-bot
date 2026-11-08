\set ON_ERROR_STOP on

BEGIN;

DO $provision_archive_decision_writer$
DECLARE
  writer_role CONSTANT text := 'AI_Crypto_Bot_Archive_Decision_Writer';
  legacy_role CONSTANT text := 'ai_crypto_bot_archive_user';
  decision_table CONSTANT text := 'public."AI_Crypto_Bot_AI_Decisions"';
  market_table CONSTANT text := 'public."AI_Crypto_Bot_Watched_Markets"';
  writer_oid oid;
  legacy_oid oid;
  decision_oid oid;
  market_oid oid;
  relation_owners_before jsonb;
  legacy_relations_before jsonb;
  relation_owners_after jsonb;
  legacy_relations_after jsonb;
  primary_key_count bigint;
  foreign_key_count bigint;
  privilege_name text;
  expected_privilege boolean;
BEGIN
  IF current_database() <> 'ai_crypto_bot_archive' THEN
    RAISE EXCEPTION 'Refusing to provision outside ai_crypto_bot_archive';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = writer_role) THEN
    RAISE EXCEPTION 'Writer role already exists; inspect it instead of altering it';
  END IF;

  SELECT oid INTO legacy_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = legacy_role;

  IF legacy_oid IS NULL THEN
    RAISE EXCEPTION 'Expected existing archive account is missing';
  END IF;

  decision_oid := pg_catalog.to_regclass(decision_table);
  market_oid := pg_catalog.to_regclass(market_table);
  IF decision_oid IS NULL OR market_oid IS NULL THEN
    RAISE EXCEPTION 'Required archive tables are missing';
  END IF;

  IF (SELECT relkind FROM pg_catalog.pg_class WHERE oid = decision_oid) <> 'r'
     OR (SELECT relkind FROM pg_catalog.pg_class WHERE oid = market_oid) <> 'r' THEN
    RAISE EXCEPTION 'Required archive relations must be ordinary tables';
  END IF;

  IF EXISTS (
    WITH expected(
      ordinal_position, column_name, data_type, is_nullable,
      numeric_precision, numeric_scale, datetime_precision
    ) AS (
      VALUES
        (1, 'id', 'uuid', 'NO', NULL::integer, NULL::integer, NULL::integer),
        (2, 'symbol', 'text', 'NO', NULL::integer, NULL::integer, NULL::integer),
        (3, 'decision', 'text', 'NO', NULL::integer, NULL::integer, NULL::integer),
        (4, 'confidence', 'numeric', 'NO', 5, 2, NULL::integer),
        (5, 'indicators', 'jsonb', 'NO', NULL::integer, NULL::integer, NULL::integer),
        (6, 'reason', 'text', 'NO', NULL::integer, NULL::integer, NULL::integer),
        (7, 'strategy_name', 'text', 'YES', NULL::integer, NULL::integer, NULL::integer),
        (8, 'strategy_version', 'text', 'YES', NULL::integer, NULL::integer, NULL::integer),
        (9, 'created_at', 'timestamp with time zone', 'NO', NULL::integer, NULL::integer, 6)
    ),
    actual AS (
      SELECT ordinal_position, column_name, data_type, is_nullable,
             numeric_precision, numeric_scale, datetime_precision
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'AI_Crypto_Bot_AI_Decisions'
    )
    SELECT 1
    FROM expected
    FULL JOIN actual
      ON actual.ordinal_position = expected.ordinal_position
    WHERE expected.ordinal_position IS NULL
       OR actual.ordinal_position IS NULL
       OR expected.column_name IS DISTINCT FROM actual.column_name
       OR expected.data_type IS DISTINCT FROM actual.data_type
       OR expected.is_nullable IS DISTINCT FROM actual.is_nullable
       OR expected.numeric_precision IS DISTINCT FROM actual.numeric_precision
       OR expected.numeric_scale IS DISTINCT FROM actual.numeric_scale
       OR expected.datetime_precision IS DISTINCT FROM actual.datetime_precision
  ) THEN
    RAISE EXCEPTION 'Archive decision table does not match the agent column contract';
  END IF;

  SELECT count(*) FILTER (WHERE contype = 'p'),
         count(*) FILTER (WHERE contype = 'f')
  INTO primary_key_count, foreign_key_count
  FROM pg_catalog.pg_constraint
  WHERE conrelid = decision_oid
    AND contype IN ('p', 'f');

  IF primary_key_count <> 1 OR foreign_key_count <> 1
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_constraint AS key_constraint
       JOIN pg_catalog.pg_attribute AS key_column
         ON key_column.attrelid = decision_oid
        AND key_column.attname = 'id'
        AND key_column.attnum > 0
        AND NOT key_column.attisdropped
       WHERE key_constraint.conrelid = decision_oid
         AND key_constraint.contype = 'p'
         AND key_constraint.convalidated
         AND key_constraint.conkey = ARRAY[key_column.attnum]::smallint[]
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_constraint AS key_constraint
       JOIN pg_catalog.pg_attribute AS source_column
         ON source_column.attrelid = decision_oid
        AND source_column.attname = 'symbol'
        AND source_column.attnum > 0
        AND NOT source_column.attisdropped
       JOIN pg_catalog.pg_attribute AS target_column
         ON target_column.attrelid = market_oid
        AND target_column.attname = 'symbol'
        AND target_column.attnum > 0
        AND NOT target_column.attisdropped
       WHERE key_constraint.conrelid = decision_oid
         AND key_constraint.contype = 'f'
         AND key_constraint.convalidated
         AND key_constraint.confrelid = market_oid
         AND key_constraint.conkey = ARRAY[source_column.attnum]::smallint[]
         AND key_constraint.confkey = ARRAY[target_column.attnum]::smallint[]
         AND key_constraint.confdeltype = 'r'
     ) THEN
    RAISE EXCEPTION 'Archive decision primary-key or watched-market foreign-key contract does not match';
  END IF;

  SELECT COALESCE(
    jsonb_agg(jsonb_build_array(relation.oid::text, relation.relowner::text)
              ORDER BY relation.oid),
    '[]'::jsonb
  )
  INTO relation_owners_before
  FROM pg_catalog.pg_class AS relation;

  SELECT COALESCE(
    jsonb_agg(jsonb_build_array(relation.oid::text, relation.relname, relation.relkind)
              ORDER BY relation.oid),
    '[]'::jsonb
  )
  INTO legacy_relations_before
  FROM pg_catalog.pg_class AS relation
  WHERE relation.relowner = legacy_oid;

  EXECUTE 'CREATE ROLE "AI_Crypto_Bot_Archive_Decision_Writer" '
       || 'NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE '
       || 'NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1';
  EXECUTE 'GRANT CONNECT ON DATABASE ai_crypto_bot_archive '
       || 'TO "AI_Crypto_Bot_Archive_Decision_Writer"';
  EXECUTE 'GRANT USAGE ON SCHEMA public '
       || 'TO "AI_Crypto_Bot_Archive_Decision_Writer"';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE '
       || 'public."AI_Crypto_Bot_AI_Decisions" '
       || 'TO "AI_Crypto_Bot_Archive_Decision_Writer"';
  EXECUTE 'GRANT SELECT ON TABLE public."AI_Crypto_Bot_Watched_Markets" '
       || 'TO "AI_Crypto_Bot_Archive_Decision_Writer"';

  SELECT oid INTO writer_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = writer_role;

  IF writer_oid IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE oid = writer_oid
      AND NOT rolsuper
      AND NOT rolinherit
      AND NOT rolcreaterole
      AND NOT rolcreatedb
      AND NOT rolreplication
      AND NOT rolbypassrls
      AND NOT rolcanlogin
      AND rolconnlimit = 1
  ) THEN
    RAISE EXCEPTION 'Writer role attributes do not match the approved NOLOGIN contract';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members
    WHERE roleid = writer_oid OR member = writer_oid
  ) THEN
    RAISE EXCEPTION 'Writer role has an unexpected role membership';
  END IF;

  IF NOT pg_catalog.has_database_privilege(writer_oid, current_database(), 'CONNECT')
     OR pg_catalog.has_database_privilege(writer_oid, current_database(), 'CREATE') THEN
    RAISE EXCEPTION 'Writer database privileges do not match the approved contract';
  END IF;

  IF NOT pg_catalog.has_schema_privilege(writer_oid, 'public', 'USAGE')
     OR pg_catalog.has_schema_privilege(writer_oid, 'public', 'CREATE')
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_namespace AS namespace
       WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
         AND left(namespace.nspname, 3) <> 'pg_'
         AND namespace.nspname <> 'public'
         AND pg_catalog.has_schema_privilege(writer_oid, namespace.oid, 'USAGE')
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_namespace AS namespace
       WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
         AND left(namespace.nspname, 3) <> 'pg_'
         AND pg_catalog.has_schema_privilege(writer_oid, namespace.oid, 'CREATE')
     ) THEN
    RAISE EXCEPTION 'Writer schema privileges do not match the approved contract';
  END IF;

  FOREACH privilege_name IN ARRAY ARRAY[
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ] LOOP
    expected_privilege := privilege_name = ANY (ARRAY['SELECT', 'INSERT', 'UPDATE']);
    IF pg_catalog.has_table_privilege(writer_oid, decision_oid, privilege_name)
       IS DISTINCT FROM expected_privilege THEN
      RAISE EXCEPTION 'Unexpected effective privilege on the decision table';
    END IF;

    expected_privilege := privilege_name = 'SELECT';
    IF pg_catalog.has_table_privilege(writer_oid, market_oid, privilege_name)
       IS DISTINCT FROM expected_privilege THEN
      RAISE EXCEPTION 'Unexpected effective privilege on the watched-market table';
    END IF;
  END LOOP;

  IF pg_catalog.has_any_column_privilege(writer_oid, market_oid, 'INSERT')
     OR pg_catalog.has_any_column_privilege(writer_oid, market_oid, 'UPDATE')
     OR pg_catalog.has_any_column_privilege(writer_oid, market_oid, 'REFERENCES')
     OR pg_catalog.has_any_column_privilege(writer_oid, decision_oid, 'REFERENCES') THEN
    RAISE EXCEPTION 'Unexpected effective column privilege on an archive table';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
      AND left(namespace.nspname, 3) <> 'pg_'
      AND pg_catalog.has_schema_privilege(writer_oid, namespace.oid, 'USAGE')
      AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND relation.oid NOT IN (decision_oid, market_oid)
      AND (
        pg_catalog.has_table_privilege(writer_oid, relation.oid, 'SELECT')
        OR pg_catalog.has_table_privilege(writer_oid, relation.oid, 'INSERT')
        OR pg_catalog.has_table_privilege(writer_oid, relation.oid, 'UPDATE')
        OR pg_catalog.has_table_privilege(writer_oid, relation.oid, 'DELETE')
        OR pg_catalog.has_table_privilege(writer_oid, relation.oid, 'TRUNCATE')
        OR pg_catalog.has_table_privilege(writer_oid, relation.oid, 'REFERENCES')
        OR pg_catalog.has_table_privilege(writer_oid, relation.oid, 'TRIGGER')
        OR pg_catalog.has_any_column_privilege(writer_oid, relation.oid, 'SELECT')
        OR pg_catalog.has_any_column_privilege(writer_oid, relation.oid, 'INSERT')
        OR pg_catalog.has_any_column_privilege(writer_oid, relation.oid, 'UPDATE')
        OR pg_catalog.has_any_column_privilege(writer_oid, relation.oid, 'REFERENCES')
      )
  ) THEN
    RAISE EXCEPTION 'Writer has effective privileges on an unrelated relation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
      AND left(namespace.nspname, 3) <> 'pg_'
      AND pg_catalog.has_schema_privilege(writer_oid, namespace.oid, 'USAGE')
      AND relation.relkind = 'S'
      AND (
        pg_catalog.has_sequence_privilege(writer_oid, relation.oid, 'USAGE')
        OR pg_catalog.has_sequence_privilege(writer_oid, relation.oid, 'SELECT')
        OR pg_catalog.has_sequence_privilege(writer_oid, relation.oid, 'UPDATE')
      )
  ) THEN
    RAISE EXCEPTION 'Writer has an unexpected sequence privilege';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    WHERE relation.relowner = writer_oid
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace AS namespace
    WHERE namespace.nspowner = writer_oid
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_database AS database
    WHERE database.datdba = writer_oid
  ) THEN
    RAISE EXCEPTION 'Writer unexpectedly owns a database object';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_database AS database
    CROSS JOIN LATERAL pg_catalog.aclexplode(database.datacl) AS acl
    WHERE acl.grantee = writer_oid AND acl.is_grantable
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace AS namespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(namespace.nspacl) AS acl
    WHERE acl.grantee = writer_oid AND acl.is_grantable
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl) AS acl
    WHERE acl.grantee = writer_oid AND acl.is_grantable
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
    WHERE attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND acl.grantee = writer_oid
      AND acl.is_grantable
  ) THEN
    RAISE EXCEPTION 'Writer was given a grant option';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE oid = legacy_oid AND rolname = legacy_role
  ) THEN
    RAISE EXCEPTION 'Existing archive account identity changed unexpectedly';
  END IF;

  SELECT COALESCE(
    jsonb_agg(jsonb_build_array(relation.oid::text, relation.relowner::text)
              ORDER BY relation.oid),
    '[]'::jsonb
  )
  INTO relation_owners_after
  FROM pg_catalog.pg_class AS relation;

  SELECT COALESCE(
    jsonb_agg(jsonb_build_array(relation.oid::text, relation.relname, relation.relkind)
              ORDER BY relation.oid),
    '[]'::jsonb
  )
  INTO legacy_relations_after
  FROM pg_catalog.pg_class AS relation
  WHERE relation.relowner = legacy_oid;

  IF relation_owners_after IS DISTINCT FROM relation_owners_before
     OR legacy_relations_after IS DISTINCT FROM legacy_relations_before THEN
    RAISE EXCEPTION 'Relation ownership changed; rolling back writer-role setup';
  END IF;

  RAISE NOTICE 'Archive decision-writer role and effective privileges verified';
END
$provision_archive_decision_writer$;

COMMIT;

-- Rollback procedure (run separately only after approval).
-- This deliberately has no CASCADE and never changes the legacy archive account.
--
-- BEGIN;
-- DO $rollback_preflight$
-- DECLARE
--   writer_oid oid;
-- BEGIN
--   IF current_database() <> 'ai_crypto_bot_archive' THEN
--     RAISE EXCEPTION 'Refusing rollback outside ai_crypto_bot_archive';
--   END IF;
--   SELECT oid INTO writer_oid
--   FROM pg_catalog.pg_roles
--   WHERE rolname = 'AI_Crypto_Bot_Archive_Decision_Writer';
--   IF writer_oid IS NULL THEN
--     RAISE EXCEPTION 'Writer role does not exist';
--   END IF;
--   IF EXISTS (
--     SELECT 1 FROM pg_catalog.pg_auth_members
--     WHERE roleid = writer_oid OR member = writer_oid
--   ) OR EXISTS (
--     SELECT 1 FROM pg_catalog.pg_class WHERE relowner = writer_oid
--   ) OR EXISTS (
--     SELECT 1 FROM pg_catalog.pg_namespace WHERE nspowner = writer_oid
--   ) OR EXISTS (
--     SELECT 1 FROM pg_catalog.pg_database WHERE datdba = writer_oid
--   ) THEN
--     RAISE EXCEPTION 'Unexpected membership or ownership; stop and inspect manually';
--   END IF;
-- END
-- $rollback_preflight$;
-- ALTER ROLE "AI_Crypto_Bot_Archive_Decision_Writer" NOLOGIN;
-- REVOKE CONNECT ON DATABASE ai_crypto_bot_archive
--   FROM "AI_Crypto_Bot_Archive_Decision_Writer";
-- REVOKE USAGE ON SCHEMA public
--   FROM "AI_Crypto_Bot_Archive_Decision_Writer";
-- REVOKE SELECT, INSERT, UPDATE ON TABLE public."AI_Crypto_Bot_AI_Decisions"
--   FROM "AI_Crypto_Bot_Archive_Decision_Writer";
-- REVOKE SELECT ON TABLE public."AI_Crypto_Bot_Watched_Markets"
--   FROM "AI_Crypto_Bot_Archive_Decision_Writer";
-- DROP ROLE "AI_Crypto_Bot_Archive_Decision_Writer";
-- COMMIT;
