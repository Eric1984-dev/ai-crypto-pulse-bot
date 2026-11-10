import {
  AI_ANALYSIS_INTERVALS,
  AI_DECISION_INTERVAL,
  MAX_CANDLES_PER_INTERVAL
} from "../services/ai-engine.mjs";
import { canonicalJson } from "../services/ai-decision-identity.mjs";
import { withWriteTransaction } from "../database/write-transaction.mjs";
import {
  queryReadOnly,
  readPositiveLimit,
  RepositoryDataError
} from "./postgres-read.mjs";

export const MAX_AI_ANALYSIS_MARKETS = 500;
export const AI_DECISION_WRITE_BATCH_SIZE = 50;

const SYMBOL_PATTERN = /^[A-Z0-9]+-EUR$/;
const DECISIONS = new Set(["BUY", "SELL", "HOLD", "WAIT"]);

const MARKET_SNAPSHOTS_SQL = `
  SELECT market_data.symbol,
         market_data.price,
         market_data.volume,
         market_data.daily_change,
         market_data.high_24h,
         market_data.low_24h,
         market_data.captured_at
  FROM public."AI_Crypto_Bot_Watched_Markets" AS watched_market
  JOIN public."AI_Crypto_Bot_Market_Data" AS market_data
    ON market_data.symbol = watched_market.symbol
  WHERE watched_market.enabled IS TRUE
    AND watched_market.symbol = ANY($1::text[])
  ORDER BY watched_market.priority ASC, watched_market.symbol ASC
  LIMIT $2
`;

const LATEST_CANDLES_SQL = `
  SELECT candle.symbol,
         candle.interval,
         candle.open,
         candle.high,
         candle.low,
         candle.close,
         candle.volume,
         candle."timestamp" AS timestamp
  FROM unnest($1::text[]) AS requested(symbol)
  JOIN public."AI_Crypto_Bot_Watched_Markets" AS watched_market
    ON watched_market.symbol = requested.symbol
   AND watched_market.enabled IS TRUE
  CROSS JOIN LATERAL (
    SELECT stored_candle.symbol,
           stored_candle.interval,
           stored_candle.open,
           stored_candle.high,
           stored_candle.low,
           stored_candle.close,
           stored_candle.volume,
           stored_candle."timestamp"
    FROM public."AI_Crypto_Bot_Candles" AS stored_candle
    WHERE stored_candle.symbol = requested.symbol
      AND stored_candle.interval = $2
    ORDER BY stored_candle."timestamp" DESC
    LIMIT $3
  ) AS candle
  ORDER BY candle.symbol ASC, candle."timestamp" ASC
`;

const EXISTING_DECISIONS_SQL = `
  SELECT id, symbol, decision, confidence, indicators, reason,
         strategy_name, strategy_version
  FROM public."AI_Crypto_Bot_AI_Decisions"
  WHERE id = ANY($1::uuid[])
`;

export class AiAnalysisRepositoryError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = "AiAnalysisRepositoryError";
    this.code = code;
    this.component = "ai-analysis-repository";
  }
}

export class AiAnalysisRepository {
  constructor(pool, { logger = console } = {}) {
    this.pool = pool;
    this.logger = logger;
  }

  async listSnapshots(symbols) {
    validateSymbols(symbols);
    if (symbols.length === 0) {
      return [];
    }
    const result = await queryReadOnly(
      this.pool,
      MARKET_SNAPSHOTS_SQL,
      [symbols, MAX_AI_ANALYSIS_MARKETS],
      { logger: this.logger }
    );
    return result.rows;
  }

  async listLatestCandles(symbols, interval, { limit = MAX_CANDLES_PER_INTERVAL } = {}) {
    validateSymbols(symbols);
    if (!AI_ANALYSIS_INTERVALS.includes(interval)) {
      throw new TypeError("A supported AI analysis interval is required.");
    }
    const boundedLimit = readPositiveLimit(limit, MAX_CANDLES_PER_INTERVAL, MAX_CANDLES_PER_INTERVAL);
    if (symbols.length === 0) {
      return [];
    }
    const result = await queryReadOnly(
      this.pool,
      LATEST_CANDLES_SQL,
      [symbols, interval, boundedLimit],
      { logger: this.logger }
    );
    return result.rows;
  }

  async insertDecisions(decisions) {
    validateDecisions(decisions);
    if (decisions.length === 0) {
      return Object.freeze({ stored: 0, duplicates: 0 });
    }

    try {
      return await withWriteTransaction(this.pool, async (client) => {
        let stored = 0;
        let duplicates = 0;
        for (let offset = 0; offset < decisions.length; offset += AI_DECISION_WRITE_BATCH_SIZE) {
          const batch = decisions.slice(offset, offset + AI_DECISION_WRITE_BATCH_SIZE);
          const values = [];
          const placeholders = batch.map((decision, index) => {
            const firstParameter = index * 9;
            values.push(
              decision.id,
              decision.symbol,
              decision.decision,
              decision.confidence,
              JSON.stringify(decision.indicators),
              decision.reason,
              decision.strategy_name,
              decision.strategy_version,
              decision.timestamp
            );
            return `($${firstParameter + 1}, $${firstParameter + 2}, $${firstParameter + 3}, `
              + `$${firstParameter + 4}, $${firstParameter + 5}::jsonb, $${firstParameter + 6}, `
              + `$${firstParameter + 7}, $${firstParameter + 8}, $${firstParameter + 9})`;
          });
          const insertResult = await client.query(`
            INSERT INTO public."AI_Crypto_Bot_AI_Decisions"
              (id, symbol, decision, confidence, indicators, reason,
               strategy_name, strategy_version, created_at)
            VALUES ${placeholders.join(", ")}
            ON CONFLICT (id) DO NOTHING
            RETURNING id
          `, values);
          const insertedIds = new Set(insertResult.rows.map(({ id }) => id));
          stored += insertedIds.size;

          const duplicateDecisions = batch.filter(({ id }) => !insertedIds.has(id));
          if (duplicateDecisions.length) {
            const existingResult = await client.query(
              EXISTING_DECISIONS_SQL,
              [duplicateDecisions.map(({ id }) => id)]
            );
            const existingById = new Map(existingResult.rows.map((row) => [row.id, row]));
            for (const decision of duplicateDecisions) {
              const existing = existingById.get(decision.id);
              if (!existing || !matchesPersistedDecision(existing, decision)) {
                throw new AiAnalysisRepositoryError(
                  "AI_DECISION_ID_COLLISION",
                  "An existing AI decision ID has a different or unverifiable payload."
                );
              }
              duplicates += 1;
            }
          }
        }
        return Object.freeze({ stored, duplicates });
      }, { logger: this.logger });
    } catch (error) {
      if (error instanceof AiAnalysisRepositoryError) {
        throw error;
      }
      throw new AiAnalysisRepositoryError(
        "AI_DECISION_WRITE_FAILED",
        "PostgreSQL could not persist the AI decision batch.",
        error
      );
    }
  }
}

function validateSymbols(symbols) {
  if (!Array.isArray(symbols) || symbols.length > MAX_AI_ANALYSIS_MARKETS
    || symbols.some((symbol) => typeof symbol !== "string" || !SYMBOL_PATTERN.test(symbol))
    || new Set(symbols).size !== symbols.length) {
    throw new TypeError("A bounded, unique EUR market list is required.");
  }
}

function validateDecisions(decisions) {
  if (!Array.isArray(decisions) || decisions.length > MAX_AI_ANALYSIS_MARKETS) {
    throw new TypeError("A bounded AI decision batch is required.");
  }
  const ids = new Set();
  const symbols = new Set();
  for (const decision of decisions) {
    const timestamp = decision && new Date(decision.timestamp);
    if (!decision || typeof decision.id !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(decision.id)
      || ids.has(decision.id)
      || typeof decision.symbol !== "string" || !SYMBOL_PATTERN.test(decision.symbol)
      || symbols.has(decision.symbol)
      || !AI_ANALYSIS_INTERVALS.includes(decision.interval)
      || decision.interval !== AI_DECISION_INTERVAL
      || !DECISIONS.has(decision.decision)
      || typeof decision.confidence !== "number" || !Number.isFinite(decision.confidence)
      || decision.confidence < 0 || decision.confidence > 100
      || !decision.indicators || typeof decision.indicators !== "object"
      || Array.isArray(decision.indicators)
      || decision.indicators.interval !== decision.interval
      || typeof decision.reason !== "string" || decision.reason.trim() === ""
      || typeof decision.strategy_name !== "string" || decision.strategy_name.trim() === ""
      || typeof decision.strategy_version !== "string" || decision.strategy_version.trim() === ""
      || !Number.isFinite(timestamp.getTime())) {
      throw new RepositoryDataError("invalid AI decision input");
    }
    ids.add(decision.id);
    symbols.add(decision.symbol);
    canonicalJson(decision.indicators);
  }
}

function matchesPersistedDecision(row, decision) {
  return row.symbol === decision.symbol
    && row.decision === decision.decision
    && Number(row.confidence) === decision.confidence
    && canonicalJson(row.indicators) === canonicalJson(decision.indicators)
    && row.reason === decision.reason
    && row.strategy_name === decision.strategy_name
    && row.strategy_version === decision.strategy_version;
}
