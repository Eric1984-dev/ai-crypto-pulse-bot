\if :{?confirm_new_paper_capital}
  \if :confirm_new_paper_capital
  \else
    \echo 'Refusing balance change: pass --set=confirm_new_paper_capital=on to confirm.'
    \quit 3
  \endif
\else
  \echo 'Refusing balance change: pass --set=confirm_new_paper_capital=on to confirm.'
  \quit 3
\endif

BEGIN;

SELECT pg_catalog.pg_advisory_xact_lock(882018081::bigint);

DO $start$
DECLARE
  v_system_profile_id CONSTANT uuid := '00000000-0000-4000-8000-000000000100';
  v_portfolio_id uuid;
  v_profile_count integer;
  v_portfolio_count integer;
  v_snapshot_count integer;
  v_snapshot_matches boolean;
  v_position_count integer;
  v_trade_count integer;
  v_decision_count integer;
  v_updated_rows integer;
BEGIN
  IF pg_catalog.current_database() <> 'ai_crypto_bot_store' THEN
    RAISE EXCEPTION 'Expected database ai_crypto_bot_store, connected to %',
      pg_catalog.current_database();
  END IF;

  IF pg_catalog.to_regclass('public."AI_Crypto_Bot_Profiles"') IS NULL
    OR pg_catalog.to_regclass('public."AI_Crypto_Bot_Portfolios"') IS NULL
    OR pg_catalog.to_regclass('public."AI_Crypto_Bot_Portfolio_Snapshots"') IS NULL
    OR pg_catalog.to_regclass('public."AI_Crypto_Bot_Positions"') IS NULL
    OR pg_catalog.to_regclass('public."AI_Crypto_Bot_Trades"') IS NULL
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
      'Expected exactly one system portfolio; found %',
      v_portfolio_count;
  END IF;

  SELECT id
  INTO v_portfolio_id
  FROM public."AI_Crypto_Bot_Portfolios"
  WHERE user_id = v_system_profile_id;

  SELECT count(*)::integer
  INTO v_snapshot_count
  FROM public."AI_Crypto_Bot_Portfolio_Snapshots"
  WHERE portfolio_id = v_portfolio_id;

  IF v_snapshot_count <> 1 THEN
    RAISE EXCEPTION
      'Expected the single baseline snapshot created by the reset script; found %',
      v_snapshot_count;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public."AI_Crypto_Bot_Portfolios" AS portfolio
    JOIN public."AI_Crypto_Bot_Portfolio_Snapshots" AS snapshot
      ON snapshot.portfolio_id = portfolio.id
    WHERE portfolio.id = v_portfolio_id
      AND snapshot.open_positions = 0
      AND snapshot.available_balance = portfolio.starting_balance
      AND snapshot.portfolio_value = portfolio.starting_balance
      AND portfolio.available_balance = portfolio.starting_balance
      AND portfolio.portfolio_value = portfolio.starting_balance
  )
  INTO v_snapshot_matches;

  IF NOT v_snapshot_matches THEN
    RAISE EXCEPTION
      'The portfolio is not in the expected post-reset baseline state';
  END IF;

  SELECT count(*)::integer
  INTO v_position_count
  FROM public."AI_Crypto_Bot_Positions"
  WHERE portfolio_id = v_portfolio_id;

  SELECT count(*)::integer
  INTO v_trade_count
  FROM public."AI_Crypto_Bot_Trades"
  WHERE portfolio_id = v_portfolio_id;

  SELECT count(*)::integer
  INTO v_decision_count
  FROM public."AI_Crypto_Bot_AI_Decisions";

  IF v_position_count <> 0 OR v_trade_count <> 0 OR v_decision_count <> 0 THEN
    RAISE EXCEPTION
      'Paper history is not empty (positions %, trades %, decisions %); do not initialize capital yet',
      v_position_count,
      v_trade_count,
      v_decision_count;
  END IF;

  UPDATE public."AI_Crypto_Bot_Portfolios"
  SET starting_balance = 2000,
      available_balance = 2000,
      portfolio_value = 2000,
      updated_at = pg_catalog.now()
  WHERE id = v_portfolio_id;

  UPDATE public."AI_Crypto_Bot_Portfolio_Snapshots"
  SET portfolio_value = 2000,
      available_balance = 2000,
      open_positions = 0,
      captured_at = pg_catalog.now()
  WHERE portfolio_id = v_portfolio_id;
  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

  IF v_updated_rows <> 1 THEN
    RAISE EXCEPTION
      'Expected to update one baseline snapshot; updated %',
      v_updated_rows;
  END IF;

  RAISE NOTICE
    'System paper portfolio initialized with EUR 2000.00 and zero open positions.';
END;
$start$;

COMMIT;
