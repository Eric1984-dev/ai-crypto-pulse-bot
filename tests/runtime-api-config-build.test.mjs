import assert from "node:assert/strict";
import test from "node:test";
import {
  createRuntimeApiConfig,
  renderRuntimeApiConfig
} from "../scripts/build-runtime-api-config.mjs";

test("local builds default to an unconfigured API origin", () => {
  assert.deepEqual(createRuntimeApiConfig({}), {
    apiOrigin: "",
    accessEnabled: false,
    accessAudience: ""
  });
});

test("Vercel builds require a stable HTTPS runtime API origin", () => {
  assert.throws(
    () => createRuntimeApiConfig({ VERCEL: "1" }),
    /CRYPTOPULSE_RUNTIME_API_ORIGIN is required/
  );
  assert.deepEqual(createRuntimeApiConfig({
    VERCEL: "1",
    CRYPTOPULSE_RUNTIME_API_ORIGIN: "https://api.example.com/"
  }), {
    apiOrigin: "https://api.example.com",
    accessEnabled: false,
    accessAudience: ""
  });
});

test("local development accepts only the runtime's localhost HTTP origin", () => {
  assert.equal(createRuntimeApiConfig({
    CRYPTOPULSE_RUNTIME_API_ORIGIN: "http://localhost:3002/"
  }).apiOrigin, "http://localhost:3002");
  assert.throws(
    () => createRuntimeApiConfig({
      CRYPTOPULSE_RUNTIME_API_ORIGIN: "http://api.example.com"
    }),
    /HTTPS origin/
  );
});

test("runtime origins reject paths, credentials, query strings, and fragments", () => {
  for (const apiOrigin of [
    "https://user:pass@api.example.com",
    "https://api.example.com/v1",
    "https://api.example.com?key=value",
    "https://api.example.com#dashboard"
  ]) {
    assert.throws(
      () => createRuntimeApiConfig({ CRYPTOPULSE_RUNTIME_API_ORIGIN: apiOrigin }),
      /HTTPS origin/
    );
  }
});

test("Quick Tunnel origins cannot be configured for dashboard deployments", () => {
  for (const apiOrigin of [
    "https://random-name.trycloudflare.com",
    "https://random-name.trycloudflare.com."
  ]) {
    assert.throws(
      () => createRuntimeApiConfig({ CRYPTOPULSE_RUNTIME_API_ORIGIN: apiOrigin }),
      /Quick Tunnel origins are not supported/
    );
  }
  assert.throws(
    () => createRuntimeApiConfig({
      VERCEL: "1",
      CRYPTOPULSE_RUNTIME_API_ORIGIN: "https://localhost:3002"
    }),
    /stable public hostname/
  );
});

test("Cloudflare Access settings are validated and emitted as public dashboard config", () => {
  assert.throws(
    () => createRuntimeApiConfig({
      CRYPTOPULSE_ACCESS_ENABLED: "true"
    }),
    /CRYPTOPULSE_ACCESS_AUDIENCE is required/
  );
  assert.throws(
    () => createRuntimeApiConfig({
      CRYPTOPULSE_ACCESS_ENABLED: "yes"
    }),
    /must be 'true' or 'false'/
  );

  const rendered = renderRuntimeApiConfig({
    VERCEL: "1",
    CRYPTOPULSE_RUNTIME_API_ORIGIN: "https://api.example.com",
    CRYPTOPULSE_ACCESS_ENABLED: "true",
    CRYPTOPULSE_ACCESS_AUDIENCE: "public-audience-tag"
  });
  assert.match(rendered, /"apiOrigin": "https:\/\/api\.example\.com"/);
  assert.match(rendered, /"accessEnabled": true/);
  assert.match(rendered, /"accessAudience": "public-audience-tag"/);
  assert.doesNotMatch(rendered, /trycloudflare\.com/);
});
