BEGIN;

DO $$
DECLARE
  v_function_definition text;
  v_old_condition constant text := 'v_decision.confidence < 70';
  v_new_condition constant text := 'v_decision.confidence < 67';
  v_condition_count integer;
BEGIN
  v_function_definition := pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure(
      'public."AI_Crypto_Bot_Apply_Paper_Decision"(uuid, uuid)'
    )
  );

  IF v_function_definition IS NULL THEN
    RAISE EXCEPTION 'Paper-trading decision function was not found.';
  END IF;

  v_condition_count := (
    pg_catalog.length(v_function_definition)
      - pg_catalog.length(
        pg_catalog.replace(v_function_definition, v_old_condition, '')
      )
  ) / pg_catalog.length(v_old_condition);

  IF v_condition_count <> 1 THEN
    RAISE EXCEPTION
      'Expected exactly one paper-trading confidence threshold condition; found %.',
      v_condition_count;
  END IF;

  EXECUTE pg_catalog.replace(
    v_function_definition,
    v_old_condition,
    v_new_condition
  );
END;
$$;

COMMIT;
