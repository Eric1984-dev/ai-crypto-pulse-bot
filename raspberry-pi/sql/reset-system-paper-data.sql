\if :{?confirm_paper_reset}
  \if :confirm_paper_reset
  \else
    \echo 'Refusing reset: pass --set=confirm_paper_reset=on to confirm.'
    \quit 3
  \endif
\else
  \echo 'Refusing reset: pass --set=confirm_paper_reset=on to confirm.'
  \quit 3
\endif

BEGIN;

SELECT pg_catalog.pg_advisory_xact_lock(882018081::bigint);

DO $reset$
DECLARE
  v_system_profile_id CONSTANT uuid := '00000000-0000-4000-8000-000000000100';
  v_portfolio_id uuid;
  v_profile_count integer;
  v_portfolio_count integer;
  v_other_portfolio_count integer;
  v_audit_deleted integer := 0;
  v_trades_deleted integer := 0;
  v_positions_deleted integer := 0;
  v_snapshots_deleted integer := 0;
  v_scenarios_deleted integer := 0;
  v_events_deleted integer := 0;
  v_decisions_deleted integer := 0;
  v_market_data_deleted integer := 0;
  v_candles_deleted integer := 0;
  v_scanner_events_deleted integer := 0;
  v_strategy_changes_deleted integer := 0;
  v_strategy_performance_deleted integer := 0;
  v_backtests_deleted integer := 0;
  v_analytics_deleted integer := 0;
BEGIN
  IF pg_catalog.current_database() <> 'ai_crypto_bot_store' THEN
    RAISE EXCEPTION 'Expected database ai_crypto_bot_store, connected to %',
      pg_catalog.current_database();
  END IF;

  IF pg_catalog.to_regclass('public."AI_Crypto_Bot_Profiles"') IS NULL
    OR pg_catalog.to_regclass('public."AI_Crypto_Bot_Portfolios"') IS NULL
    OR pg_catalog.to_regclass('public."AI_Crypto_Bot_Trades"') IS NULL
    OR pg_catalog.to_regclass('public."AI_Crypto_Bot_Positions"') IS NULL
    OR pg_catalog.to_regclass('public."AI_Crypto_Bot_Portfolio_Snapshots"') IS NULL
    OR pg_catalog.to_regclass('public."AI_Crypto_Bot_Watched_Markets"') IS NULL
    OR pg_catalog.to_regclass('public."AI_Crypto_Bot_AI_Decisions"') IS NULL
    OR pg_catalog.to_regclass('public."AI_Crypto_Bot_Market_Data"') IS NULL
    OR pg_catalog.to_regclass('public."AI_Crypto_Bot_Candles"') IS NULL
    OR pg_catalog.to_regclass('public."AI_Crypto_Bot_Strategies"') IS NULL
    OR pg_catalog.to_regclass('public."AI_Crypto_Bot_Strategy_Changes"') IS NULL
    OR pg_catalog.to_regclass('public."AI_Crypto_Bot_Strategy_Performance"') IS NULL
    OR pg_catalog.to_regclass('public."AI_Crypto_Bot_Backtests"') IS NULL
    OR pg_catalog.to_regclass('public."AI_Crypto_Bot_Scanner_Events"') IS NULL
    OR pg_catalog.to_regclass('public."AI_Crypto_Bot_Status"') IS NULL
    OR pg_catalog.to_regclass('public."AI_Crypto_Bot_Emergency_State"') IS NULL THEN
    RAISE EXCEPTION 'One or more required project tables are missing';
  END IF;

  SELECT count(*)::integer
  INTO v_profile_count
  FROM public."AI_Crypto_Bot_Profiles"
  WHERE id = v_system_profile_id
    AND email IS NULL;

  IF v_profile_count <> 1 THEN
    RAISE EXCEPTION
      'Expected exactly one reserved system profile with NULL email; found %',
      v_profile_count;
  END IF;

  SELECT count(*)::integer
  INTO v_portfolio_count
  FROM public."AI_Crypto_Bot_Portfolios"
  WHERE user_id = v_system_profile_id;

  IF v_portfolio_count <> 1 THEN
    RAISE EXCEPTION
      'Expected exactly one system portfolio; found %. Inspect state; no reset was performed.',
      v_portfolio_count;
  END IF;

  SELECT id
  INTO v_portfolio_id
  FROM public."AI_Crypto_Bot_Portfolios"
  WHERE user_id = v_system_profile_id;

  SELECT count(*)::integer
  INTO v_other_portfolio_count
  FROM public."AI_Crypto_Bot_Portfolios"
  WHERE user_id <> v_system_profile_id;

  IF v_other_portfolio_count <> 0 THEN
    RAISE EXCEPTION
      'Found % non-system portfolio(s). No reset was performed; review them before clearing shared project history.',
      v_other_portfolio_count;
  END IF;

  IF (
       pg_catalog.to_regclass('public."AI_Crypto_Bot_Shadow_Exit_Scenarios"')
         IS NULL
     ) IS DISTINCT FROM (
       pg_catalog.to_regclass('public."AI_Crypto_Bot_Shadow_Exit_Events"')
         IS NULL
     ) THEN
    RAISE EXCEPTION
      'Only one shadow-exit table exists; inspect schema before resetting';
  END IF;

  IF pg_catalog.to_regclass('public."AI_Crypto_Bot_Paper_Execution_Audit"') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public."AI_Crypto_Bot_Paper_Execution_Audit" AS audit
      WHERE audit.portfolio_id <> v_portfolio_id
    ) THEN
      RAISE EXCEPTION
        'Paper execution audit contains a non-system portfolio row. No reset was performed.';
    END IF;
  END IF;

  IF pg_catalog.to_regclass('public."AI_Crypto_Bot_Shadow_Exit_Scenarios"') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public."AI_Crypto_Bot_Shadow_Exit_Scenarios" AS scenario
      WHERE scenario.portfolio_id <> v_portfolio_id
    ) THEN
      RAISE EXCEPTION
        'Shadow-exit history contains a non-system portfolio row. No reset was performed.';
    END IF;
  END IF;

  IF pg_catalog.to_regclass('public."AI_Crypto_Bot_Paper_Execution_Audit"') IS NOT NULL THEN
    DELETE FROM public."AI_Crypto_Bot_Paper_Execution_Audit";
    GET DIAGNOSTICS v_audit_deleted = ROW_COUNT;
  END IF;

  IF pg_catalog.to_regclass('public."AI_Crypto_Bot_Shadow_Exit_Events"') IS NOT NULL THEN
    DELETE FROM public."AI_Crypto_Bot_Shadow_Exit_Events";
    GET DIAGNOSTICS v_events_deleted = ROW_COUNT;

    DELETE FROM public."AI_Crypto_Bot_Shadow_Exit_Scenarios";
    GET DIAGNOSTICS v_scenarios_deleted = ROW_COUNT;
  END IF;

  DELETE FROM public."AI_Crypto_Bot_Trades";
  GET DIAGNOSTICS v_trades_deleted = ROW_COUNT;

  DELETE FROM public."AI_Crypto_Bot_Positions";
  GET DIAGNOSTICS v_positions_deleted = ROW_COUNT;

  DELETE FROM public."AI_Crypto_Bot_Portfolio_Snapshots";
  GET DIAGNOSTICS v_snapshots_deleted = ROW_COUNT;

  DELETE FROM public."AI_Crypto_Bot_AI_Decisions";
  GET DIAGNOSTICS v_decisions_deleted = ROW_COUNT;

  DELETE FROM public."AI_Crypto_Bot_Market_Data";
  GET DIAGNOSTICS v_market_data_deleted = ROW_COUNT;

  DELETE FROM public."AI_Crypto_Bot_Candles";
  GET DIAGNOSTICS v_candles_deleted = ROW_COUNT;

  DELETE FROM public."AI_Crypto_Bot_Scanner_Events";
  GET DIAGNOSTICS v_scanner_events_deleted = ROW_COUNT;

  DELETE FROM public."AI_Crypto_Bot_Strategy_Changes";
  GET DIAGNOSTICS v_strategy_changes_deleted = ROW_COUNT;

  DELETE FROM public."AI_Crypto_Bot_Strategy_Performance";
  GET DIAGNOSTICS v_strategy_performance_deleted = ROW_COUNT;

  DELETE FROM public."AI_Crypto_Bot_Backtests";
  GET DIAGNOSTICS v_backtests_deleted = ROW_COUNT;

  IF pg_catalog.to_regclass('public."AI_Crypto_Bot_Analytics_Runs"') IS NOT NULL THEN
    DELETE FROM public."AI_Crypto_Bot_Analytics_Runs";
    GET DIAGNOSTICS v_analytics_deleted = ROW_COUNT;
  END IF;

  UPDATE public."AI_Crypto_Bot_Portfolios"
  SET starting_balance = 2000,
      available_balance = 2000,
      portfolio_value = 2000,
      updated_at = pg_catalog.now()
  WHERE id = v_portfolio_id;

  INSERT INTO public."AI_Crypto_Bot_Portfolio_Snapshots" (
    portfolio_id,
    portfolio_value,
    available_balance,
    open_positions
  )
  VALUES (
    v_portfolio_id,
    2000,
    2000,
    0
  );

  RAISE NOTICE
    'Paper reset complete at EUR 2000. Deleted: execution audits %, trades %, positions %, snapshots %, shadow scenarios %, shadow events %, AI decisions %, market snapshots %, candles %, scanner events %, strategy changes %, strategy performance rows %, backtests %, analytics runs %. Preserved profiles, watched markets, strategy definitions, agent status, and emergency state.',
    v_audit_deleted,
    v_trades_deleted,
    v_positions_deleted,
    v_snapshots_deleted,
    v_scenarios_deleted,
    v_events_deleted,
    v_decisions_deleted,
    v_market_data_deleted,
    v_candles_deleted,
    v_scanner_events_deleted,
    v_strategy_changes_deleted,
    v_strategy_performance_deleted,
    v_backtests_deleted,
    v_analytics_deleted;
END;
$reset$;

COMMIT;
