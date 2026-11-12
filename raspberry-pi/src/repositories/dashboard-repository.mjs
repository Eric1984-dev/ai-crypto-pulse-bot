import {
  queryReadOnly,
  readFiniteNumber,
  RepositoryDataError,
  readTimestamp
} from "./postgres-read.mjs";
import { SYSTEM_PROFILE_ID } from "./paper-trading-repository.mjs";
import {
  buildDashboardAnalytics,
  SUPPORTED_DASHBOARD_ANALYTICS_PERIODS
} from "../services/dashboard-analytics.mjs";

const MAX_ANALYTICS_ROWS = 10000;
const MAX_EXPORT_ROWS = 10000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONFIDENCE_BAND_LABELS = Object.freeze([
  "[50,60)", "[60,70)", "[70,80)", "[80,90)", "[90,100]"
]);

const PORTFOLIO_SQL = `
  SELECT portfolio.id,
         portfolio.starting_balance,
         portfolio.available_balance,
         portfolio.portfolio_value,
         portfolio.created_at
  FROM public."AI_Crypto_Bot_Profiles" AS profile
  JOIN public."AI_Crypto_Bot_Portfolios" AS portfolio
    ON portfolio.user_id = profile.id
  WHERE profile.id = $1::uuid
  ORDER BY portfolio.created_at ASC, portfolio.id ASC
  LIMIT 2
`;

const OPEN_POSITIONS_SQL = `
  SELECT position.id,
         position.symbol,
         position.amount,
         position.entry_price,
         position.current_price,
         position.unrealized_pnl,
         position.status,
         position.created_at,
         market_data.price AS current_market_price,
         market_data.captured_at AS current_market_captured_at,
         latest_decision.decision AS latest_ai_decision,
         latest_decision.confidence AS latest_ai_confidence,
         latest_decision.reason AS latest_ai_reason,
         latest_decision.indicators AS latest_ai_indicators,
         latest_decision.created_at AS latest_ai_created_at
  FROM public."AI_Crypto_Bot_Positions" AS position
  LEFT JOIN public."AI_Crypto_Bot_Market_Data" AS market_data
    ON market_data.symbol = position.symbol
  LEFT JOIN LATERAL (
    SELECT decision.decision, decision.confidence, decision.reason,
           decision.indicators, decision.created_at
    FROM public."AI_Crypto_Bot_AI_Decisions" AS decision
    WHERE decision.symbol = position.symbol
    ORDER BY decision.created_at DESC, decision.id DESC
    LIMIT 1
  ) AS latest_decision ON TRUE
  WHERE position.portfolio_id = $1::uuid
    AND position.status = 'OPEN'
  ORDER BY position.created_at DESC, position.id DESC
  LIMIT 50
`;

const RECENT_TRADES_SQL = `
  SELECT id, symbol, side, price, quantity, fees, realized_pnl, created_at
  FROM public."AI_Crypto_Bot_Trades"
  WHERE portfolio_id = $1::uuid
  ORDER BY created_at DESC, id DESC
  LIMIT $2
`;

const PORTFOLIO_SNAPSHOTS_SQL = `
  SELECT id, portfolio_id, portfolio_value, available_balance,
         open_positions, captured_at
  FROM public."AI_Crypto_Bot_Portfolio_Snapshots"
  WHERE portfolio_id = $1::uuid
  ORDER BY captured_at DESC, id DESC
  LIMIT $2
`;

const PORTFOLIO_METRICS_SQL = `
  SELECT
    COALESCE(SUM(trade.realized_pnl) FILTER (WHERE trade.side = 'SELL'), 0) AS realized_pnl,
    COUNT(*) FILTER (WHERE trade.side = 'SELL' AND trade.realized_pnl > 0)::integer AS wins,
    COUNT(*) FILTER (WHERE trade.side = 'SELL')::integer AS closed_trades,
    COUNT(*)::integer AS trade_count,
    COALESCE(SUM(trade.realized_pnl) FILTER (
      WHERE trade.side = 'SELL' AND trade.created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    ), 0) AS daily_pnl,
    COUNT(*) FILTER (
      WHERE trade.side = 'SELL' AND trade.created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    )::integer AS daily_pnl_trade_count
  FROM public."AI_Crypto_Bot_Trades" AS trade
  WHERE trade.portfolio_id = $1::uuid
`;

const LATEST_EMERGENCY_SQL = `
  SELECT status, reason, created_at
  FROM public."AI_Crypto_Bot_Emergency_State"
  ORDER BY created_at DESC, id DESC
  LIMIT 1
`;
const SHADOW_EXIT_SCENARIOS_SQL = `
  SELECT position.id AS position_id,
         position.symbol,
         position.status AS position_status,
         position.created_at AS position_opened_at,
         scenario.id AS scenario_id,
         scenario.rule_id,
         scenario.rule_version,
         scenario.parameters,
         scenario.status AS scenario_status,
         scenario.data_quality_status,
         scenario.tracking_started_at,
         scenario.last_evaluated_at,
         scenario.last_mark,
         scenario.last_mark_captured_at,
         scenario.high_water_mark,
         scenario.trailing_armed,
         scenario.activated_at,
         scenario.triggered_at,
         scenario.trigger_mark,
         scenario.modeled_exit_price,
         scenario.modeled_net_pnl,
         scenario.actual_closed_at,
         scenario.actual_close_price,
         scenario.actual_net_pnl,
         COALESCE(recent_events.events, '[]'::jsonb) AS events
  FROM public."AI_Crypto_Bot_Positions" AS position
  LEFT JOIN public."AI_Crypto_Bot_Shadow_Exit_Scenarios" AS scenario
    ON scenario.position_id = position.id
  LEFT JOIN LATERAL (
    SELECT pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'event_type', event.event_type,
               'event_at', event.event_at,
               'observed_mark', event.observed_mark,
               'data_quality_status', event.data_quality_status,
               'error_code', event.error_code
             )
             ORDER BY event.event_at ASC, event.id ASC
           ) AS events
    FROM (
      SELECT id, event_type, event_at, observed_mark, data_quality_status, error_code
      FROM public."AI_Crypto_Bot_Shadow_Exit_Events"
      WHERE scenario_id = scenario.id
      ORDER BY event_at DESC, id DESC
      LIMIT 10
    ) AS event
  ) AS recent_events ON TRUE
  WHERE position.portfolio_id = $1::uuid
    AND (
      position.status = 'OPEN'
      OR scenario.actual_closed_at >= pg_catalog.now() - INTERVAL '30 days'
    )
  ORDER BY position.created_at DESC, scenario.rule_id ASC NULLS LAST
  LIMIT $2
`;
const ANALYTICS_POSITIONS_SQL = `
  SELECT symbol, status, unrealized_pnl
  FROM public."AI_Crypto_Bot_Positions"
  WHERE portfolio_id = $1::uuid
  ORDER BY created_at ASC, id ASC
  LIMIT $2
`;
const ANALYTICS_TRADES_SQL = `
  SELECT id, ai_decision_id, symbol, side, price, quantity, fees, slippage,
         realized_pnl, created_at
  FROM public."AI_Crypto_Bot_Trades"
  WHERE portfolio_id = $1::uuid
    AND created_at >= $2::timestamptz
    AND created_at <= $3::timestamptz
  ORDER BY symbol ASC, created_at ASC, id ASC
  LIMIT $4
`;
const ANALYTICS_DECISION_SUMMARY_SQL = `
  WITH decisions AS MATERIALIZED (
    SELECT symbol, decision, confidence, strategy_name, strategy_version
    FROM public."AI_Crypto_Bot_AI_Decisions"
    WHERE created_at >= $1::timestamptz
      AND created_at <= $2::timestamptz
  )
  SELECT 'total'::text AS dimension, NULL::text AS label, COUNT(*)::text AS decision_count
  FROM decisions
  UNION ALL
  SELECT 'below50', NULL::text, COUNT(*)::text
  FROM decisions
  WHERE confidence < 50
  UNION ALL
  SELECT 'below70', NULL::text, COUNT(*)::text
  FROM decisions
  WHERE confidence < 70
  UNION ALL
  SELECT 'invalid', NULL::text, COUNT(*)::text
  FROM decisions
  WHERE decision IS NULL
     OR decision NOT IN ('BUY', 'SELL', 'HOLD', 'WAIT')
     OR confidence IS NULL
     OR confidence < 0
     OR confidence > 100
     OR symbol IS NULL
     OR symbol = ''
     OR ((strategy_name IS NULL) <> (strategy_version IS NULL))
     OR strategy_name = ''
     OR strategy_version = ''
  UNION ALL
  SELECT 'action', decision, COUNT(*)::text
  FROM decisions
  GROUP BY decision
  UNION ALL
  SELECT
    'confidence',
    CASE
      WHEN confidence < 60 THEN '[50,60)'
      WHEN confidence < 70 THEN '[60,70)'
      WHEN confidence < 80 THEN '[70,80)'
      WHEN confidence < 90 THEN '[80,90)'
      ELSE '[90,100]'
    END,
    COUNT(*)::text
  FROM decisions
  WHERE confidence >= 50 AND confidence <= 100
  GROUP BY 2
  UNION ALL
  SELECT
    'confidence-action',
    decision || '|' || CASE
      WHEN confidence < 60 THEN '[50,60)'
      WHEN confidence < 70 THEN '[60,70)'
      WHEN confidence < 80 THEN '[70,80)'
      WHEN confidence < 90 THEN '[80,90)'
      ELSE '[90,100]'
    END,
    COUNT(*)::text
  FROM decisions
  WHERE confidence >= 50 AND confidence <= 100
  GROUP BY decision, 2
  UNION ALL
  SELECT
    'legacy-confidence',
    CASE
      WHEN confidence < 75 THEN '70–75'
      WHEN confidence < 80 THEN '75–80'
      WHEN confidence < 85 THEN '80–85'
      ELSE '85+'
    END,
    COUNT(*)::text
  FROM decisions
  WHERE confidence >= 70 AND confidence <= 100
  GROUP BY 2
  UNION ALL
  SELECT 'strategy', strategy_name || ' · ' || strategy_version, COUNT(*)::text
  FROM decisions
  WHERE strategy_name IS NOT NULL AND strategy_version IS NOT NULL
  GROUP BY strategy_name, strategy_version
  UNION ALL
  SELECT
    'strategy-version',
    strategy_name || ' · ' || strategy_version,
    COUNT(*)::text
  FROM decisions
  WHERE strategy_name IS NOT NULL AND strategy_version IS NOT NULL
  GROUP BY strategy_name, strategy_version
  UNION ALL
  SELECT 'symbol', symbol, COUNT(*)::text
  FROM decisions
  GROUP BY symbol
`;
const ANALYTICS_LINKED_DECISIONS_SQL = `
  SELECT id, symbol, decision, confidence, indicators,
         strategy_name, strategy_version, created_at
  FROM public."AI_Crypto_Bot_AI_Decisions"
  WHERE id = ANY($1::uuid[])
    AND created_at >= $2::timestamptz
    AND created_at <= $3::timestamptz
  ORDER BY symbol ASC, created_at ASC, id ASC
  LIMIT $4
`;
const ANALYTICS_SNAPSHOTS_SQL = `
  WITH period_snapshots AS (
    SELECT id, portfolio_id, portfolio_value, available_balance, open_positions, captured_at
    FROM public."AI_Crypto_Bot_Portfolio_Snapshots"
    WHERE portfolio_id = $1::uuid
      AND captured_at >= $2::timestamptz
      AND captured_at <= $3::timestamptz
    ORDER BY captured_at ASC, id ASC
    LIMIT $4
  ),
  baseline_snapshot AS (
    SELECT id, portfolio_id, portfolio_value, available_balance, open_positions, captured_at
    FROM public."AI_Crypto_Bot_Portfolio_Snapshots"
    WHERE portfolio_id = $1::uuid
      AND captured_at < $2::timestamptz
    ORDER BY captured_at DESC, id DESC
    LIMIT 1
  )
  SELECT * FROM baseline_snapshot
  UNION ALL
  SELECT * FROM period_snapshots
  ORDER BY captured_at ASC, id ASC
  LIMIT $5
`;
const ANALYTICS_SOURCE_COUNTS_SQL = `
  SELECT
    (SELECT COUNT(*) FROM public."AI_Crypto_Bot_Positions"
     WHERE portfolio_id = $1::uuid)::text AS positions,
    (SELECT COUNT(*) FROM public."AI_Crypto_Bot_Trades"
     WHERE portfolio_id = $1::uuid
       AND created_at >= $2::timestamptz AND created_at <= $3::timestamptz)::text
      AS trades,
    (SELECT COUNT(*) FROM public."AI_Crypto_Bot_AI_Decisions"
     WHERE created_at >= $2::timestamptz AND created_at <= $3::timestamptz)::text
      AS decisions,
    (SELECT COUNT(*) FROM public."AI_Crypto_Bot_Portfolio_Snapshots"
     WHERE portfolio_id = $1::uuid
       AND captured_at >= $2::timestamptz AND captured_at <= $3::timestamptz)::text
      AS snapshots,
    (SELECT COUNT(*) FROM public."AI_Crypto_Bot_Shadow_Exit_Scenarios" AS scenario
     WHERE scenario.portfolio_id = $1::uuid
       AND (
         scenario.position_opened_at BETWEEN $2::timestamptz AND $3::timestamptz
         OR scenario.actual_closed_at BETWEEN $2::timestamptz AND $3::timestamptz
         OR scenario.last_evaluated_at BETWEEN $2::timestamptz AND $3::timestamptz
       ))::text AS shadow_exit_scenarios,
    (SELECT COUNT(*) FROM public."AI_Crypto_Bot_Shadow_Exit_Events" AS event
     JOIN public."AI_Crypto_Bot_Shadow_Exit_Scenarios" AS scenario
       ON scenario.id = event.scenario_id
     WHERE scenario.portfolio_id = $1::uuid
       AND event.event_at >= $2::timestamptz AND event.event_at <= $3::timestamptz)::text
      AS shadow_exit_events
`;
const ANALYTICS_SHADOW_EXIT_SQL = `
  SELECT scenario.symbol,
         scenario.rule_id,
         scenario.rule_version,
         scenario.status,
         scenario.data_quality_status,
         scenario.modeled_net_pnl,
         scenario.actual_net_pnl,
         scenario.actual_closed_at,
         scenario.position_opened_at
  FROM public."AI_Crypto_Bot_Shadow_Exit_Scenarios" AS scenario
  WHERE scenario.portfolio_id = $1::uuid
    AND (
      scenario.position_opened_at BETWEEN $2::timestamptz AND $3::timestamptz
      OR scenario.actual_closed_at BETWEEN $2::timestamptz AND $3::timestamptz
      OR scenario.last_evaluated_at BETWEEN $2::timestamptz AND $3::timestamptz
    )
  ORDER BY scenario.symbol ASC, scenario.rule_id ASC, scenario.position_opened_at ASC
  LIMIT $4
`;
const ANALYTICS_RUN_HISTORY_SQL = `
  SELECT id, calculation_version, period, period_start, period_end, generated_at,
         source_counts, analytics_summary, insights
  FROM public."AI_Crypto_Bot_Analytics_Runs"
  WHERE generated_at >= $1::timestamptz
    AND generated_at <= $2::timestamptz
  ORDER BY generated_at DESC, id DESC
  LIMIT $3
`;
const RECOMMENDATION_HISTORY_COUNT_SQL = `
  WITH recent_runs AS (
    SELECT insights
    FROM public."AI_Crypto_Bot_Analytics_Runs"
    WHERE generated_at >= $1::timestamptz
      AND generated_at <= $2::timestamptz
    ORDER BY generated_at DESC, id DESC
    LIMIT $3
  )
  SELECT COALESCE(SUM(
           CASE
             WHEN pg_catalog.jsonb_typeof(insights -> 'recommendations') = 'array'
             THEN pg_catalog.jsonb_array_length(insights -> 'recommendations')
             ELSE 0
           END
         ), 0)::text AS recommendation_count,
         (
           SELECT COUNT(*) FROM public."AI_Crypto_Bot_Analytics_Runs"
           WHERE generated_at >= $1::timestamptz
             AND generated_at <= $2::timestamptz
         ) > COUNT(*) AS truncated
  FROM recent_runs
`;
const LATEST_ANALYTICS_RUN_SQL = `
  SELECT id, calculation_version, period, period_start, period_end, generated_at,
         source_counts, analytics_summary, insights
  FROM public."AI_Crypto_Bot_Analytics_Runs"
  WHERE period = $1::text
    AND period_end < $2::timestamptz
  ORDER BY period_end DESC, generated_at DESC, id DESC
  LIMIT 1
`;
const BUNDLE_TRADES_SQL = `
  SELECT id, ai_decision_id, symbol, side, price, quantity, fees, slippage,
         realized_pnl, created_at
  FROM public."AI_Crypto_Bot_Trades"
  WHERE portfolio_id = $1::uuid
    AND created_at >= $2::timestamptz
    AND created_at <= $3::timestamptz
  ORDER BY created_at ASC, id ASC
  LIMIT $4
`;
const BUNDLE_DECISIONS_SQL = `
  WITH decision_population AS MATERIALIZED (
    SELECT decision.id, decision.symbol, decision.decision, decision.confidence,
           decision.indicators, decision.reason, decision.strategy_name,
           decision.strategy_version, decision.created_at,
           (decision.created_at AT TIME ZONE 'UTC')::date AS utc_day,
           CASE
             WHEN decision.confidence < 50 THEN '[0,50)'
             WHEN decision.confidence < 60 THEN '[50,60)'
             WHEN decision.confidence < 70 THEN '[60,70)'
             WHEN decision.confidence < 80 THEN '[70,80)'
             WHEN decision.confidence < 90 THEN '[80,90)'
             ELSE '[90,100]'
           END AS confidence_band
    FROM public."AI_Crypto_Bot_AI_Decisions" AS decision
    WHERE decision.created_at >= $1::timestamptz
      AND decision.created_at <= $2::timestamptz
      AND NOT (decision.id = ANY($3::uuid[]))
  ),
  stratified_decisions AS (
    SELECT decision_population.*,
           pg_catalog.row_number() OVER (
             PARTITION BY utc_day, symbol, decision, confidence_band,
                          strategy_name, strategy_version
             ORDER BY created_at ASC, id ASC
           ) AS stratum_rank,
           pg_catalog.md5(pg_catalog.jsonb_build_array(
             utc_day, symbol, decision, confidence_band, strategy_name, strategy_version
           )::text) AS stratum_order
    FROM decision_population
  )
  SELECT id, symbol, decision, confidence, indicators, reason,
         strategy_name, strategy_version, created_at
  FROM stratified_decisions
  ORDER BY stratum_rank ASC, stratum_order ASC, created_at ASC, id ASC
  LIMIT $4
`;
const BUNDLE_LINKED_DECISIONS_SQL = `
  SELECT id, symbol, decision, confidence, indicators, reason,
         strategy_name, strategy_version, created_at
  FROM public."AI_Crypto_Bot_AI_Decisions"
  WHERE id = ANY($1::uuid[])
  ORDER BY created_at ASC, id ASC
  LIMIT $2
`;
const BUNDLE_SNAPSHOTS_SQL = `
  SELECT id, portfolio_id, portfolio_value, available_balance, open_positions, captured_at
  FROM public."AI_Crypto_Bot_Portfolio_Snapshots"
  WHERE portfolio_id = $1::uuid
    AND captured_at >= $2::timestamptz
    AND captured_at <= $3::timestamptz
  ORDER BY captured_at ASC, id ASC
  LIMIT $4
`;
const BUNDLE_SHADOW_SCENARIOS_SQL = `
  SELECT scenario.id, scenario.position_id, scenario.symbol, scenario.rule_id,
         scenario.rule_version, scenario.parameters, scenario.status,
         scenario.data_quality_status, scenario.position_opened_at,
         scenario.tracking_started_at, scenario.triggered_at,
         scenario.modeled_exit_price, scenario.modeled_net_pnl,
         scenario.actual_closed_at, scenario.actual_close_price, scenario.actual_net_pnl
  FROM public."AI_Crypto_Bot_Shadow_Exit_Scenarios" AS scenario
  WHERE scenario.portfolio_id = $1::uuid
    AND (
      scenario.position_opened_at BETWEEN $2::timestamptz AND $3::timestamptz
      OR scenario.actual_closed_at BETWEEN $2::timestamptz AND $3::timestamptz
      OR scenario.last_evaluated_at BETWEEN $2::timestamptz AND $3::timestamptz
    )
  ORDER BY scenario.position_opened_at ASC, scenario.id ASC
  LIMIT $4
`;
const BUNDLE_SHADOW_EVENTS_SQL = `
  SELECT id, scenario_id, event_type, event_at, observed_mark,
         data_quality_status, error_code
  FROM public."AI_Crypto_Bot_Shadow_Exit_Events"
  WHERE scenario_id = ANY($1::uuid[])
    AND event_at >= $2::timestamptz
    AND event_at <= $3::timestamptz
  ORDER BY event_at ASC, id ASC
  LIMIT $4
`;
const BUNDLE_CANDLES_SQL = `
  WITH anchors AS (
    SELECT refs.symbol, refs.anchor_at, intervals.interval
    FROM pg_catalog.jsonb_to_recordset($1::jsonb)
      AS refs(symbol text, anchor_at timestamptz)
    CROSS JOIN pg_catalog.unnest(
      ARRAY['1m', '5m', '15m', '1h', '4h', '1d']::text[]
    ) AS intervals(interval)
  )
  SELECT anchors.symbol, anchors.interval, anchors.anchor_at,
         candle.open, candle.high, candle.low, candle.close, candle.volume, candle.timestamp
  FROM anchors
  CROSS JOIN LATERAL (
    SELECT window_candle.open, window_candle.high, window_candle.low,
           window_candle.close, window_candle.volume, window_candle.timestamp
    FROM (
      (
        SELECT source.open, source.high, source.low, source.close, source.volume, source.timestamp
        FROM public."AI_Crypto_Bot_Candles" AS source
        WHERE source.symbol = anchors.symbol
          AND source.interval = anchors.interval
          AND source.timestamp <= anchors.anchor_at
        ORDER BY source.timestamp DESC
        LIMIT ($2::integer / 2)
      )
      UNION ALL
      (
        SELECT source.open, source.high, source.low, source.close, source.volume, source.timestamp
        FROM public."AI_Crypto_Bot_Candles" AS source
        WHERE source.symbol = anchors.symbol
          AND source.interval = anchors.interval
          AND source.timestamp > anchors.anchor_at
          AND source.timestamp <= $4::timestamptz
        ORDER BY source.timestamp ASC
        LIMIT ($2::integer / 2)
      )
    ) AS window_candle
  ) AS candle
  ORDER BY anchors.anchor_at ASC, anchors.symbol ASC, anchors.interval ASC, candle.timestamp ASC
  LIMIT $3
`;
const BUNDLE_SOURCE_COUNTS_SQL = `
  SELECT
    (SELECT COUNT(*) FROM public."AI_Crypto_Bot_Trades"
     WHERE portfolio_id = $1::uuid AND created_at >= $2::timestamptz
       AND created_at <= $3::timestamptz)::text AS trades,
    (SELECT COUNT(*) FROM public."AI_Crypto_Bot_AI_Decisions"
     WHERE created_at >= $2::timestamptz AND created_at <= $3::timestamptz)::text
       AS decisions,
    (SELECT COUNT(*) FROM public."AI_Crypto_Bot_Portfolio_Snapshots"
     WHERE portfolio_id = $1::uuid AND captured_at >= $2::timestamptz
       AND captured_at <= $3::timestamptz)::text AS snapshots,
    (SELECT COUNT(*) FROM public."AI_Crypto_Bot_Shadow_Exit_Scenarios"
     WHERE portfolio_id = $1::uuid AND (
       position_opened_at BETWEEN $2::timestamptz AND $3::timestamptz
       OR actual_closed_at BETWEEN $2::timestamptz AND $3::timestamptz
       OR last_evaluated_at BETWEEN $2::timestamptz AND $3::timestamptz
     ))::text AS shadow_exit_scenarios,
    (SELECT COUNT(*) FROM public."AI_Crypto_Bot_Shadow_Exit_Events" AS event
     JOIN public."AI_Crypto_Bot_Shadow_Exit_Scenarios" AS scenario
       ON scenario.id = event.scenario_id
     WHERE scenario.portfolio_id = $1::uuid
       AND event.event_at >= $2::timestamptz AND event.event_at <= $3::timestamptz)::text
       AS shadow_exit_events
`;
const MONITORING_SQL = `
  SELECT
    pg_database_size(current_database())::text AS database_size_bytes,
    COALESCE((
      SELECT n_live_tup
      FROM pg_stat_user_tables
      WHERE schemaname = 'public' AND relname = 'AI_Crypto_Bot_Candles'
    ), 0)::text AS candle_count_estimate,
    COALESCE((
      SELECT n_live_tup
      FROM pg_stat_user_tables
      WHERE schemaname = 'public' AND relname = 'AI_Crypto_Bot_AI_Decisions'
    ), 0)::text AS decision_count_estimate,
    COALESCE((
      SELECT n_live_tup
      FROM pg_stat_user_tables
      WHERE schemaname = 'public' AND relname = 'AI_Crypto_Bot_Trades'
    ), 0)::text AS trade_count_estimate,
    COALESCE((
      SELECT n_live_tup
      FROM pg_stat_user_tables
      WHERE schemaname = 'public' AND relname = 'AI_Crypto_Bot_Positions'
    ), 0)::text AS position_count_estimate
`;
const HISTORY_SORTS = Object.freeze({
  newest: "created_at DESC, id DESC",
  oldest: "created_at ASC, id ASC",
  market: "symbol ASC, created_at DESC, id DESC",
  action: "side ASC, created_at DESC, id DESC",
  "price-high": "price DESC, created_at DESC, id DESC",
  "price-low": "price ASC, created_at DESC, id DESC",
  "quantity-high": "quantity DESC, created_at DESC, id DESC",
  "quantity-low": "quantity ASC, created_at DESC, id DESC",
  "fees-high": "fees DESC, created_at DESC, id DESC",
  "fees-low": "fees ASC, created_at DESC, id DESC",
  "pnl-high": "realized_pnl DESC, created_at DESC, id DESC",
  "pnl-low": "realized_pnl ASC, created_at DESC, id DESC"
});
const EXPORTS = Object.freeze({
  trades: Object.freeze({
    table: 'public."AI_Crypto_Bot_Trades"',
    timestamp: "created_at",
    select: "id,symbol,side,price,quantity,fees,realized_pnl,created_at",
    order: "created_at ASC, id ASC",
    portfolioScoped: true
  }),
  portfolio: Object.freeze({
    table: 'public."AI_Crypto_Bot_Portfolio_Snapshots"',
    timestamp: "captured_at",
    select: "id,portfolio_id,portfolio_value,available_balance,open_positions,captured_at",
    order: "captured_at ASC, id ASC",
    portfolioScoped: true
  }),
  decisions: Object.freeze({
    table: 'public."AI_Crypto_Bot_AI_Decisions"',
    timestamp: "created_at",
    select: "id,symbol,decision,confidence,indicators,reason,created_at",
    order: "created_at ASC, id ASC",
    portfolioScoped: false
  }),
  positions: Object.freeze({
    table: 'public."AI_Crypto_Bot_Positions"',
    timestamp: "created_at",
    select: "id,symbol,amount,entry_price,current_price,unrealized_pnl,status,created_at",
    order: "created_at ASC, id ASC",
    portfolioScoped: true
  })
});

export class DashboardRepository {
  constructor(pool, { logger = console } = {}) {
    if (!pool || typeof pool.connect !== "function") {
      throw new TypeError("A PostgreSQL pool is required.");
    }
    this.pool = pool;
    this.logger = logger;
  }

  async getSystemDashboardData({ recentTradeLimit = 5, snapshotLimit = 100 } = {}) {
    const portfolioResult = await queryReadOnly(
      this.pool,
      PORTFOLIO_SQL,
      [SYSTEM_PROFILE_ID],
      { logger: this.logger }
    );
    if (portfolioResult.rows.length > 1) {
      throw new RepositoryDataError("multiple system portfolios");
    }

    const portfolioRow = portfolioResult.rows[0];
    if (!portfolioRow) {
      return {
        portfolio: emptyPortfolio(),
        openPositions: { count: 0, items: [] },
        openPositionAiStatus: { count: 0, items: [] },
        recentTrades: { count: 0, items: [] },
        portfolioSnapshots: [],
        emergencyState: { status: "NORMAL" },
        lastMarketDataAt: null
      };
    }

    const portfolioId = portfolioRow.id;
    const [positionsResult, tradesResult, snapshotsResult, metricsResult, emergencyResult, marketResult] =
      await Promise.all([
        queryReadOnly(this.pool, OPEN_POSITIONS_SQL, [portfolioId], { logger: this.logger }),
        queryReadOnly(
          this.pool,
          RECENT_TRADES_SQL,
          [portfolioId, recentTradeLimit],
          { logger: this.logger }
        ),
        queryReadOnly(
          this.pool,
          PORTFOLIO_SNAPSHOTS_SQL,
          [portfolioId, snapshotLimit],
          { logger: this.logger }
        ),
        queryReadOnly(this.pool, PORTFOLIO_METRICS_SQL, [portfolioId], { logger: this.logger }),
        queryReadOnly(this.pool, LATEST_EMERGENCY_SQL, [], { logger: this.logger }),
        queryReadOnly(
          this.pool,
          `SELECT MAX(captured_at) AS captured_at
           FROM public."AI_Crypto_Bot_Market_Data"`,
          [],
          { logger: this.logger }
        )
      ]);

    const positions = positionsResult.rows.map(normalizePosition);
    const trades = tradesResult.rows.map(normalizeTrade);
    const snapshots = snapshotsResult.rows.map(normalizeSnapshot).reverse();
    const metrics = metricsResult.rows[0] || {};
    const startingBalance = readFiniteNumber(portfolioRow.starting_balance, "starting balance");
    const portfolioValue = readFiniteNumber(portfolioRow.portfolio_value, "portfolio value");
    const availableBalance = readFiniteNumber(
      portfolioRow.available_balance,
      "available balance"
    );
    const realizedPnl = readFiniteNumber(metrics.realized_pnl ?? 0, "realized P&L");
    const wins = readCount(metrics.wins, "winning trade count");
    const closedTrades = readCount(metrics.closed_trades, "closed trade count");
    const tradeCount = readCount(metrics.trade_count, "trade count");
    const latestEmergency = emergencyResult.rows[0];
    const currentMarketAt = marketResult.rows[0]?.captured_at;

    return {
      portfolio: {
        count: 1,
        startingBalance,
        portfolioValue,
        totalPnl: portfolioValue - startingBalance,
        realizedPnl,
        unrealizedPnl: positions.reduce((sum, item) => sum + item.unrealized_pnl, 0),
        dailyPnl: readFiniteNumber(metrics.daily_pnl ?? 0, "daily P&L"),
        dailyPnlTradeCount: readCount(metrics.daily_pnl_trade_count, "daily trade count"),
        availableBalance,
        winRate: closedTrades ? (wins / closedTrades) * 100 : null,
        winRateTradeCount: closedTrades
      },
      openPositions: { count: positions.length, items: positions },
      openPositionAiStatus: {
        count: positions.length,
        items: positions.map((position) => ({
          symbol: position.symbol,
          amount: position.amount,
          entry_price: position.entry_price,
          current_price: position.current_price,
          unrealized_pnl: position.unrealized_pnl,
          current_market_price: position.current_market_price,
          current_market_captured_at: position.current_market_captured_at ?? null,
          latestAiDecision: position.latest_ai_decision
            ? {
              decision: position.latest_ai_decision,
              confidence: position.latest_ai_confidence,
              marketStrength: position.latest_ai_indicators?.marketStrength ?? null,
              reason: position.latest_ai_reason,
              created_at: position.latest_ai_created_at
            }
            : null
        }))
      },
      recentTrades: { count: tradeCount, items: trades },
      portfolioSnapshots: snapshots,
      emergencyState: latestEmergency
        ? {
          status: latestEmergency.status,
          reason: latestEmergency.reason,
          created_at: readTimestamp(latestEmergency.created_at, "emergency-state timestamp")
        }
        : { status: "NORMAL" },
      lastMarketDataAt: currentMarketAt
        ? readTimestamp(currentMarketAt, "latest market-data timestamp")
        : null
    };
  }

  async getShadowExitScenarios({ limit = 350 } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 350) {
      throw new TypeError("The shadow-exit row limit must be between 1 and 350.");
    }

    const portfolioId = await this.#systemPortfolioId();
    if (!portfolioId) {
      return Object.freeze({ status: "AVAILABLE", positions: Object.freeze([]) });
    }
    const result = await queryReadOnly(
      this.pool,
      SHADOW_EXIT_SCENARIOS_SQL,
      [portfolioId, limit],
      { logger: this.logger }
    );
    return normalizeShadowExitScenarios(result.rows);
  }

  async getTradeHistory({
    page = 1,
    side = "all",
    period = "all",
    search = "",
    sort = "newest",
    now = new Date(),
    pageSize = 25
  } = {}) {
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize)
      || pageSize < 1 || pageSize > 100 || !Object.hasOwn(HISTORY_SORTS, sort)
      || !["all", "BUY", "SELL"].includes(side)
      || !["all", "24h", "7d", "30d"].includes(period)
      || typeof search !== "string" || search.length > 80
      || !(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new TypeError("Trade history filters are invalid.");
    }

    const portfolioResult = await queryReadOnly(
      this.pool,
      PORTFOLIO_SQL,
      [SYSTEM_PROFILE_ID],
      { logger: this.logger }
    );
    if (portfolioResult.rows.length > 1) {
      throw new RepositoryDataError("multiple system portfolios");
    }
    const portfolioId = portfolioResult.rows[0]?.id;
    if (!portfolioId) {
      return emptyTradeHistory(page, pageSize);
    }

    const periodMs = period === "all" ? null : {
      "24h": 24 * 60 * 60 * 1000,
      "7d": 7 * 24 * 60 * 60 * 1000,
      "30d": 30 * 24 * 60 * 60 * 1000
    }[period];
    const cutoff = periodMs === null ? null : new Date(now.getTime() - periodMs).toISOString();
    const sideFilter = side === "all" ? null : side;
    const searchFilter = search.trim() ? `%${escapeLike(search.trim())}%` : null;
    const filters = [portfolioId, sideFilter, cutoff, searchFilter];
    const where = `portfolio_id = $1::uuid
      AND ($2::text IS NULL OR side = $2::text)
      AND ($3::timestamptz IS NULL OR created_at >= $3::timestamptz)
      AND ($4::text IS NULL OR symbol ILIKE $4::text ESCAPE '\\')`;

    const [countResult, statsResult] = await Promise.all([
      queryReadOnly(
        this.pool,
        `SELECT COUNT(*)::integer AS total_count
         FROM public."AI_Crypto_Bot_Trades"
         WHERE ${where}`,
        filters,
        { logger: this.logger }
      ),
      queryReadOnly(
        this.pool,
        `SELECT COUNT(*) FILTER (WHERE side = 'SELL')::integer AS closed_trades,
                COUNT(*) FILTER (WHERE side = 'SELL' AND realized_pnl > 0)::integer AS winning_trades,
                COUNT(*) FILTER (WHERE side = 'SELL' AND realized_pnl < 0)::integer AS losing_trades,
                AVG(realized_pnl) FILTER (WHERE side = 'SELL' AND realized_pnl > 0) AS average_profit,
                AVG(realized_pnl) FILTER (WHERE side = 'SELL' AND realized_pnl < 0) AS average_loss,
                MAX(realized_pnl) FILTER (WHERE side = 'SELL') AS best_trade,
                MIN(realized_pnl) FILTER (WHERE side = 'SELL') AS worst_trade
         FROM public."AI_Crypto_Bot_Trades"
         WHERE portfolio_id = $1::uuid`,
        [portfolioId],
        { logger: this.logger }
      )
    ]);
    const totalCount = readCount(countResult.rows[0]?.total_count ?? 0, "trade history count");
    const offset = (page - 1) * pageSize;
    const itemsResult = await queryReadOnly(
      this.pool,
      `SELECT id, symbol, side, price, quantity, fees, realized_pnl, created_at
       FROM public."AI_Crypto_Bot_Trades"
       WHERE ${where}
       ORDER BY ${HISTORY_SORTS[sort]}
       LIMIT $5 OFFSET $6`,
      [...filters, pageSize, offset],
      { logger: this.logger }
    );
    const statsRow = statsResult.rows[0] || {};
    return {
      page,
      pageSize,
      totalCount,
      totalPages: totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize),
      items: itemsResult.rows.map(normalizeTrade),
      stats: {
        closedTrades: readCount(statsRow.closed_trades ?? 0, "closed trade count"),
        winningTrades: readCount(statsRow.winning_trades ?? 0, "winning trade count"),
        losingTrades: readCount(statsRow.losing_trades ?? 0, "losing trade count"),
        averageProfit: readNullableNumber(statsRow.average_profit, "average profit"),
        averageLoss: readNullableNumber(statsRow.average_loss, "average loss"),
        bestTrade: readNullableNumber(statsRow.best_trade, "best trade"),
        worstTrade: readNullableNumber(statsRow.worst_trade, "worst trade")
      }
    };
  }

  async getAnalytics({ period = "30d", now = new Date() } = {}) {
    if (!SUPPORTED_DASHBOARD_ANALYTICS_PERIODS.includes(period)
      || !(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new TypeError("Analytics filters are invalid.");
    }
    const portfolioResult = await queryReadOnly(
      this.pool,
      PORTFOLIO_SQL,
      [SYSTEM_PROFILE_ID],
      { logger: this.logger }
    );
    if (portfolioResult.rows.length > 1) {
      throw new RepositoryDataError("multiple system portfolios");
    }
    const portfolioRow = portfolioResult.rows[0];
    const periodStart = new Date(
      now.getTime() - (period === "30d" ? 30 : period === "90d" ? 90 : 365) * 86400000
    ).toISOString();
    if (!portfolioRow) {
      return buildDashboardAnalytics({
        period,
        now,
        portfolio: null,
        positions: [],
        trades: [],
        decisions: [],
        snapshots: [],
        sourceCounts: null
      });
    }

    const periodEnd = now.toISOString();
    const [positionsResult, tradesResult, decisionSummaryResult, snapshotsResult,
      sourceCountsResult, shadowExitResult] = await Promise.all([
      queryReadOnly(
        this.pool,
        ANALYTICS_POSITIONS_SQL,
        [portfolioRow.id, MAX_ANALYTICS_ROWS + 1],
        { logger: this.logger }
      ),
      queryReadOnly(
        this.pool,
        ANALYTICS_TRADES_SQL,
        [portfolioRow.id, periodStart, periodEnd, MAX_ANALYTICS_ROWS + 1],
        { logger: this.logger }
      ),
      queryReadOnly(
        this.pool,
        ANALYTICS_DECISION_SUMMARY_SQL,
        [periodStart, periodEnd],
        { logger: this.logger }
      ),
      queryReadOnly(
        this.pool,
        ANALYTICS_SNAPSHOTS_SQL,
        [portfolioRow.id, periodStart, periodEnd, MAX_ANALYTICS_ROWS + 1,
          MAX_ANALYTICS_ROWS + 1],
        { logger: this.logger }
      ),
      queryReadOnly(
        this.pool,
        ANALYTICS_SOURCE_COUNTS_SQL,
        [portfolioRow.id, periodStart, periodEnd],
        { logger: this.logger }
      ),
      queryReadOnly(
        this.pool,
        ANALYTICS_SHADOW_EXIT_SQL,
        [portfolioRow.id, periodStart, periodEnd, MAX_ANALYTICS_ROWS + 1],
        { logger: this.logger }
      )
    ]);
    for (const [name, result] of [
      ["positions", positionsResult],
      ["trades", tradesResult],
      ["snapshots", snapshotsResult],
      ["shadow exits", shadowExitResult]
    ]) {
      if (result.rows.length > MAX_ANALYTICS_ROWS + 1) {
        throw new RepositoryDataError(`analytics ${name} exceeded the query guard`);
      }
    }
    if (decisionSummaryResult.rows.length > MAX_ANALYTICS_ROWS) {
      throw new RepositoryDataError("analytics decision groups exceed the bounded query limit");
    }
    const portfolio = {
      starting_balance: readFiniteNumber(portfolioRow.starting_balance, "starting balance"),
      portfolio_value: readFiniteNumber(portfolioRow.portfolio_value, "portfolio value")
    };
    const positions = positionsResult.rows.slice(0, MAX_ANALYTICS_ROWS).map((row) => {
      if (!["OPEN", "CLOSED"].includes(row.status) || typeof row.symbol !== "string") {
        throw new RepositoryDataError("invalid analytics position");
      }
      return {
        symbol: row.symbol,
        status: row.status,
        unrealized_pnl: readFiniteNumber(row.unrealized_pnl, "position unrealized P&L")
      };
    });
    const trades = tradesResult.rows.slice(0, MAX_ANALYTICS_ROWS).map(normalizeTrade);
    const decisionSummary = normalizeAnalyticsDecisionSummary(decisionSummaryResult.rows);
    if (decisionSummary.invalidCount !== 0) {
      throw new RepositoryDataError("analytics decision summary contains invalid source rows");
    }
    const decisionIds = [...new Set(trades
      .map(({ ai_decision_id }) => ai_decision_id)
      .filter((id) => typeof id === "string" && UUID_PATTERN.test(id)))];
    const decisionsResult = decisionIds.length === 0
      ? { rows: [] }
      : await queryReadOnly(
        this.pool,
        ANALYTICS_LINKED_DECISIONS_SQL,
        [decisionIds, periodStart, periodEnd, MAX_ANALYTICS_ROWS + 1],
        { logger: this.logger }
      );
    const decisions = decisionsResult.rows.slice(0, MAX_ANALYTICS_ROWS)
      .map(normalizeAnalyticsDecision);
    const snapshots = snapshotsResult.rows.slice(0, MAX_ANALYTICS_ROWS).map(normalizeSnapshot);
    const sourceRow = sourceCountsResult.rows[0];
    if (!sourceRow) {
      throw new RepositoryDataError("analytics source counts are unavailable");
    }
    return buildDashboardAnalytics({
      period,
      now,
      portfolio,
      positions,
      trades,
      decisions,
      decisionSummary,
      snapshots,
      sourceCounts: Object.freeze({
        positions: readCount(sourceRow.positions, "analytics position source count"),
        trades: readCount(sourceRow.trades, "analytics trade source count"),
        decisions: readCount(sourceRow.decisions, "analytics decision source count"),
        snapshots: readCount(sourceRow.snapshots, "analytics snapshot source count"),
        shadowExitScenarios: readCount(
          sourceRow.shadow_exit_scenarios,
          "analytics shadow scenario source count"
        ),
        shadowExitEvents: readCount(
          sourceRow.shadow_exit_events,
          "analytics shadow event source count"
        )
      }),
      shadowExitAnalytics: normalizeAnalyticsShadowRows(
        shadowExitResult.rows.slice(0, MAX_ANALYTICS_ROWS)
      ),
      truncatedSources: Object.freeze({
        positions: positionsResult.rows.length > MAX_ANALYTICS_ROWS,
        trades: tradesResult.rows.length > MAX_ANALYTICS_ROWS,
        linkedDecisions: decisionsResult.rows.length > MAX_ANALYTICS_ROWS,
        snapshots: snapshotsResult.rows.length > MAX_ANALYTICS_ROWS,
        shadowExitScenarios: shadowExitResult.rows.length > MAX_ANALYTICS_ROWS
      })
    });
  }

  async getAnalyticsRunHistory({ period = "30d", now = new Date(), limit = 50 } = {}) {
    if (!SUPPORTED_DASHBOARD_ANALYTICS_PERIODS.includes(period)
      || !(now instanceof Date) || !Number.isFinite(now.getTime())
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new TypeError("Analytics history filters are invalid.");
    }
    const cutoff = new Date(now.getTime() - (period === "30d" ? 30 : period === "90d" ? 90 : 365)
      * 86400000).toISOString();
    const result = await queryReadOnly(
      this.pool,
      ANALYTICS_RUN_HISTORY_SQL,
      [cutoff, now.toISOString(), limit + 1],
      { logger: this.logger }
    );
    if (result.rows.length > limit) {
      return Object.freeze({
        items: Object.freeze(result.rows.slice(0, limit).map(normalizeAnalyticsRun)),
        limit,
        truncated: true
      });
    }
    return Object.freeze({
      items: Object.freeze(result.rows.map(normalizeAnalyticsRun)),
      limit,
      truncated: false
    });
  }

  async getLatestAnalyticsRun({ period = "30d", before = new Date() } = {}) {
    if (!SUPPORTED_DASHBOARD_ANALYTICS_PERIODS.includes(period)
      || !(before instanceof Date) || !Number.isFinite(before.getTime())) {
      throw new TypeError("The analytics history lookup is invalid.");
    }
    const result = await queryReadOnly(
      this.pool,
      LATEST_ANALYTICS_RUN_SQL,
      [period, before.toISOString()],
      { logger: this.logger }
    );
    return result.rows[0] ? normalizeAnalyticsRun(result.rows[0]) : null;
  }

  async getRecommendationHistoryExportCount({ period = "30d", now = new Date() } = {}) {
    if (!SUPPORTED_DASHBOARD_ANALYTICS_PERIODS.includes(period)
      || !(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new TypeError("Recommendation history filters are invalid.");
    }
    const cutoff = new Date(now.getTime() - (period === "30d" ? 30 : period === "90d" ? 90 : 365)
      * 86400000).toISOString();
    const result = await queryReadOnly(
      this.pool,
      RECOMMENDATION_HISTORY_COUNT_SQL,
      [cutoff, now.toISOString(), 100],
      { logger: this.logger }
    );
    const row = result.rows[0];
    if (!row || typeof row.truncated !== "boolean") {
      throw new RepositoryDataError("recommendation history export count is unavailable");
    }
    return Object.freeze({
      recordCount: readCount(row.recommendation_count, "recommendation history export count"),
      truncated: row.truncated
    });
  }

  async getAnalysisBundle({ period = "30d", now = new Date(), limit = 500 } = {}) {
    if (!SUPPORTED_DASHBOARD_ANALYTICS_PERIODS.includes(period)
      || !(now instanceof Date) || !Number.isFinite(now.getTime())
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new TypeError("Analysis bundle filters are invalid.");
    }
    const portfolioResult = await queryReadOnly(
      this.pool,
      PORTFOLIO_SQL,
      [SYSTEM_PROFILE_ID],
      { logger: this.logger }
    );
    if (portfolioResult.rows.length > 1) {
      throw new RepositoryDataError("multiple system portfolios");
    }
    const periodStart = new Date(
      now.getTime() - (period === "30d" ? 30 : period === "90d" ? 90 : 365) * 86400000
    );
    const from = periodStart.toISOString();
    const to = now.toISOString();
    const portfolioId = portfolioResult.rows[0]?.id;
    const analytics = await this.getAnalytics({ period, now });
    if (!portfolioId) {
      return createEmptyAnalysisBundle({
        analytics,
        period,
        from,
        to,
        limit
      });
    }

    const [tradesResult, snapshotsResult, scenariosResult, countsResult] =
      await Promise.all([
        queryReadOnly(this.pool, BUNDLE_TRADES_SQL,
          [portfolioId, from, to, limit + 1], { logger: this.logger }),
        queryReadOnly(this.pool, BUNDLE_SNAPSHOTS_SQL,
          [portfolioId, from, to, limit + 1], { logger: this.logger }),
        queryReadOnly(this.pool, BUNDLE_SHADOW_SCENARIOS_SQL,
          [portfolioId, from, to, limit + 1], { logger: this.logger }),
        queryReadOnly(this.pool, BUNDLE_SOURCE_COUNTS_SQL,
          [portfolioId, from, to], { logger: this.logger })
      ]);
    const selectedTrades = tradesResult.rows.slice(0, limit).map(normalizeTrade);
    const linkedDecisionIds = [...new Set(selectedTrades
      .map(({ ai_decision_id }) => ai_decision_id)
      .filter((id) => typeof id === "string" && UUID_PATTERN.test(id)))];
    const linkedResult = linkedDecisionIds.length
      ? await queryReadOnly(
        this.pool,
        BUNDLE_LINKED_DECISIONS_SQL,
        [linkedDecisionIds, limit + 1],
        { logger: this.logger }
      )
      : { rows: [] };
    const linkedDecisions = linkedResult.rows.slice(0, limit).map(normalizeBundleDecision);
    const sampledDecisionLimit = Math.max(0, limit - linkedDecisions.length);
    const sampledResult = sampledDecisionLimit
      ? await queryReadOnly(
        this.pool,
        BUNDLE_DECISIONS_SQL,
        [from, to, linkedDecisionIds, sampledDecisionLimit + 1],
        { logger: this.logger }
      )
      : { rows: [] };
    const sampledDecisions = sampledResult.rows
      .slice(0, sampledDecisionLimit)
      .map(normalizeBundleDecision);
    const snapshots = snapshotsResult.rows.slice(0, limit).map(normalizeSnapshot);
    const scenarios = scenariosResult.rows.slice(0, limit).map(normalizeBundleShadowScenario);
    const scenarioIds = scenarios.map(({ id }) => id);
    const eventsResult = scenarioIds.length
      ? await queryReadOnly(
        this.pool,
        BUNDLE_SHADOW_EVENTS_SQL,
        [scenarioIds, from, to, limit + 1],
        { logger: this.logger }
      )
      : { rows: [] };
    const counts = countsResult.rows[0];
    if (!counts) {
      throw new RepositoryDataError("analysis bundle source counts are unavailable");
    }
    const rowCounts = {
      trades: readCount(counts.trades, "bundle trade source count"),
      decisions: readCount(counts.decisions, "bundle decision source count"),
      snapshots: readCount(counts.snapshots, "bundle snapshot source count"),
      shadowExitScenarios: readCount(
        counts.shadow_exit_scenarios,
        "bundle shadow scenario source count"
      ),
      shadowExitEvents: readCount(counts.shadow_exit_events, "bundle shadow event source count")
    };
    const decisionSampling = createDecisionSamplingSummary({
      sourceCount: rowCounts.decisions,
      sampledDecisions,
      linkedDecisions,
      from,
      to,
      unresolvedTradeDecisionLinkCount: Math.max(
        0,
        linkedDecisionIds.length - linkedDecisions.length
      )
    });
    const candleSelection = createCandleAnchors(
      selectedTrades,
      linkedDecisions,
      sampledDecisions,
      50
    );
    const candlesResult = candleSelection.anchors.length
      ? await queryReadOnly(
        this.pool,
        BUNDLE_CANDLES_SQL,
        [JSON.stringify(candleSelection.anchors), 20, 6001, to],
        { logger: this.logger }
      )
      : { rows: [] };
    const bundleHistory = await this.getAnalyticsRunHistory({ period, now, limit: 50 });
    const candleWindows = candlesResult.rows.slice(0, 6000).map(normalizeBundleCandle);
    return Object.freeze({
      manifest: Object.freeze({
        requestedRange: Object.freeze({ period, from, to, timezone: "UTC" }),
        generatedAt: to,
        calculationVersion: analytics.calculationVersion,
        sourceCounts: Object.freeze(rowCounts),
        includedCounts: Object.freeze({
          trades: selectedTrades.length,
          decisions: sampledDecisions.length,
          linkedDecisions: linkedDecisions.length,
          portfolioSnapshots: snapshots.length,
          candleRows: candleWindows.length,
          candleAnchorCount: candleSelection.anchors.length,
          shadowExitScenarios: scenarios.length,
          shadowExitEvents: Math.min(eventsResult.rows.length, limit)
        }),
        decisionSampling,
        candleSampling: candleSelection.summary,
        limits: Object.freeze({
          rowsPerSource: limit,
          candleAnchorLimit: 50,
          candlesPerIntervalPerAnchor: 20,
          candleRowLimit: 6000
        }),
        truncation: Object.freeze({
          trades: tradesResult.rows.length > limit,
          decisions: decisionSampling.truncated,
          portfolioSnapshots: snapshotsResult.rows.length > limit,
          linkedDecisions: linkedResult.rows.length > limit,
          candleWindows: candleSelection.summary.omittedTradeRelatedAnchors > 0
            || candleSelection.summary.omittedSampledDecisionAnchors > 0
            || candlesResult.rows.length > 6000,
          shadowExitScenarios: scenariosResult.rows.length > limit,
          shadowExitEvents: eventsResult.rows.length > limit,
          analyticsHistory: bundleHistory.truncated
        })
      }),
      analytics,
      analyticsHistory: bundleHistory.items,
      trades: Object.freeze(selectedTrades),
      decisions: Object.freeze([...sampledDecisions, ...linkedDecisions]),
      portfolioSnapshots: Object.freeze(snapshots),
      candleWindows: Object.freeze(candleWindows),
      shadowExitScenarios: Object.freeze(scenarios),
      shadowExitEvents: Object.freeze(
        eventsResult.rows.slice(0, limit).map(normalizeBundleShadowEvent)
      )
    });
  }

  async getMonitoringMetrics() {
    const result = await queryReadOnly(this.pool, MONITORING_SQL, [], { logger: this.logger });
    const row = result.rows[0];
    if (!row) {
      throw new RepositoryDataError("database monitoring metrics are unavailable");
    }
    return Object.freeze({
      databaseSizeBytes: readCount(row.database_size_bytes, "database size"),
      estimatedRows: Object.freeze({
        candles: readCount(row.candle_count_estimate, "candle row estimate"),
        decisions: readCount(row.decision_count_estimate, "decision row estimate"),
        trades: readCount(row.trade_count_estimate, "trade row estimate"),
        positions: readCount(row.position_count_estimate, "position row estimate")
      })
    });
  }

  async getExportRecordCount({ exportType, period = "all", now = new Date() } = {}) {
    const selection = createExportSelection(exportType, period, now);
    const portfolioId = selection.definition.portfolioScoped
      ? await this.#systemPortfolioId()
      : null;
    if (selection.definition.portfolioScoped && !portfolioId) {
      return 0;
    }
    const parameters = [];
    const filters = [];
    if (portfolioId) {
      parameters.push(portfolioId);
      filters.push("portfolio_id = $1::uuid");
    }
    if (selection.cutoff) {
      parameters.push(selection.cutoff);
      filters.push(`${selection.definition.timestamp} >= $${parameters.length}::timestamptz`);
    }
    const result = await queryReadOnly(
      this.pool,
      `SELECT COUNT(*)::integer AS record_count
       FROM ${selection.definition.table}
       ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}`,
      parameters,
      { logger: this.logger }
    );
    return readCount(result.rows[0]?.record_count ?? 0, "export record count");
  }

  async getExportRecords({ exportType, period = "all", now = new Date() } = {}) {
    const selection = createExportSelection(exportType, period, now);
    const portfolioId = selection.definition.portfolioScoped
      ? await this.#systemPortfolioId()
      : null;
    if (selection.definition.portfolioScoped && !portfolioId) {
      return [];
    }
    const parameters = [];
    const filters = [];
    if (portfolioId) {
      parameters.push(portfolioId);
      filters.push("portfolio_id = $1::uuid");
    }
    if (selection.cutoff) {
      parameters.push(selection.cutoff);
      filters.push(`${selection.definition.timestamp} >= $${parameters.length}::timestamptz`);
    }
    parameters.push(MAX_EXPORT_ROWS + 1);
    const result = await queryReadOnly(
      this.pool,
      `SELECT ${selection.definition.select}
       FROM ${selection.definition.table}
       ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
       ORDER BY ${selection.definition.order}
       LIMIT $${parameters.length}`,
      parameters,
      { logger: this.logger }
    );
    if (result.rows.length > MAX_EXPORT_ROWS) {
      throw new RepositoryDataError("export data exceeds the bounded download limit");
    }
    return result.rows;
  }

  async #systemPortfolioId() {
    const result = await queryReadOnly(
      this.pool,
      PORTFOLIO_SQL,
      [SYSTEM_PROFILE_ID],
      { logger: this.logger }
    );
    if (result.rows.length > 1) {
      throw new RepositoryDataError("multiple system portfolios");
    }
    return result.rows[0]?.id || null;
  }
}

function emptyPortfolio() {
  return {
    count: 0,
    startingBalance: null,
    portfolioValue: null,
    totalPnl: null,
    realizedPnl: null,
    unrealizedPnl: null,
    dailyPnl: 0,
    dailyPnlTradeCount: 0,
    availableBalance: null,
    winRate: null,
    winRateTradeCount: 0
  };
}

function readCount(value, field) {
  const count = readFiniteNumber(value ?? 0, field);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RepositoryDataError(`invalid ${field}`);
  }
  return count;
}

function readNullableNumber(value, field) {
  return value === null || value === undefined
    ? null
    : readFiniteNumber(value, field);
}

function emptyTradeHistory(page, pageSize) {
  return {
    page,
    pageSize,
    totalCount: 0,
    totalPages: 0,
    items: [],
    stats: {
      closedTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      averageProfit: null,
      averageLoss: null,
      bestTrade: null,
      worstTrade: null
    }
  };
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function createExportSelection(exportType, period, now) {
  if (!Object.hasOwn(EXPORTS, exportType) || !["all", "24h", "7d", "30d"].includes(period)
    || !(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError("Export filters are invalid.");
  }
  const durationMs = period === "all" ? null : {
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000
  }[period];
  return {
    definition: EXPORTS[exportType],
    cutoff: durationMs === null ? null : new Date(now.getTime() - durationMs).toISOString()
  };
}

function normalizePosition(row) {
  for (const [field, value] of Object.entries({
    amount: row.amount,
    entry_price: row.entry_price,
    current_price: row.current_price,
    unrealized_pnl: row.unrealized_pnl
  })) {
    row[field] = readFiniteNumber(value, `position ${field}`);
  }
  if (typeof row.symbol !== "string" || row.status !== "OPEN") {
    throw new RepositoryDataError("invalid open position");
  }
  if (row.latest_ai_confidence !== null && row.latest_ai_confidence !== undefined) {
    row.latest_ai_confidence = readFiniteNumber(
      row.latest_ai_confidence,
      "AI decision confidence"
    );
    if (row.latest_ai_confidence < 0 || row.latest_ai_confidence > 100) {
      throw new RepositoryDataError("invalid AI decision confidence");
    }
  }
  if (row.current_market_price !== null) {
    row.current_market_price = readFiniteNumber(row.current_market_price, "market price");
    row.current_market_captured_at = readTimestamp(
      row.current_market_captured_at,
      "market snapshot timestamp"
    );
  }
  row.created_at = readTimestamp(row.created_at, "position timestamp");
  return row;
}

function normalizeShadowExitScenarios(rows) {
  const positions = new Map();
  for (const row of rows) {
    if (typeof row.position_id !== "string" || !UUID_PATTERN.test(row.position_id)
      || typeof row.symbol !== "string" || !["OPEN", "CLOSED"].includes(row.position_status)) {
      throw new RepositoryDataError("invalid shadow-exit position");
    }
    let position = positions.get(row.position_id);
    if (!position) {
      position = {
        id: row.position_id,
        symbol: row.symbol,
        isOpen: row.position_status === "OPEN",
        positionOpenedAt: readTimestamp(row.position_opened_at, "shadow position timestamp"),
        actualClosedAt: null,
        actualClosePrice: null,
        actualNetPnl: null,
        scenarios: []
      };
      positions.set(row.position_id, position);
    }

    if (row.actual_closed_at !== null && row.actual_closed_at !== undefined) {
      position.actualClosedAt = readTimestamp(row.actual_closed_at, "shadow actual-close timestamp");
      position.actualClosePrice = readNullableNumber(
        row.actual_close_price,
        "shadow actual-close price"
      );
      position.actualNetPnl = readNullableNumber(row.actual_net_pnl, "shadow actual net P&L");
    }
    if (row.scenario_id === null || row.scenario_id === undefined) {
      continue;
    }
    if (typeof row.scenario_id !== "string" || !UUID_PATTERN.test(row.scenario_id)
      || typeof row.rule_id !== "string" || typeof row.rule_version !== "string"
      || !["TRACKING", "TRIGGERED", "CLOSED_WITHOUT_TRIGGER"].includes(row.scenario_status)
      || !["AWAITING_FIRST_FRESH_MARK", "FRESH", "STALE", "INVALID", "UNAVAILABLE"]
        .includes(row.data_quality_status)
      || typeof row.trailing_armed !== "boolean") {
      throw new RepositoryDataError("invalid shadow-exit scenario");
    }
    const scenario = {
      id: row.scenario_id,
      rule_id: row.rule_id,
      rule_version: row.rule_version,
      parameters: normalizeJsonObject(row.parameters, "shadow scenario parameters"),
      status: row.scenario_status,
      data_quality_status: row.data_quality_status,
      tracking_started_at: readNullableTimestamp(
        row.tracking_started_at,
        "shadow tracking timestamp"
      ),
      last_evaluated_at: readTimestamp(row.last_evaluated_at, "shadow evaluation timestamp"),
      last_mark: readNullableNumber(row.last_mark, "shadow last mark"),
      last_mark_captured_at: readNullableTimestamp(
        row.last_mark_captured_at,
        "shadow last-mark timestamp"
      ),
      high_water_mark: readNullableNumber(row.high_water_mark, "shadow high-water mark"),
      trailing_armed: row.trailing_armed,
      activated_at: readNullableTimestamp(row.activated_at, "shadow activation timestamp"),
      triggered_at: readNullableTimestamp(row.triggered_at, "shadow trigger timestamp"),
      trigger_mark: readNullableNumber(row.trigger_mark, "shadow trigger mark"),
      modeled_exit_price: readNullableNumber(row.modeled_exit_price, "shadow exit price"),
      modeled_net_pnl: readNullableNumber(row.modeled_net_pnl, "shadow net P&L"),
      events: normalizeShadowExitEvents(row.events)
    };
    position.scenarios.push(Object.freeze(scenario));
  }

  return Object.freeze({
    status: "AVAILABLE",
    positions: Object.freeze([...positions.values()].map((position) =>
      Object.freeze({
        ...position,
        scenarios: Object.freeze(position.scenarios)
      })))
  });
}

function normalizeShadowExitEvents(value) {
  const events = typeof value === "string" ? parseJson(value, "shadow scenario events") : value;
  if (!Array.isArray(events) || events.length > 10) {
    throw new RepositoryDataError("invalid shadow scenario events");
  }
  return Object.freeze(events.map((event) => {
    if (!event || typeof event !== "object" || Array.isArray(event)
      || typeof event.event_type !== "string"
      || !["TRACKING_STARTED", "TRAILING_STOP_ARMED", "HYPOTHETICAL_TRIGGERED",
        "ACTUAL_POSITION_CLOSED", "DATA_QUALITY_CHANGED", "EVALUATION_FAILED"]
        .includes(event.event_type)
      || event.data_quality_status !== null
        && !["AWAITING_FIRST_FRESH_MARK", "FRESH", "STALE", "INVALID", "UNAVAILABLE"]
          .includes(event.data_quality_status)
      || event.error_code !== null
        && (typeof event.error_code !== "string" || !/^[0-9A-Z]{5,32}$/.test(event.error_code))) {
      throw new RepositoryDataError("invalid shadow-exit event");
    }
    return Object.freeze({
      event_type: event.event_type,
      event_at: readTimestamp(event.event_at, "shadow event timestamp"),
      observed_mark: readNullableNumber(event.observed_mark, "shadow event mark"),
      data_quality_status: event.data_quality_status,
      error_code: event.error_code
    });
  }));
}

function normalizeJsonObject(value, field) {
  const parsed = typeof value === "string" ? parseJson(value, field) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RepositoryDataError(`invalid ${field}`);
  }
  return Object.freeze({ ...parsed });
}

function parseJson(value, field) {
  try {
    return JSON.parse(value);
  } catch {
    throw new RepositoryDataError(`invalid ${field}`);
  }
}

function readNullableTimestamp(value, field) {
  return value === null || value === undefined ? null : readTimestamp(value, field);
}

function normalizeTrade(row) {
  for (const field of ["price", "quantity", "fees", "realized_pnl"]) {
    row[field] = readFiniteNumber(row[field], `trade ${field}`);
  }
  if (row.slippage !== undefined) {
    row.slippage = readFiniteNumber(row.slippage, "trade slippage");
  }
  if (typeof row.symbol !== "string" || !["BUY", "SELL"].includes(row.side)) {
    throw new RepositoryDataError("invalid trade row");
  }
  row.created_at = readTimestamp(row.created_at, "trade timestamp");
  return row;
}

function normalizeAnalyticsDecision(row) {
  const confidence = readFiniteNumber(row.confidence, "decision confidence");
  if (typeof row.symbol !== "string" || !row.symbol
    || !["BUY", "SELL", "HOLD", "WAIT"].includes(row.decision)
    || confidence < 0 || confidence > 100
    || ((row.strategy_name === null) !== (row.strategy_version === null))) {
    throw new RepositoryDataError("invalid analytics decision");
  }
  return {
    ...row,
    confidence,
    indicators: normalizeJsonObject(row.indicators, "analytics decision indicators"),
    created_at: readTimestamp(row.created_at, "decision timestamp")
  };
}

function normalizeAnalyticsDecisionSummary(rows) {
  const summary = {
    decisionCount: null,
    below50Count: null,
    below70Count: null,
    actions: [],
    confidenceBuckets: [],
    confidenceBands: [],
    confidenceBandsByAction: [],
    strategies: [],
    strategyVersions: [],
    bySymbol: []
  };
  const allowedActions = new Set(["BUY", "SELL", "HOLD", "WAIT"]);
  const allowedBuckets = new Set(["70–75", "75–80", "80–85", "85+"]);
  const allowedBands = new Set(["[50,60)", "[60,70)", "[70,80)", "[80,90)", "[90,100]"]);
  const seen = new Set();
  let invalidCount = null;
  for (const row of rows) {
    const dimension = row.dimension;
    const label = row.label;
    const count = readCount(row.decision_count, "analytics decision count");
    const key = `${dimension}:${label ?? ""}`;
    if (seen.has(key)) {
      throw new RepositoryDataError("duplicate analytics decision summary group");
    }
    seen.add(key);
    if (dimension === "total" && label === null && summary.decisionCount === null) {
      summary.decisionCount = count;
    } else if (dimension === "below50" && label === null && summary.below50Count === null) {
      summary.below50Count = count;
    } else if (dimension === "below70" && label === null && summary.below70Count === null) {
      summary.below70Count = count;
    } else if (dimension === "invalid" && label === null && invalidCount === null) {
      invalidCount = count;
    } else if (dimension === "action"
      && typeof label === "string" && allowedActions.has(label)) {
      summary.actions.push({ label, decisionCount: count });
    } else if (dimension === "confidence"
      && typeof label === "string" && allowedBuckets.has(label)) {
      summary.confidenceBuckets.push({ label, decisionCount: count });
    } else if (dimension === "legacy-confidence"
      && typeof label === "string" && allowedBuckets.has(label)) {
      summary.confidenceBuckets.push({ label, decisionCount: count });
    } else if (dimension === "confidence"
      && typeof label === "string" && allowedBands.has(label)) {
      summary.confidenceBands.push({ label, decisionCount: count });
    } else if (dimension === "confidence-action" && typeof label === "string") {
      const separatorIndex = label.indexOf("|");
      const action = label.slice(0, separatorIndex);
      const bandLabel = label.slice(separatorIndex + 1);
      if (separatorIndex < 1 || !allowedActions.has(action) || !allowedBands.has(bandLabel)) {
        throw new RepositoryDataError("invalid action confidence-band summary group");
      }
      summary.confidenceBandsByAction.push({
        action,
        label: bandLabel,
        decisionCount: count
      });
    } else if (dimension === "strategy" && typeof label === "string" && label.length > 0) {
      summary.strategies.push({ label, decisionCount: count });
    } else if (dimension === "strategy-version"
      && typeof label === "string" && label.length > 0) {
      const separatorIndex = label.lastIndexOf(" · ");
      if (separatorIndex < 1 || separatorIndex + 3 >= label.length) {
        throw new RepositoryDataError("invalid strategy-version summary group");
      }
      summary.strategyVersions.push({
        label,
        strategyName: label.slice(0, separatorIndex),
        strategyVersion: label.slice(separatorIndex + 3),
        decisionCount: count
      });
    } else if (dimension === "symbol" && typeof label === "string" && label.length > 0) {
      summary.bySymbol.push({ label, decisionCount: count });
    } else {
      throw new RepositoryDataError("invalid analytics decision summary");
    }
  }
  if (summary.decisionCount === null || summary.below50Count === null
    || summary.below70Count === null || invalidCount === null
    || summary.actions.reduce((total, row) => total + row.decisionCount, 0)
      !== summary.decisionCount
    || summary.confidenceBuckets.reduce((total, row) => total + row.decisionCount, 0)
      + summary.below70Count !== summary.decisionCount
    || summary.confidenceBands.reduce((total, row) => total + row.decisionCount, 0)
      + summary.below50Count !== summary.decisionCount
    || CONFIDENCE_BAND_LABELS.some((label) => {
      const overall = summary.confidenceBands.find((row) => row.label === label)?.decisionCount ?? 0;
      const byAction = summary.confidenceBandsByAction
        .filter((row) => row.label === label)
        .reduce((total, row) => total + row.decisionCount, 0);
      return overall !== byAction;
    })
    || summary.bySymbol.reduce((total, row) => total + row.decisionCount, 0)
      !== summary.decisionCount
    || invalidCount !== 0) {
    throw new RepositoryDataError("inconsistent analytics decision summary");
  }
  return Object.freeze({
    ...summary,
    invalidCount,
    actions: Object.freeze(summary.actions.map(Object.freeze)),
    confidenceBuckets: Object.freeze(summary.confidenceBuckets.map(Object.freeze)),
    confidenceBands: Object.freeze(summary.confidenceBands.map(Object.freeze)),
    confidenceBandsByAction: Object.freeze(
      summary.confidenceBandsByAction.map(Object.freeze)
    ),
    strategies: Object.freeze(summary.strategies.map(Object.freeze)),
    strategyVersions: Object.freeze(summary.strategyVersions.map(Object.freeze)),
    bySymbol: Object.freeze(summary.bySymbol.map(Object.freeze))
  });
}

function normalizeAnalyticsShadowRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (typeof row.symbol !== "string" || typeof row.rule_id !== "string"
      || typeof row.rule_version !== "string"
      || !["TRACKING", "TRIGGERED", "CLOSED_WITHOUT_TRIGGER"].includes(row.status)
      || !["AWAITING_FIRST_FRESH_MARK", "FRESH", "STALE", "INVALID", "UNAVAILABLE"]
        .includes(row.data_quality_status)) {
      throw new RepositoryDataError("invalid shadow analytics row");
    }
    const modeledPnl = readNullableNumber(row.modeled_net_pnl, "shadow modeled P&L");
    const actualPnl = readNullableNumber(row.actual_net_pnl, "shadow actual P&L");
    const key = `${row.rule_id}\u0000${row.rule_version}\u0000${row.symbol}`;
    if (!groups.has(key)) {
      groups.set(key, {
        ruleId: row.rule_id,
        ruleVersion: row.rule_version,
        symbol: row.symbol,
        scenarios: [],
        comparisons: []
      });
    }
    const group = groups.get(key);
    if (modeledPnl !== null) {
      group.scenarios.push(modeledPnl);
    }
    if (modeledPnl !== null && actualPnl !== null) {
      group.comparisons.push({ modeledPnl, actualPnl });
    }
  }

  const groupsByRule = new Map();
  const markets = [];
  for (const group of groups.values()) {
    const scenarioCount = group.scenarios.length;
    const comparisons = group.comparisons;
    const improvementDeltas = comparisons.map(({ modeledPnl, actualPnl }) => modeledPnl - actualPnl);
    const result = {
      ruleId: group.ruleId,
      ruleVersion: group.ruleVersion,
      symbol: group.symbol,
      scenarioSampleSize: scenarioCount,
      scenarioWinRate: scenarioCount
        ? group.scenarios.filter((pnl) => pnl > 0).length / scenarioCount * 100
        : null,
      averageScenarioOutcome: scenarioCount
        ? group.scenarios.reduce((total, pnl) => total + pnl, 0) / scenarioCount
        : null,
      actualComparisonSampleSize: comparisons.length,
      averageActualOutcome: comparisons.length
        ? comparisons.reduce((total, row) => total + row.actualPnl, 0) / comparisons.length
        : null,
      averageImprovementOverActual: improvementDeltas.length
        ? improvementDeltas.reduce((total, delta) => total + delta, 0) / improvementDeltas.length
        : null,
      improvementCount: improvementDeltas.filter((delta) => delta > 0).length,
      deteriorationCount: improvementDeltas.filter((delta) => delta < 0).length,
      confidenceIndicator: comparisons.length >= 10 ? "MODERATE_SAMPLE"
        : comparisons.length >= 5 ? "LIMITED_SAMPLE"
          : comparisons.length > 0 ? "LOW_SAMPLE" : "NO_ACTUAL_COMPARISONS"
    };
    markets.push(result);
    const ruleKey = `${group.ruleId}\u0000${group.ruleVersion}`;
    if (!groupsByRule.has(ruleKey)) {
      groupsByRule.set(ruleKey, {
        ruleId: group.ruleId,
        ruleVersion: group.ruleVersion,
        scenarios: [],
        comparisons: []
      });
    }
    groupsByRule.get(ruleKey).scenarios.push(...group.scenarios);
    groupsByRule.get(ruleKey).comparisons.push(...group.comparisons);
  }

  const summarize = (group) => {
    const comparisonCount = group.comparisons.length;
    const differences = group.comparisons.map((item) => item.modeledPnl - item.actualPnl);
    return {
      ruleId: group.ruleId,
      ruleVersion: group.ruleVersion,
      scenarioSampleSize: group.scenarios.length,
      scenarioWinRate: group.scenarios.length
        ? group.scenarios.filter((pnl) => pnl > 0).length / group.scenarios.length * 100
        : null,
      averageScenarioOutcome: group.scenarios.length
        ? group.scenarios.reduce((total, pnl) => total + pnl, 0) / group.scenarios.length
        : null,
      actualComparisonSampleSize: comparisonCount,
      averageImprovementOverActual: comparisonCount
        ? differences.reduce((total, value) => total + value, 0) / comparisonCount
        : null,
      improvementCount: differences.filter((value) => value > 0).length,
      deteriorationCount: differences.filter((value) => value < 0).length,
      confidenceIndicator: comparisonCount >= 10 ? "MODERATE_SAMPLE"
        : comparisonCount >= 5 ? "LIMITED_SAMPLE"
          : comparisonCount > 0 ? "LOW_SAMPLE" : "NO_ACTUAL_COMPARISONS"
    };
  };
  return Object.freeze({
    status: "AVAILABLE",
    strategyVersionAttribution: Object.freeze({
      status: "UNAVAILABLE",
      reason: "Shadow scenarios do not persist a validated link to a strategy version."
    }),
    byRuleVersion: Object.freeze([...groupsByRule.values()].map(summarize)),
    byMarket: Object.freeze(markets),
    sampleSizeAware: true,
    comparisonDefinition: "modeled net P&L minus actual net P&L for the same scenario after an actual closure"
  });
}

function normalizeSnapshot(row) {
  for (const field of ["portfolio_value", "available_balance"]) {
    row[field] = readFiniteNumber(row[field], `snapshot ${field}`);
  }
  if (!Number.isSafeInteger(row.open_positions) || row.open_positions < 0) {
    throw new RepositoryDataError("invalid snapshot open-position count");
  }
  row.captured_at = readTimestamp(row.captured_at, "snapshot timestamp");
  return row;
}

function normalizeAnalyticsRun(row) {
  if (typeof row.id !== "string" || !UUID_PATTERN.test(row.id)
    || typeof row.calculation_version !== "string"
    || !SUPPORTED_DASHBOARD_ANALYTICS_PERIODS.includes(row.period)) {
    throw new RepositoryDataError("invalid analytics run");
  }
  return Object.freeze({
    id: row.id,
    calculationVersion: row.calculation_version,
    period: row.period,
    periodStart: readTimestamp(row.period_start, "analytics run period start"),
    periodEnd: readTimestamp(row.period_end, "analytics run period end"),
    generatedAt: readTimestamp(row.generated_at, "analytics run generation time"),
    sourceCounts: normalizeJsonObject(row.source_counts, "analytics run source counts"),
    analyticsSummary: normalizeJsonObject(row.analytics_summary, "analytics run summary"),
    insights: normalizeJsonValue(row.insights, "analytics run insights")
  });
}

function normalizeBundleDecision(row) {
  const decision = normalizeAnalyticsDecision(row);
  if (typeof row.reason !== "string" || row.reason.length > 4000) {
    throw new RepositoryDataError("invalid bundled decision reason");
  }
  return Object.freeze({
    ...decision,
    indicators: Object.freeze({ ...decision.indicators })
  });
}

function normalizeBundleShadowScenario(row) {
  if (typeof row.id !== "string" || !UUID_PATTERN.test(row.id)
    || typeof row.position_id !== "string" || !UUID_PATTERN.test(row.position_id)
    || typeof row.symbol !== "string" || typeof row.rule_id !== "string"
    || typeof row.rule_version !== "string"
    || !["TRACKING", "TRIGGERED", "CLOSED_WITHOUT_TRIGGER"].includes(row.status)
    || !["AWAITING_FIRST_FRESH_MARK", "FRESH", "STALE", "INVALID", "UNAVAILABLE"]
      .includes(row.data_quality_status)) {
    throw new RepositoryDataError("invalid bundled shadow-exit scenario");
  }
  return Object.freeze({
    id: row.id,
    positionId: row.position_id,
    symbol: row.symbol,
    ruleId: row.rule_id,
    ruleVersion: row.rule_version,
    parameters: normalizeJsonObject(row.parameters, "bundle shadow parameters"),
    status: row.status,
    dataQualityStatus: row.data_quality_status,
    positionOpenedAt: readTimestamp(row.position_opened_at, "bundle shadow open time"),
    trackingStartedAt: readNullableTimestamp(row.tracking_started_at, "bundle shadow tracking time"),
    triggeredAt: readNullableTimestamp(row.triggered_at, "bundle shadow trigger time"),
    modeledExitPrice: readNullableNumber(row.modeled_exit_price, "bundle shadow exit price"),
    modeledNetPnl: readNullableNumber(row.modeled_net_pnl, "bundle shadow modeled P&L"),
    actualClosedAt: readNullableTimestamp(row.actual_closed_at, "bundle actual close time"),
    actualClosePrice: readNullableNumber(row.actual_close_price, "bundle actual close price"),
    actualNetPnl: readNullableNumber(row.actual_net_pnl, "bundle actual net P&L")
  });
}

function normalizeBundleShadowEvent(row) {
  const types = new Set([
    "TRACKING_STARTED",
    "TRAILING_STOP_ARMED",
    "HYPOTHETICAL_TRIGGERED",
    "ACTUAL_POSITION_CLOSED",
    "DATA_QUALITY_CHANGED",
    "EVALUATION_FAILED"
  ]);
  if (typeof row.id !== "string" || !UUID_PATTERN.test(row.id)
    || typeof row.scenario_id !== "string" || !UUID_PATTERN.test(row.scenario_id)
    || !types.has(row.event_type)
    || row.data_quality_status !== null
      && !["AWAITING_FIRST_FRESH_MARK", "FRESH", "STALE", "INVALID", "UNAVAILABLE"]
        .includes(row.data_quality_status)
    || row.error_code !== null
      && (typeof row.error_code !== "string" || !/^[0-9A-Z]{5,32}$/.test(row.error_code))) {
    throw new RepositoryDataError("invalid bundled shadow-exit event");
  }
  return Object.freeze({
    id: row.id,
    scenarioId: row.scenario_id,
    eventType: row.event_type,
    eventAt: readTimestamp(row.event_at, "bundle shadow event time"),
    observedMark: readNullableNumber(row.observed_mark, "bundle shadow observed mark"),
    dataQualityStatus: row.data_quality_status,
    errorCode: row.error_code
  });
}

function normalizeBundleCandle(row) {
  if (typeof row.symbol !== "string"
    || !["1m", "5m", "15m", "1h", "4h", "1d"].includes(row.interval)) {
    throw new RepositoryDataError("invalid bundled candle identity");
  }
  const candle = {
    symbol: row.symbol,
    interval: row.interval,
    anchorAt: readTimestamp(row.anchor_at, "bundle candle anchor time"),
    timestamp: readTimestamp(row.timestamp, "bundle candle timestamp")
  };
  for (const field of ["open", "high", "low", "close", "volume"]) {
    candle[field] = readFiniteNumber(row[field], `bundle candle ${field}`);
  }
  return Object.freeze(candle);
}

function normalizeJsonValue(value, field) {
  if (typeof value !== "string") {
    if (value === null || typeof value !== "object") {
      throw new RepositoryDataError(`invalid ${field}`);
    }
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    throw new RepositoryDataError(`invalid ${field}`);
  }
}

function createDecisionSamplingSummary({
  sourceCount,
  sampledDecisions,
  from,
  to,
  linkedDecisions,
  unresolvedTradeDecisionLinkCount
}) {
  const inWindow = (decision) => {
    const timestamp = Date.parse(decision.created_at);
    return Number.isFinite(timestamp)
      && timestamp >= Date.parse(from)
      && timestamp <= Date.parse(to);
  };
  const linkedInWindowCount = linkedDecisions.filter(inWindow).length;
  const includedInWindowCount = sampledDecisions.length + linkedInWindowCount;
  return Object.freeze({
    method: "trade-linked-first; deterministic round-robin by UTC day, market, action, confidence band, strategy name and version",
    sourceCount,
    includedInWindowCount,
    sampledDecisionCount: sampledDecisions.length,
    linkedDecisionCount: linkedDecisions.length,
    linkedDecisionInWindowCount: linkedInWindowCount,
    linkedDecisionOutsideWindowCount: linkedDecisions.length - linkedInWindowCount,
    unresolvedTradeDecisionLinkCount,
    omittedInWindowCount: Math.max(0, sourceCount - includedInWindowCount),
    truncated: sourceCount > includedInWindowCount,
    sampleDistribution: Object.freeze({
      utcDays: countDecisionDimension(
        sampledDecisions,
        (decision) => decision.created_at.slice(0, 10)
      ),
      markets: countDecisionDimension(sampledDecisions, (decision) => decision.symbol),
      actions: countDecisionDimension(sampledDecisions, (decision) => decision.decision),
      confidenceBands: countDecisionDimension(
        sampledDecisions,
        (decision) => decisionConfidenceBand(decision.confidence)
      ),
      strategyVersions: countStrategyVersions(sampledDecisions)
    })
  });
}

function countDecisionDimension(decisions, getValue) {
  const counts = new Map();
  for (const decision of decisions) {
    const value = getValue(decision) ?? "UNSPECIFIED";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.freeze([...counts.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([value, count]) => Object.freeze({ value, count })));
}

function countStrategyVersions(decisions) {
  const counts = new Map();
  for (const decision of decisions) {
    const key = JSON.stringify([decision.strategy_name, decision.strategy_version]);
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, {
        strategyName: decision.strategy_name ?? null,
        strategyVersion: decision.strategy_version ?? null,
        count: 1
      });
    }
  }
  return Object.freeze([...counts.values()]
    .sort((left, right) => {
      const leftKey = JSON.stringify([left.strategyName, left.strategyVersion]);
      const rightKey = JSON.stringify([right.strategyName, right.strategyVersion]);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    })
    .map((item) => Object.freeze(item)));
}

function decisionConfidenceBand(confidence) {
  if (confidence < 50) return "[0,50)";
  if (confidence < 60) return "[50,60)";
  if (confidence < 70) return "[60,70)";
  if (confidence < 80) return "[70,80)";
  if (confidence < 90) return "[80,90)";
  return "[90,100]";
}

function createCandleAnchors(trades, linkedDecisions, sampledDecisions, limit) {
  const tradeRelatedAnchors = getUniqueCandleAnchors([...trades, ...linkedDecisions]);
  const sampledAnchors = getUniqueCandleAnchors(sampledDecisions);
  const anchors = tradeRelatedAnchors.slice(0, limit);
  const includedKeys = new Set(anchors.map(({ symbol, anchor_at }) => `${symbol}\u0000${anchor_at}`));
  for (const anchor of sampledAnchors) {
    const key = `${anchor.symbol}\u0000${anchor.anchor_at}`;
    if (!includedKeys.has(key) && anchors.length < limit) {
      anchors.push(anchor);
      includedKeys.add(key);
    }
  }
  const includedSampledDecisionAnchors = sampledAnchors
    .filter(({ symbol, anchor_at }) => includedKeys.has(`${symbol}\u0000${anchor_at}`))
    .length;
  return Object.freeze({
    anchors: Object.freeze(anchors),
    summary: Object.freeze({
      method: "trade and linked-decision anchors first; then sampled-decision anchors in chronological order",
      limit,
      tradeRelatedAnchorCount: tradeRelatedAnchors.length,
      includedTradeRelatedAnchors: Math.min(tradeRelatedAnchors.length, limit),
      sampledDecisionAnchorCount: sampledAnchors.length,
      includedSampledDecisionAnchors,
      omittedTradeRelatedAnchors: Math.max(0, tradeRelatedAnchors.length - limit),
      omittedSampledDecisionAnchors: Math.max(
        0,
        sampledAnchors.length - includedSampledDecisionAnchors
      )
    })
  });
}

function getUniqueCandleAnchors(rows) {
  const sorted = [...rows].sort((left, right) => {
    const timeDifference = Date.parse(left.created_at) - Date.parse(right.created_at);
    if (timeDifference !== 0) return timeDifference;
    const leftSymbol = String(left.symbol);
    const rightSymbol = String(right.symbol);
    if (leftSymbol !== rightSymbol) return leftSymbol < rightSymbol ? -1 : 1;
    const leftId = String(left.id);
    const rightId = String(right.id);
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });
  const anchors = new Map();
  for (const row of sorted) {
    const key = `${row.symbol}\u0000${row.created_at}`;
    if (!anchors.has(key)) {
      anchors.set(key, { symbol: row.symbol, anchor_at: row.created_at });
    }
  }
  return [...anchors.values()];
}

function createEmptyAnalysisBundle({ analytics, period, from, to, limit }) {
  return Object.freeze({
    manifest: Object.freeze({
      requestedRange: Object.freeze({ period, from, to, timezone: "UTC" }),
      generatedAt: to,
      calculationVersion: analytics.calculationVersion,
      sourceCounts: Object.freeze({
        trades: 0,
        decisions: 0,
        snapshots: 0,
        shadowExitScenarios: 0,
        shadowExitEvents: 0
      }),
      includedCounts: Object.freeze({
        trades: 0,
        decisions: 0,
        linkedDecisions: 0,
        portfolioSnapshots: 0,
        candleRows: 0,
        candleAnchorCount: 0,
        shadowExitScenarios: 0,
        shadowExitEvents: 0
      }),
      decisionSampling: createDecisionSamplingSummary({
        sourceCount: 0,
        sampledDecisions: [],
        linkedDecisions: [],
        from,
        to,
        unresolvedTradeDecisionLinkCount: 0
      }),
      candleSampling: createCandleAnchors([], [], [], 50).summary,
      limits: Object.freeze({
        rowsPerSource: limit,
        candleAnchorLimit: 50,
        candlesPerIntervalPerAnchor: 20,
        candleRowLimit: 6000
      }),
      truncation: Object.freeze({
        trades: false,
        decisions: false,
        portfolioSnapshots: false,
        linkedDecisions: false,
        candleWindows: false,
        shadowExitScenarios: false,
        shadowExitEvents: false,
        analyticsHistory: false
      })
    }),
    analytics,
    analyticsHistory: Object.freeze([]),
    trades: Object.freeze([]),
    decisions: Object.freeze([]),
    portfolioSnapshots: Object.freeze([]),
    candleWindows: Object.freeze([]),
    shadowExitScenarios: Object.freeze([]),
    shadowExitEvents: Object.freeze([])
  });
}
