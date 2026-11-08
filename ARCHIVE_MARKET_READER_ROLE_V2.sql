BEGIN;

CREATE ROLE cryptopulse_archive_market_reader
  WITH NOLOGIN
       NOINHERIT
       NOSUPERUSER
       NOCREATEDB
       NOCREATEROLE
       NOREPLICATION
       NOBYPASSRLS
       CONNECTION LIMIT 1;

ALTER ROLE cryptopulse_archive_market_reader
  SET default_transaction_read_only = on;

REVOKE ALL PRIVILEGES ON DATABASE postgres
  FROM cryptopulse_archive_market_reader;
GRANT CONNECT ON DATABASE postgres
  TO cryptopulse_archive_market_reader;

REVOKE ALL PRIVILEGES ON SCHEMA public
  FROM cryptopulse_archive_market_reader;
GRANT USAGE ON SCHEMA public
  TO cryptopulse_archive_market_reader;

REVOKE ALL PRIVILEGES
  ON TABLE public."AI_Crypto_Bot_Watched_Markets"
  FROM cryptopulse_archive_market_reader;
GRANT SELECT
  ON TABLE public."AI_Crypto_Bot_Watched_Markets"
  TO cryptopulse_archive_market_reader;

CREATE POLICY "AI_Crypto_Bot_Watched_Markets_archive_reader_select"
  ON public."AI_Crypto_Bot_Watched_Markets"
  FOR SELECT
  TO cryptopulse_archive_market_reader
  USING (true);

DO $archive_reader_validation$
DECLARE
  reader_oid oid;
  reader_role record;
  market_table oid := 'public."AI_Crypto_Bot_Watched_Markets"'::regclass;
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Run this setup in the Supabase postgres database';
  END IF;

  SELECT oid, rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole,
         rolreplication, rolbypassrls, rolconnlimit
    INTO reader_role
    FROM pg_catalog.pg_roles
   WHERE rolname = 'cryptopulse_archive_market_reader';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Archive reader role was not created';
  END IF;

  reader_oid := reader_role.oid;

  IF reader_role.rolcanlogin
     OR reader_role.rolinherit
     OR reader_role.rolsuper
     OR reader_role.rolcreatedb
     OR reader_role.rolcreaterole
     OR reader_role.rolreplication
     OR reader_role.rolbypassrls
     OR reader_role.rolconnlimit <> 1 THEN
    RAISE EXCEPTION 'Archive reader role attributes are outside the approved profile';
  END IF;

  IF current_setting('server_version_num')::integer < 160000 THEN
    RAISE EXCEPTION 'Supabase role membership validation requires PostgreSQL 16 or later';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
      JOIN pg_catalog.pg_roles AS member_role
        ON member_role.oid = membership.member
      JOIN pg_catalog.pg_roles AS grantor_role
        ON grantor_role.oid = membership.grantor
     WHERE membership.member = reader_oid
        OR (
          membership.roleid = reader_oid
          AND NOT (
            member_role.rolname = 'postgres'
            AND grantor_role.rolname = 'supabase_admin'
            AND membership.admin_option
            AND NOT membership.inherit_option
            AND NOT membership.set_option
          )
        )
  ) THEN
    RAISE EXCEPTION 'Archive reader has an unexpected role membership; inspect pg_auth_members';
  END IF;

  IF NOT pg_catalog.has_database_privilege(reader_oid, 'postgres', 'CONNECT')
     OR pg_catalog.has_database_privilege(reader_oid, 'postgres', 'CREATE') THEN
    RAISE EXCEPTION 'Archive reader database privileges are outside the approved profile';
  END IF;

  IF NOT pg_catalog.has_schema_privilege(reader_oid, 'public', 'USAGE')
     OR pg_catalog.has_schema_privilege(reader_oid, 'public', 'CREATE') THEN
    RAISE EXCEPTION 'Archive reader schema privileges are outside the approved profile';
  END IF;

  IF NOT pg_catalog.has_table_privilege(reader_oid, market_table, 'SELECT')
     OR pg_catalog.has_table_privilege(reader_oid, market_table, 'INSERT')
     OR pg_catalog.has_table_privilege(reader_oid, market_table, 'UPDATE')
     OR pg_catalog.has_table_privilege(reader_oid, market_table, 'DELETE')
     OR pg_catalog.has_table_privilege(reader_oid, market_table, 'TRUNCATE')
     OR pg_catalog.has_table_privilege(reader_oid, market_table, 'REFERENCES')
     OR pg_catalog.has_table_privilege(reader_oid, market_table, 'TRIGGER') THEN
    RAISE EXCEPTION 'Archive reader watched-market table privileges are outside the approved profile';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS schema
        ON schema.oid = relation.relnamespace
     WHERE schema.nspname = 'public'
       AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND relation.oid <> market_table
       AND (
         pg_catalog.has_table_privilege(reader_oid, relation.oid, 'SELECT')
         OR pg_catalog.has_table_privilege(reader_oid, relation.oid, 'INSERT')
         OR pg_catalog.has_table_privilege(reader_oid, relation.oid, 'UPDATE')
         OR pg_catalog.has_table_privilege(reader_oid, relation.oid, 'DELETE')
         OR pg_catalog.has_table_privilege(reader_oid, relation.oid, 'TRUNCATE')
         OR pg_catalog.has_table_privilege(reader_oid, relation.oid, 'REFERENCES')
         OR pg_catalog.has_table_privilege(reader_oid, relation.oid, 'TRIGGER')
       )
  ) THEN
    RAISE EXCEPTION 'Archive reader has privileges on another public relation';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS sequence
      JOIN pg_catalog.pg_namespace AS schema
        ON schema.oid = sequence.relnamespace
     WHERE schema.nspname = 'public'
       AND sequence.relkind = 'S'
       AND (
         pg_catalog.has_sequence_privilege(reader_oid, sequence.oid, 'USAGE')
         OR pg_catalog.has_sequence_privilege(reader_oid, sequence.oid, 'SELECT')
         OR pg_catalog.has_sequence_privilege(reader_oid, sequence.oid, 'UPDATE')
       )
  ) THEN
    RAISE EXCEPTION 'Archive reader has privileges on a public sequence';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS routine
      JOIN pg_catalog.pg_namespace AS schema
        ON schema.oid = routine.pronamespace
     WHERE schema.nspname = 'public'
       AND pg_catalog.has_function_privilege(reader_oid, routine.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'Archive reader can execute a public routine';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_namespace AS schema
     WHERE schema.nspname <> 'public'
       AND schema.nspname <> 'information_schema'
       AND schema.nspname NOT LIKE 'pg\_%' ESCAPE '\'
       AND (
         pg_catalog.has_schema_privilege(reader_oid, schema.oid, 'USAGE')
         OR pg_catalog.has_schema_privilege(reader_oid, schema.oid, 'CREATE')
       )
  ) THEN
    RAISE EXCEPTION 'Archive reader has privileges on another application schema';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class
     WHERE oid = market_table
       AND relrowsecurity
       AND relowner <> reader_oid
  ) THEN
    RAISE EXCEPTION 'Watched-market RLS must be enabled and the reader cannot own the table';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'AI_Crypto_Bot_Watched_Markets'
       AND policyname = 'AI_Crypto_Bot_Watched_Markets_archive_reader_select'
       AND cmd = 'SELECT'
       AND roles @> ARRAY['cryptopulse_archive_market_reader']::name[]
       AND qual = 'true'
  ) THEN
    RAISE EXCEPTION 'The expected all-row SELECT RLS policy is missing';
  END IF;
END
$archive_reader_validation$;

COMMIT;
