CREATE FUNCTION public."AI_Crypto_Bot_Get_Latest_Candle_Checkpoints"(
  p_symbols text[],
  p_interval text
)
RETURNS TABLE (
  symbol text,
  latest_timestamp timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF p_interval IS NULL
     OR p_interval NOT IN ('1m', '5m', '15m', '1h', '4h', '1d') THEN
    RAISE EXCEPTION 'Unsupported candle interval: %', p_interval
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT requested.symbol, latest.timestamp
  FROM (
    SELECT DISTINCT requested_symbol AS symbol
    FROM unnest(p_symbols) AS requested_symbols(requested_symbol)
    WHERE requested_symbol IS NOT NULL
  ) AS requested
  CROSS JOIN LATERAL (
    SELECT candle.timestamp
    FROM public."AI_Crypto_Bot_Candles" AS candle
    WHERE candle.symbol = requested.symbol
      AND candle.interval = p_interval
    ORDER BY candle.timestamp DESC
    LIMIT 1
  ) AS latest;
END;
$function$;

REVOKE ALL ON FUNCTION public."AI_Crypto_Bot_Get_Latest_Candle_Checkpoints"(text[], text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public."AI_Crypto_Bot_Get_Latest_Candle_Checkpoints"(text[], text)
  TO service_role;
