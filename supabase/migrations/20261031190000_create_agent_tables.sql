BEGIN;

CREATE TABLE public."AI_Crypto_Bot_Profiles" (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT "AI_Crypto_Bot_Profiles_email_nonempty"
    CHECK (email IS NULL OR pg_catalog.btrim(email) <> '')
);

CREATE TABLE public."AI_Crypto_Bot_Portfolios" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  starting_balance numeric(28, 12) NOT NULL CHECK (starting_balance >= 0),
  available_balance numeric(28, 12) NOT NULL DEFAULT 0 CHECK (available_balance >= 0),
  portfolio_value numeric(28, 12) NOT NULL DEFAULT 0 CHECK (portfolio_value >= 0),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT "AI_Crypto_Bot_Portfolios_user_id_fkey"
    FOREIGN KEY (user_id) REFERENCES public."AI_Crypto_Bot_Profiles" (id) ON DELETE CASCADE
);

CREATE TABLE public."AI_Crypto_Bot_Watched_Markets" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 1 CHECK (priority > 0),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT "AI_Crypto_Bot_Watched_Markets_symbol_key" UNIQUE (symbol),
  CONSTRAINT "AI_Crypto_Bot_Watched_Markets_symbol_format"
    CHECK (symbol ~ '^[A-Z0-9]+-[A-Z0-9]+$')
);

CREATE TABLE public."AI_Crypto_Bot_Positions" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id uuid NOT NULL,
  symbol text NOT NULL,
  amount numeric(28, 12) NOT NULL CHECK (amount > 0),
  entry_price numeric(28, 12) NOT NULL CHECK (entry_price > 0),
  current_price numeric(28, 12) NOT NULL CHECK (current_price > 0),
  unrealized_pnl numeric(28, 12) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'CLOSED')),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT "AI_Crypto_Bot_Positions_portfolio_id_fkey"
    FOREIGN KEY (portfolio_id) REFERENCES public."AI_Crypto_Bot_Portfolios" (id) ON DELETE CASCADE,
  CONSTRAINT "AI_Crypto_Bot_Positions_symbol_fkey"
    FOREIGN KEY (symbol) REFERENCES public."AI_Crypto_Bot_Watched_Markets" (symbol) ON DELETE RESTRICT
);

CREATE TABLE public."AI_Crypto_Bot_Trades" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  symbol text NOT NULL,
  side text NOT NULL CHECK (side IN ('BUY', 'SELL')),
  price numeric(28, 12) NOT NULL CHECK (price > 0),
  quantity numeric(28, 12) NOT NULL CHECK (quantity > 0),
  fees numeric(28, 12) NOT NULL DEFAULT 0 CHECK (fees >= 0),
  slippage numeric(28, 12) NOT NULL DEFAULT 0 CHECK (slippage >= 0),
  realized_pnl numeric(28, 12) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT "AI_Crypto_Bot_Trades_portfolio_id_fkey"
    FOREIGN KEY (portfolio_id) REFERENCES public."AI_Crypto_Bot_Portfolios" (id) ON DELETE CASCADE,
  CONSTRAINT "AI_Crypto_Bot_Trades_symbol_fkey"
    FOREIGN KEY (symbol) REFERENCES public."AI_Crypto_Bot_Watched_Markets" (symbol) ON DELETE RESTRICT,
  CONSTRAINT "AI_Crypto_Bot_Trades_idempotency_key_key" UNIQUE (idempotency_key)
);

CREATE TABLE public."AI_Crypto_Bot_Market_Data" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL UNIQUE,
  price numeric(28, 12) NOT NULL CHECK (price > 0),
  volume numeric(28, 12) NOT NULL DEFAULT 0 CHECK (volume >= 0),
  daily_change numeric(12, 6) NOT NULL DEFAULT 0,
  high_24h numeric(28, 12) NOT NULL CHECK (high_24h > 0),
  low_24h numeric(28, 12) NOT NULL CHECK (low_24h > 0 AND low_24h <= high_24h),
  captured_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT "AI_Crypto_Bot_Market_Data_symbol_fkey"
    FOREIGN KEY (symbol) REFERENCES public."AI_Crypto_Bot_Watched_Markets" (symbol) ON DELETE RESTRICT
);

CREATE TABLE public."AI_Crypto_Bot_Candles" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  interval text NOT NULL CHECK (interval IN ('1m', '5m', '15m', '1h', '4h', '1d')),
  open numeric(28, 12) NOT NULL CHECK (open > 0),
  high numeric(28, 12) NOT NULL CHECK (high > 0),
  low numeric(28, 12) NOT NULL CHECK (low > 0),
  close numeric(28, 12) NOT NULL CHECK (close > 0),
  volume numeric(28, 12) NOT NULL DEFAULT 0 CHECK (volume >= 0),
  "timestamp" timestamptz NOT NULL,
  CONSTRAINT "AI_Crypto_Bot_Candles_symbol_fkey"
    FOREIGN KEY (symbol) REFERENCES public."AI_Crypto_Bot_Watched_Markets" (symbol) ON DELETE RESTRICT,
  CONSTRAINT "AI_Crypto_Bot_Candles_ohlc_valid"
    CHECK (
      high >= low
      AND high >= open
      AND high >= close
      AND low <= open
      AND low <= close
    ),
  CONSTRAINT "AI_Crypto_Bot_Candles_symbol_interval_timestamp_key"
    UNIQUE (symbol, interval, "timestamp")
);

CREATE TABLE public."AI_Crypto_Bot_Strategies" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (pg_catalog.btrim(name) <> ''),
  version text NOT NULL CHECK (pg_catalog.btrim(version) <> ''),
  enabled boolean NOT NULL DEFAULT false,
  score numeric(16, 6),
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT "AI_Crypto_Bot_Strategies_name_version_key" UNIQUE (name, version)
);

CREATE TABLE public."AI_Crypto_Bot_Strategy_Changes" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  change_type text NOT NULL CHECK (pg_catalog.btrim(change_type) <> ''),
  old_value text,
  new_value text,
  reason text NOT NULL CHECK (pg_catalog.btrim(reason) <> ''),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT "AI_Crypto_Bot_Strategy_Changes_strategy_id_fkey"
    FOREIGN KEY (strategy_id) REFERENCES public."AI_Crypto_Bot_Strategies" (id) ON DELETE RESTRICT,
  CONSTRAINT "AI_Crypto_Bot_Strategy_Changes_idempotency_key_key" UNIQUE (idempotency_key)
);

CREATE TABLE public."AI_Crypto_Bot_Strategy_Performance" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id uuid NOT NULL,
  win_rate numeric(5, 2) NOT NULL DEFAULT 0 CHECK (win_rate BETWEEN 0 AND 100),
  profit_factor numeric(16, 6) CHECK (profit_factor IS NULL OR profit_factor >= 0),
  average_profit numeric(28, 12) NOT NULL DEFAULT 0,
  average_loss numeric(28, 12) NOT NULL DEFAULT 0,
  drawdown numeric(5, 2) NOT NULL DEFAULT 0 CHECK (drawdown BETWEEN 0 AND 100),
  score numeric(16, 6),
  total_trades bigint NOT NULL DEFAULT 0 CHECK (total_trades >= 0),
  net_profit numeric(28, 12) NOT NULL DEFAULT 0,
  risk_adjusted_return numeric(16, 6),
  average_trade_duration_seconds bigint CHECK (
    average_trade_duration_seconds IS NULL OR average_trade_duration_seconds >= 0
  ),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT "AI_Crypto_Bot_Strategy_Performance_strategy_id_fkey"
    FOREIGN KEY (strategy_id) REFERENCES public."AI_Crypto_Bot_Strategies" (id) ON DELETE RESTRICT
);

CREATE TABLE public."AI_Crypto_Bot_Backtests" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id uuid NOT NULL,
  profit_loss numeric(28, 12) NOT NULL DEFAULT 0,
  win_rate numeric(5, 2) NOT NULL DEFAULT 0 CHECK (win_rate BETWEEN 0 AND 100),
  profit_factor numeric(16, 6) CHECK (profit_factor IS NULL OR profit_factor >= 0),
  drawdown numeric(5, 2) NOT NULL DEFAULT 0 CHECK (drawdown BETWEEN 0 AND 100),
  fees numeric(28, 12) NOT NULL DEFAULT 0 CHECK (fees >= 0),
  slippage numeric(28, 12) NOT NULL DEFAULT 0 CHECK (slippage >= 0),
  spread numeric(28, 12) NOT NULL DEFAULT 0 CHECK (spread >= 0),
  data_start_at timestamptz,
  data_end_at timestamptz,
  run_config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_catalog.jsonb_typeof(run_config) = 'object'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT "AI_Crypto_Bot_Backtests_strategy_id_fkey"
    FOREIGN KEY (strategy_id) REFERENCES public."AI_Crypto_Bot_Strategies" (id) ON DELETE RESTRICT,
  CONSTRAINT "AI_Crypto_Bot_Backtests_data_range_valid"
    CHECK (data_start_at IS NULL OR data_end_at IS NULL OR data_start_at < data_end_at)
);

CREATE TABLE public."AI_Crypto_Bot_AI_Decisions" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('BUY', 'SELL', 'HOLD', 'WAIT')),
  confidence numeric(5, 2) NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  indicators jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_catalog.jsonb_typeof(indicators) = 'object'),
  reason text NOT NULL CHECK (pg_catalog.btrim(reason) <> ''),
  strategy_name text,
  strategy_version text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT "AI_Crypto_Bot_AI_Decisions_strategy_snapshot_valid"
    CHECK ((strategy_name IS NULL) = (strategy_version IS NULL)),
  CONSTRAINT "AI_Crypto_Bot_AI_Decisions_symbol_fkey"
    FOREIGN KEY (symbol) REFERENCES public."AI_Crypto_Bot_Watched_Markets" (symbol) ON DELETE RESTRICT
);

CREATE TABLE public."AI_Crypto_Bot_Status" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE CHECK (singleton),
  is_active boolean NOT NULL DEFAULT false,
  is_analyzing boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'IDLE'
    CHECK (status IN ('ACTIVE', 'ANALYZING', 'IDLE', 'STOPPED', 'ERROR')),
  last_run timestamptz,
  error_message text,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT "AI_Crypto_Bot_Status_active_consistent"
    CHECK (is_active = (status IN ('ACTIVE', 'ANALYZING'))),
  CONSTRAINT "AI_Crypto_Bot_Status_analyzing_consistent"
    CHECK (is_analyzing = (status = 'ANALYZING'))
);

CREATE TABLE public."AI_Crypto_Bot_Portfolio_Snapshots" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id uuid NOT NULL,
  portfolio_value numeric(28, 12) NOT NULL CHECK (portfolio_value >= 0),
  available_balance numeric(28, 12) NOT NULL CHECK (available_balance >= 0),
  open_positions integer NOT NULL DEFAULT 0 CHECK (open_positions >= 0),
  captured_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT "AI_Crypto_Bot_Portfolio_Snapshots_portfolio_id_fkey"
    FOREIGN KEY (portfolio_id) REFERENCES public."AI_Crypto_Bot_Portfolios" (id) ON DELETE CASCADE
);

CREATE TABLE public."AI_Crypto_Bot_Scanner_Events" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  event_type text NOT NULL CHECK (pg_catalog.btrim(event_type) <> ''),
  reason text NOT NULL CHECK (pg_catalog.btrim(reason) <> ''),
  confidence numeric(5, 2) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT "AI_Crypto_Bot_Scanner_Events_symbol_fkey"
    FOREIGN KEY (symbol) REFERENCES public."AI_Crypto_Bot_Watched_Markets" (symbol) ON DELETE RESTRICT
);

CREATE TABLE public."AI_Crypto_Bot_Emergency_State" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL CHECK (status IN ('NORMAL', 'PAUSED', 'EMERGENCY_STOP')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

CREATE INDEX "AI_Crypto_Bot_Portfolios_user_id_idx"
  ON public."AI_Crypto_Bot_Portfolios" (user_id);
CREATE INDEX "AI_Crypto_Bot_Watched_Markets_enabled_priority_idx"
  ON public."AI_Crypto_Bot_Watched_Markets" (priority DESC, symbol)
  WHERE enabled;
CREATE INDEX "AI_Crypto_Bot_Positions_portfolio_status_created_idx"
  ON public."AI_Crypto_Bot_Positions" (portfolio_id, status, created_at DESC);
CREATE INDEX "AI_Crypto_Bot_Trades_portfolio_created_idx"
  ON public."AI_Crypto_Bot_Trades" (portfolio_id, created_at DESC);
CREATE INDEX "AI_Crypto_Bot_Market_Data_captured_at_idx"
  ON public."AI_Crypto_Bot_Market_Data" (captured_at DESC);
CREATE INDEX "AI_Crypto_Bot_Strategy_Changes_strategy_created_idx"
  ON public."AI_Crypto_Bot_Strategy_Changes" (strategy_id, created_at DESC);
CREATE INDEX "AI_Crypto_Bot_Strategy_Performance_strategy_created_idx"
  ON public."AI_Crypto_Bot_Strategy_Performance" (strategy_id, created_at DESC);
CREATE INDEX "AI_Crypto_Bot_Backtests_strategy_created_idx"
  ON public."AI_Crypto_Bot_Backtests" (strategy_id, created_at DESC);
CREATE INDEX "AI_Crypto_Bot_AI_Decisions_symbol_created_idx"
  ON public."AI_Crypto_Bot_AI_Decisions" (symbol, created_at DESC);
CREATE INDEX "AI_Crypto_Bot_AI_Decisions_created_at_idx"
  ON public."AI_Crypto_Bot_AI_Decisions" (created_at DESC);
CREATE INDEX "AI_Crypto_Bot_Portfolio_Snapshots_portfolio_captured_idx"
  ON public."AI_Crypto_Bot_Portfolio_Snapshots" (portfolio_id, captured_at DESC);
CREATE INDEX "AI_Crypto_Bot_Scanner_Events_symbol_created_idx"
  ON public."AI_Crypto_Bot_Scanner_Events" (symbol, created_at DESC);
CREATE INDEX "AI_Crypto_Bot_Scanner_Events_created_at_idx"
  ON public."AI_Crypto_Bot_Scanner_Events" (created_at DESC);
CREATE INDEX "AI_Crypto_Bot_Emergency_State_created_at_idx"
  ON public."AI_Crypto_Bot_Emergency_State" (created_at DESC);

CREATE FUNCTION public."AI_Crypto_Bot_Set_Updated_At"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER "AI_Crypto_Bot_Profiles_Set_Updated_At"
  BEFORE UPDATE ON public."AI_Crypto_Bot_Profiles"
  FOR EACH ROW EXECUTE FUNCTION public."AI_Crypto_Bot_Set_Updated_At"();
CREATE TRIGGER "AI_Crypto_Bot_Portfolios_Set_Updated_At"
  BEFORE UPDATE ON public."AI_Crypto_Bot_Portfolios"
  FOR EACH ROW EXECUTE FUNCTION public."AI_Crypto_Bot_Set_Updated_At"();
CREATE TRIGGER "AI_Crypto_Bot_Watched_Markets_Set_Updated_At"
  BEFORE UPDATE ON public."AI_Crypto_Bot_Watched_Markets"
  FOR EACH ROW EXECUTE FUNCTION public."AI_Crypto_Bot_Set_Updated_At"();
CREATE TRIGGER "AI_Crypto_Bot_Positions_Set_Updated_At"
  BEFORE UPDATE ON public."AI_Crypto_Bot_Positions"
  FOR EACH ROW EXECUTE FUNCTION public."AI_Crypto_Bot_Set_Updated_At"();
CREATE TRIGGER "AI_Crypto_Bot_Strategies_Set_Updated_At"
  BEFORE UPDATE ON public."AI_Crypto_Bot_Strategies"
  FOR EACH ROW EXECUTE FUNCTION public."AI_Crypto_Bot_Set_Updated_At"();

CREATE FUNCTION public."AI_Crypto_Bot_Sync_Auth_Profile"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public."AI_Crypto_Bot_Profiles" (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        updated_at = pg_catalog.now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER "AI_Crypto_Bot_Auth_User_Profile_Insert"
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public."AI_Crypto_Bot_Sync_Auth_Profile"();
CREATE TRIGGER "AI_Crypto_Bot_Auth_User_Profile_Email_Update"
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public."AI_Crypto_Bot_Sync_Auth_Profile"();

INSERT INTO public."AI_Crypto_Bot_Profiles" (id, email)
SELECT id, email
FROM auth.users
ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      updated_at = pg_catalog.now();

ALTER TABLE public."AI_Crypto_Bot_Profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AI_Crypto_Bot_Portfolios" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AI_Crypto_Bot_Positions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AI_Crypto_Bot_Trades" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AI_Crypto_Bot_AI_Decisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AI_Crypto_Bot_Status" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AI_Crypto_Bot_Watched_Markets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AI_Crypto_Bot_Market_Data" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AI_Crypto_Bot_Candles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AI_Crypto_Bot_Strategies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AI_Crypto_Bot_Strategy_Changes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AI_Crypto_Bot_Strategy_Performance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AI_Crypto_Bot_Backtests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AI_Crypto_Bot_Portfolio_Snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AI_Crypto_Bot_Scanner_Events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AI_Crypto_Bot_Emergency_State" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "AI_Crypto_Bot_Profiles_select_own"
  ON public."AI_Crypto_Bot_Profiles" FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = id);
CREATE POLICY "AI_Crypto_Bot_Portfolios_select_own"
  ON public."AI_Crypto_Bot_Portfolios" FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "AI_Crypto_Bot_Positions_select_own"
  ON public."AI_Crypto_Bot_Positions" FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public."AI_Crypto_Bot_Portfolios" AS portfolio
    WHERE portfolio.id = portfolio_id
      AND portfolio.user_id = (SELECT auth.uid())
  ));
CREATE POLICY "AI_Crypto_Bot_Trades_select_own"
  ON public."AI_Crypto_Bot_Trades" FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public."AI_Crypto_Bot_Portfolios" AS portfolio
    WHERE portfolio.id = portfolio_id
      AND portfolio.user_id = (SELECT auth.uid())
  ));
CREATE POLICY "AI_Crypto_Bot_Portfolio_Snapshots_select_own"
  ON public."AI_Crypto_Bot_Portfolio_Snapshots" FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public."AI_Crypto_Bot_Portfolios" AS portfolio
    WHERE portfolio.id = portfolio_id
      AND portfolio.user_id = (SELECT auth.uid())
  ));

CREATE POLICY "AI_Crypto_Bot_Watched_Markets_select_authenticated"
  ON public."AI_Crypto_Bot_Watched_Markets" FOR SELECT TO authenticated USING (true);
CREATE POLICY "AI_Crypto_Bot_Market_Data_select_authenticated"
  ON public."AI_Crypto_Bot_Market_Data" FOR SELECT TO authenticated USING (true);
CREATE POLICY "AI_Crypto_Bot_Candles_select_authenticated"
  ON public."AI_Crypto_Bot_Candles" FOR SELECT TO authenticated USING (true);
CREATE POLICY "AI_Crypto_Bot_AI_Decisions_select_authenticated"
  ON public."AI_Crypto_Bot_AI_Decisions" FOR SELECT TO authenticated USING (true);
CREATE POLICY "AI_Crypto_Bot_Status_select_authenticated"
  ON public."AI_Crypto_Bot_Status" FOR SELECT TO authenticated USING (true);
CREATE POLICY "AI_Crypto_Bot_Strategies_select_authenticated"
  ON public."AI_Crypto_Bot_Strategies" FOR SELECT TO authenticated USING (true);
CREATE POLICY "AI_Crypto_Bot_Strategy_Changes_select_authenticated"
  ON public."AI_Crypto_Bot_Strategy_Changes" FOR SELECT TO authenticated USING (true);
CREATE POLICY "AI_Crypto_Bot_Strategy_Performance_select_authenticated"
  ON public."AI_Crypto_Bot_Strategy_Performance" FOR SELECT TO authenticated USING (true);
CREATE POLICY "AI_Crypto_Bot_Backtests_select_authenticated"
  ON public."AI_Crypto_Bot_Backtests" FOR SELECT TO authenticated USING (true);
CREATE POLICY "AI_Crypto_Bot_Scanner_Events_select_authenticated"
  ON public."AI_Crypto_Bot_Scanner_Events" FOR SELECT TO authenticated USING (true);
CREATE POLICY "AI_Crypto_Bot_Emergency_State_select_authenticated"
  ON public."AI_Crypto_Bot_Emergency_State" FOR SELECT TO authenticated USING (true);

REVOKE ALL ON TABLE
  public."AI_Crypto_Bot_Profiles",
  public."AI_Crypto_Bot_Portfolios",
  public."AI_Crypto_Bot_Positions",
  public."AI_Crypto_Bot_Trades",
  public."AI_Crypto_Bot_AI_Decisions",
  public."AI_Crypto_Bot_Status",
  public."AI_Crypto_Bot_Watched_Markets",
  public."AI_Crypto_Bot_Market_Data",
  public."AI_Crypto_Bot_Candles",
  public."AI_Crypto_Bot_Strategies",
  public."AI_Crypto_Bot_Strategy_Changes",
  public."AI_Crypto_Bot_Strategy_Performance",
  public."AI_Crypto_Bot_Backtests",
  public."AI_Crypto_Bot_Portfolio_Snapshots",
  public."AI_Crypto_Bot_Scanner_Events",
  public."AI_Crypto_Bot_Emergency_State"
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
  public."AI_Crypto_Bot_Profiles",
  public."AI_Crypto_Bot_Portfolios",
  public."AI_Crypto_Bot_Positions",
  public."AI_Crypto_Bot_Trades",
  public."AI_Crypto_Bot_AI_Decisions",
  public."AI_Crypto_Bot_Status",
  public."AI_Crypto_Bot_Watched_Markets",
  public."AI_Crypto_Bot_Market_Data",
  public."AI_Crypto_Bot_Candles",
  public."AI_Crypto_Bot_Strategies",
  public."AI_Crypto_Bot_Strategy_Changes",
  public."AI_Crypto_Bot_Strategy_Performance",
  public."AI_Crypto_Bot_Backtests",
  public."AI_Crypto_Bot_Portfolio_Snapshots",
  public."AI_Crypto_Bot_Scanner_Events",
  public."AI_Crypto_Bot_Emergency_State"
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public."AI_Crypto_Bot_Profiles",
  public."AI_Crypto_Bot_Portfolios",
  public."AI_Crypto_Bot_Positions",
  public."AI_Crypto_Bot_Trades",
  public."AI_Crypto_Bot_AI_Decisions",
  public."AI_Crypto_Bot_Status",
  public."AI_Crypto_Bot_Watched_Markets",
  public."AI_Crypto_Bot_Market_Data",
  public."AI_Crypto_Bot_Candles",
  public."AI_Crypto_Bot_Strategies",
  public."AI_Crypto_Bot_Strategy_Changes",
  public."AI_Crypto_Bot_Strategy_Performance",
  public."AI_Crypto_Bot_Backtests",
  public."AI_Crypto_Bot_Portfolio_Snapshots",
  public."AI_Crypto_Bot_Scanner_Events",
  public."AI_Crypto_Bot_Emergency_State"
TO service_role;

REVOKE ALL ON FUNCTION public."AI_Crypto_Bot_Set_Updated_At"() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public."AI_Crypto_Bot_Sync_Auth_Profile"() FROM PUBLIC, anon, authenticated;

COMMIT;
