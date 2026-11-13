BEGIN;

DO $migration$
DECLARE
  v_paper_role_name text := nullif(
    pg_catalog.current_setting('cryptopulse.paper_database_user', true),
    ''
  );
BEGIN
  IF v_paper_role_name IS NULL THEN
    RAISE EXCEPTION
      'Set cryptopulse.paper_database_user to the configured PAPER_DATABASE_USER before applying this migration.';
  END IF;
  IF v_paper_role_name = 'ai_crypto_bot_runtime_reader' THEN
    RAISE EXCEPTION
      'PAPER_DATABASE_USER must be distinct from ai_crypto_bot_runtime_reader.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = v_paper_role_name
  ) THEN
    RAISE EXCEPTION 'Configured PAPER_DATABASE_USER role "%" does not exist.',
      v_paper_role_name;
  END IF;
  IF pg_catalog.to_regclass(
    'public."AI_Crypto_Bot_Paper_Execution_Audit"'
  ) IS NULL THEN
    RAISE EXCEPTION
      'Expected AI_Crypto_Bot_Paper_Execution_Audit table is not installed.';
  END IF;

  EXECUTE pg_catalog.format(
    'GRANT SELECT (evaluation_run_id, portfolio_id, decision_id) ON TABLE public."AI_Crypto_Bot_Paper_Execution_Audit" TO %I',
    v_paper_role_name
  );
END;
$migration$;

COMMIT;
