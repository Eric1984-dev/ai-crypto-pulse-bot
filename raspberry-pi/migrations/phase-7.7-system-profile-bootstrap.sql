BEGIN;

SELECT pg_catalog.pg_advisory_xact_lock(882018081::bigint);

DO $bootstrap$
DECLARE
  v_system_profile_id CONSTANT uuid := '00000000-0000-4000-8000-000000000100';
  v_profile_email text;
  v_profile_exists boolean;
  v_portfolio_count integer;
  v_portfolio_id uuid;
  v_starting_balance numeric;
  v_available_balance numeric;
  v_portfolio_value numeric;
  v_snapshot_count integer;
  v_open_positions integer;
BEGIN
  IF pg_catalog.to_regclass('public."AI_Crypto_Bot_Profiles"') IS NULL
    OR pg_catalog.to_regclass('public."AI_Crypto_Bot_Portfolios"') IS NULL
    OR pg_catalog.to_regclass('public."AI_Crypto_Bot_Positions"') IS NULL
    OR pg_catalog.to_regclass('public."AI_Crypto_Bot_Portfolio_Snapshots"') IS NULL
    OR pg_catalog.to_regclass('public."AI_Crypto_Bot_System_Profile_One_Portfolio"') IS NULL THEN
    RAISE EXCEPTION 'Apply the Phase 7.6 standalone-profile migration before bootstrapping';
  END IF;

  IF pg_catalog.to_regclass('auth.users') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint
      WHERE contype = 'f'
        AND conrelid = pg_catalog.to_regclass('public."AI_Crypto_Bot_Profiles"')
        AND confrelid = pg_catalog.to_regclass('auth.users')
    ) THEN
    RAISE EXCEPTION 'The Profiles table still depends on auth.users; apply Phase 7.6 first';
  END IF;

  SELECT email
  INTO v_profile_email
  FROM public."AI_Crypto_Bot_Profiles"
  WHERE id = v_system_profile_id;
  v_profile_exists := FOUND;

  IF v_profile_exists AND v_profile_email IS NOT NULL THEN
    RAISE EXCEPTION 'The reserved system profile ID is already in use';
  END IF;

  SELECT count(*)::integer
  INTO v_portfolio_count
  FROM public."AI_Crypto_Bot_Portfolios"
  WHERE user_id = v_system_profile_id;

  IF v_portfolio_count > 1 THEN
    RAISE EXCEPTION 'The system profile has % portfolios; inspect state before bootstrapping',
      v_portfolio_count;
  END IF;

  IF v_portfolio_count = 1 THEN
    SELECT id, starting_balance, available_balance, portfolio_value
    INTO v_portfolio_id,
         v_starting_balance,
         v_available_balance,
         v_portfolio_value
    FROM public."AI_Crypto_Bot_Portfolios"
    WHERE user_id = v_system_profile_id;
  END IF;

  IF NOT v_profile_exists THEN
    IF v_portfolio_count <> 0 THEN
      RAISE EXCEPTION 'An orphan system portfolio exists; inspect state before bootstrapping';
    END IF;

    INSERT INTO public."AI_Crypto_Bot_Profiles" (id, email)
    VALUES (v_system_profile_id, NULL);
  END IF;

  IF v_portfolio_count = 0 THEN
    INSERT INTO public."AI_Crypto_Bot_Portfolios" (
      user_id,
      starting_balance,
      available_balance,
      portfolio_value
    )
    VALUES (v_system_profile_id, 10000, 10000, 10000)
    RETURNING id,
              starting_balance,
              available_balance,
              portfolio_value
    INTO v_portfolio_id,
         v_starting_balance,
         v_available_balance,
         v_portfolio_value;
  END IF;

  SELECT count(*)::integer
  INTO v_snapshot_count
  FROM public."AI_Crypto_Bot_Portfolio_Snapshots"
  WHERE portfolio_id = v_portfolio_id;

  IF v_snapshot_count = 0 THEN
    SELECT count(*)::integer
    INTO v_open_positions
    FROM public."AI_Crypto_Bot_Positions"
    WHERE portfolio_id = v_portfolio_id
      AND status = 'OPEN';

    INSERT INTO public."AI_Crypto_Bot_Portfolio_Snapshots" (
      portfolio_id,
      portfolio_value,
      available_balance,
      open_positions
    )
    VALUES (
      v_portfolio_id,
      v_portfolio_value,
      v_available_balance,
      v_open_positions
    );
  END IF;
END;
$bootstrap$;

COMMIT;
