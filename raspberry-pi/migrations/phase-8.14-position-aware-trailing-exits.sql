BEGIN;

ALTER TABLE public."AI_Crypto_Bot_Positions"
  ADD COLUMN high_water_price numeric(28, 12),
  ADD COLUMN trailing_stop_price numeric(28, 12);

UPDATE public."AI_Crypto_Bot_Positions"
SET high_water_price = GREATEST(entry_price, current_price);

ALTER TABLE public."AI_Crypto_Bot_Positions"
  ALTER COLUMN high_water_price SET NOT NULL,
  ADD CONSTRAINT "AI_Crypto_Bot_Positions_high_water_price_positive"
    CHECK (high_water_price > 0),
  ADD CONSTRAINT "AI_Crypto_Bot_Positions_trailing_stop_valid"
    CHECK (
      trailing_stop_price IS NULL
      OR (trailing_stop_price > 0 AND trailing_stop_price <= high_water_price)
    );

ALTER TABLE public."AI_Crypto_Bot_Trades"
  ADD COLUMN execution_reason text NOT NULL DEFAULT 'AI_DECISION',
  ADD CONSTRAINT "AI_Crypto_Bot_Trades_execution_reason_valid"
    CHECK (execution_reason IN ('AI_DECISION', 'ATR_TRAILING_EXIT')),
  ADD CONSTRAINT "AI_Crypto_Bot_Trades_trailing_exit_source_valid"
    CHECK (
      execution_reason <> 'ATR_TRAILING_EXIT'
      OR (side = 'SELL' AND ai_decision_id IS NULL)
    );

DO $migration$
DECLARE
  v_paper_role_name text := nullif(
    pg_catalog.current_setting('cryptopulse.paper_database_user', true),
    ''
  );
  v_paper_role_oid oid;
  v_role_can_login boolean;
  v_role_is_superuser boolean;
  v_role_can_create_database boolean;
  v_role_can_create_role boolean;
  v_role_bypasses_rls boolean;
  v_candles_table oid := pg_catalog.to_regclass('public."AI_Crypto_Bot_Candles"');
BEGIN
  IF v_paper_role_name IS NULL THEN
    RAISE EXCEPTION
      'Set cryptopulse.paper_database_user to the configured PAPER_DATABASE_USER before applying this migration.';
  END IF;

  SELECT oid,
         rolcanlogin,
         rolsuper,
         rolcreatedb,
         rolcreaterole,
         rolbypassrls
  INTO v_paper_role_oid,
       v_role_can_login,
       v_role_is_superuser,
       v_role_can_create_database,
       v_role_can_create_role,
       v_role_bypasses_rls
  FROM pg_catalog.pg_roles
  WHERE rolname = v_paper_role_name;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Configured PAPER_DATABASE_USER role "%" does not exist.',
      v_paper_role_name;
  END IF;
  IF NOT v_role_can_login
    OR v_role_is_superuser
    OR v_role_can_create_database
    OR v_role_can_create_role
    OR v_role_bypasses_rls THEN
    RAISE EXCEPTION
      'Configured PAPER_DATABASE_USER role "%" must be a restricted login role.',
      v_paper_role_name;
  END IF;
  IF v_candles_table IS NULL THEN
    RAISE EXCEPTION 'Expected AI_Crypto_Bot_Candles table is not installed.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = v_candles_table
      AND relation.relowner = v_paper_role_oid
  )
    OR pg_catalog.has_table_privilege(v_paper_role_oid, v_candles_table, 'INSERT')
    OR pg_catalog.has_table_privilege(v_paper_role_oid, v_candles_table, 'UPDATE')
    OR pg_catalog.has_table_privilege(v_paper_role_oid, v_candles_table, 'DELETE')
    OR pg_catalog.has_table_privilege(v_paper_role_oid, v_candles_table, 'TRUNCATE') THEN
    RAISE EXCEPTION
      'PAPER_DATABASE_USER "%" must not own or write AI_Crypto_Bot_Candles.',
      v_paper_role_name;
  END IF;

  EXECUTE pg_catalog.format(
    'GRANT SELECT ON TABLE public."AI_Crypto_Bot_Candles" TO %I',
    v_paper_role_name
  );
END;
$migration$;

COMMIT;
