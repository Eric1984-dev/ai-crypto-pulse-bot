\set ON_ERROR_STOP on
\pset pager off

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL TIME ZONE 'UTC';

DO $market_export_preflight$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Expected the Supabase postgres database';
  END IF;

  IF (SELECT count(*) FROM public."AI_Crypto_Bot_Watched_Markets") <> 102 THEN
    RAISE EXCEPTION 'Expected exactly 102 watched-market rows';
  END IF;
END
$market_export_preflight$;

SELECT
  current_database() AS source_database,
  current_user AS source_role,
  count(*) AS source_rows,
  count(DISTINCT id) AS distinct_ids,
  count(DISTINCT symbol) AS distinct_symbols,
  min(created_at) AS earliest_created_at,
  max(created_at) AS latest_created_at
FROM public."AI_Crypto_Bot_Watched_Markets";

\copy (SELECT id::text AS id, symbol, enabled, priority, created_at::text AS created_at, updated_at::text AS updated_at FROM public."AI_Crypto_Bot_Watched_Markets" ORDER BY id) TO 'market_export.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')

COMMIT;

\echo 'Export complete: market_export.csv was written by the psql client.'
