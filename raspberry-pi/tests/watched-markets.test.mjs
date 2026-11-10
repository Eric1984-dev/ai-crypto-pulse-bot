import test from "node:test";
import assert from "node:assert/strict";
import { validateEnabledWatchedMarkets } from "../src/services/watched-markets.mjs";

const markets = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    symbol: "BTC-EUR",
    enabled: true,
    priority: 1
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    symbol: "ETH-EUR",
    enabled: true,
    priority: 2
  }
];

test("watched market validation preserves the enabled market rows and order", () => {
  const result = validateEnabledWatchedMarkets(markets);

  assert.deepEqual(result, markets);
  assert.notEqual(result, markets);
  assert.ok(Object.isFrozen(result));
  assert.ok(result.every(Object.isFrozen));
});

test("watched market validation fails closed on empty, disabled, malformed, or duplicate rows", () => {
  assert.throws(() => validateEnabledWatchedMarkets([]), { code: "WATCHED_MARKETS_INVALID" });
  assert.throws(() => validateEnabledWatchedMarkets([
    { ...markets[0], enabled: false }
  ]), { code: "WATCHED_MARKETS_INVALID" });
  assert.throws(() => validateEnabledWatchedMarkets([
    { ...markets[0], symbol: "bad-market" }
  ]), { code: "WATCHED_MARKETS_INVALID" });
  assert.throws(() => validateEnabledWatchedMarkets([
    markets[0],
    { ...markets[1], id: markets[0].id }
  ]), { code: "WATCHED_MARKETS_INVALID" });
});
