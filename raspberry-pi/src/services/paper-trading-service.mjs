import { createHash } from "node:crypto";
import { MAX_PAPER_TRADING_MARKETS } from "../repositories/paper-trading-repository.mjs";
import { createPaperTradingFailureDiagnostic } from "./paper-trading-diagnostics.mjs";
import {
  assessPositionExit,
  POSITION_EXIT_POLICY
} from "./position-exit-policy.mjs";

export const PAPER_TRADING_RULES = Object.freeze({
  maxPositionSizeFraction: 0.10,
  maxOpenPositions: 9,
  minimumConfidence: 70,
  cooldownMs: 15 * 60 * 1000,
  marketDataFreshnessMs: 15 * 60 * 1000,
  futureTimestampToleranceMs: 60 * 1000,
  feeRate: 0.0025,
  slippageRate: 0.001,
  dailyDrawdownFraction: 0.05,
  maxPortfolioDrawdownFraction: 0.15,
  emergencyDrawdownFraction: 0.20
});

const TRADE_DECISIONS = new Set(["BUY", "SELL"]);
const SYMBOL_PATTERN = /^[A-Z0-9]+-EUR$/;
const SCALE = 1_000_000_000_000n;

export class PaperTradingServiceError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = "PaperTradingServiceError";
    this.code = code;
    this.component = "paper-trading-service";
  }
}

export class PaperTradingConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "PaperTradingConfigurationError";
    this.code = "PAPER_TRADING_CONFIGURATION_INVALID";
    this.component = "configuration";
  }
}

export function createPaperTradingDatabaseConfig(config, env = process.env) {
  const user = config.paperTrading?.databaseUser || "";
  const password = config.paperTrading?.databasePassword || "";
  const ingestionUser = env.INGESTION_DATABASE_USER?.trim() || config.database.user;
  const aiUser = config.aiAnalysis?.databaseUser || "";
  if (!user || !password) {
    throw new PaperTradingConfigurationError(
      "PAPER_DATABASE_USER and PAPER_DATABASE_PASSWORD are required for paper trading."
    );
  }
  if ([config.database.user, ingestionUser, aiUser].includes(user)) {
    throw new PaperTradingConfigurationError(
      "PAPER_DATABASE_USER must be distinct from the API, ingestion, and AI database users."
    );
  }
  return Object.freeze({
    ...config,
    database: Object.freeze({
      ...config.database,
      user,
      password
    })
  });
}

export function createPaperTradingService({
  repository,
  now = () => new Date(),
  logger = console
} = {}) {
  if (!repository
    || typeof repository.withTransaction !== "function"
    || typeof repository.tryAcquireRunLock !== "function"
    || typeof repository.getSystemPortfolio !== "function"
    || typeof repository.listLatestDecisions !== "function"
    || typeof repository.listTrailingExitCandles !== "function"
    || typeof repository.updatePositionExitState !== "function"
    || typeof now !== "function") {
    throw new TypeError("A paper-trading repository and clock are required.");
  }

  return Object.freeze({
    async run() {
      const currentTime = readTime(now());
      try {
        const tradingResult = await repository.withTransaction(async (client) => {
          if (!await repository.tryAcquireRunLock(client)) {
            return skipped("RUN_IN_PROGRESS");
          }
          const agentStatus = await repository.getAgentStatus(client, { forUpdate: true });
          if (!agentStatus) {
            throw new PaperTradingServiceError(
              "PAPER_TRADING_STATUS_ROW_MISSING",
              "The existing singleton runtime status row is missing."
            );
          }
          if (agentStatus.status === "ANALYZING") {
            return skipped("AI_ANALYSIS_IN_PROGRESS");
          }

          const systemAccount = await repository.getSystemPortfolio(client);
          if (!systemAccount
            || !["READY", "PROFILE_MISSING", "PORTFOLIO_MISSING"].includes(systemAccount.status)) {
            throw new PaperTradingServiceError(
              "PAPER_TRADING_SYSTEM_PROFILE_INVALID",
              "The system profile repository returned an invalid state."
            );
          }
          if (systemAccount.status !== "READY") {
            const code = systemAccount.status === "PROFILE_MISSING"
              ? "SYSTEM_PROFILE_NOT_PROVISIONED"
              : "SYSTEM_PORTFOLIO_NOT_PROVISIONED";
            const message = JSON.stringify({
              event: "paper_trading_not_provisioned",
              code,
              component: "paper-trading-service"
            });
            const log = typeof logger.warn === "function" ? logger.warn : logger.error;
            log.call(logger, message);
            return skipped(code);
          }
          const portfolios = [systemAccount.portfolio];
          const decisions = await repository.listLatestDecisions(client);
          const openPositionsByPortfolio = new Map();
          const symbols = new Set(decisions.map(({ symbol }) => symbol));
          for (const portfolio of portfolios) {
            const positions = await repository.listOpenPositions(client, portfolio.id);
            openPositionsByPortfolio.set(portfolio.id, positions);
            for (const position of positions) {
              symbols.add(position.symbol);
            }
          }
          const marketRows = await repository.listMarketData(client, [...symbols].sort());
          const marketData = indexMarketData(marketRows);
          let emergencyStatus = await repository.getLatestEmergencyStatus(client);
          let effectiveAgentStatus = agentStatus.status;
          const result = {
            status: "COMPLETED",
            portfoliosProcessed: 0,
            decisionsProcessed: 0,
            tradesExecuted: 0,
            automaticExits: 0,
            duplicates: 0,
            skipped: 0
          };

          for (const portfolio of portfolios) {
            await repository.refreshOpenPositionPrices(
              client,
              portfolio.id,
              currentTime
            );
            let state = await repository.refreshPortfolioState(
              client,
              portfolio.id,
              currentTime
            );
            result.portfoliosProcessed += 1;
            if (isAtOrBelowFraction(
              state.portfolioValue,
              state.peakValue,
              1 - PAPER_TRADING_RULES.emergencyDrawdownFraction
            )) {
              if (emergencyStatus !== "EMERGENCY_STOP") {
                await repository.setEmergencyStop(
                  client,
                  `Portfolio ${portfolio.id} reached the 20% emergency drawdown threshold.`
                );
                emergencyStatus = "EMERGENCY_STOP";
              }
              effectiveAgentStatus = await repository.updateStatusInTransaction(client, {
                status: "STOPPED",
                errorMessage: "Paper portfolio emergency drawdown threshold reached.",
                lastRunAt: null,
                updatedAt: currentTime
              });
            }

            let openPositions = await repository.listOpenPositions(client, portfolio.id);
            const idempotencyKeys = decisions.map(({ id }) =>
              createTradeIdempotencyKey(portfolio.id, id));
            const existingKeys = await repository.listExistingTradeKeys(
              client,
              idempotencyKeys
            );
            const cooldowns = await repository.listCooldowns(
              client,
              portfolio.id,
              [...new Set(decisions.map(({ symbol }) => symbol))].sort()
            );

            const exitCandles = openPositions.length > 0
              ? await repository.listTrailingExitCandles(
                client,
                [...new Set(openPositions.map(({ symbol }) => symbol))].sort(),
                currentTime
              )
              : [];
            const candlesBySymbol = groupCandlesBySymbol(exitCandles);
            for (const position of [...openPositions]) {
              const market = marketData.get(position.symbol);
              if (!market || !isFresh(market.captured_at, currentTime)) {
                logPositionExitDataQuality(
                  logger,
                  position,
                  market ? "STALE_MARKET_DATA" : "MISSING_MARKET_DATA"
                );
                continue;
              }
              const assessment = assessPositionExit(
                position,
                market.price,
                candlesBySymbol.get(position.symbol) || [],
                currentTime
              );
              const savedExitState = await repository.updatePositionExitState(client, {
                positionId: position.id,
                highWaterPrice: assessment.highWaterPrice,
                trailingStopPrice: assessment.trailingStopPrice
              });
              if (assessment.dataQuality !== "VALID") {
                logPositionExitDataQuality(logger, position, assessment.dataQuality);
              }
              if (savedExitState.trailingStopPrice === null
                || decimalCompare(market.price, savedExitState.trailingStopPrice) > 0) {
                continue;
              }

              const quote = await repository.quoteSell(client, {
                marketPrice: market.price,
                amount: position.amount,
                entryCostBasis: position.entry_cost_basis
              });
              const tradeState = await repository.insertSell(client, {
                portfolioId: portfolio.id,
                decisionId: null,
                idempotencyKey: createPositionExitIdempotencyKey(
                  portfolio.id,
                  position.id
                ),
                symbol: position.symbol,
                marketPrice: market.price,
                quote,
                positionId: position.id,
                executionReason: "ATR_TRAILING_EXIT"
              });
              state = Object.freeze({ ...state, ...tradeState });
              openPositions = openPositions.filter(({ id }) => id !== position.id);
              cooldowns.set(position.symbol, currentTime);
              state = updatePeak(state);
              result.tradesExecuted += 1;
              result.automaticExits += 1;
              logPositionExitExecuted(logger, position, market.price, savedExitState, quote);
            }

            for (const decision of decisions) {
              result.decisionsProcessed += 1;
              const idempotencyKey = createTradeIdempotencyKey(portfolio.id, decision.id);
              if (existingKeys.has(idempotencyKey)) {
                result.duplicates += 1;
                continue;
              }
              if (!TRADE_DECISIONS.has(decision.decision)) {
                result.skipped += 1;
                continue;
              }
              if (isStale(decision.created_at, currentTime)) {
                result.skipped += 1;
                continue;
              }
              const market = marketData.get(decision.symbol);
              if (!market || !isFresh(market.captured_at, currentTime)) {
                result.skipped += 1;
                continue;
              }

              if (decision.decision === "BUY") {
                if (Number(decision.confidence) < PAPER_TRADING_RULES.minimumConfidence
                  || emergencyStatus !== "NORMAL"
                  || effectiveAgentStatus === "STOPPED"
                  || openPositions.some((position) => {
                    const positionMarket = marketData.get(position.symbol);
                    return !positionMarket || !isFresh(positionMarket.captured_at, currentTime);
                  })
                  || openPositions.some(({ symbol }) => symbol === decision.symbol)
                  || openPositions.length >= PAPER_TRADING_RULES.maxOpenPositions
                  || isInCooldown(cooldowns.get(decision.symbol), currentTime)
                  || isAtOrBelowFraction(
                    state.portfolioValue,
                    state.dailyStartValue,
                    1 - PAPER_TRADING_RULES.dailyDrawdownFraction
                  )
                  || isAtOrBelowFraction(
                    state.portfolioValue,
                    state.peakValue,
                    1 - PAPER_TRADING_RULES.maxPortfolioDrawdownFraction
                  )) {
                  result.skipped += 1;
                  continue;
                }

                const quote = await repository.quoteBuy(client, {
                  marketPrice: market.price,
                  portfolioValue: state.portfolioValue,
                  availableBalance: state.availableBalance
                });
                if (decimalCompare(quote.amount, "0") <= 0 || !quote.affordable) {
                  result.skipped += 1;
                  continue;
                }
                const tradeState = await repository.insertBuy(client, {
                  portfolioId: portfolio.id,
                  decisionId: decision.id,
                  idempotencyKey,
                  symbol: decision.symbol,
                  quote,
                  marketPrice: market.price
                });
                state = Object.freeze({ ...state, ...tradeState });
                openPositions.push({
                  symbol: decision.symbol,
                  amount: quote.amount
                });
              } else {
                const matchingPositions = openPositions.filter(
                  ({ symbol }) => symbol === decision.symbol
                );
                if (matchingPositions.length === 0) {
                  result.skipped += 1;
                  continue;
                }
                const positionTotals = await repository.getOpenPositionTotals(
                  client,
                  portfolio.id,
                  decision.symbol
                );
                const quote = await repository.quoteSell(client, {
                  marketPrice: market.price,
                  amount: positionTotals.amount,
                  entryCostBasis: positionTotals.entryCostBasis
                });
                const tradeState = await repository.insertSell(client, {
                  portfolioId: portfolio.id,
                  decisionId: decision.id,
                  idempotencyKey,
                  symbol: decision.symbol,
                  marketPrice: market.price,
                  quote
                });
                state = Object.freeze({ ...state, ...tradeState });
                openPositions = openPositions.filter(
                  ({ symbol }) => symbol !== decision.symbol
                );
              }
              existingKeys.add(idempotencyKey);
              cooldowns.set(decision.symbol, currentTime);
              state = updatePeak(state);
              result.tradesExecuted += 1;
            }
          }
          return Object.freeze(result);
        });
        return tradingResult;
      } catch (error) {
        const wrapped = error instanceof PaperTradingServiceError
          ? error
          : new PaperTradingServiceError(
            error?.code || "PAPER_TRADING_FAILED",
            "The paper trading cycle failed and was rolled back.",
            error
          );
        logger.error(JSON.stringify(createPaperTradingFailureDiagnostic(wrapped)));
        throw wrapped;
      }
    },
    readAgentStatus() {
      return repository.readAgentStatus();
    },
    updateAgentStatus({ status, lastRunAt = null, errorMessage = null, updatedAt = now() }) {
      return repository.updateAgentStatus({
        status,
        lastRunAt,
        errorMessage,
        updatedAt: readTime(updatedAt)
      });
    }
  });
}

export function createTradeIdempotencyKey(portfolioId, decisionId) {
  if (typeof portfolioId !== "string" || typeof decisionId !== "string") {
    throw new TypeError("Portfolio and decision UUIDs are required.");
  }
  const hash = createHash("md5").update(`${portfolioId}:${decisionId}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-`
    + `${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

export function createPositionExitIdempotencyKey(portfolioId, positionId) {
  if (typeof portfolioId !== "string" || typeof positionId !== "string") {
    throw new TypeError("Portfolio and position UUIDs are required.");
  }
  const hash = createHash("md5")
    .update(`${portfolioId}:${positionId}:${POSITION_EXIT_POLICY.version}`)
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-`
    + `${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

function groupCandlesBySymbol(candles) {
  if (!Array.isArray(candles)) {
    throw new PaperTradingServiceError(
      "PAPER_TRADING_EXIT_CANDLES_INVALID",
      "The trailing-exit repository returned invalid candle data."
    );
  }
  const grouped = new Map();
  for (const candle of candles) {
    if (!candle || typeof candle.symbol !== "string" || !SYMBOL_PATTERN.test(candle.symbol)) {
      throw new PaperTradingServiceError(
        "PAPER_TRADING_EXIT_CANDLES_INVALID",
        "The trailing-exit repository returned a candle with an invalid market."
      );
    }
    const rows = grouped.get(candle.symbol) || [];
    rows.push(candle);
    grouped.set(candle.symbol, rows);
  }
  return grouped;
}

function logPositionExitDataQuality(logger, position, reason) {
  const log = typeof logger.warn === "function" ? logger.warn : logger.error;
  log.call(logger, JSON.stringify({
    event: "paper_position_exit_waiting_for_valid_atr",
    component: "paper-trading-service",
    policy: POSITION_EXIT_POLICY.version,
    positionId: position.id,
    symbol: position.symbol,
    reason
  }));
}

function logPositionExitExecuted(logger, position, marketPrice, exitState, quote) {
  const log = typeof logger.info === "function" ? logger.info : logger.log;
  if (typeof log !== "function") {
    return;
  }
  log.call(logger, JSON.stringify({
    event: "paper_position_closed_by_trailing_exit",
    component: "paper-trading-service",
    policy: POSITION_EXIT_POLICY.version,
    positionId: position.id,
    symbol: position.symbol,
    marketPrice,
    highWaterPrice: exitState.highWaterPrice,
    trailingStopPrice: exitState.trailingStopPrice,
    realizedPnl: quote.realized_pnl
  }));
}

function skipped(reason) {
  return Object.freeze({ status: "SKIPPED", reason });
}

function indexMarketData(rows) {
  if (!Array.isArray(rows) || rows.length > MAX_PAPER_TRADING_MARKETS) {
    throw new PaperTradingServiceError(
      "PAPER_TRADING_MARKET_DATA_INVALID",
      "The market-data repository returned an invalid result."
    );
  }
  const indexed = new Map();
  for (const row of rows) {
    if (!row || typeof row.symbol !== "string" || !SYMBOL_PATTERN.test(row.symbol)
      || indexed.has(row.symbol) || decimalCompare(row.price, "0") <= 0) {
      throw new PaperTradingServiceError(
        "PAPER_TRADING_MARKET_DATA_INVALID",
        "The market-data repository returned an unknown or duplicate market."
      );
    }
    indexed.set(row.symbol, row);
  }
  return indexed;
}

function isStale(value, now) {
  const timestamp = timestampMilliseconds(value);
  return timestamp < now.getTime() - PAPER_TRADING_RULES.marketDataFreshnessMs
    || timestamp > now.getTime() + PAPER_TRADING_RULES.futureTimestampToleranceMs;
}

function isFresh(value, now) {
  return !isStale(value, now);
}

function isInCooldown(value, now) {
  return value instanceof Date
    && value.getTime() >= now.getTime() - PAPER_TRADING_RULES.cooldownMs;
}

function updatePeak(state) {
  return decimalCompare(state.portfolioValue, state.peakValue) > 0
    ? Object.freeze({ ...state, peakValue: state.portfolioValue })
    : state;
}

function isAtOrBelowFraction(value, reference, fraction) {
  const [numerator, denominator] = fractionToRatio(fraction);
  return decimalToScaled(value) * denominator
    <= decimalToScaled(reference) * numerator;
}

function fractionToRatio(value) {
  if (value === 0.95) return [95n, 100n];
  if (value === 0.85) return [85n, 100n];
  if (value === 0.8) return [80n, 100n];
  throw new RangeError("An unsupported paper-trading risk threshold was supplied.");
}

function decimalCompare(left, right) {
  const leftValue = decimalToScaled(left);
  const rightValue = decimalToScaled(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function decimalToScaled(value) {
  const text = typeof value === "number" ? String(value) : value;
  const match = typeof text === "string"
    ? /^(-?)(\d+)(?:\.(\d{1,12}))?$/.exec(text)
    : null;
  if (!match) {
    throw new PaperTradingServiceError(
      "PAPER_TRADING_NUMERIC_INVALID",
      "A stored paper-trading amount is invalid."
    );
  }
  const fraction = (match[3] || "").padEnd(12, "0");
  const valueScaled = BigInt(match[2]) * SCALE + BigInt(fraction || "0");
  return match[1] === "-" ? -valueScaled : valueScaled;
}

function timestampMilliseconds(value) {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new PaperTradingServiceError(
      "PAPER_TRADING_TIMESTAMP_INVALID",
      "A stored paper-trading timestamp is invalid."
    );
  }
  return timestamp;
}

function readTime(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new PaperTradingServiceError(
      "PAPER_TRADING_TIME_INVALID",
      "The paper-trading clock returned an invalid timestamp."
    );
  }
  return date;
}
