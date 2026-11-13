import {
  AI_ANALYSIS_INTERVALS,
  MAX_CANDLES_PER_INTERVAL,
  analyzeMarket
} from "./ai-engine.mjs";
import { createDeterministicDecisionId } from "./ai-decision-identity.mjs";
import {
  MAX_AI_ANALYSIS_MARKETS
} from "../repositories/ai-analysis-repository.mjs";
import { validateEnabledWatchedMarkets } from "./watched-markets.mjs";

export const AI_MARKET_BATCH_SIZE = 4;

const SYMBOL_PATTERN = /^[A-Z0-9]+-EUR$/;

export class AIAnalysisServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AIAnalysisServiceError";
    this.code = code;
  }
}

export function createAiAnalysisService({
  watchedMarketsRepository,
  aiAnalysisRepository,
  logger = console,
  now = () => new Date()
}) {
  if (!watchedMarketsRepository || typeof watchedMarketsRepository.listEnabled !== "function"
    || !aiAnalysisRepository || typeof aiAnalysisRepository.listSnapshots !== "function"
    || typeof aiAnalysisRepository.listLatestCandles !== "function"
    || typeof aiAnalysisRepository.insertDecisions !== "function"
    || typeof now !== "function") {
    throw new TypeError("Watched-market and AI-analysis repositories are required.");
  }

  return Object.freeze({
    async run() {
      const analysisTime = readAnalysisTime(now());
      const marketRows = await watchedMarketsRepository.listEnabled();
      const markets = validateEnabledWatchedMarkets(marketRows);
      if (markets.length > MAX_AI_ANALYSIS_MARKETS) {
        throw new AIAnalysisServiceError(
          "AI_ANALYSIS_MARKET_LIMIT_EXCEEDED",
          "The enabled-market count exceeds the AI analysis capacity."
        );
      }

      const symbols = markets.map(({ symbol }) => symbol);
      if (symbols.some((symbol) => !SYMBOL_PATTERN.test(symbol))) {
        throw new AIAnalysisServiceError(
          "AI_ANALYSIS_MARKET_INVALID",
          "An enabled market symbol is not supported by the AI analysis repository."
        );
      }

      const snapshots = await aiAnalysisRepository.listSnapshots(symbols);
      const snapshotsBySymbol = indexSnapshots(snapshots, symbols);
      const decisions = [];

      for (let offset = 0; offset < markets.length; offset += AI_MARKET_BATCH_SIZE) {
        const marketBatch = markets.slice(offset, offset + AI_MARKET_BATCH_SIZE);
        const batchSymbols = marketBatch.map(({ symbol }) => symbol);
        const candlesBySymbol = new Map(batchSymbols.map((symbol) => [symbol, []]));

        for (const interval of AI_ANALYSIS_INTERVALS) {
          const rows = await aiAnalysisRepository.listLatestCandles(batchSymbols, interval, {
            limit: MAX_CANDLES_PER_INTERVAL
          });
          appendCandleRows(candlesBySymbol, rows, batchSymbols, interval);
        }

        for (const { symbol } of marketBatch) {
          const snapshot = snapshotsBySymbol.get(symbol) || null;
          const candles = candlesBySymbol.get(symbol);
          const decision = analyzeMarket({
            symbol,
            marketData: snapshot,
            candles,
            now: analysisTime
          });
          decision.id = createDeterministicDecisionId({
            symbol,
            strategy_name: decision.strategy_name,
            strategy_version: decision.strategy_version,
            snapshot,
            candles,
            freshness: getFreshnessFingerprint(decision)
          });
          decisions.push(decision);
        }
      }

      const persistence = await aiAnalysisRepository.insertDecisions(decisions);
      const dataQuality = summarizeDataQuality(decisions);
      if (dataQuality.affectedMarkets.length) {
        logger?.warn?.(JSON.stringify({
          event: "ai_analysis_candle_data_quality",
          component: "ai-analysis-service",
          ...dataQuality
        }));
      }
      return Object.freeze({
        status: "completed",
        analyzedMarkets: decisions.length,
        decisionsStored: persistence.stored,
        duplicateDecisions: persistence.duplicates,
        buyCount: decisions.filter(({ decision }) => decision === "BUY").length,
        sellCount: decisions.filter(({ decision }) => decision === "SELL").length,
        holdCount: decisions.filter(({ decision }) => decision === "HOLD").length,
        waitCount: decisions.filter(({ decision }) => decision === "WAIT").length,
        dataQuality
      });
    }
  });
}

function summarizeDataQuality(decisions) {
  const affectedMarkets = decisions.flatMap(({ symbol, indicators }) => {
    const dataQuality = indicators.dataQuality;
    const incompleteIntervals = dataQuality.incompleteCandleIntervals;
    const staleIntervals = dataQuality.staleCandleIntervals;
    const missingIntervals = dataQuality.missingCandleIntervals;
    const invalidCandleCount = dataQuality.invalidCandlesIgnored;
    return incompleteIntervals.length || staleIntervals.length || missingIntervals.length
      || invalidCandleCount
      ? [{
        symbol,
        incompleteIntervals,
        staleIntervals,
        missingIntervals,
        invalidCandleCount,
        sufficientForDirectionalSignal: dataQuality.sufficientForDirectionalSignal
      }]
      : [];
  });
  return Object.freeze({
    affectedMarketCount: affectedMarkets.length,
    marketsWithoutDirectionalData: decisions.filter(({ indicators }) =>
      !indicators.dataQuality.sufficientForDirectionalSignal
    ).length,
    affectedMarkets: Object.freeze(affectedMarkets)
  });
}

function readAnalysisTime(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new AIAnalysisServiceError(
      "AI_ANALYSIS_TIME_INVALID",
      "The AI analysis clock returned an invalid timestamp."
    );
  }
  return date;
}

function indexSnapshots(rows, symbols) {
  if (!Array.isArray(rows) || rows.length > symbols.length) {
    throw new AIAnalysisServiceError(
      "AI_ANALYSIS_SNAPSHOT_RESPONSE_INVALID",
      "The snapshot repository returned an invalid result set."
    );
  }
  const allowedSymbols = new Set(symbols);
  const indexed = new Map();
  for (const row of rows) {
    if (!row || !allowedSymbols.has(row.symbol) || indexed.has(row.symbol)) {
      throw new AIAnalysisServiceError(
        "AI_ANALYSIS_SNAPSHOT_RESPONSE_INVALID",
        "The snapshot repository returned an unknown or duplicate market."
      );
    }
    indexed.set(row.symbol, row);
  }
  return indexed;
}

function appendCandleRows(candlesBySymbol, rows, symbols, interval) {
  if (!Array.isArray(rows) || rows.length > symbols.length * MAX_CANDLES_PER_INTERVAL) {
    throw new AIAnalysisServiceError(
      "AI_ANALYSIS_CANDLE_RESPONSE_INVALID",
      "The candle repository returned an invalid or unbounded result set."
    );
  }
  const allowedSymbols = new Set(symbols);
  const counts = new Map(symbols.map((symbol) => [symbol, 0]));
  for (const row of rows) {
    if (!row || !allowedSymbols.has(row.symbol) || row.interval !== interval) {
      throw new AIAnalysisServiceError(
        "AI_ANALYSIS_CANDLE_RESPONSE_INVALID",
        "The candle repository returned an unknown market or interval."
      );
    }
    const count = counts.get(row.symbol) + 1;
    if (count > MAX_CANDLES_PER_INTERVAL) {
      throw new AIAnalysisServiceError(
        "AI_ANALYSIS_CANDLE_RESPONSE_INVALID",
        "The candle repository exceeded the per-market interval limit."
      );
    }
    counts.set(row.symbol, count);
    candlesBySymbol.get(row.symbol).push(row);
  }
}

function getFreshnessFingerprint(decision) {
  return {
    snapshotAvailable: decision.indicators.marketData.available,
    snapshotStale: decision.indicators.marketData.stale,
    intervals: AI_ANALYSIS_INTERVALS.map((interval) => {
      const result = decision.indicators.timeframes[interval];
      return {
        interval,
        candleCount: result.candleCount,
        analyzedCandleCount: result.analyzedCandleCount,
        staleCandleCount: result.staleCandleCount,
        invalidCandleCount: result.invalidCandleCount
      };
    })
  };
}
