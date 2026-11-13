const ONESIGNAL_NOTIFICATIONS_URL = "https://api.onesignal.com/notifications?c=push";
const UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const SYMBOL_PATTERN = /^[A-Z0-9]+-EUR$/;
const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;

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

  return async function notifyExecutedTrade(trade) {
    validateTrade(trade);
    const sideLabel = trade.side === "BUY" ? "Buy" : "Sell";
    const response = await fetchImpl(ONESIGNAL_NOTIFICATIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Key ${config.restApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        app_id: config.appId,
        included_segments: ["Total Subscriptions"],
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
        }
      }),
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new OneSignalNotificationError(
        "ONESIGNAL_REQUEST_FAILED",
        `OneSignal rejected the trade notification with HTTP ${response.status}.`,
        response.status
      );
    }

    const result = await response.json();
    logger.info(JSON.stringify({
      event: "onesignal_trade_notification_sent",
      tradeId: trade.tradeId,
      side: trade.side,
      symbol: trade.symbol,
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
    || !["AI_DECISION", "ATR_TRAILING_EXIT"].includes(trade.executionReason)
    || (trade.executionReason === "ATR_TRAILING_EXIT" && trade.side !== "SELL")) {
    throw new TypeError("The executed trade is invalid for a OneSignal notification.");
  }
}
