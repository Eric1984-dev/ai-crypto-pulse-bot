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
         indicators, strategy_name, strategy_version, created_at
  FROM public."AI_Crypto_Bot_AI_Decisions"
  ORDER BY created_at DESC, id DESC
  LIMIT $1
`;
const AI_DECISION_COUNT_SQL = `
  SELECT COUNT(*)::integer AS total_count
  FROM public."AI_Crypto_Bot_AI_Decisions"
`;
const AI_DECISION_HISTORY_SQL = `
  SELECT id, symbol, decision, confidence, reason,
         indicators, strategy_name, strategy_version, created_at
  FROM public."AI_Crypto_Bot_AI_Decisions"
  ORDER BY created_at DESC, id DESC
  LIMIT $1 OFFSET $2
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
    return result.rows.map(normalizeDecision);
  }

  async listHistory({ page = 1, pageSize = 25 } = {}) {
    if (!Number.isSafeInteger(page) || page < 1
      || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_AI_DECISION_ROWS) {
      throw new TypeError("AI decision history pagination is invalid.");
    }
    const [countResult, historyResult] = await Promise.all([
      queryReadOnly(this.pool, AI_DECISION_COUNT_SQL, [], { logger: this.logger }),
      queryReadOnly(
        this.pool,
        AI_DECISION_HISTORY_SQL,
        [pageSize, (page - 1) * pageSize],
        { logger: this.logger }
      )
    ]);
    const totalCount = Number(countResult.rows[0]?.total_count);
    if (!Number.isSafeInteger(totalCount) || totalCount < 0) {
      throw new RepositoryDataError("invalid AI decision history count");
    }
    return {
      page,
      pageSize,
      totalCount,
      totalPages: totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize),
      items: historyResult.rows.map(normalizeDecision)
    };
  }
}

function normalizeDecision(row) {
  const confidence = readFiniteNumber(row.confidence, "decision confidence");
  if (!DECISIONS.has(row.decision) || confidence < 0 || confidence > 100
    || typeof row.reason !== "string" || row.reason.trim() === ""
    || !row.indicators || typeof row.indicators !== "object" || Array.isArray(row.indicators)
    || ((row.strategy_name === null) !== (row.strategy_version === null))) {
    throw new RepositoryDataError("invalid AI decision row");
  }
  return {
    ...row,
    confidence,
    created_at: readTimestamp(row.created_at, "AI decision timestamp")
  };
}
