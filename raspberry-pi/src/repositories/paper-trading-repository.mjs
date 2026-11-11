import { withWriteTransaction } from "../database/write-transaction.mjs";
import { queryReadOnly } from "./postgres-read.mjs";

export const MAX_PAPER_TRADING_MARKETS = 500;
export const MAX_PAPER_TRADING_PORTFOLIOS = 500;
export const MAX_PAPER_TRADING_POSITIONS = 500;
export const PAPER_TRADING_RUN_LOCK_ID = 882018081;

const SYMBOL_PATTERN = /^[A-Z0-9]+-EUR$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_VALUES = new Set(["ACTIVE", "ANALYZING", "IDLE", "STOPPED", "ERROR"]);
const EMERGENCY_VALUES = new Set(["NORMAL", "PAUSED", "EMERGENCY_STOP"]);

const ENSURE_PORTFOLIOS_SQL = `
  WITH candidates AS (
    SELECT profile.id
    FROM public."AI_Crypto_Bot_Profiles" AS profile
    WHERE NOT EXISTS (
      SELECT 1
      FROM public."AI_Crypto_Bot_Portfolios" AS portfolio
      WHERE portfolio.user_id = profile.id
    )
    ORDER BY profile.created_at ASC, profile.id ASC
    LIMIT $2
  ),
  new_portfolios AS (
    INSERT INTO public."AI_Crypto_Bot_Portfolios"
      (user_id, starting_balance, available_balance, portfolio_value)
    SELECT candidate.id, $1::numeric, $1::numeric, $1::numeric
    FROM candidates AS candidate
    RETURNING id, starting_balance, available_balance
  )
  INSERT INTO public."AI_Crypto_Bot_Portfolio_Snapshots"
    (portfolio_id, portfolio_value, available_balance, open_positions)
  SELECT portfolio.id, portfolio.starting_balance, portfolio.available_balance, 0
  FROM new_portfolios AS portfolio
  RETURNING portfolio_id
`;

const PORTFOLIOS_SQL = `
  SELECT portfolio.id,
         portfolio.starting_balance,
         portfolio.available_balance,
         portfolio.portfolio_value,
         portfolio.created_at
  FROM public."AI_Crypto_Bot_Portfolios" AS portfolio
  ORDER BY portfolio.created_at ASC, portfolio.id ASC
  LIMIT $1
  FOR UPDATE
`;

const STATUS_SQL = `
  SELECT status_row.status,
         status_row.is_active,
         status_row.is_analyzing,
         status_row.last_run
  FROM public."AI_Crypto_Bot_Status" AS status_row
  WHERE status_row.singleton IS TRUE
  LIMIT 1
`;

const STATUS_FOR_UPDATE_SQL = `${STATUS_SQL.trimEnd()} FOR UPDATE`;

const UPDATE_STATUS_SQL = `
  UPDATE public."AI_Crypto_Bot_Status"
  SET status = $1,
      is_active = $2,
      is_analyzing = $3,
      last_run = CASE WHEN $4::boolean THEN $5::timestamptz ELSE last_run END,
      error_message = $6,
      updated_at = $5::timestamptz
  WHERE singleton IS TRUE
    AND ($1 = 'STOPPED' OR status <> 'STOPPED')
  RETURNING status
`;

const LATEST_DECISIONS_SQL = `
  SELECT DISTINCT ON (decision.symbol)
         decision.id,
         decision.symbol,
         decision.decision,
         decision.confidence,
         decision.created_at
  FROM public."AI_Crypto_Bot_AI_Decisions" AS decision
  JOIN public."AI_Crypto_Bot_Watched_Markets" AS watched_market
    ON watched_market.symbol = decision.symbol
   AND watched_market.enabled IS TRUE
  ORDER BY decision.symbol ASC, decision.created_at DESC, decision.id DESC
  LIMIT $1
`;

const OPEN_POSITIONS_SQL = `
  SELECT position.id,
         position.symbol,
         position.amount,
         position.entry_price,
         position.current_price,
         position.unrealized_pnl,
         position.created_at
  FROM public."AI_Crypto_Bot_Positions" AS position
  WHERE position.portfolio_id = $1
    AND position.status = 'OPEN'
  ORDER BY position.created_at ASC, position.id ASC
  LIMIT $2
  FOR UPDATE
`;

const OPEN_POSITION_TOTALS_SQL = `
  SELECT COALESCE(pg_catalog.sum(position.amount), 0)::numeric(28, 12) AS amount,
         COALESCE(
           pg_catalog.sum(position.entry_price * position.amount),
           0
         )::numeric(28, 12) AS entry_cost_basis
  FROM public."AI_Crypto_Bot_Positions" AS position
  WHERE position.portfolio_id = $1
    AND position.symbol = $2
    AND position.status = 'OPEN'
`;

const MARKET_DATA_SQL = `
  SELECT market_data.symbol,
         market_data.price,
         market_data.captured_at
  FROM public."AI_Crypto_Bot_Market_Data" AS market_data
  WHERE market_data.symbol = ANY($1::text[])
  ORDER BY market_data.symbol ASC
  LIMIT $2
`;

const REFRESH_POSITION_PRICES_SQL = `
  UPDATE public."AI_Crypto_Bot_Positions" AS position
  SET current_price = market_data.price,
      unrealized_pnl = pg_catalog.round(
        (market_data.price - position.entry_price) * position.amount,
        12
      )
  FROM public."AI_Crypto_Bot_Market_Data" AS market_data
  WHERE position.portfolio_id = $1
    AND position.status = 'OPEN'
    AND market_data.symbol = position.symbol
    AND market_data.captured_at >= $2::timestamptz - INTERVAL '15 minutes'
    AND market_data.captured_at <= $2::timestamptz + INTERVAL '1 minute'
`;

const PORTFOLIO_VALUE_SQL = `
  SELECT portfolio.starting_balance,
         portfolio.available_balance,
         pg_catalog.round(
           portfolio.available_balance
             + COALESCE(pg_catalog.sum(position.amount * position.current_price), 0),
           12
         ) AS portfolio_value,
         pg_catalog.count(position.id)::integer AS open_positions
  FROM public."AI_Crypto_Bot_Portfolios" AS portfolio
  LEFT JOIN public."AI_Crypto_Bot_Positions" AS position
    ON position.portfolio_id = portfolio.id
   AND position.status = 'OPEN'
  WHERE portfolio.id = $1
  GROUP BY portfolio.id
`;

const UPDATE_PORTFOLIO_VALUE_SQL = `
  UPDATE public."AI_Crypto_Bot_Portfolios" AS portfolio
  SET portfolio_value = $2::numeric
  WHERE portfolio.id = $1
  RETURNING portfolio.available_balance, portfolio.portfolio_value
`;

const INSERT_SNAPSHOT_SQL = `
  INSERT INTO public."AI_Crypto_Bot_Portfolio_Snapshots"
    (portfolio_id, portfolio_value, available_balance, open_positions)
  VALUES ($1, $2::numeric, $3::numeric, $4::integer)
`;

const DRAWDOWN_SNAPSHOT_SQL = `
  SELECT GREATEST($2::numeric, COALESCE(MAX(snapshot.portfolio_value), $2::numeric))
           AS peak_value,
         COALESCE((
           SELECT previous.portfolio_value
           FROM public."AI_Crypto_Bot_Portfolio_Snapshots" AS previous
           WHERE previous.portfolio_id = $1
             AND previous.captured_at < $3::timestamptz
           ORDER BY previous.captured_at DESC, previous.id DESC
           LIMIT 1
         ), $2::numeric) AS daily_start_value
  FROM public."AI_Crypto_Bot_Portfolio_Snapshots" AS snapshot
  WHERE snapshot.portfolio_id = $1
`;

const LATEST_EMERGENCY_SQL = `
  SELECT emergency.status
  FROM public."AI_Crypto_Bot_Emergency_State" AS emergency
  ORDER BY emergency.created_at DESC, emergency.id DESC
  LIMIT 1
  FOR UPDATE
`;

const INSERT_EMERGENCY_SQL = `
  INSERT INTO public."AI_Crypto_Bot_Emergency_State" (status, reason)
  VALUES ('EMERGENCY_STOP', $1)
  RETURNING id
`;

const EXISTING_TRADE_KEYS_SQL = `
  SELECT trade.idempotency_key
  FROM public."AI_Crypto_Bot_Trades" AS trade
  WHERE trade.idempotency_key = ANY($1::uuid[])
`;

const COOLDOWN_SQL = `
  SELECT trade.symbol, MAX(trade.created_at) AS latest_trade_at
  FROM public."AI_Crypto_Bot_Trades" AS trade
  WHERE trade.portfolio_id = $1
    AND trade.symbol = ANY($2::text[])
  GROUP BY trade.symbol
  ORDER BY trade.symbol ASC
`;

const BUY_QUOTE_SQL = `
  WITH inputs AS (
    SELECT $1::numeric AS market_price,
           $2::numeric AS portfolio_value,
           $3::numeric AS available_balance
  ),
  sizing AS (
    SELECT inputs.market_price,
           inputs.available_balance,
           pg_catalog.round(inputs.market_price * 1.001, 12) AS execution_price,
           LEAST(
             inputs.portfolio_value * 0.10,
             inputs.available_balance / 1.0025
           ) AS max_notional
    FROM inputs
  ),
  quantity AS (
    SELECT sizing.*,
           pg_catalog.trunc(sizing.max_notional / sizing.execution_price, 12) AS amount
    FROM sizing
  ),
  costs AS (
    SELECT quantity.*,
           pg_catalog.round(quantity.amount * quantity.execution_price, 12) AS notional
    FROM quantity
  ),
  fees AS (
    SELECT costs.*,
           pg_catalog.round(costs.notional * 0.0025, 12) AS fee
    FROM costs
  )
  SELECT execution_price,
         amount,
         notional,
         fee,
         pg_catalog.round((execution_price - market_price) * amount, 12) AS slippage,
         notional + fee AS cash_required,
         CASE WHEN amount > 0
           THEN pg_catalog.round((notional + fee) / amount, 12)
           ELSE 0
         END AS entry_price,
         pg_catalog.round(
           (market_price * amount) - (notional + fee),
           12
         ) AS unrealized_pnl,
         (notional + fee) <= available_balance AS affordable
  FROM fees
`;

const INSERT_TRADE_SQL = `
  INSERT INTO public."AI_Crypto_Bot_Trades"
    (portfolio_id, ai_decision_id, idempotency_key, symbol, side, price,
     quantity, fees, slippage, realized_pnl)
  VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::numeric,
          $7::numeric, $8::numeric, $9::numeric, $10::numeric)
  RETURNING id
`;

const INSERT_POSITION_SQL = `
  INSERT INTO public."AI_Crypto_Bot_Positions"
    (portfolio_id, symbol, amount, entry_price, current_price, unrealized_pnl)
  VALUES ($1::uuid, $2::text, $3::numeric, $4::numeric, $5::numeric, $6::numeric)
  RETURNING id
`;

const UPDATE_PORTFOLIO_AFTER_TRADE_SQL = `
  WITH open_position_value AS (
    SELECT pg_catalog.round(
             COALESCE(pg_catalog.sum(position.amount * position.current_price), 0),
             12
           ) AS market_value,
           pg_catalog.count(*)::integer AS open_positions
    FROM public."AI_Crypto_Bot_Positions" AS position
    WHERE position.portfolio_id = $1
      AND position.status = 'OPEN'
  )
  UPDATE public."AI_Crypto_Bot_Portfolios" AS portfolio
  SET available_balance = portfolio.available_balance + $2::numeric,
      portfolio_value = pg_catalog.round(
        portfolio.available_balance + $2::numeric + open_position_value.market_value,
        12
      )
  FROM open_position_value
  WHERE portfolio.id = $1
  RETURNING portfolio.available_balance,
            portfolio.portfolio_value,
            open_position_value.open_positions
`;

const SELL_QUOTE_SQL = `
  WITH inputs AS (
    SELECT $1::numeric AS market_price,
           $2::numeric AS amount,
           $3::numeric AS entry_cost_basis
  ),
  execution AS (
    SELECT inputs.*,
           pg_catalog.round(inputs.market_price * 0.999, 12) AS execution_price
    FROM inputs
  ),
  proceeds AS (
    SELECT execution.*,
           pg_catalog.round(execution.execution_price * execution.amount, 12)
             AS gross_proceeds
    FROM execution
  ),
  fees AS (
    SELECT proceeds.*,
           pg_catalog.round(proceeds.gross_proceeds * 0.0025, 12) AS fee
    FROM proceeds
  )
  SELECT execution_price,
         amount,
         fee,
         pg_catalog.round((market_price - execution_price) * amount, 12) AS slippage,
         gross_proceeds - fee AS net_proceeds,
         pg_catalog.round(gross_proceeds - fee - entry_cost_basis, 12) AS realized_pnl
  FROM fees
`;

const CLOSE_POSITIONS_SQL = `
  UPDATE public."AI_Crypto_Bot_Positions"
  SET status = 'CLOSED',
      current_price = $3::numeric,
      unrealized_pnl = 0
  WHERE portfolio_id = $1::uuid
    AND symbol = $2::text
    AND status = 'OPEN'
  RETURNING id
`;

export class PaperTradingRepositoryError extends Error {
  constructor(message, code = "PAPER_TRADING_DATABASE_FAILED", cause) {
    super(message, { cause });
    this.name = "PaperTradingRepositoryError";
    this.code = code;
    this.component = "paper-trading-repository";
  }
}

export class PaperTradingRepositoryQueryError extends Error {
  constructor(cause, context) {
    super("A paper-trading database statement failed.", { cause });
    this.name = "PaperTradingRepositoryQueryError";
    this.code = typeof cause?.code === "string"
      ? cause.code
      : "PAPER_TRADING_DATABASE_FAILED";
    this.component = "paper-trading-repository";
    this.paperTradingContext = Object.freeze(context);
  }
}

export class PaperTradingRepository {
  constructor(pool, { logger = console } = {}) {
    if (!pool || typeof pool.connect !== "function") {
      throw new TypeError("A PostgreSQL pool is required.");
    }
    this.pool = pool;
    this.logger = logger;
  }

  withTransaction(operation) {
    return withWriteTransaction(
      this.pool,
      (client) => operation(createPaperTradingQueryClient(client)),
      { logger: this.logger }
    );
  }

  async tryAcquireRunLock(client) {
    const result = await client.query(
      "SELECT pg_catalog.pg_try_advisory_xact_lock($1::bigint) AS locked",
      [PAPER_TRADING_RUN_LOCK_ID]
    );
    return result.rows[0]?.locked === true;
  }

  async ensureDefaultPortfolios(client, startingBalance) {
    const result = await client.query(ENSURE_PORTFOLIOS_SQL, [
      startingBalance,
      MAX_PAPER_TRADING_PORTFOLIOS + 1
    ]);
    if (result.rows.length > MAX_PAPER_TRADING_PORTFOLIOS) {
      throw new PaperTradingRepositoryError(
        "The profile count exceeds the bounded paper portfolio limit.",
        "PAPER_TRADING_PORTFOLIO_LIMIT_EXCEEDED"
      );
    }
    return result.rows.length;
  }

  async getAgentStatus(client, { forUpdate = false } = {}) {
    const result = await client.query(forUpdate ? STATUS_FOR_UPDATE_SQL : STATUS_SQL);
    return result.rows[0] ? validateStatusRow(result.rows[0]) : null;
  }

  async writeAgentStatus(client, {
    status,
    isActive,
    isAnalyzing,
    lastRunAt,
    errorMessage = null,
    updatedAt
  }) {
    if (!STATUS_VALUES.has(status)
      || typeof isActive !== "boolean"
      || typeof isAnalyzing !== "boolean"
      || typeof errorMessage !== "string" && errorMessage !== null) {
      throw new TypeError("A valid runtime status update is required.");
    }
    if (lastRunAt !== null) {
      requireTimestamp(lastRunAt, "runtime last-run timestamp");
    }
    requireTimestamp(updatedAt, "runtime update timestamp");
    const result = await client.query(UPDATE_STATUS_SQL, [
      status,
      isActive,
      isAnalyzing,
      lastRunAt !== null,
      updatedAt,
      errorMessage
    ]);
    return result.rows[0]?.status || null;
  }

  async listPortfolios(client) {
    const result = await client.query(PORTFOLIOS_SQL, [
      MAX_PAPER_TRADING_PORTFOLIOS + 1
    ]);
    if (result.rows.length > MAX_PAPER_TRADING_PORTFOLIOS) {
      throw new PaperTradingRepositoryError(
        "The portfolio count exceeds the bounded paper trading limit.",
        "PAPER_TRADING_PORTFOLIO_LIMIT_EXCEEDED"
      );
    }
    for (const portfolio of result.rows) {
      requireUuid(portfolio.id, "portfolio id");
      requireNumeric(portfolio.starting_balance, "starting balance");
      requireNumeric(portfolio.available_balance, "available balance");
      requireNumeric(portfolio.portfolio_value, "portfolio value");
    }
    return result.rows;
  }

  async listLatestDecisions(client) {
    const result = await client.query(LATEST_DECISIONS_SQL, [
      MAX_PAPER_TRADING_MARKETS + 1
    ]);
    if (result.rows.length > MAX_PAPER_TRADING_MARKETS) {
      throw new PaperTradingRepositoryError(
        "The enabled-market decision count exceeds the bounded paper trading limit.",
        "PAPER_TRADING_MARKET_LIMIT_EXCEEDED"
      );
    }
    for (const decision of result.rows) {
      requireUuid(decision.id, "decision id");
      requireSymbol(decision.symbol);
      if (!["BUY", "SELL", "HOLD", "WAIT"].includes(decision.decision)) {
        throw new PaperTradingRepositoryError(
          "An AI decision has an unsupported value.",
          "PAPER_TRADING_DECISION_INVALID"
        );
      }
      requireNumeric(decision.confidence, "decision confidence");
      if (Number(decision.confidence) < 0 || Number(decision.confidence) > 100) {
        throw new PaperTradingRepositoryError(
          "An AI decision has an unsupported confidence value.",
          "PAPER_TRADING_DECISION_INVALID"
        );
      }
      requireTimestamp(decision.created_at, "decision timestamp");
    }
    return result.rows;
  }

  async listOpenPositions(client, portfolioId) {
    requireUuid(portfolioId, "portfolio id");
    const result = await client.query(OPEN_POSITIONS_SQL, [
      portfolioId,
      MAX_PAPER_TRADING_POSITIONS + 1
    ]);
    if (result.rows.length > MAX_PAPER_TRADING_POSITIONS) {
      throw new PaperTradingRepositoryError(
        "The open-position count exceeds the bounded paper trading limit.",
        "PAPER_TRADING_POSITION_LIMIT_EXCEEDED"
      );
    }
    for (const position of result.rows) {
      requireUuid(position.id, "position id");
      requireSymbol(position.symbol);
      requireNumeric(position.amount, "position amount");
      requireNumeric(position.entry_price, "position entry price");
      requireNumeric(position.current_price, "position current price");
      requireNumeric(position.unrealized_pnl, "position unrealized P&L");
    }
    return result.rows;
  }

  async getOpenPositionTotals(client, portfolioId, symbol) {
    requireUuid(portfolioId, "portfolio id");
    requireSymbol(symbol);
    const result = await client.query(OPEN_POSITION_TOTALS_SQL, [
      portfolioId,
      symbol
    ]);
    const row = result.rows[0];
    if (!row) {
      throw new PaperTradingRepositoryError(
        "The open paper positions could not be totaled.",
        "PAPER_TRADING_POSITION_READ_FAILED"
      );
    }
    return Object.freeze({
      amount: requireNumeric(row.amount, "position amount"),
      entryCostBasis: requireNumeric(row.entry_cost_basis, "position cost basis")
    });
  }

  async listMarketData(client, symbols) {
    validateSymbols(symbols);
    if (symbols.length === 0) {
      return [];
    }
    const result = await client.query(MARKET_DATA_SQL, [
      symbols,
      Math.min(MAX_PAPER_TRADING_MARKETS + 1, symbols.length + 1)
    ]);
    if (result.rows.length > symbols.length) {
      throw new PaperTradingRepositoryError(
        "The market-data query returned an unbounded or duplicate result.",
        "PAPER_TRADING_MARKET_DATA_INVALID"
      );
    }
    for (const market of result.rows) {
      requireSymbol(market.symbol);
      requireNumeric(market.price, "market price");
      requireTimestamp(market.captured_at, "market-data timestamp");
    }
    return result.rows;
  }

  async refreshOpenPositionPrices(client, portfolioId, now) {
    requireUuid(portfolioId, "portfolio id");
    await client.query(REFRESH_POSITION_PRICES_SQL, [portfolioId, now]);
  }

  async refreshPortfolioState(client, portfolioId, now) {
    const values = await client.query(PORTFOLIO_VALUE_SQL, [portfolioId]);
    const row = values.rows[0];
    if (!row) {
      throw new PaperTradingRepositoryError(
        "A portfolio disappeared while it was being refreshed.",
        "PAPER_TRADING_PORTFOLIO_NOT_FOUND"
      );
    }
    const portfolioValue = requireNumeric(row.portfolio_value, "portfolio value");
    const startingBalance = requireNumeric(row.starting_balance, "starting balance");
    const availableBalance = requireNumeric(row.available_balance, "available balance");
    const openPositions = requireCount(row.open_positions, "open position count");
    await client.query(UPDATE_PORTFOLIO_VALUE_SQL, [portfolioId, portfolioValue]);
    await client.query(INSERT_SNAPSHOT_SQL, [
      portfolioId,
      portfolioValue,
      availableBalance,
      openPositions
    ]);

    const dayStart = utcDayStart(now);
    const drawdown = await client.query(DRAWDOWN_SNAPSHOT_SQL, [
      portfolioId,
      startingBalance,
      dayStart
    ]);
    const peakValue = requireNumeric(drawdown.rows[0]?.peak_value, "peak portfolio value");
    const dailyStartValue = requireNumeric(
      drawdown.rows[0]?.daily_start_value,
      "daily starting portfolio value"
    );
    return Object.freeze({
      startingBalance,
      availableBalance,
      portfolioValue,
      openPositions,
      peakValue,
      dailyStartValue
    });
  }

  async getLatestEmergencyStatus(client) {
    const result = await client.query(LATEST_EMERGENCY_SQL);
    const status = result.rows[0]?.status || "NORMAL";
    if (!EMERGENCY_VALUES.has(status)) {
      throw new PaperTradingRepositoryError(
        "The emergency state contains an unsupported value.",
        "PAPER_TRADING_EMERGENCY_STATE_INVALID"
      );
    }
    return status;
  }

  async setEmergencyStop(client, reason) {
    const result = await client.query(INSERT_EMERGENCY_SQL, [reason]);
    if (result.rowCount !== 1) {
      throw new PaperTradingRepositoryError(
        "The emergency stop state could not be persisted.",
        "PAPER_TRADING_EMERGENCY_STATE_WRITE_FAILED"
      );
    }
  }

  async listExistingTradeKeys(client, keys) {
    validateUuidList(keys);
    if (keys.length === 0) {
      return new Set();
    }
    const result = await client.query(EXISTING_TRADE_KEYS_SQL, [keys]);
    return new Set(result.rows.map(({ idempotency_key }) =>
      requireUuid(idempotency_key, "trade idempotency key")));
  }

  async listCooldowns(client, portfolioId, symbols) {
    requireUuid(portfolioId, "portfolio id");
    validateSymbols(symbols);
    if (symbols.length === 0) {
      return new Map();
    }
    const result = await client.query(COOLDOWN_SQL, [portfolioId, symbols]);
    return new Map(result.rows.map((row) => [
      requireSymbol(row.symbol),
      requireTimestamp(row.latest_trade_at, "trade timestamp")
    ]));
  }

  async quoteBuy(client, { marketPrice, portfolioValue, availableBalance }) {
    const result = await client.query(BUY_QUOTE_SQL, [
      requireNumeric(marketPrice, "market price"),
      requireNumeric(portfolioValue, "portfolio value"),
      requireNumeric(availableBalance, "available balance")
    ]);
    return validateQuote(result.rows[0], [
      "execution_price",
      "amount",
      "notional",
      "fee",
      "slippage",
      "cash_required",
      "entry_price",
      "unrealized_pnl"
    ]);
  }

  async quoteSell(client, { marketPrice, amount, entryCostBasis }) {
    const result = await client.query(SELL_QUOTE_SQL, [
      requireNumeric(marketPrice, "market price"),
      requireNumeric(amount, "position amount"),
      requireNumeric(entryCostBasis, "position cost basis")
    ]);
    return validateQuote(result.rows[0], [
      "execution_price",
      "amount",
      "fee",
      "slippage",
      "net_proceeds",
      "realized_pnl"
    ]);
  }

  async insertBuy(client, {
    portfolioId,
    decisionId,
    idempotencyKey,
    symbol,
    quote,
    marketPrice
  }) {
    await this.insertTrade(client, {
      portfolioId,
      decisionId,
      idempotencyKey,
      symbol,
      side: "BUY",
      price: quote.execution_price,
      quantity: quote.amount,
      fees: quote.fee,
      slippage: quote.slippage,
      realizedPnl: "0"
    });
    const position = await client.query(INSERT_POSITION_SQL, [
      portfolioId,
      symbol,
      quote.amount,
      quote.entry_price,
      marketPrice,
      quote.unrealized_pnl
    ]);
    if (position.rowCount !== 1) {
      throw new PaperTradingRepositoryError(
        "The paper position could not be persisted.",
        "PAPER_TRADING_POSITION_WRITE_FAILED"
      );
    }
    const state = await this.updatePortfolioAfterTrade(
      client,
      portfolioId,
      `-${quote.cash_required}`
    );
    await this.insertSnapshot(client, portfolioId, state);
    return state;
  }

  async insertSell(client, {
    portfolioId,
    decisionId,
    idempotencyKey,
    symbol,
    marketPrice,
    quote
  }) {
    const closed = await client.query(CLOSE_POSITIONS_SQL, [
      portfolioId,
      symbol,
      marketPrice
    ]);
    if (closed.rowCount === 0) {
      throw new PaperTradingRepositoryError(
        "The open paper position changed before its exit could be recorded.",
        "PAPER_TRADING_POSITION_CHANGED"
      );
    }
    await this.insertTrade(client, {
      portfolioId,
      decisionId,
      idempotencyKey,
      symbol,
      side: "SELL",
      price: quote.execution_price,
      quantity: quote.amount,
      fees: quote.fee,
      slippage: quote.slippage,
      realizedPnl: quote.realized_pnl
    });
    const state = await this.updatePortfolioAfterTrade(
      client,
      portfolioId,
      quote.net_proceeds
    );
    await this.insertSnapshot(client, portfolioId, state);
    return state;
  }

  async insertTrade(client, {
    portfolioId,
    decisionId,
    idempotencyKey,
    symbol,
    side,
    price,
    quantity,
    fees,
    slippage,
    realizedPnl
  }) {
    const result = await client.query(INSERT_TRADE_SQL, [
      requireUuid(portfolioId, "portfolio id"),
      requireUuid(decisionId, "decision id"),
      requireUuid(idempotencyKey, "trade idempotency key"),
      requireSymbol(symbol),
      side,
      price,
      quantity,
      fees,
      slippage,
      realizedPnl
    ]);
    if (result.rowCount !== 1) {
      throw new PaperTradingRepositoryError(
        "The paper trade could not be persisted.",
        "PAPER_TRADING_TRADE_WRITE_FAILED"
      );
    }
  }

  async updatePortfolioAfterTrade(client, portfolioId, cashDelta) {
    const result = await client.query(UPDATE_PORTFOLIO_AFTER_TRADE_SQL, [
      portfolioId,
      cashDelta
    ]);
    const row = result.rows[0];
    if (!row) {
      throw new PaperTradingRepositoryError(
        "The paper portfolio could not be updated after a trade.",
        "PAPER_TRADING_PORTFOLIO_WRITE_FAILED"
      );
    }
    return Object.freeze({
      availableBalance: requireNumeric(row.available_balance, "available balance"),
      portfolioValue: requireNumeric(row.portfolio_value, "portfolio value"),
      openPositions: requireCount(row.open_positions, "open position count")
    });
  }

  async insertSnapshot(client, portfolioId, state) {
    await client.query(INSERT_SNAPSHOT_SQL, [
      portfolioId,
      state.portfolioValue,
      state.availableBalance,
      state.openPositions
    ]);
  }

  async readAgentStatus() {
    const result = await queryReadOnly(
      this.pool,
      STATUS_SQL,
      [],
      { logger: this.logger }
    );
    return result.rows[0] ? validateStatusRow(result.rows[0]) : null;
  }

  async updateAgentStatus({
    status,
    lastRunAt = null,
    errorMessage = null,
    updatedAt = new Date()
  }) {
    return this.withTransaction(async (client) => {
      const currentStatus = await this.getAgentStatus(client, { forUpdate: true });
      if (!currentStatus) {
        throw new PaperTradingRepositoryError(
          "The existing singleton runtime status row is missing.",
          "PAPER_TRADING_STATUS_ROW_MISSING"
        );
      }
      const savedStatus = await this.updateStatusInTransaction(client, {
        status,
        lastRunAt,
        errorMessage,
        updatedAt
      });
      return savedStatus || currentStatus.status;
    });
  }

  async updateStatusInTransaction(client, {
    status,
    lastRunAt = null,
    errorMessage = null,
    updatedAt
  }) {
    if (!STATUS_VALUES.has(status)) {
      throw new TypeError("A supported agent status is required.");
    }
    return this.writeAgentStatus(client, {
      status,
      isActive: status === "ACTIVE" || status === "ANALYZING",
      isAnalyzing: status === "ANALYZING",
      lastRunAt,
      errorMessage,
      updatedAt
    });
  }
}

function createPaperTradingQueryClient(client) {
  return new Proxy(client, {
    get(target, property) {
      if (property === "query") {
        return async (sql, values) => {
          try {
            return await target.query(sql, values);
          } catch (cause) {
            throw new PaperTradingRepositoryQueryError(
              cause,
              describePaperTradingQuery(sql)
            );
          }
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

function describePaperTradingQuery(sql) {
  const query = typeof sql === "string" ? sql : sql?.text || "";
  const isSelectForUpdate = /\bFOR\s+UPDATE\b/i.test(query);
  const insertTargets = [...query.matchAll(
    /\bINSERT\s+INTO\s+public\."([^"]+)"/gi
  )].map((match) => match[1]);
  const updateTarget = query.match(/\bUPDATE\s+public\."([^"]+)"/i)?.[1];
  const selectTarget = query.match(/\bFROM\s+public\."([^"]+)"/i)?.[1];
  const operation = isSelectForUpdate
    ? "SELECT FOR UPDATE"
    : insertTargets.length > 0
      ? "INSERT"
      : updateTarget
        ? "UPDATE"
        : selectTarget
          ? "SELECT"
          : "QUERY";
  const table = isSelectForUpdate
    ? selectTarget
    : insertTargets[0] || updateTarget || selectTarget;
  const requiredPrivilege = isSelectForUpdate || updateTarget
    ? "UPDATE"
    : insertTargets.length > 0
      ? "INSERT"
      : selectTarget
        ? "SELECT"
        : null;

  return {
    ...(table ? { table } : {}),
    operation,
    ...(requiredPrivilege ? { requiredPrivilege } : {}),
    ...(insertTargets.length > 1 ? { tables: insertTargets } : {}),
    ...(query === LATEST_EMERGENCY_SQL
      ? { repositoryOperation: "getLatestEmergencyStatus" }
      : {})
  };
}

function validateSymbols(symbols) {
  if (!Array.isArray(symbols)
    || symbols.length > MAX_PAPER_TRADING_MARKETS
    || symbols.some((symbol) => typeof symbol !== "string" || !SYMBOL_PATTERN.test(symbol))
    || new Set(symbols).size !== symbols.length) {
    throw new TypeError("A bounded, unique EUR market list is required.");
  }
}

function validateStatusRow(row) {
  if (!STATUS_VALUES.has(row.status)
    || typeof row.is_active !== "boolean"
    || typeof row.is_analyzing !== "boolean") {
    throw new PaperTradingRepositoryError(
      "The runtime status row contains invalid values.",
      "PAPER_TRADING_STATUS_INVALID"
    );
  }
  return Object.freeze({
    ...row,
    last_run: row.last_run === null
      ? null
      : requireTimestamp(row.last_run, "runtime last-run timestamp")
  });
}

function validateUuidList(values) {
  if (!Array.isArray(values)
    || values.length > MAX_PAPER_TRADING_MARKETS
    || values.some((value) => typeof value !== "string" || !UUID_PATTERN.test(value))
    || new Set(values).size !== values.length) {
    throw new TypeError("A bounded, unique UUID list is required.");
  }
}

function requireUuid(value, label) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new PaperTradingRepositoryError(
      `The ${label} is invalid.`,
      "PAPER_TRADING_DATABASE_DATA_INVALID"
    );
  }
  return value;
}

function requireSymbol(value) {
  if (typeof value !== "string" || !SYMBOL_PATTERN.test(value)) {
    throw new PaperTradingRepositoryError(
      "A stored paper-trading symbol is invalid.",
      "PAPER_TRADING_DATABASE_DATA_INVALID"
    );
  }
  return value;
}

function requireNumeric(value, label) {
  const numeric = typeof value === "number" ? String(value) : value;
  if (typeof numeric !== "string"
    || !/^-?\d+(?:\.\d{1,12})?$/.test(numeric)
    || !Number.isFinite(Number(numeric))) {
    throw new PaperTradingRepositoryError(
      `The ${label} is invalid.`,
      "PAPER_TRADING_DATABASE_DATA_INVALID"
    );
  }
  return numeric;
}

function requireCount(value, label) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new PaperTradingRepositoryError(
      `The ${label} is invalid.`,
      "PAPER_TRADING_DATABASE_DATA_INVALID"
    );
  }
  return count;
}

function requireTimestamp(value, label) {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new PaperTradingRepositoryError(
      `The ${label} is invalid.`,
      "PAPER_TRADING_DATABASE_DATA_INVALID"
    );
  }
  return timestamp;
}

function validateQuote(row, fields) {
  if (!row) {
    throw new PaperTradingRepositoryError(
      "The database returned no paper-trade quote.",
      "PAPER_TRADING_QUOTE_INVALID"
    );
  }
  const quote = {};
  for (const field of fields) {
    quote[field] = requireNumeric(row[field], `paper-trade quote ${field}`);
  }
  quote.affordable = row.affordable === true;
  return Object.freeze(quote);
}

function utcDayStart(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError("A valid runtime timestamp is required.");
  }
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
