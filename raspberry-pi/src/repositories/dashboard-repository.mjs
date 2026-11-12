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
  SELECT id, ai_decision_id, symbol, side, price, quantity, fees, realized_pnl, created_at
  FROM public."AI_Crypto_Bot_Trades"
  WHERE portfolio_id = $1::uuid
    AND created_at >= $2::timestamptz
  ORDER BY symbol ASC, created_at ASC, id ASC
  LIMIT $3
`;
const ANALYTICS_DECISION_SUMMARY_SQL = `
  WITH decisions AS MATERIALIZED (
    SELECT symbol, decision, confidence, strategy_name, strategy_version
    FROM public."AI_Crypto_Bot_AI_Decisions"
    WHERE created_at >= $1::timestamptz
  )
  SELECT 'total'::text AS dimension, NULL::text AS label, COUNT(*)::text AS decision_count
  FROM decisions
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
  SELECT 'symbol', symbol, COUNT(*)::text
  FROM decisions
  GROUP BY symbol
`;
const ANALYTICS_LINKED_DECISIONS_SQL = `
  SELECT id, symbol, decision, confidence, strategy_name, strategy_version, created_at
  FROM public."AI_Crypto_Bot_AI_Decisions"
  WHERE id = ANY($1::uuid[])
    AND created_at >= $2::timestamptz
  ORDER BY symbol ASC, created_at ASC, id ASC
  LIMIT $3
`;
const ANALYTICS_SNAPSHOTS_SQL = `
  SELECT id, portfolio_id, portfolio_value, available_balance, open_positions, captured_at
  FROM public."AI_Crypto_Bot_Portfolio_Snapshots"
  WHERE portfolio_id = $1::uuid
    AND captured_at >= $2::timestamptz
  ORDER BY captured_at ASC, id ASC
  LIMIT $3
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
    const cutoff = new Date(
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
        snapshots: []
      });
    }

    const [positionsResult, tradesResult, decisionSummaryResult, snapshotsResult] = await Promise.all([
      queryReadOnly(
        this.pool,
        ANALYTICS_POSITIONS_SQL,
        [portfolioRow.id, MAX_ANALYTICS_ROWS + 1],
        { logger: this.logger }
      ),
      queryReadOnly(
        this.pool,
        ANALYTICS_TRADES_SQL,
        [portfolioRow.id, cutoff, MAX_ANALYTICS_ROWS + 1],
        { logger: this.logger }
      ),
      queryReadOnly(
        this.pool,
        ANALYTICS_DECISION_SUMMARY_SQL,
        [cutoff],
        { logger: this.logger }
      ),
      queryReadOnly(
        this.pool,
        ANALYTICS_SNAPSHOTS_SQL,
        [portfolioRow.id, cutoff, MAX_ANALYTICS_ROWS + 1],
        { logger: this.logger }
      )
    ]);
    for (const [name, result] of [
      ["positions", positionsResult],
      ["trades", tradesResult],
      ["snapshots", snapshotsResult]
    ]) {
      if (result.rows.length > MAX_ANALYTICS_ROWS) {
        throw new RepositoryDataError(`analytics ${name} exceed the bounded query limit`);
      }
    }
    if (decisionSummaryResult.rows.length > MAX_ANALYTICS_ROWS) {
      throw new RepositoryDataError("analytics decision groups exceed the bounded query limit");
    }
    const portfolio = {
      starting_balance: readFiniteNumber(portfolioRow.starting_balance, "starting balance"),
      portfolio_value: readFiniteNumber(portfolioRow.portfolio_value, "portfolio value")
    };
    const positions = positionsResult.rows.map((row) => {
      if (!["OPEN", "CLOSED"].includes(row.status) || typeof row.symbol !== "string") {
        throw new RepositoryDataError("invalid analytics position");
      }
      return {
        symbol: row.symbol,
        status: row.status,
        unrealized_pnl: readFiniteNumber(row.unrealized_pnl, "position unrealized P&L")
      };
    });
    const trades = tradesResult.rows.map(normalizeTrade);
    const decisionSummary = normalizeAnalyticsDecisionSummary(decisionSummaryResult.rows);
    const decisionIds = [...new Set(trades
      .map(({ ai_decision_id }) => ai_decision_id)
      .filter((id) => typeof id === "string" && UUID_PATTERN.test(id)))];
    const decisionsResult = decisionIds.length === 0
      ? { rows: [] }
      : await queryReadOnly(
        this.pool,
        ANALYTICS_LINKED_DECISIONS_SQL,
        [decisionIds, cutoff, MAX_ANALYTICS_ROWS + 1],
        { logger: this.logger }
      );
    if (decisionsResult.rows.length > MAX_ANALYTICS_ROWS) {
      throw new RepositoryDataError("analytics linked decisions exceed the bounded query limit");
    }
    const decisions = decisionsResult.rows.map(normalizeAnalyticsDecision);
    const snapshots = snapshotsResult.rows.map(normalizeSnapshot);
    return buildDashboardAnalytics({
      period,
      now,
      portfolio,
      positions,
      trades,
      decisions,
      decisionSummary,
      snapshots
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
    created_at: readTimestamp(row.created_at, "decision timestamp")
  };
}

function normalizeAnalyticsDecisionSummary(rows) {
  const summary = {
    decisionCount: null,
    below70Count: null,
    actions: [],
    confidenceBuckets: [],
    strategies: [],
    bySymbol: []
  };
  const allowedActions = new Set(["BUY", "SELL", "HOLD", "WAIT"]);
  const allowedBuckets = new Set(["70–75", "75–80", "80–85", "85+"]);
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
    } else if (dimension === "strategy" && typeof label === "string" && label.length > 0) {
      summary.strategies.push({ label, decisionCount: count });
    } else if (dimension === "symbol" && typeof label === "string" && label.length > 0) {
      summary.bySymbol.push({ label, decisionCount: count });
    } else {
      throw new RepositoryDataError("invalid analytics decision summary");
    }
  }
  if (summary.decisionCount === null || summary.below70Count === null || invalidCount !== 0
    || summary.actions.reduce((total, row) => total + row.decisionCount, 0)
      !== summary.decisionCount
    || summary.confidenceBuckets.reduce((total, row) => total + row.decisionCount, 0)
      + summary.below70Count !== summary.decisionCount
    || summary.bySymbol.reduce((total, row) => total + row.decisionCount, 0)
      !== summary.decisionCount) {
    throw new RepositoryDataError("inconsistent analytics decision summary");
  }
  return Object.freeze({
    ...summary,
    actions: Object.freeze(summary.actions.map(Object.freeze)),
    confidenceBuckets: Object.freeze(summary.confidenceBuckets.map(Object.freeze)),
    strategies: Object.freeze(summary.strategies.map(Object.freeze)),
    bySymbol: Object.freeze(summary.bySymbol.map(Object.freeze))
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
