BEGIN;

DO $preflight$
DECLARE
  v_paper_role_name text := nullif(
    pg_catalog.current_setting('cryptopulse.paper_database_user', true),
    ''
  );
  v_paper_role_oid oid;
  v_migration_role_oid oid;
  v_paper_role_can_login boolean;
  v_paper_role_is_superuser boolean;
  v_paper_role_can_create_database boolean;
  v_paper_role_can_create_role boolean;
  v_paper_role_bypasses_rls boolean;
  v_migration_role_is_superuser boolean;
  v_migration_role_bypasses_rls boolean;
BEGIN
  IF v_paper_role_name IS NULL THEN
    RAISE EXCEPTION
      'Set cryptopulse.paper_database_user to the configured PAPER_DATABASE_USER before applying this migration.';
  END IF;

  SELECT role_row.oid,
         role_row.rolcanlogin,
         role_row.rolsuper,
         role_row.rolcreatedb,
         role_row.rolcreaterole,
         role_row.rolbypassrls
  INTO v_paper_role_oid,
       v_paper_role_can_login,
       v_paper_role_is_superuser,
       v_paper_role_can_create_database,
       v_paper_role_can_create_role,
       v_paper_role_bypasses_rls
  FROM pg_catalog.pg_roles AS role_row
  WHERE role_row.rolname = v_paper_role_name;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Configured PAPER_DATABASE_USER role "%" does not exist.',
      v_paper_role_name;
  END IF;

  IF NOT v_paper_role_can_login
    OR v_paper_role_is_superuser
    OR v_paper_role_can_create_database
    OR v_paper_role_can_create_role
    OR v_paper_role_bypasses_rls THEN
    RAISE EXCEPTION
      'Configured PAPER_DATABASE_USER role "%" must be a restricted login role.',
      v_paper_role_name;
  END IF;

  SELECT role_row.oid, role_row.rolsuper, role_row.rolbypassrls
  INTO v_migration_role_oid, v_migration_role_is_superuser, v_migration_role_bypasses_rls
  FROM pg_catalog.pg_roles AS role_row
  WHERE role_row.rolname = current_user;

  IF v_migration_role_oid = v_paper_role_oid THEN
    RAISE EXCEPTION
      'PAPER_DATABASE_USER "%" must not own the shadow-exit evaluator.',
      v_paper_role_name;
  END IF;

  IF pg_catalog.to_regclass('public."AI_Crypto_Bot_Positions"') IS NULL
    OR pg_catalog.to_regclass('public."AI_Crypto_Bot_Trades"') IS NULL
    OR pg_catalog.to_regclass('public."AI_Crypto_Bot_Market_Data"') IS NULL
    OR pg_catalog.to_regclass('public."AI_Crypto_Bot_Shadow_Exit_Scenarios"') IS NULL
    OR pg_catalog.to_regclass('public."AI_Crypto_Bot_Shadow_Exit_Events"') IS NULL THEN
    RAISE EXCEPTION
      'The existing position, trade, market-data, and shadow-exit tables must be installed before this migration.';
  END IF;

  IF pg_catalog.to_regprocedure(
       'public."AI_Crypto_Bot_Evaluate_Shadow_Exit_Scenarios"()'
     ) IS NOT NULL THEN
    RAISE EXCEPTION
      'The shadow-exit evaluator already exists; inspect its definition before applying this migration.';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       current_user, 'public."AI_Crypto_Bot_Positions"', 'SELECT'
     )
    OR NOT pg_catalog.has_table_privilege(
       current_user, 'public."AI_Crypto_Bot_Trades"', 'SELECT'
     )
    OR NOT pg_catalog.has_table_privilege(
       current_user, 'public."AI_Crypto_Bot_Market_Data"', 'SELECT'
     )
    OR NOT pg_catalog.has_table_privilege(
       current_user, 'public."AI_Crypto_Bot_Shadow_Exit_Scenarios"', 'SELECT'
     )
    OR NOT pg_catalog.has_table_privilege(
       current_user, 'public."AI_Crypto_Bot_Shadow_Exit_Scenarios"', 'INSERT'
     )
    OR NOT pg_catalog.has_table_privilege(
       current_user, 'public."AI_Crypto_Bot_Shadow_Exit_Scenarios"', 'UPDATE'
     )
    OR NOT pg_catalog.has_table_privilege(
       current_user, 'public."AI_Crypto_Bot_Shadow_Exit_Events"', 'SELECT'
     )
    OR NOT pg_catalog.has_table_privilege(
       current_user, 'public."AI_Crypto_Bot_Shadow_Exit_Events"', 'INSERT'
     ) THEN
    RAISE EXCEPTION
      'The migration owner must be able to read runtime inputs and write only the shadow-exit tables.';
  END IF;

  IF NOT v_migration_role_is_superuser
    AND NOT v_migration_role_bypasses_rls
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname IN (
          'AI_Crypto_Bot_Shadow_Exit_Scenarios',
          'AI_Crypto_Bot_Shadow_Exit_Events'
        )
        AND relation.relrowsecurity
        AND (relation.relowner <> v_migration_role_oid OR relation.relforcerowsecurity)
    ) THEN
    RAISE EXCEPTION
      'The migration owner must own RLS-protected shadow-exit tables or have BYPASSRLS.';
  END IF;
END;
$preflight$;
CREATE FUNCTION public."AI_Crypto_Bot_Evaluate_Shadow_Exit_Scenarios"()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_position record;
  v_rule record;
  v_scenario record;
  v_market_price numeric(28, 12);
  v_market_captured_at timestamptz;
  v_market_found boolean;
  v_quality text;
  v_previous_quality text;
  v_scenario_found boolean;
  v_scenario_id uuid;
  v_status text;
  v_armed boolean;
  v_high_water_mark numeric(28, 12);
  v_activated_at timestamptz;
  v_triggered_at timestamptz;
  v_trigger_mark numeric(28, 12);
  v_modeled_exit_price numeric(28, 12);
  v_modeled_gross numeric(28, 12);
  v_modeled_fee numeric(28, 12);
  v_modeled_net_pnl numeric(28, 12);
  v_trigger boolean;
  v_event_key text;
  v_error_code text;
  v_failure_bucket text;
  v_failure_at timestamptz;
  v_positions_evaluated integer := 0;
  v_scenarios_created integer := 0;
  v_scenarios_updated integer := 0;
  v_scenarios_triggered integer := 0;
  v_positions_finalized integer := 0;
  v_waiting_for_fresh_data integer := 0;
BEGIN
  IF NOT pg_catalog.pg_try_advisory_xact_lock(882018083) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'SKIPPED', 'reason', 'RUN_IN_PROGRESS');
  END IF;

  FOR v_position IN
    SELECT id, portfolio_id, symbol, amount, entry_price, created_at
    FROM public."AI_Crypto_Bot_Positions"
    WHERE status = 'OPEN'
    ORDER BY portfolio_id, created_at, id
  LOOP
    v_positions_evaluated := v_positions_evaluated + 1;
    SELECT price, captured_at
    INTO v_market_price, v_market_captured_at
    FROM public."AI_Crypto_Bot_Market_Data"
    WHERE symbol = v_position.symbol;
    v_market_found := FOUND;

    IF NOT v_market_found THEN
      v_quality := 'UNAVAILABLE';
    ELSIF v_market_price IS NULL
      OR v_market_price <= 0
      OR v_market_price::text IN ('NaN', 'Infinity', '-Infinity')
      OR v_market_captured_at > v_now THEN
      v_quality := 'INVALID';
    ELSIF v_market_captured_at < v_now - INTERVAL '15 minutes' THEN
      v_quality := 'STALE';
    ELSE
      v_quality := 'FRESH';
    END IF;

    FOR v_rule IN
      SELECT rule_id, rule_version, rule_type, target_pct, arm_pct, trail_pct, parameters
      FROM (VALUES
        (
          'fixed_tp_5',
          '1.0.0',
          'FIXED',
          5::numeric,
          NULL::numeric,
          NULL::numeric,
          pg_catalog.jsonb_build_object(
            'targetGainPct', 5,
            'sellSlippageRate', 0.001,
            'exitFeeRate', 0.0025,
            'fillConvention', 'observed-last-price'
          )
        ),
        (
          'fixed_tp_10',
          '1.0.0',
          'FIXED',
          10::numeric,
          NULL::numeric,
          NULL::numeric,
          pg_catalog.jsonb_build_object(
            'targetGainPct', 10,
            'sellSlippageRate', 0.001,
            'exitFeeRate', 0.0025,
            'fillConvention', 'observed-last-price'
          )
        ),
        (
          'fixed_tp_15',
          '1.0.0',
          'FIXED',
          15::numeric,
          NULL::numeric,
          NULL::numeric,
          pg_catalog.jsonb_build_object(
            'targetGainPct', 15,
            'sellSlippageRate', 0.001,
            'exitFeeRate', 0.0025,
            'fillConvention', 'observed-last-price'
          )
        ),
        (
          'fixed_tp_20',
          '1.0.0',
          'FIXED',
          20::numeric,
          NULL::numeric,
          NULL::numeric,
          pg_catalog.jsonb_build_object(
            'targetGainPct', 20,
            'sellSlippageRate', 0.001,
            'exitFeeRate', 0.0025,
            'fillConvention', 'observed-last-price'
          )
        ),
        (
          'trailing_stop_5',
          '1.0.0',
          'TRAILING',
          NULL::numeric,
          5::numeric,
          5::numeric,
          pg_catalog.jsonb_build_object(
            'armGainPct', 5,
            'drawdownPct', 5,
            'sellSlippageRate', 0.001,
            'exitFeeRate', 0.0025,
            'fillConvention', 'observed-last-price'
          )
        ),
        (
          'trailing_stop_10',
          '1.0.0',
          'TRAILING',
          NULL::numeric,
          5::numeric,
          10::numeric,
          pg_catalog.jsonb_build_object(
            'armGainPct', 5,
            'drawdownPct', 10,
            'sellSlippageRate', 0.001,
            'exitFeeRate', 0.0025,
            'fillConvention', 'observed-last-price'
          )
        ),
        (
          'trailing_stop_15',
          '1.0.0',
          'TRAILING',
          NULL::numeric,
          5::numeric,
          15::numeric,
          pg_catalog.jsonb_build_object(
            'armGainPct', 5,
            'drawdownPct', 15,
            'sellSlippageRate', 0.001,
            'exitFeeRate', 0.0025,
            'fillConvention', 'observed-last-price'
          )
        )
      ) AS configured_rules(
        rule_id,
        rule_version,
        rule_type,
        target_pct,
        arm_pct,
        trail_pct,
        parameters
      )
    LOOP
      SELECT *
      INTO v_scenario
      FROM public."AI_Crypto_Bot_Shadow_Exit_Scenarios"
      WHERE position_id = v_position.id
        AND rule_id = v_rule.rule_id
        AND rule_version = v_rule.rule_version
      FOR UPDATE;
      v_scenario_found := FOUND;
      v_previous_quality := CASE
        WHEN v_scenario_found THEN v_scenario.data_quality_status
        ELSE 'AWAITING_FIRST_FRESH_MARK'
      END;

      IF v_quality = 'FRESH'
        AND v_scenario_found
        AND v_scenario.last_mark_captured_at IS NOT NULL
        AND (
          v_market_captured_at < v_scenario.last_mark_captured_at
          OR (
            v_market_captured_at = v_scenario.last_mark_captured_at
            AND v_market_price IS DISTINCT FROM v_scenario.last_mark
          )
        ) THEN
        v_quality := 'INVALID';
      END IF;

      IF v_quality <> 'FRESH' THEN
        IF NOT v_scenario_found THEN
          INSERT INTO public."AI_Crypto_Bot_Shadow_Exit_Scenarios" (
            position_id,
            portfolio_id,
            symbol,
            position_opened_at,
            amount,
            entry_price,
            rule_id,
            rule_version,
            parameters,
            data_quality_status,
            last_evaluated_at
          )
          VALUES (
            v_position.id,
            v_position.portfolio_id,
            v_position.symbol,
            v_position.created_at,
            v_position.amount,
            v_position.entry_price,
            v_rule.rule_id,
            v_rule.rule_version,
            v_rule.parameters,
            v_quality,
            v_now
          )
          RETURNING id INTO v_scenario_id;
          v_scenarios_created := v_scenarios_created + 1;
        ELSE
          v_scenario_id := v_scenario.id;
          UPDATE public."AI_Crypto_Bot_Shadow_Exit_Scenarios"
          SET data_quality_status = v_quality,
              last_evaluated_at = v_now,
              updated_at = v_now
          WHERE id = v_scenario.id;
          v_scenarios_updated := v_scenarios_updated + 1;
        END IF;

        IF v_previous_quality IS DISTINCT FROM v_quality THEN
          v_event_key := v_scenario_id::text || ':DATA_QUALITY:' || v_quality || ':' || v_now::text;
          INSERT INTO public."AI_Crypto_Bot_Shadow_Exit_Events" (
            position_id,
            scenario_id,
            symbol,
            event_type,
            event_at,
            data_quality_status,
            details,
            dedupe_key
          )
          VALUES (
            v_position.id,
            v_scenario_id,
            v_position.symbol,
            'DATA_QUALITY_CHANGED',
            v_now,
            v_quality,
            pg_catalog.jsonb_build_object('previousStatus', v_previous_quality),
            v_event_key
          )
          ON CONFLICT (dedupe_key) DO NOTHING;
        END IF;
        v_waiting_for_fresh_data := v_waiting_for_fresh_data + 1;
        CONTINUE;
      END IF;

      IF NOT v_scenario_found THEN
        v_scenario_id := pg_catalog.gen_random_uuid();
        v_status := 'TRACKING';
        v_armed := false;
        v_high_water_mark := v_market_price;
        v_activated_at := NULL;
        v_trigger := false;
        IF v_rule.rule_type = 'FIXED'
          AND v_market_price >= v_position.entry_price * (1 + v_rule.target_pct / 100) THEN
          v_trigger := true;
        ELSIF v_rule.rule_type = 'TRAILING'
          AND v_market_price >= v_position.entry_price * (1 + v_rule.arm_pct / 100) THEN
          v_armed := true;
          v_activated_at := v_market_captured_at;
        END IF;

        v_triggered_at := NULL;
        v_trigger_mark := NULL;
        v_modeled_exit_price := NULL;
        v_modeled_net_pnl := NULL;
        IF v_trigger THEN
          v_status := 'TRIGGERED';
          v_triggered_at := v_market_captured_at;
          v_trigger_mark := v_market_price;
          v_modeled_exit_price := pg_catalog.round(v_market_price * 0.999, 12);
          v_modeled_gross := pg_catalog.round(v_modeled_exit_price * v_position.amount, 12);
          v_modeled_fee := pg_catalog.round(v_modeled_gross * 0.0025, 12);
          v_modeled_net_pnl := pg_catalog.round(
            v_modeled_gross - v_modeled_fee - (v_position.entry_price * v_position.amount),
            12
          );
        END IF;

        INSERT INTO public."AI_Crypto_Bot_Shadow_Exit_Scenarios" (
          id,
          position_id,
          portfolio_id,
          symbol,
          position_opened_at,
          amount,
          entry_price,
          rule_id,
          rule_version,
          parameters,
          status,
          data_quality_status,
          tracking_started_at,
          last_evaluated_at,
          last_mark,
          last_mark_captured_at,
          high_water_mark,
          trailing_armed,
          activated_at,
          triggered_at,
          trigger_mark,
          modeled_exit_price,
          modeled_net_pnl
        )
        VALUES (
          v_scenario_id,
          v_position.id,
          v_position.portfolio_id,
          v_position.symbol,
          v_position.created_at,
          v_position.amount,
          v_position.entry_price,
          v_rule.rule_id,
          v_rule.rule_version,
          v_rule.parameters,
          v_status,
          'FRESH',
          v_market_captured_at,
          v_now,
          v_market_price,
          v_market_captured_at,
          v_high_water_mark,
          v_armed,
          v_activated_at,
          v_triggered_at,
          v_trigger_mark,
          v_modeled_exit_price,
          v_modeled_net_pnl
        );
        v_scenarios_created := v_scenarios_created + 1;

        INSERT INTO public."AI_Crypto_Bot_Shadow_Exit_Events" (
          position_id,
          scenario_id,
          symbol,
          event_type,
          event_at,
          observed_mark,
          data_quality_status,
          details,
          dedupe_key
        )
        VALUES (
          v_position.id,
          v_scenario_id,
          v_position.symbol,
          'TRACKING_STARTED',
          v_market_captured_at,
          v_market_price,
          'FRESH',
          pg_catalog.jsonb_build_object('ruleId', v_rule.rule_id, 'ruleVersion', v_rule.rule_version),
          v_scenario_id::text || ':TRACKING_STARTED:' || v_market_captured_at::text
        )
        ON CONFLICT (dedupe_key) DO NOTHING;

        IF v_armed THEN
          INSERT INTO public."AI_Crypto_Bot_Shadow_Exit_Events" (
            position_id,
            scenario_id,
            symbol,
            event_type,
            event_at,
            observed_mark,
            data_quality_status,
            details,
            dedupe_key
          )
          VALUES (
            v_position.id,
            v_scenario_id,
            v_position.symbol,
            'TRAILING_STOP_ARMED',
            v_market_captured_at,
            v_market_price,
            'FRESH',
            pg_catalog.jsonb_build_object('armGainPct', v_rule.arm_pct),
            v_scenario_id::text || ':TRAILING_STOP_ARMED:' || v_market_captured_at::text
          )
          ON CONFLICT (dedupe_key) DO NOTHING;
        END IF;

        IF v_trigger THEN
          INSERT INTO public."AI_Crypto_Bot_Shadow_Exit_Events" (
            position_id,
            scenario_id,
            symbol,
            event_type,
            event_at,
            observed_mark,
            data_quality_status,
            details,
            dedupe_key
          )
          VALUES (
            v_position.id,
            v_scenario_id,
            v_position.symbol,
            'HYPOTHETICAL_TRIGGERED',
            v_market_captured_at,
            v_market_price,
            'FRESH',
            pg_catalog.jsonb_build_object(
              'modeledExitPrice', v_modeled_exit_price,
              'modeledNetPnl', v_modeled_net_pnl
            ),
            v_scenario_id::text || ':HYPOTHETICAL_TRIGGERED:' || v_market_captured_at::text
          )
          ON CONFLICT (dedupe_key) DO NOTHING;
          v_scenarios_triggered := v_scenarios_triggered + 1;
        END IF;
        CONTINUE;
      END IF;

      v_scenario_id := v_scenario.id;
      IF v_scenario.status <> 'TRACKING' THEN
        CONTINUE;
      END IF;

      IF v_scenario.tracking_started_at IS NULL THEN
        v_status := 'TRACKING';
        v_armed := false;
        v_high_water_mark := v_market_price;
        v_activated_at := NULL;
        v_trigger := false;
        IF v_rule.rule_type = 'FIXED'
          AND v_market_price >= v_position.entry_price * (1 + v_rule.target_pct / 100) THEN
          v_trigger := true;
        ELSIF v_rule.rule_type = 'TRAILING'
          AND v_market_price >= v_position.entry_price * (1 + v_rule.arm_pct / 100) THEN
          v_armed := true;
          v_activated_at := v_market_captured_at;
        END IF;

        v_triggered_at := NULL;
        v_trigger_mark := NULL;
        v_modeled_exit_price := NULL;
        v_modeled_net_pnl := NULL;
        IF v_trigger THEN
          v_status := 'TRIGGERED';
          v_triggered_at := v_market_captured_at;
          v_trigger_mark := v_market_price;
          v_modeled_exit_price := pg_catalog.round(v_market_price * 0.999, 12);
          v_modeled_gross := pg_catalog.round(v_modeled_exit_price * v_position.amount, 12);
          v_modeled_fee := pg_catalog.round(v_modeled_gross * 0.0025, 12);
          v_modeled_net_pnl := pg_catalog.round(
            v_modeled_gross - v_modeled_fee - (v_position.entry_price * v_position.amount),
            12
          );
        END IF;

        UPDATE public."AI_Crypto_Bot_Shadow_Exit_Scenarios"
        SET status = v_status,
            data_quality_status = 'FRESH',
            tracking_started_at = v_market_captured_at,
            last_evaluated_at = v_now,
            last_mark = v_market_price,
            last_mark_captured_at = v_market_captured_at,
            high_water_mark = v_high_water_mark,
            trailing_armed = v_armed,
            activated_at = v_activated_at,
            triggered_at = v_triggered_at,
            trigger_mark = v_trigger_mark,
            modeled_exit_price = v_modeled_exit_price,
            modeled_net_pnl = v_modeled_net_pnl,
            updated_at = v_now
        WHERE id = v_scenario.id;
        v_scenarios_updated := v_scenarios_updated + 1;

        INSERT INTO public."AI_Crypto_Bot_Shadow_Exit_Events" (
          position_id,
          scenario_id,
          symbol,
          event_type,
          event_at,
          observed_mark,
          data_quality_status,
          details,
          dedupe_key
        )
        VALUES (
          v_position.id,
          v_scenario_id,
          v_position.symbol,
          'TRACKING_STARTED',
          v_market_captured_at,
          v_market_price,
          'FRESH',
          pg_catalog.jsonb_build_object('ruleId', v_rule.rule_id, 'ruleVersion', v_rule.rule_version),
          v_scenario_id::text || ':TRACKING_STARTED:' || v_market_captured_at::text
        )
        ON CONFLICT (dedupe_key) DO NOTHING;

        IF v_armed THEN
          INSERT INTO public."AI_Crypto_Bot_Shadow_Exit_Events" (
            position_id,
            scenario_id,
            symbol,
            event_type,
            event_at,
            observed_mark,
            data_quality_status,
            details,
            dedupe_key
          )
          VALUES (
            v_position.id,
            v_scenario_id,
            v_position.symbol,
            'TRAILING_STOP_ARMED',
            v_market_captured_at,
            v_market_price,
            'FRESH',
            pg_catalog.jsonb_build_object('armGainPct', v_rule.arm_pct),
            v_scenario_id::text || ':TRAILING_STOP_ARMED:' || v_market_captured_at::text
          )
          ON CONFLICT (dedupe_key) DO NOTHING;
        END IF;

        IF v_trigger THEN
          INSERT INTO public."AI_Crypto_Bot_Shadow_Exit_Events" (
            position_id,
            scenario_id,
            symbol,
            event_type,
            event_at,
            observed_mark,
            data_quality_status,
            details,
            dedupe_key
          )
          VALUES (
            v_position.id,
            v_scenario_id,
            v_position.symbol,
            'HYPOTHETICAL_TRIGGERED',
            v_market_captured_at,
            v_market_price,
            'FRESH',
            pg_catalog.jsonb_build_object(
              'modeledExitPrice', v_modeled_exit_price,
              'modeledNetPnl', v_modeled_net_pnl
            ),
            v_scenario_id::text || ':HYPOTHETICAL_TRIGGERED:' || v_market_captured_at::text
          )
          ON CONFLICT (dedupe_key) DO NOTHING;
          v_scenarios_triggered := v_scenarios_triggered + 1;
        END IF;
        CONTINUE;
      END IF;

      IF v_market_captured_at <= v_scenario.last_mark_captured_at THEN
        UPDATE public."AI_Crypto_Bot_Shadow_Exit_Scenarios"
        SET data_quality_status = 'FRESH',
            last_evaluated_at = v_now,
            updated_at = v_now
        WHERE id = v_scenario.id;
        v_scenarios_updated := v_scenarios_updated + 1;
        IF v_scenario.data_quality_status IS DISTINCT FROM 'FRESH' THEN
          INSERT INTO public."AI_Crypto_Bot_Shadow_Exit_Events" (
            position_id,
            scenario_id,
            symbol,
            event_type,
            event_at,
            observed_mark,
            data_quality_status,
            details,
            dedupe_key
          )
          VALUES (
            v_position.id,
            v_scenario_id,
            v_position.symbol,
            'DATA_QUALITY_CHANGED',
            v_now,
            v_market_price,
            'FRESH',
            pg_catalog.jsonb_build_object('previousStatus', v_scenario.data_quality_status),
            v_scenario_id::text || ':DATA_QUALITY:FRESH:' || v_now::text
          )
          ON CONFLICT (dedupe_key) DO NOTHING;
        END IF;
        CONTINUE;
      END IF;

      v_armed := v_scenario.trailing_armed;
      v_high_water_mark := v_scenario.high_water_mark;
      v_activated_at := v_scenario.activated_at;
      v_trigger := false;
      IF v_rule.rule_type = 'FIXED' THEN
        v_trigger := v_market_price >= v_position.entry_price * (1 + v_rule.target_pct / 100);
      ELSIF NOT v_armed
        AND v_market_price >= v_position.entry_price * (1 + v_rule.arm_pct / 100) THEN
        v_armed := true;
        v_activated_at := v_market_captured_at;
        v_high_water_mark := v_market_price;
        INSERT INTO public."AI_Crypto_Bot_Shadow_Exit_Events" (
          position_id,
          scenario_id,
          symbol,
          event_type,
          event_at,
          observed_mark,
          data_quality_status,
          details,
          dedupe_key
        )
        VALUES (
          v_position.id,
          v_scenario_id,
          v_position.symbol,
          'TRAILING_STOP_ARMED',
          v_market_captured_at,
          v_market_price,
          'FRESH',
          pg_catalog.jsonb_build_object('armGainPct', v_rule.arm_pct),
          v_scenario_id::text || ':TRAILING_STOP_ARMED:' || v_market_captured_at::text
        )
        ON CONFLICT (dedupe_key) DO NOTHING;
      ELSIF v_armed THEN
        IF v_market_price > v_high_water_mark THEN
          v_high_water_mark := v_market_price;
        ELSE
          v_trigger := v_market_price <= v_high_water_mark * (1 - v_rule.trail_pct / 100);
        END IF;
      END IF;

      v_status := 'TRACKING';
      v_triggered_at := NULL;
      v_trigger_mark := NULL;
      v_modeled_exit_price := NULL;
      v_modeled_net_pnl := NULL;
      IF v_trigger THEN
        v_status := 'TRIGGERED';
        v_triggered_at := v_market_captured_at;
        v_trigger_mark := v_market_price;
        v_modeled_exit_price := pg_catalog.round(v_market_price * 0.999, 12);
        v_modeled_gross := pg_catalog.round(v_modeled_exit_price * v_position.amount, 12);
        v_modeled_fee := pg_catalog.round(v_modeled_gross * 0.0025, 12);
        v_modeled_net_pnl := pg_catalog.round(
          v_modeled_gross - v_modeled_fee - (v_position.entry_price * v_position.amount),
          12
        );
      END IF;

      UPDATE public."AI_Crypto_Bot_Shadow_Exit_Scenarios"
      SET status = v_status,
          data_quality_status = 'FRESH',
          last_evaluated_at = v_now,
          last_mark = v_market_price,
          last_mark_captured_at = v_market_captured_at,
          high_water_mark = v_high_water_mark,
          trailing_armed = v_armed,
          activated_at = v_activated_at,
          triggered_at = v_triggered_at,
          trigger_mark = v_trigger_mark,
          modeled_exit_price = v_modeled_exit_price,
          modeled_net_pnl = v_modeled_net_pnl,
          updated_at = v_now
      WHERE id = v_scenario.id;
      v_scenarios_updated := v_scenarios_updated + 1;

      IF v_trigger THEN
        INSERT INTO public."AI_Crypto_Bot_Shadow_Exit_Events" (
          position_id,
          scenario_id,
          symbol,
          event_type,
          event_at,
          observed_mark,
          data_quality_status,
          details,
          dedupe_key
        )
        VALUES (
          v_position.id,
          v_scenario_id,
          v_position.symbol,
          'HYPOTHETICAL_TRIGGERED',
          v_market_captured_at,
          v_market_price,
          'FRESH',
          pg_catalog.jsonb_build_object(
            'modeledExitPrice', v_modeled_exit_price,
            'modeledNetPnl', v_modeled_net_pnl
          ),
          v_scenario_id::text || ':HYPOTHETICAL_TRIGGERED:' || v_market_captured_at::text
        )
        ON CONFLICT (dedupe_key) DO NOTHING;
        v_scenarios_triggered := v_scenarios_triggered + 1;
      END IF;
    END LOOP;
  END LOOP;

  FOR v_position IN
    SELECT position.id,
           position.portfolio_id,
           position.symbol,
           position.current_price,
           position.updated_at,
           sell.id AS actual_trade_id,
           sell.created_at AS actual_closed_at,
           sell.price AS actual_close_price,
           sell.realized_pnl AS actual_net_pnl
    FROM public."AI_Crypto_Bot_Positions" AS position
    LEFT JOIN LATERAL (
      SELECT trade.id, trade.created_at, trade.price, trade.realized_pnl
      FROM public."AI_Crypto_Bot_Trades" AS trade
      WHERE trade.portfolio_id = position.portfolio_id
        AND trade.symbol = position.symbol
        AND trade.side = 'SELL'
        AND trade.created_at >= position.created_at
        AND trade.created_at <= position.updated_at
      ORDER BY trade.created_at DESC, trade.id DESC
      LIMIT 1
    ) AS sell ON true
    WHERE position.status = 'CLOSED'
      AND EXISTS (
        SELECT 1
        FROM public."AI_Crypto_Bot_Shadow_Exit_Scenarios" AS scenario
        WHERE scenario.position_id = position.id
          AND scenario.actual_closed_at IS NULL
      )
    ORDER BY position.portfolio_id, position.updated_at, position.id
  LOOP
    UPDATE public."AI_Crypto_Bot_Shadow_Exit_Scenarios"
    SET status = CASE
          WHEN status = 'TRIGGERED' THEN 'TRIGGERED'
          ELSE 'CLOSED_WITHOUT_TRIGGER'
        END,
        actual_trade_id = v_position.actual_trade_id,
        actual_closed_at = COALESCE(v_position.actual_closed_at, v_position.updated_at),
        actual_close_price = v_position.actual_close_price,
        actual_net_pnl = v_position.actual_net_pnl,
        finalized_at = v_now,
        updated_at = v_now
    WHERE position_id = v_position.id
      AND actual_closed_at IS NULL;

    INSERT INTO public."AI_Crypto_Bot_Shadow_Exit_Events" (
      position_id,
      scenario_id,
      symbol,
      event_type,
      event_at,
      observed_mark,
      details,
      dedupe_key
    )
    SELECT
      scenario.position_id,
      scenario.id,
      scenario.symbol,
      'ACTUAL_POSITION_CLOSED',
      COALESCE(v_position.actual_closed_at, v_position.updated_at),
      v_position.actual_close_price,
      pg_catalog.jsonb_build_object(
        'actualTradeId', v_position.actual_trade_id,
        'actualNetPnl', v_position.actual_net_pnl,
        'sellRecordAvailable', v_position.actual_trade_id IS NOT NULL
      ),
      scenario.id::text || ':ACTUAL_POSITION_CLOSED:'
        || COALESCE(v_position.actual_trade_id::text, v_position.updated_at::text)
    FROM public."AI_Crypto_Bot_Shadow_Exit_Scenarios" AS scenario
    WHERE scenario.position_id = v_position.id
      AND scenario.actual_closed_at IS NOT NULL
      AND scenario.finalized_at = v_now
    ON CONFLICT (dedupe_key) DO NOTHING;

    v_positions_finalized := v_positions_finalized + 1;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'COMPLETED',
    'positionsEvaluated', v_positions_evaluated,
    'scenariosCreated', v_scenarios_created,
    'scenariosUpdated', v_scenarios_updated,
    'scenariosTriggered', v_scenarios_triggered,
    'positionsFinalized', v_positions_finalized,
    'waitingForFreshData', v_waiting_for_fresh_data
  );
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_error_code = RETURNED_SQLSTATE;
  v_failure_at := pg_catalog.clock_timestamp();
  v_failure_bucket := (
    pg_catalog.date_part('epoch', v_failure_at)::bigint / 300
  )::text;
  INSERT INTO public."AI_Crypto_Bot_Shadow_Exit_Events" (
    event_type,
    event_at,
    error_code,
    details,
    dedupe_key
  )
  VALUES (
    'EVALUATION_FAILED',
    v_failure_at,
    v_error_code,
    pg_catalog.jsonb_build_object('phase', 'shadow_evaluation'),
    'EVALUATION_FAILED:' || v_error_code || ':' || v_failure_bucket
  )
  ON CONFLICT (dedupe_key) DO NOTHING;
  RETURN pg_catalog.jsonb_build_object('status', 'FAILED', 'errorCode', v_error_code);
END;
$$;
REVOKE ALL ON FUNCTION public."AI_Crypto_Bot_Evaluate_Shadow_Exit_Scenarios"()
  FROM PUBLIC;

DO $permissions$
DECLARE
  v_paper_role_name text := nullif(
    pg_catalog.current_setting('cryptopulse.paper_database_user', true),
    ''
  );
  v_legacy_role_name text;
  v_function_owner oid;
  v_paper_role_oid oid;
  v_function_result text;
  v_function_is_security_definer boolean;
  v_function_config text[];
BEGIN
  SELECT role_row.oid
  INTO v_paper_role_oid
  FROM pg_catalog.pg_roles AS role_row
  WHERE role_row.rolname = v_paper_role_name;

  SELECT proc.proowner,
         pg_catalog.pg_get_function_result(proc.oid),
         proc.prosecdef,
         proc.proconfig
  INTO v_function_owner,
       v_function_result,
       v_function_is_security_definer,
       v_function_config
  FROM pg_catalog.pg_proc AS proc
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'public'
    AND proc.proname = 'AI_Crypto_Bot_Evaluate_Shadow_Exit_Scenarios'
    AND proc.pronargs = 0
    AND proc.prokind = 'f';

  IF NOT FOUND
    OR v_function_result <> 'jsonb'
    OR NOT v_function_is_security_definer
    OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(COALESCE(v_function_config, ARRAY[]::text[])) AS setting
      WHERE setting LIKE 'search_path=%'
    ) THEN
    RAISE EXCEPTION
      'The installed shadow-exit evaluator must be SECURITY DEFINER, return jsonb, and pin search_path.';
  END IF;

  IF v_function_owner = v_paper_role_oid THEN
    RAISE EXCEPTION
      'PAPER_DATABASE_USER "%" must not own the shadow-exit evaluator.',
      v_paper_role_name;
  END IF;

  FOR v_legacy_role_name IN
    SELECT role_row.rolname
    FROM pg_catalog.pg_roles AS role_row
    WHERE role_row.rolname IN ('anon', 'authenticated', 'service_role')
      AND role_row.oid <> v_paper_role_oid
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE ALL ON FUNCTION public."AI_Crypto_Bot_Evaluate_Shadow_Exit_Scenarios"() FROM %I',
      v_legacy_role_name
    );
  END LOOP;

  EXECUTE pg_catalog.format('GRANT USAGE ON SCHEMA public TO %I', v_paper_role_name);
  EXECUTE pg_catalog.format(
    'GRANT EXECUTE ON FUNCTION public."AI_Crypto_Bot_Evaluate_Shadow_Exit_Scenarios"() TO %I',
    v_paper_role_name
  );
END;
$permissions$;

COMMIT;