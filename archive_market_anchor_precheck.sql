-- Read-only psql client script for the archive-market-anchor precheck.
-- It never creates or changes database objects and never writes database rows.
-- It writes three CSV exports to the client working directory; run from an
-- empty, access-controlled directory to avoid overwriting existing files.
--
-- Configure libpq service aliases outside this repository:
--   cryptopulse_source  -> intended Supabase PostgreSQL read-only connection
--   cryptopulse_archive -> ai_crypto_bot_archive read-only connection
-- Verify the source service host/project identity before running.
--
-- Run only when separately authorized:
--   psql -X -v ON_ERROR_STOP=1 -f archive_market_anchor_precheck.sql

\set ON_ERROR_STOP on
\pset pager off
\pset format aligned

\echo 'Connecting to the configured Supabase source service...'
\connect service=cryptopulse_source

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

SELECT
  current_database() AS source_database,
  current_user AS source_role,
  current_setting('server_version') AS server_version;

SELECT COALESCE(jsonb_agg(symbol ORDER BY symbol), '[]'::jsonb)::text
       AS source_symbols_json
FROM (
  SELECT DISTINCT symbol
  FROM public."AI_Crypto_Bot_AI_Decisions"
) AS required_symbols
\gset

\pset format csv
\o source_decision_symbols.csv
SELECT DISTINCT symbol
FROM public."AI_Crypto_Bot_AI_Decisions"
ORDER BY symbol;
\o
\pset format aligned

COMMIT;

\echo 'Connecting to the configured archive service...'
\connect service=cryptopulse_archive

SELECT current_database() AS archive_database, current_user AS archive_role;

SELECT current_database() = 'ai_crypto_bot_archive' AS expected_archive_database
\gset
\if :expected_archive_database
\else
  \echo 'ERROR: archive service did not connect to ai_crypto_bot_archive; stopping.'
  \quit 2
\endif

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

SELECT COALESCE(jsonb_agg(symbol ORDER BY symbol), '[]'::jsonb)::text
       AS archive_symbols_json
FROM (
  SELECT DISTINCT symbol
  FROM public."AI_Crypto_Bot_Watched_Markets"
) AS archive_symbols
\gset

\pset format csv
\o archive_watched_market_symbols.csv
SELECT DISTINCT symbol
FROM public."AI_Crypto_Bot_Watched_Markets"
ORDER BY symbol;
\o
\pset format aligned

\echo 'Symbol set counts:'
WITH source_symbols AS (
  SELECT value AS symbol
  FROM jsonb_array_elements_text(:'source_symbols_json'::jsonb) AS source(value)
),
archive_symbols AS (
  SELECT value AS symbol
  FROM jsonb_array_elements_text(:'archive_symbols_json'::jsonb) AS archive(value)
)
SELECT
  (SELECT count(*) FROM source_symbols) AS source_decision_symbol_count,
  (SELECT count(*) FROM archive_symbols) AS archive_market_symbol_count,
  (
    SELECT count(*)
    FROM source_symbols AS source
    LEFT JOIN archive_symbols AS archive USING (symbol)
    WHERE archive.symbol IS NULL
  ) AS missing_in_archive_count,
  (
    SELECT count(*)
    FROM archive_symbols AS archive
    LEFT JOIN source_symbols AS source USING (symbol)
    WHERE source.symbol IS NULL
  ) AS extra_in_archive_count;

\echo 'Differences (MISSING_IN_ARCHIVE rows are required FK anchors):'
WITH source_symbols AS (
  SELECT value AS symbol
  FROM jsonb_array_elements_text(:'source_symbols_json'::jsonb) AS source(value)
),
archive_symbols AS (
  SELECT value AS symbol
  FROM jsonb_array_elements_text(:'archive_symbols_json'::jsonb) AS archive(value)
)
SELECT
  COALESCE(source.symbol, archive.symbol) AS symbol,
  CASE
    WHEN archive.symbol IS NULL THEN 'MISSING_IN_ARCHIVE'
    WHEN source.symbol IS NULL THEN 'EXTRA_IN_ARCHIVE'
  END AS status
FROM source_symbols AS source
FULL OUTER JOIN archive_symbols AS archive USING (symbol)
WHERE source.symbol IS NULL OR archive.symbol IS NULL
ORDER BY status, symbol;

COMMIT;

\echo 'Exporting source market rows for missing symbols (no inserts are performed)...'
\connect service=cryptopulse_source

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

\pset format csv
\o missing_market_anchor_rows.csv
WITH source_symbols AS (
  SELECT value AS symbol
  FROM jsonb_array_elements_text(:'source_symbols_json'::jsonb) AS source(value)
),
archive_symbols AS (
  SELECT value AS symbol
  FROM jsonb_array_elements_text(:'archive_symbols_json'::jsonb) AS archive(value)
),
missing_symbols AS (
  SELECT source.symbol
  FROM source_symbols AS source
  LEFT JOIN archive_symbols AS archive USING (symbol)
  WHERE archive.symbol IS NULL
)
SELECT
  market.id,
  market.symbol,
  market.enabled,
  market.priority,
  market.created_at,
  market.updated_at
FROM public."AI_Crypto_Bot_Watched_Markets" AS market
JOIN missing_symbols USING (symbol)
ORDER BY market.symbol;
\o
\pset format aligned

COMMIT;

\echo 'Finished read-only precheck. Review the difference output and CSV files before any separate seeding approval.'
