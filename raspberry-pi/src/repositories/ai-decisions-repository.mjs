import {
  queryReadOnly,
  readFiniteNumber,
  readPositiveLimit,
  RepositoryDataError,
  readTimestamp
} from "./postgres-read.mjs";

export const MAX_AI_DECISION_ROWS = 100;
const DECISIONS = new Set(["BUY", "SELL", "HOLD", "WAIT"]);

const RECENT_AI_DECISIONS_SQL = `
  SELECT id, symbol, decision, confidence, reason,
         strategy_name, strategy_version, created_at
  FROM public."AI_Crypto_Bot_AI_Decisions"
  ORDER BY created_at DESC, id DESC
  LIMIT $1
`;

export class AiDecisionsRepository {
  constructor(pool, { logger = console } = {}) {
    this.pool = pool;
    this.logger = logger;
  }

  async listRecent({ limit = 5 } = {}) {
    const boundedLimit = readPositiveLimit(limit, MAX_AI_DECISION_ROWS, 5);
    const result = await queryReadOnly(
      this.pool,
      RECENT_AI_DECISIONS_SQL,
      [boundedLimit],
      { logger: this.logger }
    );
    return result.rows.map((row) => {
      const confidence = readFiniteNumber(row.confidence, "decision confidence");
      if (!DECISIONS.has(row.decision) || confidence < 0 || confidence > 100
        || typeof row.reason !== "string" || row.reason.trim() === ""
        || ((row.strategy_name === null) !== (row.strategy_version === null))) {
        throw new RepositoryDataError("invalid AI decision row");
      }
      return {
        ...row,
        confidence,
        created_at: readTimestamp(row.created_at, "AI decision timestamp")
      };
    });
  }
}
