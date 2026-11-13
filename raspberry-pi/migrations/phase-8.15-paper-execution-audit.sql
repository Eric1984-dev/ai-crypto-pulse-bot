BEGIN;

CREATE TABLE public."AI_Crypto_Bot_Paper_Execution_Audit" (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  evaluation_run_id uuid NOT NULL,
  portfolio_id uuid NOT NULL,
  decision_id uuid NOT NULL,
  symbol text NOT NULL,
  action text NOT NULL,
  confidence numeric,
  decision_at timestamptz NOT NULL,
  evaluated_at timestamptz NOT NULL,
  outcome text NOT NULL,
  reason_code text NOT NULL,
  trade_id uuid REFERENCES public."AI_Crypto_Bot_Trades"(id) ON DELETE RESTRICT,
  CONSTRAINT "AI_Crypto_Bot_Paper_Execution_Audit_symbol_valid"
    CHECK (symbol ~ '^[A-Z0-9]+-EUR$'),
  CONSTRAINT "AI_Crypto_Bot_Paper_Execution_Audit_action_valid"
    CHECK (action IN ('BUY', 'SELL')),
  CONSTRAINT "AI_Crypto_Bot_Paper_Execution_Audit_confidence_valid"
    CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 100),
  CONSTRAINT "AI_Crypto_Bot_Paper_Execution_Audit_outcome_valid"
    CHECK (outcome IN ('EXECUTED', 'SKIPPED', 'DUPLICATE')),
  CONSTRAINT "AI_Crypto_Bot_Paper_Execution_Audit_reason_valid"
    CHECK (reason_code IN (
      'TRADE_EXECUTED',
      'DUPLICATE_TRADE',
      'STALE_DECISION',
      'MISSING_MARKET_DATA',
      'STALE_MARKET_DATA',
      'LOW_CONFIDENCE',
      'TRADING_PAUSED',
      'EMERGENCY_STOP_ACTIVE',
      'EMERGENCY_DRAWDOWN_STOP',
      'AGENT_STOPPED',
      'STALE_OPEN_POSITION_DATA',
      'POSITION_ALREADY_OPEN',
      'MAX_OPEN_POSITIONS',
      'COOLDOWN_ACTIVE',
      'DAILY_DRAWDOWN_LIMIT',
      'MAX_PORTFOLIO_DRAWDOWN',
      'INSUFFICIENT_FUNDS',
      'ZERO_POSITION_SIZE',
      'NO_OPEN_POSITION'
    )),
  CONSTRAINT "AI_Crypto_Bot_Paper_Execution_Audit_outcome_reason_valid"
    CHECK (
      (outcome = 'EXECUTED' AND reason_code = 'TRADE_EXECUTED')
      OR (outcome = 'DUPLICATE' AND reason_code = 'DUPLICATE_TRADE')
      OR (
        outcome = 'SKIPPED'
        AND reason_code NOT IN ('TRADE_EXECUTED', 'DUPLICATE_TRADE')
      )
    ),
  CONSTRAINT "AI_Crypto_Bot_Paper_Execution_Audit_trade_link_valid"
    CHECK (
      (outcome = 'EXECUTED' AND trade_id IS NOT NULL)
      OR (outcome = 'SKIPPED' AND trade_id IS NULL)
      OR outcome = 'DUPLICATE'
    ),
  CONSTRAINT "AI_Crypto_Bot_Paper_Execution_Audit_attempt_unique"
    UNIQUE (evaluation_run_id, portfolio_id, decision_id)
);

CREATE INDEX "AI_Crypto_Bot_Paper_Execution_Audit_history_idx"
  ON public."AI_Crypto_Bot_Paper_Execution_Audit"
    (portfolio_id, evaluated_at, id);

CREATE INDEX "AI_Crypto_Bot_Paper_Execution_Audit_decision_idx"
  ON public."AI_Crypto_Bot_Paper_Execution_Audit"
    (decision_id, evaluated_at, id);

GRANT SELECT ON TABLE public."AI_Crypto_Bot_Paper_Execution_Audit"
  TO ai_crypto_bot_runtime_reader;

DO $migration$
DECLARE
  v_paper_role_name text := nullif(
    pg_catalog.current_setting('cryptopulse.paper_database_user', true),
    ''
  );
BEGIN
  IF v_paper_role_name IS NULL THEN
    RAISE EXCEPTION
      'Set cryptopulse.paper_database_user to the configured PAPER_DATABASE_USER before applying this migration.';
  END IF;
  IF v_paper_role_name = 'ai_crypto_bot_runtime_reader' THEN
    RAISE EXCEPTION
      'PAPER_DATABASE_USER must be distinct from ai_crypto_bot_runtime_reader.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = v_paper_role_name
  ) THEN
    RAISE EXCEPTION 'Configured PAPER_DATABASE_USER role "%" does not exist.',
      v_paper_role_name;
  END IF;

  EXECUTE pg_catalog.format(
    'GRANT INSERT ON TABLE public."AI_Crypto_Bot_Paper_Execution_Audit" TO %I',
    v_paper_role_name
  );
END;
$migration$;

COMMIT;
