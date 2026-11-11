BEGIN;

SELECT pg_catalog.pg_advisory_xact_lock(882018081::bigint);

DO $provision$
DECLARE
  v_system_profile_id CONSTANT uuid := '00000000-0000-4000-8000-000000000100';
  v_profile_email text;
  v_portfolio_count integer;
  v_portfolio_id uuid;
BEGIN
  IF pg_catalog.to_regclass('public."AI_Crypto_Bot_Profiles"') IS NULL
    OR pg_catalog.to_regclass('public."AI_Crypto_Bot_Portfolios"') IS NULL
    OR pg_catalog.to_regclass('public."AI_Crypto_Bot_Portfolio_Snapshots"') IS NULL
    OR pg_catalog.to_regclass('public."AI_Crypto_Bot_System_Profile_One_Portfolio"') IS NULL THEN
    RAISE EXCEPTION 'Apply the Phase 7.6 schema migration before provisioning';
  END IF;

  SELECT email
  INTO v_profile_email
  FROM public."AI_Crypto_Bot_Profiles"
  WHERE id = v_system_profile_id;

  IF FOUND THEN
    IF v_profile_email IS NOT NULL THEN
      RAISE EXCEPTION 'The reserved system profile ID is already in use';
    END IF;

    SELECT count(*)
    INTO v_portfolio_count
    FROM public."AI_Crypto_Bot_Portfolios"
    WHERE user_id = v_system_profile_id;

    IF v_portfolio_count <> 1 THEN
      RAISE EXCEPTION
        'System profile exists with % portfolios; inspect state instead of recreating it',
        v_portfolio_count;
    END IF;

    RAISE NOTICE 'System profile and portfolio already exist; no data was changed';
    RETURN;
  END IF;

  SELECT count(*)
  INTO v_portfolio_count
  FROM public."AI_Crypto_Bot_Portfolios"
  WHERE user_id = v_system_profile_id;

  IF v_portfolio_count <> 0 THEN
    RAISE EXCEPTION 'An orphan system portfolio exists; inspect state before provisioning';
  END IF;

  INSERT INTO public."AI_Crypto_Bot_Profiles" (id, email)
  VALUES (v_system_profile_id, NULL);

  INSERT INTO public."AI_Crypto_Bot_Portfolios" (
    user_id,
    starting_balance,
    available_balance,
    portfolio_value
  )
  VALUES (v_system_profile_id, 10000, 10000, 10000)
  RETURNING id INTO v_portfolio_id;

  INSERT INTO public."AI_Crypto_Bot_Portfolio_Snapshots" (
    portfolio_id,
    portfolio_value,
    available_balance,
    open_positions
  )
  VALUES (v_portfolio_id, 10000, 10000, 0);

  RAISE NOTICE 'System profile and default paper portfolio provisioned';
END;
$provision$;

COMMIT;
