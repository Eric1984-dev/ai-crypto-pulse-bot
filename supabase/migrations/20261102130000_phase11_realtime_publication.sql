BEGIN;

DO $$
DECLARE
  table_name text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    RAISE EXCEPTION 'Supabase Realtime publication supabase_realtime is required before applying this migration.';
  END IF;

  FOREACH table_name IN ARRAY ARRAY[
    'AI_Crypto_Bot_Status',
    'AI_Crypto_Bot_Emergency_State',
    'AI_Crypto_Bot_Portfolios',
    'AI_Crypto_Bot_Positions',
    'AI_Crypto_Bot_Trades',
    'AI_Crypto_Bot_Portfolio_Snapshots',
    'AI_Crypto_Bot_AI_Decisions',
    'AI_Crypto_Bot_Watched_Markets',
    'AI_Crypto_Bot_Market_Data',
    'AI_Crypto_Bot_Candles'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = table_name
    ) THEN
      EXECUTE pg_catalog.format(
        'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
        table_name
      );
    END IF;
  END LOOP;
END;
$$;

COMMIT;
