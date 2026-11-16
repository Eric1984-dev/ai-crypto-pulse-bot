const ONESIGNAL_NOTIFICATIONS_URL = "https://api.onesignal.com/notifications?c=push";
const UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const SYMBOL_PATTERN = /^[A-Z0-9]+-EUR$/;
const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;
const RUNTIME_ERROR_STAGES = new Set([
  "market-ingestion",
  "ai-analysis",
  "paper-trading",
  "data-retention",
  "runtime-startup"
]);

export class OneSignalNotificationError extends Error {
  constructor(code, message, statusCode) {
    super(message);
    this.name = "OneSignalNotificationError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function createOneSignalTradeNotifier(config, {
  fetchImpl = globalThis.fetch,
  logger = console
} = {}) {
  const send = createOneSignalSender(config, fetchImpl, logger);
  if (!send) {
    return null;
  }

  return async function notifyExecutedTrade(trade) {
    validateTrade(trade);
    const sideLabel = trade.side === "BUY" ? "Buy" : "Sell";
    await send({
      headings: { en: "AI-Crypto-Pulse-Bot" },
      contents: {
        en: `A new ${sideLabel} trade was executed: ${trade.symbol} at ${trade.executionPrice} EUR.`
      },
      data: {
        tradeId: trade.tradeId,
        side: trade.side,
        symbol: trade.symbol,
        executionPrice: trade.executionPrice,
        quantity: trade.quantity,
        executionReason: trade.executionReason
      },
      event: "onesignal_trade_notification_sent",
      logFields: {
        tradeId: trade.tradeId,
        side: trade.side,
        symbol: trade.symbol
      },
      description: "trade"
    });
  };
}

export function createOneSignalBackendErrorNotifier(config, {
  fetchImpl = globalThis.fetch,
  logger = console
} = {}) {
  const send = createOneSignalSender(config, fetchImpl, logger);
  if (!send) {
    return null;
  }

  return async function notifyBackendError(incident) {
    validateBackendError(incident);
    await send({
      headings: { en: "CryptoPulse backend error" },
      contents: {
        en: `CryptoPulse backend entered ERROR during ${incident.stage}. Check the dashboard or runtime logs.`
      },
      data: {
        type: "backend_error",
        status: "ERROR",
        stage: incident.stage,
        code: incident.code,
        occurredAt: incident.occurredAt
      },
      event: "onesignal_backend_error_notification_sent",
      logFields: {
        stage: incident.stage,
        code: incident.code
      },
      description: "backend error"
    });
  };
}

function createOneSignalSender(config, fetchImpl, logger) {
  if (!config || config.enabled !== true) {
    return null;
  }
  if (!UUID_PATTERN.test(config.appId || "")
    || typeof config.restApiKey !== "string"
    || config.restApiKey.trim() !== config.restApiKey
    || config.restApiKey.length < 1
    || config.restApiKey.length > 512
    || /[\r\n]/.test(config.restApiKey)
    || typeof fetchImpl !== "function"
    || !logger
    || typeof logger.info !== "function") {
    throw new TypeError("Valid OneSignal configuration, fetch, and logger are required.");
  }

  return async function sendNotification({
    headings,
    contents,
    data,
    event,
    logFields,
    description
  }) {
    const response = await fetchImpl(ONESIGNAL_NOTIFICATIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Key ${config.restApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        app_id: config.appId,
        included_segments: ["Total Subscriptions"],
        headings,
        contents,
        data
      }),
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new OneSignalNotificationError(
        "ONESIGNAL_REQUEST_FAILED",
        `OneSignal rejected the ${description} notification with HTTP ${response.status}.`,
        response.status
      );
    }

    const result = await response.json();
    logger.info(JSON.stringify({
      event,
      ...logFields,
      messageId: typeof result.id === "string" ? result.id : null,
      recipients: Number.isSafeInteger(result.recipients) ? result.recipients : null
    }));
  };
}

function validateTrade(trade) {
  if (!trade
    || !UUID_PATTERN.test(trade.tradeId || "")
    || !["BUY", "SELL"].includes(trade.side)
    || !SYMBOL_PATTERN.test(trade.symbol || "")
    || !DECIMAL_PATTERN.test(trade.executionPrice || "")
    || !DECIMAL_PATTERN.test(trade.quantity || "")
    || !["AI_DECISION", "ATR_TRAILING_EXIT", "MAX_POSITION_LOSS_EXIT"]
      .includes(trade.executionReason)
    || (trade.executionReason !== "AI_DECISION" && trade.side !== "SELL")) {
    throw new TypeError("The executed trade is invalid for a OneSignal notification.");
  }
}

function validateBackendError(incident) {
  if (!incident
    || !RUNTIME_ERROR_STAGES.has(incident.stage)
    || typeof incident.code !== "string"
    || !/^[A-Z0-9_]{1,64}$/.test(incident.code)
    || typeof incident.occurredAt !== "string"
    || !Number.isFinite(Date.parse(incident.occurredAt))) {
    throw new TypeError("The backend error is invalid for a OneSignal notification.");
  }
}
