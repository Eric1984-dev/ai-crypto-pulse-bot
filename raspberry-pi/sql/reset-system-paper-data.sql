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
  v_starting_balance numeric;
  v_trades_deleted integer := 0;
  v_positions_deleted integer := 0;
  v_snapshots_deleted integer := 0;
  v_scenarios_deleted integer := 0;
  v_events_deleted integer := 0;
  v_decisions_deleted integer := 0;
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
    OR pg_catalog.to_regclass('public."AI_Crypto_Bot_AI_Decisions"') IS NULL THEN
    RAISE EXCEPTION 'One or more required paper-trading tables are missing';
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

  SELECT id, starting_balance
  INTO v_portfolio_id, v_starting_balance
  FROM public."AI_Crypto_Bot_Portfolios"
  WHERE user_id = v_system_profile_id;

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

  IF EXISTS (
    SELECT 1
    FROM public."AI_Crypto_Bot_Trades" AS trade
    WHERE trade.portfolio_id <> v_portfolio_id
      AND trade.ai_decision_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'A trade outside the system portfolio references an AI decision. No reset was performed; preserve and inspect that history.';
  END IF;

  IF pg_catalog.to_regclass('public."AI_Crypto_Bot_Shadow_Exit_Events"') IS NOT NULL THEN
    DELETE FROM public."AI_Crypto_Bot_Shadow_Exit_Events" AS event
    WHERE event.position_id IN (
      SELECT position.id
      FROM public."AI_Crypto_Bot_Positions" AS position
      WHERE position.portfolio_id = v_portfolio_id
    )
    OR event.scenario_id IN (
      SELECT scenario.id
      FROM public."AI_Crypto_Bot_Shadow_Exit_Scenarios" AS scenario
      WHERE scenario.portfolio_id = v_portfolio_id
    );
    GET DIAGNOSTICS v_events_deleted = ROW_COUNT;

    DELETE FROM public."AI_Crypto_Bot_Shadow_Exit_Scenarios"
    WHERE portfolio_id = v_portfolio_id;
    GET DIAGNOSTICS v_scenarios_deleted = ROW_COUNT;
  END IF;

  DELETE FROM public."AI_Crypto_Bot_Trades"
  WHERE portfolio_id = v_portfolio_id;
  GET DIAGNOSTICS v_trades_deleted = ROW_COUNT;

  DELETE FROM public."AI_Crypto_Bot_Positions"
  WHERE portfolio_id = v_portfolio_id;
  GET DIAGNOSTICS v_positions_deleted = ROW_COUNT;

  DELETE FROM public."AI_Crypto_Bot_Portfolio_Snapshots"
  WHERE portfolio_id = v_portfolio_id;
  GET DIAGNOSTICS v_snapshots_deleted = ROW_COUNT;

  DELETE FROM public."AI_Crypto_Bot_AI_Decisions";
  GET DIAGNOSTICS v_decisions_deleted = ROW_COUNT;

  IF pg_catalog.to_regclass('public."AI_Crypto_Bot_Analytics_Runs"') IS NOT NULL THEN
    DELETE FROM public."AI_Crypto_Bot_Analytics_Runs";
    GET DIAGNOSTICS v_analytics_deleted = ROW_COUNT;
  END IF;

  UPDATE public."AI_Crypto_Bot_Portfolios"
  SET available_balance = v_starting_balance,
      portfolio_value = v_starting_balance,
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
    v_starting_balance,
    v_starting_balance,
    0
  );

  RAISE NOTICE
    'Paper reset complete. Deleted: trades %, positions %, snapshots %, shadow scenarios %, shadow events %, AI decisions %, analytics runs %. Watched markets and market data were preserved.',
    v_trades_deleted,
    v_positions_deleted,
    v_snapshots_deleted,
    v_scenarios_deleted,
    v_events_deleted,
    v_decisions_deleted,
    v_analytics_deleted;
END;
$reset$;

COMMIT;
