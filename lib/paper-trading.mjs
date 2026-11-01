const PAPER_TRADING_RPC = "AI_Crypto_Bot_Run_Paper_Trading";
const REQUEST_TIMEOUT_MS = 8000;

export class PaperTradingError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = "PaperTradingError";
    this.code = code;
  }
}

export function createPaperTradingService({ fetchImpl = globalThis.fetch } = {}) {
  async function runPaperTrading({ config, serviceRoleKey }) {
    if (!config || typeof config.supabaseUrl !== "string" || !serviceRoleKey) {
      throw new PaperTradingError(
        "PAPER_TRADING_NOT_CONFIGURED",
        "Paper trading database configuration is missing."
      );
    }

    const url = new URL(`/rest/v1/rpc/${PAPER_TRADING_RPC}`, config.supabaseUrl);
    let response;
    try {
      response = await fetchImpl(url.toString(), {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
          "content-type": "application/json",
          accept: "application/json"
        },
        body: "{}",
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch (error) {
      throw new PaperTradingError(
        "PAPER_TRADING_DATABASE_UNAVAILABLE",
        "The paper trading process could not reach Supabase.",
        error
      );
    }

    if (!response.ok) {
      throw new PaperTradingError(
        "PAPER_TRADING_DATABASE_FAILED",
        "Supabase rejected the paper trading request."
      );
    }

    let result;
    try {
      result = await response.json();
    } catch (error) {
      throw new PaperTradingError(
        "INVALID_PAPER_TRADING_RESPONSE",
        "Supabase returned an invalid paper trading response.",
        error
      );
    }

    if (!isRunResult(result)) {
      throw new PaperTradingError(
        "INVALID_PAPER_TRADING_RESPONSE",
        "Supabase returned an unexpected paper trading result."
      );
    }
    return result;
  }

  return { runPaperTrading };
}

function isRunResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  if (value.status === "SKIPPED") {
    return typeof value.reason === "string";
  }
  return value.status === "COMPLETED"
    && ["portfoliosProcessed", "decisionsProcessed", "tradesExecuted", "duplicates", "skipped"]
      .every((field) => Number.isInteger(value[field]) && value[field] >= 0);
}
