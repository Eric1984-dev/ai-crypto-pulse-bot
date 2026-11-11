BEGIN;

ALTER TABLE public."AI_Crypto_Bot_Trades"
  ADD COLUMN ai_decision_id uuid,
  ADD CONSTRAINT "AI_Crypto_Bot_Trades_ai_decision_id_fkey"
    FOREIGN KEY (ai_decision_id)
    REFERENCES public."AI_Crypto_Bot_AI_Decisions" (id)
    ON DELETE RESTRICT;

CREATE INDEX "AI_Crypto_Bot_AI_Decisions_symbol_created_id_idx"
  ON public."AI_Crypto_Bot_AI_Decisions" (symbol, created_at DESC, id DESC);
CREATE INDEX "AI_Crypto_Bot_Trades_portfolio_symbol_created_idx"
  ON public."AI_Crypto_Bot_Trades" (portfolio_id, symbol, created_at DESC);
CREATE INDEX "AI_Crypto_Bot_Trades_ai_decision_id_idx"
  ON public."AI_Crypto_Bot_Trades" (ai_decision_id);

CREATE FUNCTION public."AI_Crypto_Bot_Provision_Paper_Portfolio"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_portfolio_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public."AI_Crypto_Bot_Portfolios"
    WHERE user_id = NEW.id
  ) THEN
    INSERT INTO public."AI_Crypto_Bot_Portfolios" (
      user_id,
      starting_balance,
      available_balance,
      portfolio_value
    )
    VALUES (NEW.id, 10000, 10000, 10000)
    RETURNING id INTO v_portfolio_id;

    INSERT INTO public."AI_Crypto_Bot_Portfolio_Snapshots" (
      portfolio_id,
      portfolio_value,
      available_balance,
      open_positions
    )
    VALUES (v_portfolio_id, 10000, 10000, 0);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "AI_Crypto_Bot_Profile_Provision_Paper_Portfolio"
  AFTER INSERT ON public."AI_Crypto_Bot_Profiles"
  FOR EACH ROW EXECUTE FUNCTION public."AI_Crypto_Bot_Provision_Paper_Portfolio"();

WITH new_portfolios AS (
  INSERT INTO public."AI_Crypto_Bot_Portfolios" (
    user_id,
    starting_balance,
    available_balance,
    portfolio_value
  )
  SELECT profile.id, 10000, 10000, 10000
  FROM public."AI_Crypto_Bot_Profiles" AS profile
  WHERE NOT EXISTS (
    SELECT 1
    FROM public."AI_Crypto_Bot_Portfolios" AS portfolio
    WHERE portfolio.user_id = profile.id
  )
  RETURNING id
)
INSERT INTO public."AI_Crypto_Bot_Portfolio_Snapshots" (
  portfolio_id,
  portfolio_value,
  available_balance,
  open_positions
)
SELECT id, 10000, 10000, 0
FROM new_portfolios;

CREATE FUNCTION public."AI_Crypto_Bot_Refresh_Paper_Portfolio"(p_portfolio_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_starting_balance numeric(28, 12);
  v_available_balance numeric(28, 12);
  v_portfolio_value numeric(28, 12);
  v_open_positions integer;
  v_peak_value numeric(28, 12);
  v_daily_start_value numeric(28, 12);
  v_emergency_status text;
BEGIN
  SELECT starting_balance, available_balance
  INTO v_starting_balance, v_available_balance
  FROM public."AI_Crypto_Bot_Portfolios"
  WHERE id = p_portfolio_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('status', 'PORTFOLIO_NOT_FOUND');
  END IF;

  UPDATE public."AI_Crypto_Bot_Positions" AS position
  SET current_price = market_data.price,
      unrealized_pnl = pg_catalog.round(
        (market_data.price - position.entry_price) * position.amount,
        12
      )
  FROM public."AI_Crypto_Bot_Market_Data" AS market_data
  WHERE position.portfolio_id = p_portfolio_id
    AND position.status = 'OPEN'
    AND market_data.symbol = position.symbol
    AND market_data.captured_at >= pg_catalog.now() - INTERVAL '15 minutes'
    AND market_data.captured_at <= pg_catalog.now() + INTERVAL '1 minute';

  SELECT
    pg_catalog.round(
      v_available_balance
        + COALESCE(pg_catalog.sum(position.amount * position.current_price), 0),
      12
    ),
    pg_catalog.count(*)::integer
  INTO v_portfolio_value, v_open_positions
  FROM public."AI_Crypto_Bot_Positions" AS position
  WHERE position.portfolio_id = p_portfolio_id
    AND position.status = 'OPEN';

  UPDATE public."AI_Crypto_Bot_Portfolios"
  SET portfolio_value = v_portfolio_value
  WHERE id = p_portfolio_id;

  INSERT INTO public."AI_Crypto_Bot_Portfolio_Snapshots" (
    portfolio_id,
    portfolio_value,
    available_balance,
    open_positions
  )
  VALUES (
    p_portfolio_id,
    v_portfolio_value,
    v_available_balance,
    v_open_positions
  );

  SELECT GREATEST(
    v_starting_balance,
    COALESCE(MAX(portfolio_value), v_starting_balance)
  )
  INTO v_peak_value
  FROM public."AI_Crypto_Bot_Portfolio_Snapshots"
  WHERE portfolio_id = p_portfolio_id;

  SELECT portfolio_value
  INTO v_daily_start_value
  FROM public."AI_Crypto_Bot_Portfolio_Snapshots"
  WHERE portfolio_id = p_portfolio_id
    AND captured_at < (
      pg_catalog.date_trunc('day', pg_catalog.now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    )
  ORDER BY captured_at DESC, id DESC
  LIMIT 1;
  v_daily_start_value := COALESCE(v_daily_start_value, v_starting_balance);

  IF v_portfolio_value <= v_peak_value * 0.80 THEN
    SELECT status
    INTO v_emergency_status
    FROM public."AI_Crypto_Bot_Emergency_State"
    ORDER BY created_at DESC, id DESC
    LIMIT 1;

    IF v_emergency_status IS DISTINCT FROM 'EMERGENCY_STOP' THEN
      INSERT INTO public."AI_Crypto_Bot_Emergency_State" (status, reason)
      VALUES (
        'EMERGENCY_STOP',
        pg_catalog.format(
          'Portfolio %s reached the 20%% emergency drawdown threshold.',
          p_portfolio_id
        )
      );
    END IF;

    UPDATE public."AI_Crypto_Bot_Status"
    SET status = 'STOPPED',
        is_active = false,
        is_analyzing = false,
        error_message = 'Paper portfolio emergency drawdown threshold reached.'
    WHERE singleton = true
      AND status <> 'STOPPED';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'REFRESHED',
    'portfolioValue', v_portfolio_value,
    'availableBalance', v_available_balance,
    'openPositions', v_open_positions,
    'dailyDrawdownLimitReached', v_portfolio_value <= v_daily_start_value * 0.95,
    'portfolioDrawdownLimitReached', v_portfolio_value <= v_peak_value * 0.85
  );
END;
$$;

CREATE FUNCTION public."AI_Crypto_Bot_Apply_Paper_Decision"(
  p_portfolio_id uuid,
  p_decision_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_portfolio record;
  v_decision record;
  v_market record;
  v_emergency_status text;
  v_agent_status text;
  v_idempotency_hash text;
  v_idempotency_key uuid;
  v_execution_price numeric(28, 12);
  v_max_notional numeric(28, 12);
  v_quantity numeric(28, 12);
  v_notional numeric(28, 12);
  v_fees numeric(28, 12);
  v_slippage numeric(28, 12);
  v_cash_required numeric(28, 12);
  v_entry_price numeric(28, 12);
  v_position_count integer;
  v_position_quantity numeric(28, 12);
  v_entry_cost_basis numeric(28, 12);
  v_gross_proceeds numeric(28, 12);
  v_net_proceeds numeric(28, 12);
  v_realized_pnl numeric(28, 12);
  v_portfolio_value numeric(28, 12);
  v_peak_value numeric(28, 12);
  v_daily_start_value numeric(28, 12);
  v_available_balance numeric(28, 12);
  v_open_positions integer;
BEGIN
  SELECT id, starting_balance, available_balance, portfolio_value
  INTO v_portfolio
  FROM public."AI_Crypto_Bot_Portfolios"
  WHERE id = p_portfolio_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('status', 'PORTFOLIO_NOT_FOUND');
  END IF;

  SELECT id, symbol, decision, confidence, created_at
  INTO v_decision
  FROM public."AI_Crypto_Bot_AI_Decisions"
  WHERE id = p_decision_id;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('status', 'DECISION_NOT_FOUND');
  END IF;

  v_idempotency_hash := pg_catalog.md5(p_portfolio_id::text || ':' || p_decision_id::text);
  v_idempotency_key := (
    pg_catalog.substr(v_idempotency_hash, 1, 8) || '-'
      || pg_catalog.substr(v_idempotency_hash, 9, 4) || '-'
      || pg_catalog.substr(v_idempotency_hash, 13, 4) || '-'
      || pg_catalog.substr(v_idempotency_hash, 17, 4) || '-'
      || pg_catalog.substr(v_idempotency_hash, 21, 12)
  )::uuid;

  IF EXISTS (
    SELECT 1
    FROM public."AI_Crypto_Bot_Trades"
    WHERE idempotency_key = v_idempotency_key
  ) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'DUPLICATE', 'symbol', v_decision.symbol);
  END IF;

  IF v_decision.decision IN ('HOLD', 'WAIT') THEN
    RETURN pg_catalog.jsonb_build_object('status', 'NO_TRADE', 'symbol', v_decision.symbol);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."AI_Crypto_Bot_AI_Decisions" AS newer
    WHERE newer.symbol = v_decision.symbol
      AND (newer.created_at, newer.id) > (v_decision.created_at, v_decision.id)
  ) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'STALE_DECISION', 'symbol', v_decision.symbol);
  END IF;

  IF v_decision.created_at < pg_catalog.now() - INTERVAL '15 minutes'
    OR v_decision.created_at > pg_catalog.now() + INTERVAL '1 minute' THEN
    RETURN pg_catalog.jsonb_build_object('status', 'STALE_DECISION', 'symbol', v_decision.symbol);
  END IF;

  IF v_decision.decision = 'BUY' AND v_decision.confidence < 70 THEN
    RETURN pg_catalog.jsonb_build_object('status', 'CONFIDENCE_TOO_LOW', 'symbol', v_decision.symbol);
  END IF;

  SELECT price, captured_at
  INTO v_market
  FROM public."AI_Crypto_Bot_Market_Data"
  WHERE symbol = v_decision.symbol;

  IF NOT FOUND
    OR v_market.price <= 0
    OR v_market.captured_at < pg_catalog.now() - INTERVAL '15 minutes'
    OR v_market.captured_at > pg_catalog.now() + INTERVAL '1 minute' THEN
    RETURN pg_catalog.jsonb_build_object('status', 'MARKET_DATA_STALE', 'symbol', v_decision.symbol);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public."AI_Crypto_Bot_Watched_Markets"
    WHERE symbol = v_decision.symbol
      AND enabled = true
  ) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'MARKET_DISABLED', 'symbol', v_decision.symbol);
  END IF;

  IF v_decision.decision = 'BUY' THEN
    SELECT status
    INTO v_emergency_status
    FROM public."AI_Crypto_Bot_Emergency_State"
    ORDER BY created_at DESC, id DESC
    LIMIT 1;
    SELECT status
    INTO v_agent_status
    FROM public."AI_Crypto_Bot_Status"
    WHERE singleton = true;

    IF COALESCE(v_emergency_status, 'NORMAL') <> 'NORMAL'
      OR COALESCE(v_agent_status, 'STOPPED') = 'STOPPED' THEN
      RETURN pg_catalog.jsonb_build_object('status', 'TRADING_PAUSED', 'symbol', v_decision.symbol);
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public."AI_Crypto_Bot_Positions" AS position
      LEFT JOIN public."AI_Crypto_Bot_Market_Data" AS market_data
        ON market_data.symbol = position.symbol
        AND market_data.captured_at >= pg_catalog.now() - INTERVAL '15 minutes'
        AND market_data.captured_at <= pg_catalog.now() + INTERVAL '1 minute'
      WHERE position.portfolio_id = p_portfolio_id
        AND position.status = 'OPEN'
        AND market_data.symbol IS NULL
    ) THEN
      RETURN pg_catalog.jsonb_build_object(
        'status', 'PORTFOLIO_MARKET_DATA_STALE',
        'symbol', v_decision.symbol
      );
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public."AI_Crypto_Bot_Positions"
      WHERE portfolio_id = p_portfolio_id
        AND symbol = v_decision.symbol
        AND status = 'OPEN'
    ) THEN
      RETURN pg_catalog.jsonb_build_object('status', 'POSITION_ALREADY_OPEN', 'symbol', v_decision.symbol);
    END IF;

    SELECT pg_catalog.count(*)::integer
    INTO v_position_count
    FROM public."AI_Crypto_Bot_Positions"
    WHERE portfolio_id = p_portfolio_id
      AND status = 'OPEN';
    IF v_position_count >= 5 THEN
      RETURN pg_catalog.jsonb_build_object('status', 'MAX_OPEN_POSITIONS', 'symbol', v_decision.symbol);
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public."AI_Crypto_Bot_Trades"
      WHERE portfolio_id = p_portfolio_id
        AND symbol = v_decision.symbol
        AND created_at >= pg_catalog.now() - INTERVAL '15 minutes'
    ) THEN
      RETURN pg_catalog.jsonb_build_object('status', 'COOLDOWN', 'symbol', v_decision.symbol);
    END IF;

    SELECT GREATEST(
      v_portfolio.starting_balance,
      COALESCE(MAX(portfolio_value), v_portfolio.starting_balance)
    )
    INTO v_peak_value
    FROM public."AI_Crypto_Bot_Portfolio_Snapshots"
    WHERE portfolio_id = p_portfolio_id;

    SELECT portfolio_value
    INTO v_daily_start_value
    FROM public."AI_Crypto_Bot_Portfolio_Snapshots"
    WHERE portfolio_id = p_portfolio_id
      AND captured_at < (
        pg_catalog.date_trunc('day', pg_catalog.now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
      )
    ORDER BY captured_at DESC, id DESC
    LIMIT 1;
    v_daily_start_value := COALESCE(v_daily_start_value, v_portfolio.starting_balance);

    IF v_portfolio.portfolio_value <= v_daily_start_value * 0.95 THEN
      RETURN pg_catalog.jsonb_build_object('status', 'DAILY_DRAWDOWN_LIMIT', 'symbol', v_decision.symbol);
    END IF;
    IF v_portfolio.portfolio_value <= v_peak_value * 0.85 THEN
      RETURN pg_catalog.jsonb_build_object('status', 'MAX_DRAWDOWN_LIMIT', 'symbol', v_decision.symbol);
    END IF;

    v_execution_price := pg_catalog.round(v_market.price * 1.001, 12);
    v_max_notional := LEAST(
      v_portfolio.portfolio_value * 0.10,
      v_portfolio.available_balance / 1.0025
    );
    v_quantity := pg_catalog.trunc(v_max_notional / v_execution_price, 12);
    IF v_quantity <= 0 THEN
      RETURN pg_catalog.jsonb_build_object('status', 'INSUFFICIENT_FUNDS', 'symbol', v_decision.symbol);
    END IF;

    v_notional := pg_catalog.round(v_quantity * v_execution_price, 12);
    v_fees := pg_catalog.round(v_notional * 0.0025, 12);
    v_slippage := pg_catalog.round((v_execution_price - v_market.price) * v_quantity, 12);
    v_cash_required := v_notional + v_fees;
    IF v_cash_required > v_portfolio.available_balance THEN
      RETURN pg_catalog.jsonb_build_object('status', 'INSUFFICIENT_FUNDS', 'symbol', v_decision.symbol);
    END IF;
    v_entry_price := pg_catalog.round(v_cash_required / v_quantity, 12);

    INSERT INTO public."AI_Crypto_Bot_Trades" (
      portfolio_id,
      ai_decision_id,
      idempotency_key,
      symbol,
      side,
      price,
      quantity,
      fees,
      slippage
    )
    VALUES (
      p_portfolio_id,
      p_decision_id,
      v_idempotency_key,
      v_decision.symbol,
      'BUY',
      v_execution_price,
      v_quantity,
      v_fees,
      v_slippage
    );

    INSERT INTO public."AI_Crypto_Bot_Positions" (
      portfolio_id,
      symbol,
      amount,
      entry_price,
      current_price,
      unrealized_pnl
    )
    VALUES (
      p_portfolio_id,
      v_decision.symbol,
      v_quantity,
      v_entry_price,
      v_market.price,
      pg_catalog.round((v_market.price * v_quantity) - v_cash_required, 12)
    );

    UPDATE public."AI_Crypto_Bot_Portfolios"
    SET available_balance = available_balance - v_cash_required
    WHERE id = p_portfolio_id
    RETURNING available_balance INTO v_available_balance;
  ELSE
    PERFORM 1
    FROM public."AI_Crypto_Bot_Positions"
    WHERE portfolio_id = p_portfolio_id
      AND symbol = v_decision.symbol
      AND status = 'OPEN'
    FOR UPDATE;

    SELECT
      COALESCE(pg_catalog.sum(amount), 0),
      COALESCE(pg_catalog.sum(entry_price * amount), 0)
    INTO v_position_quantity, v_entry_cost_basis
    FROM public."AI_Crypto_Bot_Positions"
    WHERE portfolio_id = p_portfolio_id
      AND symbol = v_decision.symbol
      AND status = 'OPEN';

    IF v_position_quantity <= 0 THEN
      RETURN pg_catalog.jsonb_build_object('status', 'NO_OPEN_POSITION', 'symbol', v_decision.symbol);
    END IF;

    v_execution_price := pg_catalog.round(v_market.price * 0.999, 12);
    v_gross_proceeds := pg_catalog.round(v_execution_price * v_position_quantity, 12);
    v_fees := pg_catalog.round(v_gross_proceeds * 0.0025, 12);
    v_slippage := pg_catalog.round((v_market.price - v_execution_price) * v_position_quantity, 12);
    v_net_proceeds := v_gross_proceeds - v_fees;
    v_realized_pnl := pg_catalog.round(v_net_proceeds - v_entry_cost_basis, 12);

    UPDATE public."AI_Crypto_Bot_Positions"
    SET status = 'CLOSED',
        current_price = v_market.price,
        unrealized_pnl = 0
    WHERE portfolio_id = p_portfolio_id
      AND symbol = v_decision.symbol
      AND status = 'OPEN';

    INSERT INTO public."AI_Crypto_Bot_Trades" (
      portfolio_id,
      ai_decision_id,
      idempotency_key,
      symbol,
      side,
      price,
      quantity,
      fees,
      slippage,
      realized_pnl
    )
    VALUES (
      p_portfolio_id,
      p_decision_id,
      v_idempotency_key,
      v_decision.symbol,
      'SELL',
      v_execution_price,
      v_position_quantity,
      v_fees,
      v_slippage,
      v_realized_pnl
    );

    UPDATE public."AI_Crypto_Bot_Portfolios"
    SET available_balance = available_balance + v_net_proceeds
    WHERE id = p_portfolio_id
    RETURNING available_balance INTO v_available_balance;
  END IF;

  SELECT
    pg_catalog.round(
      v_available_balance
        + COALESCE(pg_catalog.sum(position.amount * position.current_price), 0),
      12
    ),
    pg_catalog.count(*)::integer
  INTO v_portfolio_value, v_open_positions
  FROM public."AI_Crypto_Bot_Positions" AS position
  WHERE position.portfolio_id = p_portfolio_id
    AND position.status = 'OPEN';

  UPDATE public."AI_Crypto_Bot_Portfolios"
  SET portfolio_value = v_portfolio_value
  WHERE id = p_portfolio_id;

  INSERT INTO public."AI_Crypto_Bot_Portfolio_Snapshots" (
    portfolio_id,
    portfolio_value,
    available_balance,
    open_positions
  )
  VALUES (
    p_portfolio_id,
    v_portfolio_value,
    v_available_balance,
    v_open_positions
  );

  RETURN pg_catalog.jsonb_build_object(
    'status', 'EXECUTED',
    'side', v_decision.decision,
    'symbol', v_decision.symbol,
    'quantity', COALESCE(v_quantity, v_position_quantity),
    'price', v_execution_price,
    'fees', v_fees,
    'slippage', v_slippage,
    'realizedPnl', COALESCE(v_realized_pnl, 0),
    'portfolioValue', v_portfolio_value
  );
END;
$$;

CREATE FUNCTION public."AI_Crypto_Bot_Run_Paper_Trading"()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_agent_status text;
  v_portfolio record;
  v_decision record;
  v_result jsonb;
  v_portfolios_processed integer := 0;
  v_decisions_processed integer := 0;
  v_trades_executed integer := 0;
  v_duplicates integer := 0;
  v_skipped integer := 0;
BEGIN
  IF NOT pg_catalog.pg_try_advisory_xact_lock(882018081) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'SKIPPED', 'reason', 'RUN_IN_PROGRESS');
  END IF;

  SELECT status
  INTO v_agent_status
  FROM public."AI_Crypto_Bot_Status"
  WHERE singleton = true;

  IF v_agent_status = 'ANALYZING' THEN
    RETURN pg_catalog.jsonb_build_object('status', 'SKIPPED', 'reason', 'AI_ANALYSIS_IN_PROGRESS');
  END IF;

  FOR v_portfolio IN
    SELECT id
    FROM public."AI_Crypto_Bot_Portfolios"
    ORDER BY created_at, id
  LOOP
    v_result := public."AI_Crypto_Bot_Refresh_Paper_Portfolio"(v_portfolio.id);
    IF v_result->>'status' = 'REFRESHED' THEN
      v_portfolios_processed := v_portfolios_processed + 1;
    END IF;
  END LOOP;

  FOR v_decision IN
    SELECT DISTINCT ON (decision.symbol)
      decision.id,
      decision.symbol
    FROM public."AI_Crypto_Bot_AI_Decisions" AS decision
    JOIN public."AI_Crypto_Bot_Watched_Markets" AS market
      ON market.symbol = decision.symbol
      AND market.enabled = true
    ORDER BY decision.symbol, decision.created_at DESC, decision.id DESC
  LOOP
    FOR v_portfolio IN
      SELECT id
      FROM public."AI_Crypto_Bot_Portfolios"
      ORDER BY created_at, id
    LOOP
      v_result := public."AI_Crypto_Bot_Apply_Paper_Decision"(
        v_portfolio.id,
        v_decision.id
      );
      v_decisions_processed := v_decisions_processed + 1;
      IF v_result->>'status' = 'EXECUTED' THEN
        v_trades_executed := v_trades_executed + 1;
      ELSIF v_result->>'status' = 'DUPLICATE' THEN
        v_duplicates := v_duplicates + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    END LOOP;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'COMPLETED',
    'portfoliosProcessed', v_portfolios_processed,
    'decisionsProcessed', v_decisions_processed,
    'tradesExecuted', v_trades_executed,
    'duplicates', v_duplicates,
    'skipped', v_skipped
  );
END;
$$;

REVOKE ALL ON FUNCTION public."AI_Crypto_Bot_Provision_Paper_Portfolio"() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public."AI_Crypto_Bot_Refresh_Paper_Portfolio"(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public."AI_Crypto_Bot_Apply_Paper_Decision"(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public."AI_Crypto_Bot_Run_Paper_Trading"() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public."AI_Crypto_Bot_Run_Paper_Trading"() TO service_role;

COMMIT;
