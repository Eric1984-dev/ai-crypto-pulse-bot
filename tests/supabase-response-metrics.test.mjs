import assert from "node:assert/strict";
import test from "node:test";
import { createSupabaseResponseMetrics } from "../lib/supabase-response-metrics.mjs";

test("Supabase response metrics group calls by method and pathname without logging query strings", async () => {
  const metrics = createSupabaseResponseMetrics("https://project.supabase.co");
  const measuredFetch = metrics.wrapFetch(async () => ({
    status: 200,
    headers: { get: (name) => name === "content-length" ? "27" : null },
    async json() { return [{ symbol: "BTC-EUR" }]; }
  }));

  const response = await measuredFetch(
    "https://project.supabase.co/rest/v1/rpc/read_candles?secret=must-not-appear",
    { method: "POST" }
  );
  await response.json();

  assert.deepEqual(metrics.summary().endpoints, [{
    endpoint: "POST /rest/v1/rpc/read_candles",
    requests: 1,
    responsesWithContentLength: 1,
    contentLengthBytes: 27,
    jsonResponsesMeasured: 1,
    jsonBodyBytesEstimate: Buffer.byteLength(JSON.stringify([{ symbol: "BTC-EUR" }]), "utf8")
  }]);
  assert.doesNotMatch(JSON.stringify(metrics.summary()), /secret=must-not-appear/);
});

test("Supabase response metrics ignore non-Supabase API traffic", async () => {
  const metrics = createSupabaseResponseMetrics("https://project.supabase.co");
  const measuredFetch = metrics.wrapFetch(async () => ({ status: 200 }));

  await measuredFetch("https://api.bitvavo.com/v2/markets", { method: "GET" });

  assert.deepEqual(metrics.summary().endpoints, []);
});
