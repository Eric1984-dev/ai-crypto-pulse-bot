BEGIN;

DO $preflight$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Run only in the approved Supabase postgres database';
  END IF;

  IF current_setting('server_version_num')::integer < 160000 THEN
    RAISE EXCEPTION 'Decision reader membership validation requires PostgreSQL 16 or later';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'AI_Crypto_Bot_Archive_Decision_Reader'
  ) THEN
    RAISE EXCEPTION 'Decision reader role already exists; inspect before proceeding';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'AI_Crypto_Bot_AI_Decisions'
      AND policyname = 'AI_Crypto_Bot_AI_Decisions_Archive_Reader_Select'
  ) THEN
    RAISE EXCEPTION 'Decision reader policy already exists; inspect before proceeding';
  END IF;

  IF to_regclass('public."AI_Crypto_Bot_AI_Decisions"') IS NULL THEN
    RAISE EXCEPTION 'AI decision table is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class
    WHERE oid = 'public."AI_Crypto_Bot_AI_Decisions"'::regclass
      AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Decision-table RLS must be enabled';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'AI_Crypto_Bot_AI_Decisions'
      AND policyname = 'AI_Crypto_Bot_AI_Decisions_select_authenticated'
      AND cmd = 'SELECT'
      AND roles @> ARRAY['authenticated']::name[]
      AND qual = 'true'
  ) THEN
    RAISE EXCEPTION 'Existing authenticated decision policy differs from expectation';
  END IF;
END
$preflight$;

CREATE ROLE "AI_Crypto_Bot_Archive_Decision_Reader"
  WITH NOLOGIN
       NOINHERIT
       NOSUPERUSER
       NOCREATEDB
       NOCREATEROLE
       NOREPLICATION
       NOBYPASSRLS
       CONNECTION LIMIT 1;

ALTER ROLE "AI_Crypto_Bot_Archive_Decision_Reader"
  SET default_transaction_read_only = on;

REVOKE ALL PRIVILEGES ON DATABASE postgres
  FROM "AI_Crypto_Bot_Archive_Decision_Reader";
GRANT CONNECT ON DATABASE postgres
  TO "AI_Crypto_Bot_Archive_Decision_Reader";

REVOKE ALL PRIVILEGES ON SCHEMA public
  FROM "AI_Crypto_Bot_Archive_Decision_Reader";
GRANT USAGE ON SCHEMA public
  TO "AI_Crypto_Bot_Archive_Decision_Reader";

REVOKE ALL PRIVILEGES
  ON TABLE public."AI_Crypto_Bot_AI_Decisions"
  FROM "AI_Crypto_Bot_Archive_Decision_Reader";
GRANT SELECT
  ON TABLE public."AI_Crypto_Bot_AI_Decisions"
  TO "AI_Crypto_Bot_Archive_Decision_Reader";

CREATE POLICY "AI_Crypto_Bot_AI_Decisions_Archive_Reader_Select"
  ON public."AI_Crypto_Bot_AI_Decisions"
  AS PERMISSIVE
  FOR SELECT
  TO "AI_Crypto_Bot_Archive_Decision_Reader"
  USING (true);

DO $postflight$
DECLARE
  reader_oid oid;
  postgres_oid oid;
  supabase_admin_oid oid;
  decision_oid oid;
BEGIN
  SELECT oid
  INTO reader_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = 'AI_Crypto_Bot_Archive_Decision_Reader';

  SELECT 'public."AI_Crypto_Bot_AI_Decisions"'::regclass
  INTO decision_oid;

  SELECT oid
  INTO postgres_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = 'postgres';

  SELECT oid
  INTO supabase_admin_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = 'supabase_admin';

  IF reader_oid IS NULL OR postgres_oid IS NULL
     OR supabase_admin_oid IS NULL OR decision_oid IS NULL THEN
    RAISE EXCEPTION 'Decision reader postflight could not resolve required objects';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE oid = reader_oid
      AND (
        rolsuper
        OR rolcreatedb
        OR rolcreaterole
        OR rolreplication
        OR rolbypassrls
        OR rolinherit
        OR rolcanlogin
        OR rolconnlimit <> 1
      )
  ) THEN
    RAISE EXCEPTION 'Decision reader role attributes exceed the approved scope';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership
    WHERE membership.roleid = reader_oid
      AND membership.member = postgres_oid
      AND membership.grantor = supabase_admin_oid
      AND membership.admin_option
      AND NOT membership.inherit_option
      AND NOT membership.set_option
  ) THEN
    RAISE EXCEPTION 'Expected Supabase-managed postgres membership is missing or differs';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership
    WHERE (membership.roleid = reader_oid OR membership.member = reader_oid)
      AND NOT (
        membership.roleid = reader_oid
        AND membership.member = postgres_oid
        AND membership.grantor = supabase_admin_oid
        AND membership.admin_option
        AND NOT membership.inherit_option
        AND NOT membership.set_option
      )
  ) THEN
    RAISE EXCEPTION 'Decision reader has an unexpected role membership';
  END IF;

  IF NOT pg_catalog.has_database_privilege(reader_oid, 'postgres', 'CONNECT')
     OR pg_catalog.has_database_privilege(reader_oid, 'postgres', 'CREATE')
     OR NOT pg_catalog.has_schema_privilege(reader_oid, 'public', 'USAGE')
     OR pg_catalog.has_schema_privilege(reader_oid, 'public', 'CREATE') THEN
    RAISE EXCEPTION 'Decision reader database or schema privileges exceed the approved scope';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace AS namespace
    WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
      AND left(namespace.nspname, 3) <> 'pg_'
      AND namespace.nspname <> 'public'
      AND pg_catalog.has_schema_privilege(reader_oid, namespace.oid, 'USAGE')
  ) THEN
    RAISE EXCEPTION 'Decision reader has USAGE on a non-approved schema';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace AS namespace
    WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
      AND left(namespace.nspname, 3) <> 'pg_'
      AND pg_catalog.has_schema_privilege(reader_oid, namespace.oid, 'CREATE')
  ) THEN
    RAISE EXCEPTION 'Decision reader has persistent schema-creation privileges';
  END IF;

  IF NOT pg_catalog.has_table_privilege(reader_oid, decision_oid, 'SELECT')
     OR pg_catalog.has_table_privilege(reader_oid, decision_oid, 'INSERT')
     OR pg_catalog.has_table_privilege(reader_oid, decision_oid, 'UPDATE')
     OR pg_catalog.has_table_privilege(reader_oid, decision_oid, 'DELETE')
     OR pg_catalog.has_table_privilege(reader_oid, decision_oid, 'TRUNCATE')
     OR pg_catalog.has_table_privilege(reader_oid, decision_oid, 'REFERENCES')
     OR pg_catalog.has_table_privilege(reader_oid, decision_oid, 'TRIGGER')
     OR pg_catalog.has_any_column_privilege(reader_oid, decision_oid, 'INSERT')
     OR pg_catalog.has_any_column_privilege(reader_oid, decision_oid, 'UPDATE')
     OR pg_catalog.has_any_column_privilege(reader_oid, decision_oid, 'REFERENCES') THEN
    RAISE EXCEPTION 'Decision reader table privileges exceed SELECT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
      AND left(namespace.nspname, 3) <> 'pg_'
      AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND relation.oid <> decision_oid
      AND pg_catalog.has_schema_privilege(reader_oid, namespace.oid, 'USAGE')
      AND (
        pg_catalog.has_table_privilege(reader_oid, relation.oid, 'SELECT')
        OR pg_catalog.has_table_privilege(reader_oid, relation.oid, 'INSERT')
        OR pg_catalog.has_table_privilege(reader_oid, relation.oid, 'UPDATE')
        OR pg_catalog.has_table_privilege(reader_oid, relation.oid, 'DELETE')
        OR pg_catalog.has_table_privilege(reader_oid, relation.oid, 'TRUNCATE')
        OR pg_catalog.has_table_privilege(reader_oid, relation.oid, 'REFERENCES')
        OR pg_catalog.has_table_privilege(reader_oid, relation.oid, 'TRIGGER')
        OR pg_catalog.has_any_column_privilege(reader_oid, relation.oid, 'SELECT')
        OR pg_catalog.has_any_column_privilege(reader_oid, relation.oid, 'INSERT')
        OR pg_catalog.has_any_column_privilege(reader_oid, relation.oid, 'UPDATE')
        OR pg_catalog.has_any_column_privilege(reader_oid, relation.oid, 'REFERENCES')
      )
  ) THEN
    RAISE EXCEPTION 'Decision reader has access to another non-system relation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
      AND left(namespace.nspname, 3) <> 'pg_'
      AND relation.relkind = 'S'
      AND pg_catalog.has_schema_privilege(reader_oid, namespace.oid, 'USAGE')
      AND (
        pg_catalog.has_sequence_privilege(reader_oid, relation.oid, 'USAGE')
        OR pg_catalog.has_sequence_privilege(reader_oid, relation.oid, 'SELECT')
        OR pg_catalog.has_sequence_privilege(reader_oid, relation.oid, 'UPDATE')
      )
  ) THEN
    RAISE EXCEPTION 'Decision reader has privileges on a non-system sequence';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND left(procedure.proname, 14) = 'AI_Crypto_Bot_'
      AND pg_catalog.has_function_privilege(reader_oid, procedure.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'Decision reader has execute access to a CryptoPulse function';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'AI_Crypto_Bot_AI_Decisions'
      AND policyname = 'AI_Crypto_Bot_AI_Decisions_Archive_Reader_Select'
      AND permissive = 'PERMISSIVE'
      AND cmd = 'SELECT'
      AND roles @> ARRAY['AI_Crypto_Bot_Archive_Decision_Reader']::name[]
      AND qual = 'true'
  ) THEN
    RAISE EXCEPTION 'Decision reader SELECT policy postflight failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS role
    JOIN pg_catalog.pg_db_role_setting AS setting
      ON setting.setrole = role.oid
     AND setting.setdatabase = 0
    WHERE role.oid = reader_oid
      AND 'default_transaction_read_only=on' = ANY(setting.setconfig)
  ) THEN
    RAISE EXCEPTION 'Decision reader read-only transaction default is missing';
  END IF;
END
$postflight$;

COMMIT;
