# Supabase Column Storage Optimization Audit

## Conclusion

The configured Supabase connection's largest relations are `AI_Crypto_Bot_AI_Decisions` and `AI_Crypto_Bot_Candles`. Together they occupy 426,074,112 bytes, or 99.64% of the 18 project-prefixed table relations measured in this audit. The largest column opportunity is the compressed `AI_Crypto_Bot_AI_Decisions.indicators` JSONB payload, but the apparent savings from removing its detailed `timeframes` object are a low-confidence model, not a measured post-change size.

No schema change is both demonstrated to save material space and safe to make now. `marketStrength` is used by current dashboard/export behavior; other stored indicator sections support existing audit reports, database-mode parity tests, and future strategy/backtesting work. Retention and archiving remain unapproved roadmap proposals. This report recommends a non-production prototype and compatibility/parity testing only; it does not authorize or perform a schema or data change.

## Scope, identity, and confidence

- Read-only inspection used the configured Supabase SQL connection. At **2026-11-06 00:10 UTC**, it reported database `postgres`, role `supabase_read_only_user`, PostgreSQL `17.6`, and cluster `main`.
- The connection did not expose a Supabase project reference. The live measurements therefore describe the configured connection; its identity as the intended production project is **not independently confirmed**.
- The live schema was inspected through PostgreSQL catalogs and `information_schema`. Eleven local migration files were reviewed for stored-column declarations and relevant write logic. The available remote migration-list result did not establish a migration ledger, so local and remote migration histories could not be reconciled; that is not evidence that migrations were not applied.
- Relation byte sizes below are exact catalog measurements at the stated observation time. `n_live_tup` values are PostgreSQL estimates, not exact row counts. Small-table counts queried directly are exact. Large-table column distributions use bounded page samples and are explicitly labeled.
- `pg_total_relation_size` includes the table relation and its associated indexes/TOAST; those components are not separated or analyzed here. Index usage, `EXPLAIN` plans, and index-removal analysis were out of scope and were not repeated. The existing [candle query-plan report](./CANDLE_QUERY_PLAN_REPORT.md) and [checkpoint query review](./CHECKPOINT_QUERY_OPTIMIZATION_REVIEW.md) were used only as prior context.
- No raw production rows, credentials, or secrets were returned in the aggregate measurements.

## Current storage measurements

Catalog snapshot at **2026-11-06 00:14:46 UTC**:

| Scope | Bytes | Rows |
|---|---:|---:|
| Current database (`pg_database_size`) | 441,207,955 | — |
| All 18 `AI_Crypto_Bot_` table relations | 427,597,824 | — |
| `AI_Crypto_Bot_AI_Decisions` relation | 298,639,360 | 139,840 estimated |
| `AI_Crypto_Bot_Candles` relation | 127,434,752 | 515,247 estimated |
| Decisions plus candles | 426,074,112 | 655,087 estimated |

The two large relations account for **99.64%** of project-prefixed relation bytes. The table-size values are exact catalog results at the observation time; the tuple counts are `pg_stat_user_tables.n_live_tup` estimates. The database size and table-relation sum are different measures and should not be treated as a billable quota reading. The prior [retention assessment](./SUPABASE_DATA_RETENTION_AND_CLEANUP_ASSESSMENT.md) also cautions that the configured connection's project mapping and reported storage-panel figures could not be independently reconciled.

### AI decision columns

`AI_Crypto_Bot_AI_Decisions.indicators` is non-null JSONB. A **1% `TABLESAMPLE SYSTEM` sample at 2026-11-06 00:15:05 UTC** selected 1,364 rows:

| Measurement | Result | Classification |
|---|---:|---|
| `pg_column_size(indicators)` average | 1,458.8 B | Sampled stored-datum size |
| Median | 1,474.5 B | Sampled |
| p95 | 1,617.85 B | Sampled |
| Maximum | 1,727 B | Sampled |
| Sampled aggregate | 1,989,860 B | Exact for these 1,364 sampled rows |
| Estimated current column total | ~204.0 MB | Sample average × 139,840 estimated rows |

The estimated column total is not an exact whole-table sum. `pg_column_compression(indicators)` was non-null on all 1,364 sampled values, indicating that the measured values were stored with PostgreSQL compression.

The generated top-level sections and their sampled extracted sizes were:

| JSONB section | Average extracted `pg_column_size` | Interpretation |
|---|---:|---|
| `timeframes` | 3,933.6 B | Largest section; six interval records with candle counts/quality and trend, momentum, RSI, MACD, volume, and volatility details |
| `marketData` | 259.8 B | Snapshot availability, price, daily change, volume, high/low, range position, capture time, and staleness |
| `dataQuality` | 306.3 B | Available/required intervals, coverage, invalid/stale counts, and sufficiency flags |
| `marketStrength` | 21.8 B | Scalar analysis score |

These are sizes of extracted JSONB expressions, not exact on-disk attribution. They must not be summed to infer the stored column size; extraction materializes values, while the parent JSONB datum is compressed.

A separate sample projection measured an average expanded JSONB size of 4,588.4 B, versus 1,458.8 B stored. Removing `timeframes` from a sampled expression left 637.8 B expanded. Applying each row's observed whole-object compression ratio to that reduced expression estimates about **202.8 B stored per decision**, or **175.6 MB** across the current estimated row count. The raw JSON text representation was 84.5% smaller after removing that key. This is a **low-confidence compression-ratio model**, not a physical measurement of rewritten rows; the removed section's compressibility may differ from the whole-object ratio.

The same sequential model estimates 100.4 B/row after also removing `dataQuality` (an additional ~14.3 MB) and 13.3 B/row after also removing `marketData` (an additional ~12.2 MB). These estimates are order-dependent and must not be added as independent savings. Removing all three would also discard audit/test/report inputs; `marketStrength` must remain or be exposed through a compatible alternative.

Sampled decision text fields:

| Column | Average payload | Median | p95 | Maximum | Distinct / repetition |
|---|---:|---:|---:|---:|---|
| `reason` | 133.5 B | 136 B | 137 B | 137 B | 1,215 distinct in 1,364 rows; most common value appeared 21 times |
| `strategy_name` | 32 B payload; 33 B stored width | — | — | — | One distinct sampled value |
| `strategy_version` | 5 B payload; 6 B stored width | — | — | — | One distinct sampled value |

No reason strings or strategy names were returned. The high sampled reason cardinality argues against a simple repeated-string dictionary as a useful storage optimization.

### Candle columns

The live schema defines `open`, `high`, `low`, `close`, and `volume` as `numeric(28,12)`, with `symbol` and `interval` as `text`, and `timestamp` as `timestamptz`. A 1% page sample at **2026-11-06 00:17:25 UTC** contained 4,701 rows:

| Column(s) | Average stored bytes | Median | p95 | Maximum | Sample observations |
|---|---:|---:|---:|---:|---|
| Each OHLC numeric | 6.9 B | 7 B | 9 B | 9 B | Values collectively ranged from 0.000057 to 72,375; scale reached 12 |
| `volume` numeric | 9.3 B | 9 B | 11 B | 13 B | 0.00000353 to 227,500,759.3578986; scale reached 12 |
| `symbol` text | 8.6 B | 8 B | 11 B | 11 B | Maximum payload 10 bytes; 101 distinct symbols sampled |
| `interval` text | 3.1 B | 3 B | 4 B | 4 B | Maximum text payload 3 bytes; six distinct supported intervals sampled |
| `timestamp` | 8 B | 8 B | 8 B | 8 B | Fixed-size PostgreSQL timestamp datum |

These are sampled ranges and sizes, not whole-table minima/maxima. All sampled OHLCV values reached scale 12. The 28-digit precision also permits more integer digits than this sample observed; narrowing precision from sampled values alone is not justified.

### Other text and JSONB

- `AI_Crypto_Bot_Scanner_Events.reason`: exact aggregate over 46 rows; 7 distinct values, average 75.6 payload bytes, median/p95/maximum 76 bytes, and the most common value appeared 27 times. Its size is negligible at the current table count.
- `AI_Crypto_Bot_Status.error_message`: one exact row, currently null; zero stored message bytes.
- `AI_Crypto_Bot_Strategies.description` and `AI_Crypto_Bot_Strategy_Changes.reason`: zero rows at observation.
- `AI_Crypto_Bot_Shadow_Exit_Events.details`: exact 40-row aggregate, 2,212 bytes total, 55.3 B average, 79 B maximum.
- `AI_Crypto_Bot_Shadow_Exit_Scenarios.parameters`: exact 35-row aggregate, 5,260 bytes total, 150.3 B average, 164 B maximum.
- `AI_Crypto_Bot_Backtests.run_config`: zero rows at observation.

No other live JSONB/text column measured here materially contributes compared with decision indicators or candle history.

## Field-use and compatibility trace

| Field | Writers and readers | Classification |
|---|---|---|
| `indicators.timeframes` | Written by [`lib/ai-engine.mjs`](../../lib/ai-engine.mjs) and the database-analysis migration. The engine uses timeframe calculations before persistence; the paper-trading RPC does not read the stored JSON. Database migration tests assert the stored per-interval values, and the full indicator result is part of JavaScript/database parity checks. | Not read by current dashboard, scanner, Analytics, or CSV output after persistence; retained for decision audit, parity tests, and planned strategy/backtesting analysis. Not safe to remove without product approval and parity redesign. |
| `indicators.marketData` | Written by both analysis modes. Current UI/export code does not consume it, but [the open-position strategy/data audit](./OPEN_POSITION_STRATEGY_AND_DATA_AUDIT.md) queries historical `marketData.price` and `capturedAt` to assess stored decision marks. | Historical market context and audit input. Removing it would invalidate those report methods and lose the snapshot associated with a decision. |
| `indicators.dataQuality` | Written by both analysis modes. Current dashboard/export logic does not render it; database-mode tests inspect stale intervals and invalid-candle counts. The [production verification report](./AI_ANALYSIS_PRODUCTION_VERIFICATION_REPORT.md) uses `candleIntervalsAvailable`. | Diagnostic/audit and regression-test data. Its lack of a current dashboard reader is not evidence that it is disposable. |
| `indicators.marketStrength` | Read by [`api/dashboard-data.mjs`](../../api/dashboard-data.mjs) for open-position AI status and by [`lib/exports.mjs`](../../lib/exports.mjs) for the decisions CSV. It is also used in historical analysis reports. | Required for current dashboard and export behavior unless an equivalent compatible source is introduced. |
| Decision `reason` | Written by both analysis modes; read by dashboard decision history, scanner AI opportunities, and decisions CSV. Paper execution uses decision/action/confidence/timestamp, not the reason text. | Current UI/export explanatory content and audit record; not safe to discard. |
| `strategy_name`, `strategy_version` | Written as a decision-time snapshot. Read by [`lib/analytics.mjs`](../../lib/analytics.mjs) for strategy attribution and by dashboard decision history. Analytics exports include strategy-level outcomes. | Current Analytics input and immutable historical strategy identity. It is intentionally not a foreign key; catalog normalization would change the snapshot model. |
| Candle `symbol`, `interval`, OHLCV, `timestamp` | Validated and upserted by [`lib/market-data.mjs`](../../lib/market-data.mjs); read by [`lib/ai-engine.mjs`](../../lib/ai-engine.mjs), market/scanner views, and existing candle RPCs. The `(symbol, interval, timestamp)` key is also the current duplicate-safe candle identity/upsert contract. | Required for current analysis, market views, scanning, and future backtesting. Narrowing/remapping values requires compatibility tests across ingestion, RPCs, and financial calculations. |
| Status/error and other event text/JSONB | Status error text is written for AI failure reporting. Strategy descriptions/change reasons and backtest configuration are future-phase schema. Shadow scenario parameters are read by shadow-exit/dashboard flows; shadow event `details` are appended as audit data, and no current application read path was found. | Current low-volume operational state or planned/audit records; storage is immaterial today. |

The paper-trading SQL reads a decision's ID, symbol, action, confidence, and time; it does not consume `indicators` or `reason`. However, trades reference decision rows restrictively, and Analytics, exports, dashboard history, audit reports, and future simulation/backtesting use the stored history. Deleting decision rows is therefore not a safe storage shortcut.

## Ranked storage proposals

Ranked by estimated gross/current-payload savings, not by safety. Percentages use the 427,597,824-byte project-relation total as context; index changes are not evaluated.

| Rank | Proposal and estimated size | Savings timing | Effort | Behavior/data-loss risk | Confidence |
|---:|---|---|---|---|---|
| 1 | Remove or substantially compact `indicators.timeframes`: ~175.6 MB modeled savings (~41.1% of current project relation bytes); sampled extracted section averages 3,933.6 B. Additional sequential model estimates are ~14.3 MB for `dataQuality` and ~12.2 MB for `marketData`, but these are not independent/additive. | Smaller future rows; existing rows would need a rewrite to change their payload. Neither logical savings nor rewrite guarantees immediate filesystem/database-metric reduction. | High: versioned payload, JavaScript/SQL parity, tests, reports, and consumer review. | High: removes interval-level decision evidence and breaks current stored-output tests/report queries unless updated. | Low for physical bytes; medium for sample size. |
| 2 | Approve a hot-window plus archive/retrieval design. The prior **2026-11-05** assessment measured 60,886,256 tuple bytes for decisions older than three days (one was trade-referenced) and about 8.06 MB of candle tuple bytes older than 30 days. These are historical cohort payload sizes, not current relation savings. | Future growth only while archiving; database rows would leave PostgreSQL only after a separately approved, verified archive and retention policy. Physical size reduction is not guaranteed by ordinary deletion. | High: policy, archive format/integrity/restore, transparent reads for analytics/exports, and FK-aware handling. | Very high: can break decision audit, analytics/recommendations, and reproducible strategy/backtesting history. | Medium for the old measured cohorts; low for current savings. |
| 3 | Convert candle OHLCV to `real`: theoretical gross ~8.71 MB at current estimated rows (about 2.0% of project relation bytes), calculated from sampled numeric widths versus five 4-byte values. | Only after a full rewrite; this changes stored values. | High: financial precision, indicators, parity, and range validation. | Very high and unacceptable: `real` has roughly 7 significant decimal digits; sampled values use scale 12, including micro-priced assets and large volumes. | Medium for gross byte arithmetic; high confidence that it is unsafe. |
| 4 | Normalize repeated symbols to a new 2-byte key: ~4.33 MB gross heap-field savings using 8.6 B sampled symbol width and 655,425 estimated symbol-bearing rows. Replacing text with the existing watched-market UUID instead would add about 4.85 MB of heap-field bytes before other effects. | Requires rewriting affected rows and changing readers/writers. | High: mappings, foreign keys, joins, APIs, RPCs, conflict keys, and possible supporting indexes. | Medium/high: broad cross-table compatibility risk; net savings unknown after dimension/index costs. | Medium for gross estimates; low for net savings. |
| 5 | Replace repeated strategy snapshot text with an immutable strategy-version ID: about 3.22 MB gross if a 16-byte UUID replaces the sampled 33 B + 6 B stored widths; a 2-byte surrogate would gross about 5.17 MB before lookup/index costs. | One-time rewrite plus versioned dimension rows. | Medium/high: preserve version snapshots and update Analytics/history queries. | Medium/high: current strategy table is empty, while decisions already store historical identity independently. | Medium for gross field arithmetic; low for net savings. |
| 6 | Encode candle `interval` as a 2-byte code: about 0.57 MB gross at current estimated candle rows, before mapping/FK/index costs. | One-time rewrite and code-path changes. | Medium relative to the small saving. | Low/medium if all six values are mapped and validated; otherwise can break ingestion/RPC ordering. | Medium for gross estimate; low for worthwhile net benefit. |

The first row's model uses each sampled value's current stored-to-expanded JSONB ratio; it does not compress a rewritten payload and must not be treated as a production saving forecast. The storage distribution is exact only for the sample. The current average `indicators` column extrapolation is about 204.0 MB, which is an upper bound on what deleting that entire column could save at today's estimated row count, not a proposal to drop it.

## Safe candidates

There is **no immediate schema candidate** with both demonstrated material savings and no compatibility/audit risk. The safe near-term action is to retain the schema and benchmark a versioned compact payload outside the configured database. Keep `marketStrength`, historical market context, and quality fields available to existing consumers; do not rewrite or truncate current rows based solely on the model.

If a later approved design reduces new-row size, it should preserve old payload readability and prove equivalent decision outputs before rollout. Existing history should remain unchanged unless a separate archive/retention policy is approved.

## Candidates requiring compatibility and parity testing

- Any JSONB reshape/removal must compare the complete JavaScript and database analysis outputs on the same fixtures, preserve `marketStrength`, and update the database migration parity tests without weakening stale/invalid-data checks. Verify dashboard open-position status, scanner results, Analytics attribution, CSV exports, and historical report queries.
- Symbol or interval normalization must validate all enabled markets, every supported timeframe, upserts/duplicates, RPC tuple reconstruction, market disable behavior, and query/API response shapes. Estimate and measure lookup/FK/index overhead before claiming a net saving.
- Strategy snapshot normalization must retain immutable name/version values for historical decisions and preserve Analytics groupings when a strategy is renamed or superseded.
- Any retention/archive plan must maintain decision-to-trade references, dashboard/history access, the full 30/90/365-day Analytics and Recommendation windows, and future reproducible simulation/backtesting. The prior retention assessment documents the relevant foreign-key and history dependencies; no deletion was performed here.

## Not worthwhile or too risky

- **`TEXT` to `VARCHAR(n)`:** PostgreSQL stores these variable-length values the same way. A length limit saves no bytes and could reject future symbols, reasons, descriptions, or error text. Current sampled decision reasons peak at 137 bytes.
- **Text status/decision columns to enums:** The schema already constrains closed vocabularies with checks. PostgreSQL enums use 4 bytes; the decision text column's catalog average width is 4 bytes, and other status columns have very few rows. Any saving is negligible or absent while enum changes add migration rigidity.
- **Narrower numeric precision or floating point:** Scale 12 is present in the candle sample. `double precision` would average about 40 bytes for the five OHLCV values versus about 36.9 B sampled today, so it does not save space; it also cannot guarantee the exact decimal semantics of `numeric`. `real` has a gross saving estimate but would lose required precision. Do not narrow numeric types from a 1% sample.
- **Symbol to the existing UUID key:** The existing UUID is 16 bytes, larger than the sampled 8.6-byte text value, before joins and index costs. A compact integer key could save gross heap bytes, but requires a new mapping and broad schema/API/RPC changes; its net benefit is not demonstrated.
- **Reason dictionary:** Decision reasons have 1,215 distinct values in 1,364 sampled rows, so dictionary coding is unlikely to reduce much and would complicate user-facing reasons and audit history. Scanner-event reason text is only 46 rows.
- **Small JSONB/text tables:** Shadow details/parameters, status errors, strategy descriptions, and backtest configuration are currently tiny, null, or empty. Reworking them cannot materially reduce the measured footprint.
- **Timestamp narrowing:** `timestamptz` is an 8-byte value; `timestamp` without time zone is also 8 bytes and loses timezone semantics, while `date` would discard intraday candle time.

## Retention and archive constraints

The roadmap lists retention/archiving as backlog and requires preserving Analytics, Recommendations, Strategy Simulation, and Backtesting. Prior assessment values are historical candidates only, not current approved cutoffs. The prior assessment also found no implemented archive store, restore path, or transparent live/archive query layer. `AI_Crypto_Bot_Trades.ai_decision_id` restricts deletion of referenced decisions; candle and decision rows also reference watched markets. No table was deleted or archived.

The roadmap's database-capacity trigger cannot be confirmed from this connection: project identity and the storage-panel capacity/metric definition are unverified. Confirm those values before concluding that a retention threshold has been met.

## Measurement method

Large tables were not fully scanned for column distributions. Catalog metadata supplied relation sizes and estimated live rows; 1% `TABLESAMPLE SYSTEM` queries supplied bounded column samples. Small tables (35-46 rows) were aggregated exactly. `octet_length` measures UTF-8 payload length; `pg_column_size` measures PostgreSQL datum size. No raw text values were returned.

Representative read-only queries:

```sql
-- Exact relation bytes; live row counts are estimates.
SELECT c.relname,
       s.n_live_tup AS estimated_live_rows,
       pg_total_relation_size(c.oid) AS relation_bytes
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
LEFT JOIN pg_stat_user_tables AS s ON s.relid = c.oid
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'm')
  AND c.relname LIKE 'AI_Crypto_Bot_%';

-- Bounded decision indicator/reason sample; no raw values are selected.
SELECT count(*) AS sampled_rows,
       avg(pg_column_size(indicators)) AS avg_stored_bytes,
       percentile_cont(0.5) WITHIN GROUP
         (ORDER BY pg_column_size(indicators)) AS median_stored_bytes,
       percentile_cont(0.95) WITHIN GROUP
         (ORDER BY pg_column_size(indicators)) AS p95_stored_bytes,
       max(pg_column_size(indicators)) AS max_stored_bytes,
       avg(octet_length(reason)) AS avg_reason_payload_bytes,
       count(DISTINCT reason) AS distinct_reason_values
FROM public."AI_Crypto_Bot_AI_Decisions"
TABLESAMPLE SYSTEM (1) REPEATABLE (11062026);

-- Bounded candle precision/range and stored-width sample.
SELECT count(*) AS sampled_rows,
       avg(pg_column_size(open)) AS avg_open_bytes,
       avg(pg_column_size(volume)) AS avg_volume_bytes,
       min(LEAST(open, high, low, close)) AS sample_ohlc_min,
       max(GREATEST(open, high, low, close)) AS sample_ohlc_max,
       min(volume) AS sample_volume_min,
       max(volume) AS sample_volume_max,
       max(GREATEST(scale(open), scale(high), scale(low),
                    scale(close), scale(volume))) AS max_observed_scale
FROM public."AI_Crypto_Bot_Candles"
TABLESAMPLE SYSTEM (1) REPEATABLE (11062026);
```

The JSONB projection model additionally compared `pg_column_size(indicators)` with the expanded expression `pg_column_size(indicators || '{}'::jsonb)` and the reduced expression `pg_column_size(indicators - 'timeframes')`. It estimated a candidate compressed size by applying each sample row's current storage-to-expanded ratio to the reduced expression. This method quantifies a hypothesis only; it does not measure a stored rewritten row.

## Recommended next action

First confirm the Supabase project reference and the actual storage metric/capacity, then reconcile the live schema with an authoritative migration ledger. If storage reduction is still needed, prototype a versioned compact indicator representation in an isolated/staging database using the same PostgreSQL version and representative payloads. Measure the actual rewritten JSONB size and run parity checks across analysis, dashboard, scanner, Analytics, exports, reports, and the database RPC before requesting any production change. Retention/archiving requires a separate explicit policy, archive/restore validation, and approval.

**No production data, schema, settings, migrations, indexes, or deployments were changed.**
