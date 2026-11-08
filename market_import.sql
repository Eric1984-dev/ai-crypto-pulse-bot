\set ON_ERROR_STOP on
\pset pager off

BEGIN;
SET LOCAL TIME ZONE 'UTC';

DO $market_import_preflight$
DECLARE
  actual_columns integer;
  source_row_count bigint;
BEGIN
  IF current_database() <> 'ai_crypto_bot_archive' THEN
    RAISE EXCEPTION 'Expected the ai_crypto_bot_archive database';
  END IF;

  IF to_regclass('public."AI_Crypto_Bot_Watched_Markets"') IS NULL THEN
    RAISE EXCEPTION 'Archive watched-market table is missing';
  END IF;

  SELECT count(*)
    INTO actual_columns
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'AI_Crypto_Bot_Watched_Markets';

  IF actual_columns <> 6 OR EXISTS (
    SELECT 1
      FROM (VALUES
        ('id', 'uuid'),
        ('symbol', 'text'),
        ('enabled', 'boolean'),
        ('priority', 'integer'),
        ('created_at', 'timestamp with time zone'),
        ('updated_at', 'timestamp with time zone')
      ) AS expected(column_name, data_type)
      LEFT JOIN information_schema.columns AS actual
        ON actual.table_schema = 'public'
       AND actual.table_name = 'AI_Crypto_Bot_Watched_Markets'
       AND actual.column_name = expected.column_name
     WHERE actual.column_name IS NULL
        OR actual.data_type <> expected.data_type
        OR actual.is_nullable <> 'NO'
  ) THEN
    RAISE EXCEPTION 'Archive watched-market column contract mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint
     WHERE conrelid = 'public."AI_Crypto_Bot_Watched_Markets"'::regclass
       AND contype = 'p'
       AND pg_catalog.pg_get_constraintdef(oid) = 'PRIMARY KEY (id)'
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint
     WHERE conrelid = 'public."AI_Crypto_Bot_Watched_Markets"'::regclass
       AND contype = 'u'
       AND pg_catalog.pg_get_constraintdef(oid) = 'UNIQUE (symbol)'
  ) THEN
    RAISE EXCEPTION 'Archive watched-market key constraints are missing';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger
     WHERE tgrelid = 'public."AI_Crypto_Bot_Watched_Markets"'::regclass
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Archive watched-market table has an unexpected trigger';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public."AI_Crypto_Bot_Watched_Markets"
  ) THEN
    RAISE EXCEPTION 'Archive watched-market table is not empty; import stopped';
  END IF;
END
$market_import_preflight$;

\copy public."AI_Crypto_Bot_Watched_Markets" ("id", "symbol", "enabled", "priority", "created_at", "updated_at") FROM 'market_export.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')

DO $market_import_validation$
DECLARE
  row_count bigint;
  distinct_ids bigint;
  distinct_symbols bigint;
BEGIN
  SELECT count(*), count(DISTINCT id), count(DISTINCT symbol)
    INTO row_count, distinct_ids, distinct_symbols
    FROM public."AI_Crypto_Bot_Watched_Markets";

  IF row_count <> 102 OR distinct_ids <> 102 OR distinct_symbols <> 102 THEN
    RAISE EXCEPTION 'Import validation failed: expected 102 unique market rows';
  END IF;
END
$market_import_validation$;

SELECT
  current_database() AS archive_database,
  current_user AS archive_role,
  count(*) AS archive_rows,
  count(DISTINCT id) AS distinct_ids,
  count(DISTINCT symbol) AS distinct_symbols,
  min(created_at) AS earliest_created_at,
  max(created_at) AS latest_created_at,
  min(updated_at) AS earliest_updated_at,
  max(updated_at) AS latest_updated_at
FROM public."AI_Crypto_Bot_Watched_Markets";

COMMIT;

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL TIME ZONE 'UTC';

\copy (SELECT id::text AS id, symbol, enabled, priority, created_at::text AS created_at, updated_at::text AS updated_at FROM public."AI_Crypto_Bot_Watched_Markets" ORDER BY id) TO 'market_archive_validation.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')

COMMIT;

\echo 'Import and in-database count validation complete. Compare market_export.csv with market_archive_validation.csv.'
