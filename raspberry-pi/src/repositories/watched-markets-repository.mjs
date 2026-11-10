import { withReadOnlyTransaction } from "../database/read-only-transaction.mjs";

const ENABLED_MARKETS_SQL = `
  SELECT id, symbol, enabled, priority
  FROM public."AI_Crypto_Bot_Watched_Markets"
  WHERE enabled IS TRUE
  ORDER BY priority ASC, symbol ASC
`;

export async function readEnabledWatchedMarkets(pool, { logger = console } = {}) {
  return withReadOnlyTransaction(pool, async (client) => {
    const result = await client.query(ENABLED_MARKETS_SQL);
    return result.rows;
  }, { logger });
}
