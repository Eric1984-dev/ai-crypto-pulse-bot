BEGIN;

DO $migration$
DECLARE
  v_dashboard_role_name text := nullif(
    pg_catalog.current_setting('cryptopulse.dashboard_database_user', true),
    ''
  );
  v_dashboard_role_oid oid;
  v_can_login boolean;
  v_is_superuser boolean;
  v_can_create_database boolean;
  v_can_create_role boolean;
  v_bypasses_rls boolean;
BEGIN
  IF v_dashboard_role_name IS NULL THEN
    RAISE EXCEPTION
      'Set cryptopulse.dashboard_database_user to the configured DATABASE_USER before applying this migration.';
  END IF;

  SELECT role_row.oid,
         role_row.rolcanlogin,
         role_row.rolsuper,
         role_row.rolcreatedb,
         role_row.rolcreaterole,
         role_row.rolbypassrls
  INTO v_dashboard_role_oid,
       v_can_login,
       v_is_superuser,
       v_can_create_database,
       v_can_create_role,
       v_bypasses_rls
  FROM pg_catalog.pg_roles AS role_row
  WHERE role_row.rolname = v_dashboard_role_name;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Configured DATABASE_USER role "%" does not exist.',
      v_dashboard_role_name;
  END IF;

  IF NOT v_can_login
    OR v_is_superuser
    OR v_can_create_database
    OR v_can_create_role
    OR v_bypasses_rls THEN
    RAISE EXCEPTION
      'Configured DATABASE_USER role "%" must be a restricted login role.',
      v_dashboard_role_name;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN (
        'AI_Crypto_Bot_Shadow_Exit_Scenarios',
        'AI_Crypto_Bot_Shadow_Exit_Events'
      )
      AND relation.relkind IN ('r', 'p')
      AND relation.relowner = v_dashboard_role_oid
  ) THEN
    RAISE EXCEPTION
      'Configured DATABASE_USER role "%" must not own shadow-exit tables.',
      v_dashboard_role_name;
  END IF;

  EXECUTE pg_catalog.format('GRANT USAGE ON SCHEMA public TO %I', v_dashboard_role_name);
  EXECUTE pg_catalog.format(
    'GRANT SELECT ON TABLE public."AI_Crypto_Bot_Shadow_Exit_Scenarios", '
      || 'public."AI_Crypto_Bot_Shadow_Exit_Events" TO %I',
    v_dashboard_role_name
  );

  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('AI_Crypto_Bot_Shadow_Exit_Scenarios'),
        ('AI_Crypto_Bot_Shadow_Exit_Events')
    ) AS shadow_table(table_name)
    WHERE NOT pg_catalog.has_table_privilege(
            v_dashboard_role_name,
            pg_catalog.format('public.%I', shadow_table.table_name),
            'SELECT'
          )
       OR pg_catalog.has_table_privilege(
            v_dashboard_role_name,
            pg_catalog.format('public.%I', shadow_table.table_name),
            'INSERT'
          )
       OR pg_catalog.has_table_privilege(
            v_dashboard_role_name,
            pg_catalog.format('public.%I', shadow_table.table_name),
            'UPDATE'
          )
       OR pg_catalog.has_table_privilege(
            v_dashboard_role_name,
            pg_catalog.format('public.%I', shadow_table.table_name),
            'DELETE'
          )
       OR pg_catalog.has_table_privilege(
            v_dashboard_role_name,
            pg_catalog.format('public.%I', shadow_table.table_name),
            'TRUNCATE'
          )
  ) THEN
    RAISE EXCEPTION
      'Configured DATABASE_USER role "%" must have SELECT only on shadow-exit tables.',
      v_dashboard_role_name;
  END IF;
END;
$migration$;

COMMIT;
