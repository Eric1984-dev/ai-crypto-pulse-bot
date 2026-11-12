# Phase 11 — Historical Analytics and AI Analysis Data Foundation

## Scope and architecture

This phase extends the Raspberry Pi backend only. The existing authenticated
Pi API remains the read-only interface for dashboard and operator data. It
continues to read PostgreSQL through the configured runtime database role.
Historical analytics are calculated on demand by the existing analytics
service and repository; no parallel scheduler or analytics pipeline was
introduced.

Persistence is an explicit operator action. `npm run analytics:generate`
reads through the existing read-only `DATABASE_USER` and writes a calculated
summary through a distinct, restricted `ANALYTICS_DATABASE_USER`. The existing
API role receives read-only access to the persisted run table. The paper
trading role receives no access to that table. The writer cannot read source
records, and the API does not write analytics history.

No frontend or dashboard UI was changed. The new API data is available for a
future approved interface, but a visible Agent Insights dashboard section is
not part of this phase.

## Existing functionality audited and reused

- Existing trade, market, AI-decision, confidence, strategy, portfolio,
  recommendation, and shadow-exit analytics remain the source of on-demand
  results. The existing recommendation generator is extended with historical
  comparison metadata rather than replaced.
- Existing authenticated read-only dashboard-data and CSV routes are reused;
  no new API function or database query endpoint was added.
- `analysis-bundle` is the canonical historical export for AI-assisted review.
  Existing analytics-summary, trade, portfolio, AI, and current
  recommendation CSV exports remain for compatibility. The
  `recommendation-history` CSV now exports persisted recommendation
  generations rather than recalculating recommendations.
- Raw trades, decisions, candles, and snapshots are not copied into analytics
  history. They remain source records and are selected into a bounded bundle
  only when requested.

## Analytics definitions and limitations

All analytics windows are rolling UTC windows ending at the generation time;
the supported windows are 30, 90, and 365 days. Source counts and truncation
indicators accompany the calculations.

### Trade and portfolio performance

- A closed trade is represented by a `SELL` trade row. Win/loss rates,
  average win/loss, profit factor, expectancy, trade count, market results,
  and realized P&L use those SELL rows in the selected window. Breakeven rows
  remain in the rate denominator. Expectancy is
  `win rate × average win + loss rate × average loss`; breakeven contributes
  zero.
- Realized P&L uses the stored `realized_pnl`. The paper engine already
  accounts for fees and execution slippage in this value. Fees and slippage
  are also reported separately and are not deducted a second time. No
  independent spread field is available in these source records.
- Profit factor is gross winning realized P&L divided by absolute gross losing
  realized P&L. It is `null` when there are no losses, with an explicit status.
  Risk/reward is average win divided by the absolute average loss and is
  `null` when either side is unavailable.
- Current unrealized P&L is the sum for currently open positions. Lifetime
  total P&L is current portfolio value minus starting balance. These values
  are labelled separately from windowed realized P&L.
- Period portfolio P&L and drawdown use stored portfolio snapshots. The last
  snapshot before the window is used as a baseline when available; otherwise
  status identifies the available sample as incomplete. Drawdown cannot
  describe movements between snapshots.
- Per-market win rate, realized P&L, and trade counts use closed SELL rows.
  Best/worst rankings are descriptive and do not imply future performance.
- Strategy-version metrics include linked closed-trade count, win rate,
  profit factor, expectancy, realized P&L, and observed drawdown. Comparisons
  are produced only when each version has at least five linked closed
  outcomes. These results depend on the strategy identity available through
  linked AI decisions.

### AI decisions and indicators

- Decision counts and confidence groupings cover all valid stored decisions
  in the selected window. Confidence intervals are non-overlapping:
  `[50,60)`, `[60,70)`, `[70,80)`, `[80,90)`, and `[90,100]`. Values outside
  `[0,100]` are reported as data-quality counts and are not silently
  reassigned.
- BUY outcomes are attributed only when the BUY decision is linked to a BUY
  trade and an in-window FIFO trade sequence matches its quantity to later
  SELL rows. Entries outside the available window or unmatched quantities are
  not attributed. SELL outcomes require a linked SELL decision. HOLD and WAIT
  decisions are reported separately and receive no realized-trade P&L.
- EMA, RSI, and MACD statistics group recorded indicator values by linked
  closed-trade outcome, market, strategy/version, and timeframe when present.
  They are descriptive associations, not causal evidence.

### Shadow exits

Shadow-exit analysis reuses stored scenario and event data. Scenario outcomes
are compared with actual closures only when both modeled and actual net P&L
are available. Results include sample counts and sample-size indicators;
small samples are not presented as reliable effectiveness. A direct
scenario-to-strategy-version attribution is unavailable in the source schema
and is identified as such. Shadow analytics are advisory and cannot select or
activate an exit strategy.

## Insights and persistence

Recommendations are generated by the existing recommendation service and
remain advisory. Each generated recommendation records its analysis period,
generation time, supporting sample size and metrics, confidence-level basis,
historical trend direction, limitations, and calculation version. The
confidence level is a sample-size heuristic, not a statistical probability or
confidence interval. No recommendation is applied automatically.

The migration `migrations/phase-11-analytics-history.sql` creates the
prefixed table `AI_Crypto_Bot_Analytics_Runs` and a generated-time index.
The table stores calculation version, period boundaries, generation time,
source counts, analytics summary, and insights. It stores no duplicate raw
market or trading history. Run IDs and a unique calculation-version/window
constraint make retries of the same window idempotent.

The migration validates the configured API, analytics-writer, and
paper-trading roles, and grants the API role `SELECT` and the writer role
`INSERT` only on the new table. It intentionally fails on table or index
collisions; inspect existing schema objects rather than converting it to an
`IF NOT EXISTS` migration. Apply it as the schema owner using the procedure
in the Raspberry Pi README, then configure the distinct analytics writer
credentials before manually generating a run.

Retention is indefinite. No automatic pruning or scheduled generation is
configured; an operator may generate a run explicitly with
`npm run analytics:generate -- --period=30d`. A fixed UTC `--as-of` timestamp
supports a reproducible retry key.

## Analysis bundle and API contracts

The authenticated, read-only existing
`GET /api/v1/dashboard-data?view=analysis-bundle&period=30d&limit=500` route
returns analytics, prior run history, linked trades and decisions, portfolio
snapshots, shadow-exit summaries/events, and decision/trade-anchored candle
windows. Its manifest records the requested UTC window, generation time,
calculation version, active markets, strategy versions, PAPER mode, risk
settings, source/included counts, limits, and truncation flags.

The bundle accepts at most 1,000 decision rows, 1,000 rows for each other
source, 50 candle anchors, up to 20 candles per interval per anchor across
six intervals, and 6,000 candle rows. Trade-linked decisions are selected
first; remaining decision capacity is filled deterministically, one row at a
time across combined strata keyed by UTC day, market, action, confidence band, strategy
name, and strategy version. The manifest records the method, counts,
unresolved trade-decision links, truncation, and the sampled distribution for
each dimension. Candle anchors for trades and linked decisions have priority
over sampled-decision anchors. The manifest reports any omitted anchors.
Only bounded candle windows around selected decisions and trades are
included, and future candle rows are excluded. The response is generated
from current source data and does not provide arbitrary SQL access.

The existing
`GET /api/v1/dashboard-data?view=analytics-history&period=30d` route returns
bounded persisted-run history. Existing analytics and recommendations
routes remain read-only. CSV analytics exports remain for compatibility;
`recommendation-history` reads persisted generated insights. The JSON
analysis bundle is the preferred export for historical AI-assisted analysis.
No credentials, session tokens, cookies, or unnecessary personal data are
included.

## Validation results

Checks executed in the development workspace:

- Raspberry Pi full test suite: **208 passed, 0 failed**.
- Targeted analytics, repository, API, migration, and contract tests passed
  before the full suite. The suite includes PGlite migration/role checks,
  analytics boundary and insufficient-data checks, and bundle limit tests.
- JavaScript syntax validation: **95 source and test files passed**.
- `git diff --check`: passed.

The Phase 11 migration was exercised against local PGlite test databases,
including idempotent persistence and role separation. No production database
was accessed, no production migration was applied, and no deployment or
runtime behavior was claimed or verified.

## Known limitations and remaining risks

- Production migration application, role grants, and API responses remain
  unverified until the operator applies and validates them on the Raspberry
  Pi PostgreSQL instance.
- Analytics generation is manual and is not scheduled. Persisted runs remain
  indefinitely until an explicitly reviewed retention policy is introduced.
- Detailed analytics and exports are bounded; truncation or insufficient
  source data must be considered when interpreting results.
- BUY attribution cannot reliably include entries before the selected
  window. Strategy-version attribution relies on linked decision records;
  shadow-exit strategy-version attribution is unavailable.
- Snapshot-derived drawdown omits unobserved intra-snapshot movement.
  Indicator associations, recommendations, and small-sample comparisons are
  not causal or statistically conclusive.
- This phase adds API contracts and data only; it does not add a visible
  dashboard interface.

## Readiness assessment

The backend implementation and local validation are complete for Phase 11.
It is ready for operator review and controlled production migration
validation, but production readiness is **not verified** until the migration,
role configuration, and authenticated API responses are checked on the Pi.
No future phase was started.
