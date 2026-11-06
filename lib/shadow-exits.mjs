const SHADOW_EXIT_RPC = "AI_Crypto_Bot_Evaluate_Shadow_Exit_Scenarios";
const SHADOW_EXIT_REQUEST_TIMEOUT_MS = 2500;

const fillParameters = Object.freeze({
  sellSlippageRate: 0.001,
  exitFeeRate: 0.0025,
  fillConvention: "observed-last-price"
});

export const SHADOW_EXIT_RULE_VERSION = "1.0.0";
export const SHADOW_EXIT_RULES = Object.freeze([
  ...[5, 10, 15, 20].map((targetGainPct) => Object.freeze({
    id: `fixed_tp_${targetGainPct}`,
    name: `Fixed take-profit · +${targetGainPct}%`,
    version: SHADOW_EXIT_RULE_VERSION,
    parameters: Object.freeze({ ...fillParameters, targetGainPct })
  })),
  ...[5, 10, 15].map((drawdownPct) => Object.freeze({
    id: `trailing_stop_${drawdownPct}`,
    name: `Trailing stop · arm +5%, retrace ${drawdownPct}%`,
    version: SHADOW_EXIT_RULE_VERSION,
    parameters: Object.freeze({ ...fillParameters, armGainPct: 5, drawdownPct })
  }))
]);

export class ShadowExitEvaluationError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = "ShadowExitEvaluationError";
    this.code = code;
  }
}

export function createShadowExitService({ fetchImpl = globalThis.fetch } = {}) {
  async function evaluate({ config, serviceRoleKey }) {
    if (!config || typeof config.supabaseUrl !== "string" || !serviceRoleKey) {
      throw new ShadowExitEvaluationError(
        "SHADOW_EXIT_NOT_CONFIGURED",
        "Shadow exit database configuration is missing."
      );
    }

    const url = new URL(`/rest/v1/rpc/${SHADOW_EXIT_RPC}`, config.supabaseUrl);
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
        signal: AbortSignal.timeout(SHADOW_EXIT_REQUEST_TIMEOUT_MS)
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new ShadowExitEvaluationError(
        timedOut ? "SHADOW_EXIT_DATABASE_TIMEOUT" : "SHADOW_EXIT_DATABASE_UNAVAILABLE",
        timedOut
          ? "Shadow exit evaluation timed out while waiting for Supabase."
          : "Shadow exit evaluation could not reach Supabase.",
        error
      );
    }

    if (!response.ok) {
      throw new ShadowExitEvaluationError(
        "SHADOW_EXIT_DATABASE_FAILED",
        "Supabase rejected shadow exit evaluation."
      );
    }

    let result;
    try {
      result = await response.json();
    } catch (error) {
      throw new ShadowExitEvaluationError(
        "INVALID_SHADOW_EXIT_RESPONSE",
        "Supabase returned an invalid shadow exit result.",
        error
      );
    }

    if (!isShadowExitResult(result)) {
      throw new ShadowExitEvaluationError(
        "INVALID_SHADOW_EXIT_RESPONSE",
        "Supabase returned an unexpected shadow exit result."
      );
    }
    return result;
  }

  return { evaluate };
}

function isShadowExitResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  if (value.status === "SKIPPED") {
    return typeof value.reason === "string";
  }
  if (value.status === "FAILED") {
    return typeof value.errorCode === "string";
  }
  return value.status === "COMPLETED"
    && [
      "positionsEvaluated",
      "scenariosCreated",
      "scenariosUpdated",
      "scenariosTriggered",
      "positionsFinalized",
      "waitingForFreshData"
    ].every((field) => Number.isInteger(value[field]) && value[field] >= 0);
}
