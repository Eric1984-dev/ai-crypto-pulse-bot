import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as signBytes } from "node:crypto";
import { ApiError } from "../src/api/api-error.mjs";
import { createApiServer } from "../src/api/server.mjs";
import { CloudflareAccessAuthenticationProvider } from "../src/auth/cloudflare-access-provider.mjs";

const issuer = "https://team.cloudflareaccess.com";
const audience = "test-application-audience";
const now = 1_800_000_000_000;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", use: "sig", alg: "RS256" };

function createToken(claimOverrides = {}, headerOverrides = {}) {
  const header = { alg: "RS256", typ: "JWT", kid: "test-key", ...headerOverrides };
  const claims = {
    iss: issuer,
    aud: audience,
    sub: "operator-subject",
    email: "ops@example.com",
    exp: Math.floor(now / 1000) + 60,
    iat: Math.floor(now / 1000),
    ...claimOverrides
  };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedClaims = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const input = `${encodedHeader}.${encodedClaims}`;
  const signature = signBytes("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url");
  return `${input}.${signature}`;
}

function createProvider({ keys = [jwk], fetchError } = {}) {
  const requests = [];
  const provider = new CloudflareAccessAuthenticationProvider({
    issuer,
    audience,
    allowedOperatorEmails: ["Ops@example.com"],
    now: () => now,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (fetchError) {
        throw fetchError;
      }
      const body = Buffer.from(JSON.stringify({ keys }));
      return {
        ok: true,
        async arrayBuffer() {
          return body;
        }
      };
    }
  });
  return { provider, requests };
}

test("validates Cloudflare Access signature, issuer, audience, and allowlisted email", async () => {
  const { provider, requests } = createProvider();
  const identity = await provider.authenticate({
    headers: { "cf-access-jwt-assertion": createToken() }
  });
  assert.deepEqual(identity, {
    principal: {
      subject: "operator-subject",
      email: "ops@example.com",
      roles: ["operator"]
    }
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `${issuer}/cdn-cgi/access/certs`);
  assert.equal(requests[0].options.redirect, "error");
  assert.equal(requests[0].options.cache, "no-store");
});

test("rejects untrusted JWT claims and signatures", async () => {
  const cases = [
    createToken({ iss: "https://other.cloudflareaccess.com" }),
    createToken({ aud: "other-audience" }),
    createToken({ email: "other@example.com" }),
    createToken({ exp: Math.floor(now / 1000) }),
    createToken({}, { alg: "HS256" })
  ];
  for (const token of cases) {
    const { provider } = createProvider();
    assert.equal(await provider.authenticate({
      headers: { "cf-access-jwt-assertion": token }
    }), null);
  }

  const { provider } = createProvider();
  const token = createToken();
  assert.equal(await provider.authenticate({
    headers: { "cf-access-jwt-assertion": `${token.slice(0, -2)}aa` }
  }), null);
});

test("does not authenticate missing or malformed access assertions", async () => {
  const { provider } = createProvider();
  assert.equal(await provider.authenticate({ headers: {} }), null);
  assert.equal(await provider.authenticate({
    headers: { "cf-access-jwt-assertion": "not.a.jwt" }
  }), null);
  assert.equal(await provider.authenticate({
    headers: { "cf-access-jwt-assertion": "x".repeat(16385) }
  }), null);
});

test("fails explicitly when Cloudflare signing keys are unavailable", async () => {
  const { provider } = createProvider({ fetchError: new Error("network detail") });
  await assert.rejects(
    provider.authenticate({
      headers: { "cf-access-jwt-assertion": createToken() }
    }),
    (error) => error instanceof ApiError
      && error.statusCode === 503
      && error.code === "ACCESS_KEYS_UNAVAILABLE"
  );
});

test("API activates Cloudflare Access from runtime config and carries operator identity context", async () => {
  const requests = [];
  const server = createApiServer({
    readiness: { async check() { return true; } },
    getOperationalHealth: () => ({ status: "healthy" }),
    cloudflareAccess: {
      enabled: true,
      issuer,
      audience,
      allowedOperatorEmails: ["ops@example.com"],
      now: () => now,
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        const body = Buffer.from(JSON.stringify({ keys: [jwk] }));
        return {
          ok: true,
          async arrayBuffer() {
            return body;
          }
        };
      }
    },
    logger: { info() {}, error() {} }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const anonymous = await fetch(`${baseUrl}/api/v1/health/operational`);
    assert.equal(anonymous.status, 401);

    const operator = await fetch(`${baseUrl}/api/v1/health/operational`, {
      headers: { "Cf-Access-Jwt-Assertion": createToken() }
    });
    assert.equal(operator.status, 403);
    assert.equal((await operator.json()).error.code, "FORBIDDEN");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, `${issuer}/cdn-cgi/access/certs`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) =>
      error ? reject(error) : resolve()));
  }
});
