BEGIN;

-- Minimal key anchor for the production Profiles.id -> auth.users.id foreign key.
-- This is not a replica of Supabase Auth and must not contain auth credentials.
CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY
);

CREATE TABLE public."AI_Crypto_Bot_Profiles" (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT "AI_Crypto_Bot_Profiles_email_nonempty"
    CHECK (email IS NULL OR pg_catalog.btrim(email) <> '')
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
  ai_decision_id uuid,
  CONSTRAINT "AI_Crypto_Bot_Trades_portfolio_id_fkey"
    FOREIGN KEY (portfolio_id) REFERENCES public."AI_Crypto_Bot_Portfolios" (id) ON DELETE CASCADE,
  CONSTRAINT "AI_Crypto_Bot_Trades_symbol_fkey"
    FOREIGN KEY (symbol) REFERENCES public."AI_Crypto_Bot_Watched_Markets" (symbol) ON DELETE RESTRICT,
  CONSTRAINT "AI_Crypto_Bot_Trades_idempotency_key_key" UNIQUE (idempotency_key),
  CONSTRAINT "AI_Crypto_Bot_Trades_ai_decision_id_fkey"
    FOREIGN KEY (ai_decision_id)
    REFERENCES public."AI_Crypto_Bot_AI_Decisions" (id)
    ON DELETE RESTRICT
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

CREATE TABLE public."AI_Crypto_Bot_Shadow_Exit_Scenarios" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id uuid NOT NULL,
  portfolio_id uuid NOT NULL,
  symbol text NOT NULL,
  position_opened_at timestamptz NOT NULL,
  amount numeric(28, 12) NOT NULL CHECK (amount > 0),
  entry_price numeric(28, 12) NOT NULL CHECK (entry_price > 0),
  rule_id text NOT NULL CHECK (rule_id IN (
    'fixed_tp_5',
    'fixed_tp_10',
    'fixed_tp_15',
    'fixed_tp_20',
    'trailing_stop_5',
    'trailing_stop_10',
    'trailing_stop_15'
  )),
  rule_version text NOT NULL CHECK (pg_catalog.btrim(rule_version) <> ''),
  parameters jsonb NOT NULL CHECK (pg_catalog.jsonb_typeof(parameters) = 'object'),
  status text NOT NULL DEFAULT 'TRACKING'
    CHECK (status IN ('TRACKING', 'TRIGGERED', 'CLOSED_WITHOUT_TRIGGER')),
  data_quality_status text NOT NULL DEFAULT 'AWAITING_FIRST_FRESH_MARK'
    CHECK (data_quality_status IN (
      'AWAITING_FIRST_FRESH_MARK',
      'FRESH',
      'STALE',
      'INVALID',
      'UNAVAILABLE'
    )),
  tracking_started_at timestamptz,
  last_evaluated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  last_mark numeric(28, 12) CHECK (last_mark IS NULL OR last_mark > 0),
  last_mark_captured_at timestamptz,
  high_water_mark numeric(28, 12) CHECK (high_water_mark IS NULL OR high_water_mark > 0),
  trailing_armed boolean NOT NULL DEFAULT false,
  activated_at timestamptz,
  triggered_at timestamptz,
  trigger_mark numeric(28, 12) CHECK (trigger_mark IS NULL OR trigger_mark > 0),
  modeled_exit_price numeric(28, 12) CHECK (modeled_exit_price IS NULL OR modeled_exit_price > 0),
  modeled_net_pnl numeric(28, 12),
  actual_trade_id uuid,
  actual_closed_at timestamptz,
  actual_close_price numeric(28, 12) CHECK (actual_close_price IS NULL OR actual_close_price > 0),
  actual_net_pnl numeric(28, 12),
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT "AI_Crypto_Bot_Shadow_Exit_Scenarios_position_id_fkey"
    FOREIGN KEY (position_id) REFERENCES public."AI_Crypto_Bot_Positions" (id) ON DELETE CASCADE,
  CONSTRAINT "AI_Crypto_Bot_Shadow_Exit_Scenarios_portfolio_id_fkey"
    FOREIGN KEY (portfolio_id) REFERENCES public."AI_Crypto_Bot_Portfolios" (id) ON DELETE CASCADE,
  CONSTRAINT "AI_Crypto_Bot_Shadow_Exit_Scenarios_symbol_fkey"
    FOREIGN KEY (symbol) REFERENCES public."AI_Crypto_Bot_Watched_Markets" (symbol) ON DELETE RESTRICT,
  CONSTRAINT "AI_Crypto_Bot_Shadow_Exit_Scenarios_actual_trade_id_fkey"
    FOREIGN KEY (actual_trade_id) REFERENCES public."AI_Crypto_Bot_Trades" (id) ON DELETE SET NULL,
  CONSTRAINT "AI_Crypto_Bot_Shadow_Exit_Scenarios_rule_key"
    UNIQUE (position_id, rule_id, rule_version),
  CONSTRAINT "AI_Crypto_Bot_Shadow_Exit_Scenarios_trigger_consistency"
    CHECK (
      (status = 'TRIGGERED')
      = (
        triggered_at IS NOT NULL
        AND trigger_mark IS NOT NULL
        AND modeled_exit_price IS NOT NULL
        AND modeled_net_pnl IS NOT NULL
      )
    ),
  CONSTRAINT "AI_Crypto_Bot_Shadow_Exit_Scenarios_activation_consistency"
    CHECK (trailing_armed = (activated_at IS NOT NULL)),
  CONSTRAINT "AI_Crypto_Bot_Shadow_Exit_Scenarios_finalization_consistency"
    CHECK ((actual_closed_at IS NULL) = (finalized_at IS NULL)),
  CONSTRAINT "AI_Crypto_Bot_Shadow_Exit_Scenarios_closed_status_consistency"
    CHECK (status <> 'CLOSED_WITHOUT_TRIGGER' OR actual_closed_at IS NOT NULL)
);

CREATE TABLE public."AI_Crypto_Bot_Shadow_Exit_Events" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id uuid,
  scenario_id uuid,
  symbol text,
  event_type text NOT NULL CHECK (event_type IN (
    'TRACKING_STARTED',
    'TRAILING_STOP_ARMED',
    'HYPOTHETICAL_TRIGGERED',
    'ACTUAL_POSITION_CLOSED',
    'DATA_QUALITY_CHANGED',
    'EVALUATION_FAILED'
  )),
  event_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  observed_mark numeric(28, 12) CHECK (observed_mark IS NULL OR observed_mark > 0),
  data_quality_status text,
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[0-9A-Z_]{1,32}$'),
  details jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (pg_catalog.jsonb_typeof(details) = 'object'),
  dedupe_key text NOT NULL UNIQUE,
  CONSTRAINT "AI_Crypto_Bot_Shadow_Exit_Events_position_id_fkey"
    FOREIGN KEY (position_id) REFERENCES public."AI_Crypto_Bot_Positions" (id) ON DELETE CASCADE,
  CONSTRAINT "AI_Crypto_Bot_Shadow_Exit_Events_scenario_id_fkey"
    FOREIGN KEY (scenario_id) REFERENCES public."AI_Crypto_Bot_Shadow_Exit_Scenarios" (id) ON DELETE CASCADE,
  CONSTRAINT "AI_Crypto_Bot_Shadow_Exit_Events_quality_check"
    CHECK (
      data_quality_status IS NULL
      OR data_quality_status IN (
        'AWAITING_FIRST_FRESH_MARK',
        'FRESH',
        'STALE',
        'INVALID',
        'UNAVAILABLE'
      )
    )
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
CREATE INDEX "AI_Crypto_Bot_AI_Decisions_symbol_created_id_idx"
  ON public."AI_Crypto_Bot_AI_Decisions" (symbol, created_at DESC, id DESC);
CREATE INDEX "AI_Crypto_Bot_Trades_portfolio_symbol_created_idx"
  ON public."AI_Crypto_Bot_Trades" (portfolio_id, symbol, created_at DESC);
CREATE INDEX "AI_Crypto_Bot_Trades_ai_decision_id_idx"
  ON public."AI_Crypto_Bot_Trades" (ai_decision_id);
CREATE INDEX "AI_Crypto_Bot_Shadow_Exit_Scenarios_recent_closed_idx"
  ON public."AI_Crypto_Bot_Shadow_Exit_Scenarios"
    (actual_closed_at DESC, position_opened_at DESC, position_id, rule_id)
  WHERE actual_closed_at IS NOT NULL;
CREATE INDEX "AI_Crypto_Bot_Shadow_Exit_Events_position_event_idx"
  ON public."AI_Crypto_Bot_Shadow_Exit_Events" (position_id, event_at DESC);
CREATE INDEX "AI_Crypto_Bot_Shadow_Exit_Events_scenario_event_idx"
  ON public."AI_Crypto_Bot_Shadow_Exit_Events" (scenario_id, event_at DESC);

COMMIT;
