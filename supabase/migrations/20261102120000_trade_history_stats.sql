BEGIN;

CREATE FUNCTION public."AI_Crypto_Bot_Trade_History_Stats"()
RETURNS TABLE (
  closed_trade_count bigint,
  winning_trade_count bigint,
  losing_trade_count bigint,
  average_profit numeric,
  average_loss numeric,
  best_trade numeric,
  worst_trade numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    pg_catalog.count(*)::bigint,
    pg_catalog.count(*) FILTER (WHERE trade.realized_pnl > 0)::bigint,
    pg_catalog.count(*) FILTER (WHERE trade.realized_pnl < 0)::bigint,
    pg_catalog.avg(trade.realized_pnl) FILTER (WHERE trade.realized_pnl > 0),
    pg_catalog.avg(trade.realized_pnl) FILTER (WHERE trade.realized_pnl < 0),
    pg_catalog.max(trade.realized_pnl),
    pg_catalog.min(trade.realized_pnl)
  FROM public."AI_Crypto_Bot_Trades" AS trade
  WHERE trade.side = 'SELL';
$$;

REVOKE ALL ON FUNCTION public."AI_Crypto_Bot_Trade_History_Stats"() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public."AI_Crypto_Bot_Trade_History_Stats"() TO authenticated;

COMMIT;
