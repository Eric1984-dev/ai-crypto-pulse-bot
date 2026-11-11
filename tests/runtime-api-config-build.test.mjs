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

test("Vercel builds require an origin and infer production or validation mode", () => {
  assert.throws(
    () => createRuntimeApiConfig({ VERCEL: "1" }),
    /CRYPTOPULSE_RUNTIME_API_ORIGIN is required/
  );
  assert.throws(
    () => createRuntimeApiConfig({
      VERCEL: "1",
      CRYPTOPULSE_RUNTIME_API_ORIGIN: "https://api.example.com"
    }),
    /Set CRYPTOPULSE_ENVIRONMENT/
  );
  assert.deepEqual(createRuntimeApiConfig({
    VERCEL: "1",
    VERCEL_ENV: "production",
    CRYPTOPULSE_RUNTIME_API_ORIGIN: "https://api.example.com"
  }), {
    apiOrigin: "https://api.example.com",
    accessEnabled: false,
    accessAudience: ""
  });
  assert.deepEqual(createRuntimeApiConfig({
    VERCEL: "1",
    VERCEL_ENV: "preview",
    CRYPTOPULSE_RUNTIME_API_ORIGIN: "https://api-preview.trycloudflare.com"
  }), {
    apiOrigin: "https://api-preview.trycloudflare.com",
    accessEnabled: false,
    accessAudience: ""
  });
  assert.deepEqual(createRuntimeApiConfig({
    VERCEL: "1",
    CRYPTOPULSE_ENVIRONMENT: "validation",
    CRYPTOPULSE_RUNTIME_API_ORIGIN: "https://api-validation.trycloudflare.com"
  }), {
    apiOrigin: "https://api-validation.trycloudflare.com",
    accessEnabled: false,
    accessAudience: ""
  });
});

test("Quick Tunnel origins are allowed only outside production", () => {
  for (const [environment, apiOrigin, expectedOrigin] of [
    [{}, "https://local.trycloudflare.com", "https://local.trycloudflare.com"],
    [{ CRYPTOPULSE_ENVIRONMENT: "validation" }, "https://validation.trycloudflare.com", "https://validation.trycloudflare.com"],
    [{ VERCEL: "1", VERCEL_ENV: "preview" }, "https://preview.trycloudflare.com", "https://preview.trycloudflare.com"],
    [{ VERCEL: "1", VERCEL_ENV: "preview" }, "https://preview.trycloudflare.com.", "https://preview.trycloudflare.com"]
  ]) {
    assert.equal(createRuntimeApiConfig({
      ...environment,
      CRYPTOPULSE_RUNTIME_API_ORIGIN: apiOrigin
    }).apiOrigin, expectedOrigin);
  }

  for (const environment of [
    { CRYPTOPULSE_ENVIRONMENT: "production" },
    { VERCEL: "1", VERCEL_ENV: "production", CRYPTOPULSE_ENVIRONMENT: "production" }
  ]) {
    assert.throws(
      () => createRuntimeApiConfig({
        ...environment,
        CRYPTOPULSE_RUNTIME_API_ORIGIN: "https://production.trycloudflare.com"
      }),
      /Quick Tunnel origins are not allowed in production/
    );
  }

  assert.throws(
    () => createRuntimeApiConfig({
      VERCEL: "1",
      VERCEL_ENV: "production",
      CRYPTOPULSE_ENVIRONMENT: "validation",
      CRYPTOPULSE_RUNTIME_API_ORIGIN: "https://api.example.com"
    }),
    /must use CRYPTOPULSE_ENVIRONMENT=production/
  );
});

test("deployment modes are validated and Vercel builds require a known environment", () => {
  assert.throws(
    () => createRuntimeApiConfig({
      VERCEL: "1",
      VERCEL_ENV: "custom",
      CRYPTOPULSE_ENVIRONMENT: "validation",
      CRYPTOPULSE_RUNTIME_API_ORIGIN: "https://api.example.com"
    }),
    /VERCEL_ENV must be production, preview, or development/
  );
  assert.throws(
    () => createRuntimeApiConfig({
      VERCEL: "1",
      CRYPTOPULSE_ENVIRONMENT: "preview",
      CRYPTOPULSE_RUNTIME_API_ORIGIN: "https://api.example.com"
    }),
    /CRYPTOPULSE_ENVIRONMENT must be development, validation, or production/
  );
  assert.throws(
    () => createRuntimeApiConfig({
      VERCEL: "1",
      CRYPTOPULSE_RUNTIME_API_ORIGIN: "https://api.example.com"
    }),
    /Set CRYPTOPULSE_ENVIRONMENT when VERCEL_ENV is unavailable/
  );
});

test("local development accepts only the runtime's localhost HTTP origin", () => {
  assert.equal(createRuntimeApiConfig({
    CRYPTOPULSE_RUNTIME_API_ORIGIN: "http://localhost:3002/"
  }).apiOrigin, "http://localhost:3002");
  assert.throws(
    () => createRuntimeApiConfig({
      CRYPTOPULSE_RUNTIME_API_ORIGIN: "http://api.example.com"
    }),
    /secure origin/
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
      /secure origin/
    );
  }
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
    VERCEL_ENV: "production",
    CRYPTOPULSE_RUNTIME_API_ORIGIN: "https://api.example.com",
    CRYPTOPULSE_ACCESS_ENABLED: "true",
    CRYPTOPULSE_ACCESS_AUDIENCE: "public-audience-tag"
  });
  assert.match(rendered, /"apiOrigin": "https:\/\/api\.example\.com"/);
  assert.match(rendered, /"accessEnabled": true/);
  assert.match(rendered, /"accessAudience": "public-audience-tag"/);
  assert.doesNotMatch(rendered, /trycloudflare\.com/);
});
