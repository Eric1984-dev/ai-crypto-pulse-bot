import assert from "node:assert/strict";
import test from "node:test";
import {
  createOneSignalBackendErrorNotifier,
  createOneSignalTradeNotifier
} from "../src/services/onesignal-trade-notifier.mjs";

const CONFIG = Object.freeze({
  enabled: true,
  appId: "123e4567-e89b-12d3-a456-426614174000",
  restApiKey: "test-server-key"
});
const TRADE = Object.freeze({
  tradeId: "00000000-0000-4000-8000-000000000001",
  side: "SELL",
  symbol: "BTC-EUR",
  executionPrice: "102.50",
  quantity: "0.5",
  executionReason: "AI_DECISION"
});

test("OneSignal sends a push to subscribed devices with executed trade details", async () => {
  const requests = [];
  const logs = [];
  const notify = createOneSignalTradeNotifier(CONFIG, {
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "onesignal-message-id", recipients: 1 })
      };
    },
    logger: { info: (message) => logs.push(JSON.parse(message)) }
  });

  await notify(TRADE);
  await notify({ ...TRADE, side: "BUY" });
  await notify({ ...TRADE, executionReason: "MAX_POSITION_LOSS_EXIT" });

  assert.equal(requests[0].url, "https://api.onesignal.com/notifications?c=push");
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.headers.Authorization, "Key test-server-key");
  const sellPayload = JSON.parse(requests[0].options.body);
  assert.deepEqual(sellPayload, {
    app_id: CONFIG.appId,
    included_segments: ["Total Subscriptions"],
    headings: { en: "AI-Crypto-Pulse-Bot" },
    contents: { en: "A new Sell trade was executed: BTC-EUR at 102.50 EUR." },
    data: {
      tradeId: TRADE.tradeId,
      side: "SELL",
      symbol: "BTC-EUR",
      executionPrice: "102.50",
      quantity: "0.5",
      executionReason: "AI_DECISION"
    }
  });
  const buyPayload = JSON.parse(requests[1].options.body);
  assert.match(buyPayload.contents.en, /^A new Buy trade was executed:/);
  assert.equal(buyPayload.data.side, "BUY");
  const lossExitPayload = JSON.parse(requests[2].options.body);
  assert.equal(lossExitPayload.data.executionReason, "MAX_POSITION_LOSS_EXIT");
  assert.equal(logs[0].event, "onesignal_trade_notification_sent");
  assert.equal(logs[0].recipients, 1);
});

test("OneSignal sends backend error stage and safe code to subscribed devices", async () => {
  const requests = [];
  const logs = [];
  const notify = createOneSignalBackendErrorNotifier(CONFIG, {
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "backend-error-message", recipients: 2 })
      };
    },
    logger: { info: (message) => logs.push(JSON.parse(message)) }
  });

  await notify({
    stage: "paper-trading",
    code: "PAPER_TRADING_DATABASE_FAILED",
    occurredAt: "2026-11-16T20:25:32.000Z"
  });

  assert.equal(requests.length, 1);
  const payload = JSON.parse(requests[0].options.body);
  assert.deepEqual(payload, {
    app_id: CONFIG.appId,
    included_segments: ["Total Subscriptions"],
    headings: { en: "CryptoPulse backend error" },
    contents: {
      en: "CryptoPulse backend entered ERROR during paper-trading. Check the dashboard or runtime logs."
    },
    data: {
      type: "backend_error",
      status: "ERROR",
      stage: "paper-trading",
      code: "PAPER_TRADING_DATABASE_FAILED",
      occurredAt: "2026-11-16T20:25:32.000Z"
    }
  });
  assert.equal(logs[0].event, "onesignal_backend_error_notification_sent");
  assert.equal(logs[0].stage, "paper-trading");
  assert.equal(logs[0].recipients, 2);
});

test("OneSignal notifier does not initialize when credentials are not configured", () => {
  assert.equal(createOneSignalTradeNotifier({
    enabled: false,
    appId: "",
    restApiKey: ""
  }), null);
});

test("OneSignal backend error notifier rejects unsafe or unsupported incident data", async () => {
  const notify = createOneSignalBackendErrorNotifier(CONFIG, {
    fetchImpl: async () => {
      throw new Error("invalid notification must not reach network");
    },
    logger: { info() {} }
  });

  await assert.rejects(
    notify({
      stage: "paper-trading",
      code: "DATABASE\nPASSWORD",
      occurredAt: "2026-11-16T20:25:32.000Z"
    }),
    /backend error is invalid/
  );
  await assert.rejects(
    notify({
      stage: "unknown",
      code: "RUNTIME_CYCLE_FAILED",
      occurredAt: "2026-11-16T20:25:32.000Z"
    }),
    /backend error is invalid/
  );
});

test("OneSignal notification errors are surfaced without exposing the API key", async () => {
  const notify = createOneSignalTradeNotifier(CONFIG, {
    fetchImpl: async () => ({ ok: false, status: 401 }),
    logger: { info() {} }
  });

  await assert.rejects(notify(TRADE), (error) => {
    assert.equal(error.code, "ONESIGNAL_REQUEST_FAILED");
    assert.equal(error.statusCode, 401);
    assert.doesNotMatch(error.message, /test-server-key/);
    return true;
  });
});

test("OneSignal notifier rejects malformed or unsupported trade events", async () => {
  const notify = createOneSignalTradeNotifier(CONFIG, {
    fetchImpl: async () => {
      throw new Error("invalid notification must not reach network");
    },
    logger: { info() {} }
  });

  await assert.rejects(
    notify({ ...TRADE, executionReason: "SKIPPED" }),
    /executed trade is invalid/
  );
  await assert.rejects(
    notify({ ...TRADE, side: "BUY", executionReason: "ATR_TRAILING_EXIT" }),
    /executed trade is invalid/
  );
});
