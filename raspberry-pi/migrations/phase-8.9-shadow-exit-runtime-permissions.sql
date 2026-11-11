BEGIN;

DO $migration$
DECLARE
  v_paper_role_name text := nullif(
    pg_catalog.current_setting('cryptopulse.paper_database_user', true),
    ''
  );
  v_paper_role_oid oid;
  v_paper_role_can_login boolean;
  v_paper_role_is_superuser boolean;
  v_paper_role_can_create_database boolean;
  v_paper_role_can_create_role boolean;
  v_paper_role_bypasses_rls boolean;
  v_function_owner oid;
  v_function_result text;
  v_function_is_security_definer boolean;
  v_function_config text[];
  v_legacy_role_name text;
BEGIN
  IF v_paper_role_name IS NULL THEN
    RAISE EXCEPTION
      'Set cryptopulse.paper_database_user to the configured PAPER_DATABASE_USER before applying this migration.';
  END IF;

  SELECT role_row.oid,
         role_row.rolcanlogin,
         role_row.rolsuper,
         role_row.rolcreatedb,
         role_row.rolcreaterole,
         role_row.rolbypassrls
  INTO v_paper_role_oid,
       v_paper_role_can_login,
       v_paper_role_is_superuser,
       v_paper_role_can_create_database,
       v_paper_role_can_create_role,
       v_paper_role_bypasses_rls
  FROM pg_catalog.pg_roles AS role_row
  WHERE role_row.rolname = v_paper_role_name;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Configured PAPER_DATABASE_USER role "%" does not exist.',
      v_paper_role_name;
  END IF;

  IF NOT v_paper_role_can_login
    OR v_paper_role_is_superuser
    OR v_paper_role_can_create_database
    OR v_paper_role_can_create_role
    OR v_paper_role_bypasses_rls THEN
    RAISE EXCEPTION
      'Configured PAPER_DATABASE_USER role "%" must be a restricted login role.',
      v_paper_role_name;
  END IF;

  SELECT proc.proowner,
         pg_catalog.pg_get_function_result(proc.oid),
         proc.prosecdef,
         proc.proconfig
  INTO v_function_owner,
       v_function_result,
       v_function_is_security_definer,
       v_function_config
  FROM pg_catalog.pg_proc AS proc
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'public'
    AND proc.proname = 'AI_Crypto_Bot_Evaluate_Shadow_Exit_Scenarios'
    AND proc.pronargs = 0
    AND proc.prokind = 'f';

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Expected public.AI_Crypto_Bot_Evaluate_Shadow_Exit_Scenarios() function is not installed.';
  END IF;

  IF v_function_result <> 'jsonb'
    OR NOT v_function_is_security_definer
    OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(COALESCE(v_function_config, ARRAY[]::text[])) AS setting
      WHERE setting LIKE 'search_path=%'
    ) THEN
    RAISE EXCEPTION
      'The shadow-exit evaluator must be SECURITY DEFINER, return jsonb, and pin search_path.';
  END IF;

  IF v_function_owner = v_paper_role_oid THEN
    RAISE EXCEPTION
      'PAPER_DATABASE_USER "%" must not own the shadow-exit evaluator.',
      v_paper_role_name;
  END IF;

  REVOKE ALL ON FUNCTION
    public."AI_Crypto_Bot_Evaluate_Shadow_Exit_Scenarios"()
    FROM PUBLIC;

  FOR v_legacy_role_name IN
    SELECT role_row.rolname
    FROM pg_catalog.pg_roles AS role_row
    WHERE role_row.rolname IN ('anon', 'authenticated', 'service_role')
      AND role_row.oid <> v_paper_role_oid
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE ALL ON FUNCTION public."AI_Crypto_Bot_Evaluate_Shadow_Exit_Scenarios"() FROM %I',
      v_legacy_role_name
    );
  END LOOP;

  EXECUTE pg_catalog.format('GRANT USAGE ON SCHEMA public TO %I', v_paper_role_name);
  EXECUTE pg_catalog.format(
    'GRANT EXECUTE ON FUNCTION public."AI_Crypto_Bot_Evaluate_Shadow_Exit_Scenarios"() TO %I',
    v_paper_role_name
  );
END;
$migration$;

COMMIT;
