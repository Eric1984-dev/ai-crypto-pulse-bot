import { createPublicKey, verify as verifySignature } from "node:crypto";
import { ApiError } from "../api/api-error.mjs";
import { AuthenticationProvider } from "./authentication-provider.mjs";

const JWT_HEADER_NAME = "cf-access-jwt-assertion";
const MAX_TOKEN_LENGTH = 16384;
const MAX_JWKS_BYTES = 65536;
const JWKS_CACHE_MS = 60 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 60;

export class CloudflareAccessAuthenticationProvider extends AuthenticationProvider {
  constructor({
    issuer,
    audience,
    allowedOperatorEmails,
    fetchImpl = globalThis.fetch,
    now = Date.now
  }) {
    super();
    if (typeof issuer !== "string" || !issuer
      || typeof audience !== "string" || !audience
      || !Array.isArray(allowedOperatorEmails) || allowedOperatorEmails.length === 0
      || typeof fetchImpl !== "function" || typeof now !== "function") {
      throw new TypeError("Cloudflare Access authentication configuration is incomplete.");
    }
    this.issuer = issuer;
    this.audience = audience;
    this.allowedOperatorEmails = new Set(
      allowedOperatorEmails.map((email) => email.toLowerCase())
    );
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.keys = new Map();
    this.keysExpiresAt = 0;
    this.keysRequest = null;
  }

  async authenticate(request) {
    const token = request.headers?.[JWT_HEADER_NAME];
    if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
      return null;
    }

    const parts = token.split(".");
    if (parts.length !== 3) {
      return null;
    }
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = decodeJsonSegment(encodedHeader);
    const claims = decodeJsonSegment(encodedPayload);
    if (!header || !claims || header.alg !== "RS256"
      || typeof header.kid !== "string" || !header.kid
      || !isBase64Url(encodedSignature)) {
      return null;
    }

    const jwk = await this.#keyFor(header.kid);
    if (!jwk) {
      return null;
    }
    let signatureValid = false;
    try {
      signatureValid = verifySignature(
        "RSA-SHA256",
        Buffer.from(`${encodedHeader}.${encodedPayload}`),
        createPublicKey({ key: jwk, format: "jwk" }),
        Buffer.from(encodedSignature, "base64url")
      );
    } catch {
      return null;
    }
    if (!signatureValid || !this.#validClaims(claims)) {
      return null;
    }

    return {
      principal: {
        subject: claims.sub,
        email: claims.email.toLowerCase(),
        roles: ["operator"]
      }
    };
  }

  #validClaims(claims) {
    const nowSeconds = Math.floor(this.now() / 1000);
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    return claims.iss === this.issuer
      && audiences.includes(this.audience)
      && typeof claims.sub === "string" && claims.sub.length > 0
      && typeof claims.email === "string"
      && this.allowedOperatorEmails.has(claims.email.toLowerCase())
      && Number.isFinite(claims.exp) && claims.exp > nowSeconds
      && (claims.nbf === undefined
        || (Number.isFinite(claims.nbf) && claims.nbf <= nowSeconds + CLOCK_SKEW_SECONDS))
      && (claims.iat === undefined
        || (Number.isFinite(claims.iat) && claims.iat <= nowSeconds + CLOCK_SKEW_SECONDS));
  }

  async #keyFor(kid) {
    if (this.keysExpiresAt > this.now() && this.keys.has(kid)) {
      return this.keys.get(kid);
    }
    const keys = await this.#loadKeys(this.keysExpiresAt <= this.now());
    if (keys.has(kid)) {
      return keys.get(kid);
    }
    return (await this.#loadKeys(true)).get(kid) || null;
  }

  async #loadKeys(force) {
    if (!force && this.keysExpiresAt > this.now()) {
      return this.keys;
    }
    if (this.keysRequest) {
      return this.keysRequest;
    }
    this.keysRequest = this.#fetchKeys();
    try {
      return await this.keysRequest;
    } finally {
      this.keysRequest = null;
    }
  }

  async #fetchKeys() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    let response;
    try {
      response = await this.fetchImpl(`${this.issuer}/cdn-cgi/access/certs`, {
        method: "GET",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
        headers: { Accept: "application/json" }
      });
    } catch {
      throw new ApiError(
        503,
        "ACCESS_KEYS_UNAVAILABLE",
        "Authentication validation is temporarily unavailable."
      );
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new ApiError(
        503,
        "ACCESS_KEYS_UNAVAILABLE",
        "Authentication validation is temporarily unavailable."
      );
    }

    let body;
    try {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_JWKS_BYTES) {
        throw new Error("JWKS response is too large.");
      }
      body = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new ApiError(
        503,
        "ACCESS_KEYS_INVALID",
        "Authentication validation is temporarily unavailable."
      );
    }
    if (!Array.isArray(body?.keys)) {
      throw new ApiError(
        503,
        "ACCESS_KEYS_INVALID",
        "Authentication validation is temporarily unavailable."
      );
    }
    const keys = new Map();
    for (const key of body.keys) {
      if (key?.kty === "RSA" && key.use !== "enc" && key.alg !== "RS512"
        && typeof key.kid === "string") {
        keys.set(key.kid, key);
      }
    }
    this.keys = keys;
    this.keysExpiresAt = this.now() + JWKS_CACHE_MS;
    return keys;
  }
}

function decodeJsonSegment(value) {
  if (!isBase64Url(value)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isBase64Url(value) {
  return typeof value === "string" && value.length > 0 && /^[A-Za-z0-9_-]+$/.test(value);
}
