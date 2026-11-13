import assert from "node:assert/strict";
import test from "node:test";
import {
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
  assert.equal(logs[0].event, "onesignal_trade_notification_sent");
  assert.equal(logs[0].recipients, 1);
});

test("OneSignal notifier does not initialize when credentials are not configured", () => {
  assert.equal(createOneSignalTradeNotifier({
    enabled: false,
    appId: "",
    restApiKey: ""
  }), null);
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
