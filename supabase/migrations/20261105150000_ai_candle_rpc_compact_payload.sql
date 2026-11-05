CREATE FUNCTION public."AI_Crypto_Bot_Get_Latest_AI_Candles_Compact"(
  p_symbols text[],
  p_interval text
)
RETURNS TABLE (
  symbol text,
  candles jsonb
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

  IF p_symbols IS NULL
     OR pg_catalog.cardinality(p_symbols) < 1
     OR pg_catalog.cardinality(p_symbols) > 4
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.unnest(p_symbols) AS requested(symbol)
       WHERE requested.symbol IS NULL OR pg_catalog.btrim(requested.symbol) = ''
     )
     OR pg_catalog.cardinality(p_symbols) <> (
       SELECT count(DISTINCT requested.symbol)
       FROM pg_catalog.unnest(p_symbols) AS requested(symbol)
     ) THEN
    RAISE EXCEPTION 'Expected one to four unique non-empty market symbols.'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(p_symbols) AS requested(symbol)
    WHERE requested.symbol !~ '^[A-Z0-9]+-EUR$'
  ) THEN
    RAISE EXCEPTION 'Expected uppercase EUR market symbols.'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(p_symbols) AS requested(symbol)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public."AI_Crypto_Bot_Watched_Markets" AS watched
      WHERE watched.symbol = requested.symbol
        AND watched.enabled IS TRUE
    )
  ) THEN
    RAISE EXCEPTION 'Every requested market must be enabled.'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT requested.symbol,
         COALESCE(
           (
             SELECT pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_array(
                 latest.timestamp,
                 latest.open,
                 latest.high,
                 latest.low,
                 latest.close,
                 latest.volume
               )
               ORDER BY latest.timestamp DESC
             )
             FROM (
               SELECT candle.timestamp,
                      candle.open,
                      candle.high,
                      candle.low,
                      candle.close,
                      candle.volume
               FROM public."AI_Crypto_Bot_Candles" AS candle
               WHERE candle.symbol = requested.symbol
                 AND candle.interval = p_interval
               ORDER BY candle.timestamp DESC
               LIMIT 150
             ) AS latest
           ),
           '[]'::jsonb
         ) AS candles
  FROM pg_catalog.unnest(p_symbols) WITH ORDINALITY AS requested(symbol, position)
  ORDER BY requested.position;
END;
$function$;

REVOKE ALL ON FUNCTION public."AI_Crypto_Bot_Get_Latest_AI_Candles_Compact"(text[], text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public."AI_Crypto_Bot_Get_Latest_AI_Candles_Compact"(text[], text)
  TO service_role;
