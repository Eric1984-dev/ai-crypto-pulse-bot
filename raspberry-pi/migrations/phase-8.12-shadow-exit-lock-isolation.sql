BEGIN;

DO $migration$
DECLARE
  v_function regprocedure := pg_catalog.to_regprocedure(
    'public."AI_Crypto_Bot_Evaluate_Shadow_Exit_Scenarios"()'
  );
  v_definition text;
  v_updated_definition text;
  v_old_lock text := '882018082';
  v_new_lock text := '882018083';
BEGIN
  IF v_function IS NULL THEN
    RAISE EXCEPTION
      'The shadow-exit evaluator must be installed before applying this migration.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid = v_function
      AND proc.proowner = (
        SELECT role_row.oid
        FROM pg_catalog.pg_roles AS role_row
        WHERE role_row.rolname = current_user
      )
  ) THEN
    RAISE EXCEPTION
      'The migration must run as the owner of the shadow-exit evaluator.';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_function)
  INTO v_definition;

  IF pg_catalog.strpos(v_definition, v_old_lock) = 0
    OR pg_catalog.strpos(
      pg_catalog.replace(v_definition, v_old_lock, ''),
      v_old_lock
    ) > 0 THEN
    RAISE EXCEPTION
      'The evaluator does not have the expected conflicting lock expression exactly once.';
  END IF;

  v_updated_definition := pg_catalog.replace(v_definition, v_old_lock, v_new_lock);
  EXECUTE v_updated_definition;

  SELECT pg_catalog.pg_get_functiondef(v_function)
  INTO v_definition;

  IF pg_catalog.strpos(v_definition, v_new_lock) = 0
    OR pg_catalog.strpos(v_definition, v_old_lock) > 0 THEN
    RAISE EXCEPTION
      'The evaluator lock expression was not updated as expected.';
  END IF;
END;
$migration$;

COMMIT;
