# Full-History AI Analysis Export

## Change

The Exports page now presents a complete historical JSONL export as its sole
export UI. The browser requests one bounded page at a time from the existing
authenticated Pi dashboard-data route and writes the output into a user-selected
local folder. No new Vercel function, database object, write API, or automatic
AI upload was added.

The export contains all available system-portfolio trades, position rows,
recorded AI decisions, portfolio snapshots, shadow-exit scenarios and events,
and persisted analytics runs through one fixed `asOf` time. Candle data is
restricted to windows around every trade and decision timestamp: up to ten
candles before and ten after each unique symbol/timestamp for each of the six
supported intervals.

The folder contains a manifest and separate JSONL files per source; candle
anchors, unique candle rows, and anchor-to-candle links have separate files.
Candles are deduplicated by `(symbol, interval, timestamp)`, while link rows
retain the exact `(symbol, anchorAt, interval, candleTimestamp)` relationship
for AI analysis. Files are split at 5 MiB. Requests are sequential and limited
to 250 ordinary rows or ten candle anchors (at most 1,200 candle-window rows)
per page. The client honors `Retry-After`, supports cancellation,
records completed-source counts, and writes a partial/failed status to the
manifest when it can finalize the run.

All overlapping CSV and recommendation-history cards and their explanatory
copy were removed from the Exports page because the full-history JSONL bundle
already includes those analysis sources. Existing CSV API endpoints remain
available for compatibility; no endpoint or server-side export behavior was
removed.

## Limitations

- Candle history is not exported as a full table; only the documented
  trade/decision windows are included.
- Position rows reflect their stored current state, not a complete position
  state-change log.
- A fixed `asOf` boundary is not a transactionally consistent database
  snapshot. Mutable position/scenario rows can change during a long export.
- An interrupted export cannot resume. User cancellation writes a cancelled
  manifest, but abrupt browser/process termination can leave an in-progress
  manifest and partial files.
- If an individual record exceeds 5 MiB, the export fails instead of producing
  an oversized file.
- Saving a directory requires the browser File System Access API; the UI
  supports a current desktop Chromium browser.
- A Pi/Vercel production export has not been run or deployed from this change.

## Validation

| Check | Result |
|---|---|
| Focused export/API/repository/auth tests | Passed: 42 tests |
| Raspberry Pi package test suite | Passed: 214 tests |
| Root repository test suite | 382 passed, 1 failed. The remaining failure is the existing dashboard test expecting a `<section class="dashboard-panel shadow-exit-panel">`; `dashboard.html` uses a `<details>` element. The test also fails when run alone; the export change does not touch either file. |
| `npm.cmd run build` | Passed static project and database migration validation |
| `node --check` on changed JavaScript modules | Passed |
| `git diff --check` | Passed |

These are local results. Live Pi database performance, production proxy timing,
and supported-browser folder access remain unverified; no deployment was
performed.

## Export UI Cleanup Follow-up

The overlapping export cards and CSV-specific browser logic have since been
removed; the existing CSV API endpoints remain unchanged for compatibility.
After this UI-only change, `node --test tests/exports-ui.test.js` passed all
four tests, `node --check js/exports.js` passed, and `git diff --check` passed.

## Candle-Page Validation Fix

The browser previously required every source page to include `items`, while
the Pi API's `candleWindows` page correctly returns `anchors` and
`candleWindows` instead. This caused the export to fail as it advanced from
analytics runs to candle windows. The client now validates the source-specific
candle response shape, and the export test fixture matches the actual API
contract.

Validation after the fix: the export UI tests passed (4/4), the Pi API and
dashboard repository tests passed (31/31), `node --check js/exports.js` passed,
and `git diff --check` passed.

## Unique Candle Output

The export format is now v2. Candle OHLCV rows are written once per
`(symbol, interval, timestamp)` key, while `candle-window-links-*.jsonl` keeps
the exact relationship between each trade/decision anchor and its selected
candle timestamps. The manifest separates anchor, unique-candle, and
window-link counts; the progress display reports those counts separately.
The Pi API groups overlapping windows within each bounded page and returns
each candle once with its page-local anchor timestamps; the browser deduplicates
across pages. The query still evaluates the bounded per-anchor windows to find
their relationships, but it does not load or transmit the full candle table.

Earlier focused validation passed the export UI suite (4/4) and Raspberry Pi
repository/API/authentication suites (36/36). After adding page-level candle
aggregation, the export UI suite passed again (4/4) and the dashboard repository
suite passed (11/11). JavaScript syntax checks and `git diff --check` passed.

## Paper Execution Outcome Attribution (Format v3)

The full-history export now includes a `paperExecutionAttempts` JSONL source,
read through the same bounded, keyset-paginated dashboard-data API. It exports
each system-portfolio BUY/SELL evaluation through the fixed `asOf` timestamp,
including run/decision identity, confidence, outcome, reason code, timestamps,
and a trade ID when available (including a duplicate linked to its existing
trade). The browser's saved manifest records
the source count and filenames. The format is now
`cryptopulse-analysis-export-v3`; prior sources and candle file behavior are
retained.

The additive `phase-8.15-paper-execution-audit.sql` migration is a required
operator-applied Pi schema change. It has not been applied to a live database,
and this implementation did not deploy or validate a production export. Global
cycle skips before per-decision evaluation have no per-decision row; HOLD/WAIT
and automatic `ATR_TRAILING_EXIT` sells remain excluded.

Execution attempts are written in the paper-trade transaction, with unique
`(evaluation_run_id, portfolio_id, decision_id)` identity. A failed audit write
rolls back the transaction and fails the cycle rather than silently losing an
outcome. Later cycles receive a new run identity, preserving cooldown and other
repeat-evaluation outcomes.

Local follow-up validation: the focused paper-trading, schema-contract,
dashboard-repository, API/authentication, runtime-bootstrap, and export UI
tests passed (117/117); `npm.cmd run build`, changed-module `node --check`, and
`git diff --check` passed. The PGlite migration test does not modify the Pi
database, and no deployment or production export was performed.
