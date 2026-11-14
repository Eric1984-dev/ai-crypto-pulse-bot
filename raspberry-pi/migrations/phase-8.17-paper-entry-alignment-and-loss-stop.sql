BEGIN;

ALTER TABLE public."AI_Crypto_Bot_Trades"
  DROP CONSTRAINT "AI_Crypto_Bot_Trades_execution_reason_valid",
  ADD CONSTRAINT "AI_Crypto_Bot_Trades_execution_reason_valid"
    CHECK (execution_reason IN (
      'AI_DECISION',
      'ATR_TRAILING_EXIT',
      'MAX_POSITION_LOSS_EXIT'
    )),
  DROP CONSTRAINT "AI_Crypto_Bot_Trades_trailing_exit_source_valid",
  ADD CONSTRAINT "AI_Crypto_Bot_Trades_automatic_exit_source_valid"
    CHECK (
      execution_reason = 'AI_DECISION'
      OR (side = 'SELL' AND ai_decision_id IS NULL)
    );

ALTER TABLE public."AI_Crypto_Bot_Paper_Execution_Audit"
  DROP CONSTRAINT "AI_Crypto_Bot_Paper_Execution_Audit_reason_valid",
  ADD CONSTRAINT "AI_Crypto_Bot_Paper_Execution_Audit_reason_valid"
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
      'TIMEFRAME_MISALIGNMENT',
      'TIMEFRAME_ALIGNMENT_UNAVAILABLE',
      'MAX_OPEN_POSITIONS',
      'COOLDOWN_ACTIVE',
      'DAILY_DRAWDOWN_LIMIT',
      'MAX_PORTFOLIO_DRAWDOWN',
      'INSUFFICIENT_FUNDS',
      'ZERO_POSITION_SIZE',
      'NO_OPEN_POSITION'
    ));

COMMIT;
