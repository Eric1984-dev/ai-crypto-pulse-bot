import test from "node:test";
import assert from "node:assert/strict";
import { BitvavoProviderError } from "../src/services/bitvavo-public-client.mjs";
import {
  createIngestionFailureDiagnostic,
  sanitizeDiagnosticText,
  withIngestionDiagnosticComponent
} from "../src/services/ingestion-diagnostics.mjs";

test("diagnostics preserve Bitvavo HTTP status and provider-specific component", () => {
  const error = new BitvavoProviderError(
    "PROVIDER_UNAVAILABLE",
    "Bitvavo public market data could not be loaded.",
    { httpStatus: 503 }
  );

  assert.deepEqual(createIngestionFailureDiagnostic(error), {
    code: "BITVAVO_HTTP_503",
    category: "bitvavo_http",
    message: "Bitvavo returned HTTP status 503.",
    component: "bitvavo-public-client",
    causeCode: "PROVIDER_UNAVAILABLE",
    httpStatus: 503,
    causeName: "BitvavoProviderError"
  });
});

test("diagnostics classify nested DNS, TLS, and timeout causes", () => {
  const dnsCause = Object.assign(new Error("DNS lookup failed"), { code: "ENOTFOUND" });
  const dnsError = new BitvavoProviderError(
    "PROVIDER_UNAVAILABLE",
    "Bitvavo request failed.",
    { cause: dnsCause }
  );
  const tlsError = Object.assign(new Error("certificate rejected"), {
    code: "DEPTH_ZERO_SELF_SIGNED_CERT"
  });
  const timeoutError = Object.assign(new Error("request timed out"), {
    name: "TimeoutError"
  });

  assert.equal(createIngestionFailureDiagnostic(dnsError).code, "BITVAVO_DNS_FAILED");
  assert.equal(createIngestionFailureDiagnostic(tlsError, {
    component: "bitvavo-public-client"
  }).code, "BITVAVO_TLS_FAILED");
  assert.equal(createIngestionFailureDiagnostic(timeoutError, {
    component: "bitvavo-public-client"
  }).code, "BITVAVO_TIMEOUT");
});

test("diagnostics classify PostgreSQL privilege failures through wrapped causes", () => {
  const databaseError = Object.assign(new Error("permission denied for table"), {
    code: "42501"
  });
  const storageError = Object.assign(new Error("A PostgreSQL market-data write failed.", {
    cause: databaseError
  }), {
    code: "POSTGRES_WRITE_FAILED",
    component: "postgres-write-transaction"
  });

  const diagnostic = createIngestionFailureDiagnostic(storageError);

  assert.equal(diagnostic.code, "POSTGRES_PERMISSION_DENIED");
  assert.equal(diagnostic.category, "database_privilege");
  assert.equal(diagnostic.causeCode, "42501");
  assert.equal(diagnostic.message, "PostgreSQL denied a required privilege (SQLSTATE 42501).");
  assert.equal(diagnostic.component, "postgres-write-transaction");
});

test("diagnostics distinguish PostgreSQL connection and query failures", () => {
  const connectionError = Object.assign(new Error("connection failure"), {
    code: "08006"
  });
  const queryError = Object.assign(new Error("query failure"), {
    code: "23505"
  });
  const connectionDiagnostic = createIngestionFailureDiagnostic(connectionError, {
    component: "postgres-pool"
  });
  const queryDiagnostic = createIngestionFailureDiagnostic(queryError, {
    component: "postgres-read"
  });

  assert.equal(connectionDiagnostic.code, "POSTGRES_CONNECTION_FAILED");
  assert.equal(connectionDiagnostic.category, "database_connection");
  assert.equal(connectionDiagnostic.causeCode, "08006");
  assert.equal(queryDiagnostic.code, "POSTGRES_QUERY_FAILED");
  assert.equal(queryDiagnostic.category, "database_query");
  assert.equal(queryDiagnostic.causeCode, "23505");
});

test("configuration and unexpected failures always have a meaningful non-UNKNOWN code", () => {
  const configurationError = withIngestionDiagnosticComponent(
    new Error("Missing required runtime setting: DATABASE_PASSWORD"),
    "configuration"
  );
  const unexpectedError = new Error("Unexpected ingestion failure");

  assert.equal(createIngestionFailureDiagnostic(configurationError).code,
    "INGESTION_CONFIGURATION_INVALID");
  assert.equal(createIngestionFailureDiagnostic(unexpectedError).code,
    "INGESTION_UNEXPECTED_ERROR");
  assert.notEqual(createIngestionFailureDiagnostic(unexpectedError).code, "UNKNOWN");
});

test("diagnostic text redacts credentials and stack traces are development-only", () => {
  const passwordAssignment = ["pass", "word=", "masked-value"].join("");
  const error = Object.assign(new Error(`connection failed ${passwordAssignment}`), {
    code: "ECONNRESET"
  });
  const production = createIngestionFailureDiagnostic(error, {
    component: "postgres-pool",
    env: { NODE_ENV: "production" }
  });
  const development = createIngestionFailureDiagnostic(error, {
    component: "postgres-pool",
    env: { NODE_ENV: "development" }
  });
  const sensitiveText = [
    "Bearer ",
    "access-token",
    "; ",
    ["api", "_key=", "hidden-value"].join("")
  ].join("");

  const sanitizedText = sanitizeDiagnosticText(sensitiveText);
  assert.ok(sanitizedText.includes("[REDACTED]"));
  assert.ok(!sanitizedText.includes("hidden-value"));
  assert.equal(production.message, "PostgreSQL connection failed.");
  assert.equal("stack" in production, false);
  assert.equal(typeof development.stack, "string");
  assert.ok(development.stack.includes("password=[REDACTED]"));
});
