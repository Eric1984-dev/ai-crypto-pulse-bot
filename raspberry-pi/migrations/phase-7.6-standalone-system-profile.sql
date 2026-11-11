BEGIN;

DO $migration$
DECLARE
  v_profiles regclass := pg_catalog.to_regclass('public."AI_Crypto_Bot_Profiles"');
  v_auth_users regclass := pg_catalog.to_regclass('auth.users');
  v_profile_id_attnum smallint;
  v_auth_id_attnum smallint;
  v_fk record;
  v_relation regclass;
  v_policy record;
BEGIN
  IF v_profiles IS NULL THEN
    RAISE EXCEPTION 'AI_Crypto_Bot_Profiles is missing';
  END IF;

  IF v_auth_users IS NOT NULL THEN
    SELECT attnum::smallint
    INTO v_profile_id_attnum
    FROM pg_catalog.pg_attribute
    WHERE attrelid = v_profiles
      AND attname = 'id'
      AND NOT attisdropped;

    SELECT attnum::smallint
    INTO v_auth_id_attnum
    FROM pg_catalog.pg_attribute
    WHERE attrelid = v_auth_users
      AND attname = 'id'
      AND NOT attisdropped;

    IF v_profile_id_attnum IS NULL OR v_auth_id_attnum IS NULL THEN
      RAISE EXCEPTION 'Profile/Auth identity columns could not be verified';
    END IF;

    FOR v_fk IN
      SELECT conname, conkey, confkey
      FROM pg_catalog.pg_constraint
      WHERE contype = 'f'
        AND conrelid = v_profiles
        AND confrelid = v_auth_users
    LOOP
      IF v_fk.conkey IS DISTINCT FROM ARRAY[v_profile_id_attnum]::smallint[]
        OR v_fk.confkey IS DISTINCT FROM ARRAY[v_auth_id_attnum]::smallint[] THEN
        RAISE EXCEPTION 'Unexpected Profiles foreign key to auth.users: %', v_fk.conname;
      END IF;

      EXECUTE pg_catalog.format(
        'ALTER TABLE %s DROP CONSTRAINT %I',
        v_profiles,
        v_fk.conname
      );
    END LOOP;

    EXECUTE pg_catalog.format(
      'DROP TRIGGER IF EXISTS %I ON %s',
      'AI_Crypto_Bot_Auth_User_Profile_Insert',
      v_auth_users
    );
    EXECUTE pg_catalog.format(
      'DROP TRIGGER IF EXISTS %I ON %s',
      'AI_Crypto_Bot_Auth_User_Profile_Email_Update',
      v_auth_users
    );
  END IF;

  EXECUTE pg_catalog.format(
    'DROP TRIGGER IF EXISTS %I ON %s',
    'AI_Crypto_Bot_Profile_Provision_Paper_Portfolio',
    v_profiles
  );

  FOR v_policy IN
    SELECT *
    FROM (VALUES
      ('AI_Crypto_Bot_Profiles', 'AI_Crypto_Bot_Profiles_select_own'),
      ('AI_Crypto_Bot_Portfolios', 'AI_Crypto_Bot_Portfolios_select_own'),
      ('AI_Crypto_Bot_Positions', 'AI_Crypto_Bot_Positions_select_own'),
      ('AI_Crypto_Bot_Trades', 'AI_Crypto_Bot_Trades_select_own'),
      ('AI_Crypto_Bot_Portfolio_Snapshots', 'AI_Crypto_Bot_Portfolio_Snapshots_select_own')
    ) AS policies(table_name, policy_name)
  LOOP
    v_relation := pg_catalog.to_regclass(
      pg_catalog.format('public.%I', v_policy.table_name)
    );
    IF v_relation IS NOT NULL THEN
      EXECUTE pg_catalog.format(
        'DROP POLICY IF EXISTS %I ON %s',
        v_policy.policy_name,
        v_relation
      );
    END IF;
  END LOOP;
END;
$migration$;

DROP FUNCTION IF EXISTS public."AI_Crypto_Bot_Sync_Auth_Profile"();
DROP FUNCTION IF EXISTS public."AI_Crypto_Bot_Provision_Paper_Portfolio"();

CREATE UNIQUE INDEX "AI_Crypto_Bot_System_Profile_One_Portfolio"
  ON public."AI_Crypto_Bot_Portfolios" (user_id)
  WHERE user_id = '00000000-0000-4000-8000-000000000100'::uuid;

COMMIT;
