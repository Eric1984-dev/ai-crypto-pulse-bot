const SAFE_CODE_PATTERN = /^[A-Z0-9_]{1,64}$/;
const POSTGRES_SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;
const MAX_MESSAGE_LENGTH = 500;
const MAX_STACK_LENGTH = 12000;

const DNS_CODES = new Set(["EAI_AGAIN", "EAI_FAIL", "ENODATA", "ENOTFOUND"]);
const CONNECTION_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH"
]);
const POSTGRES_CONNECTION_SQLSTATES = new Set(["53300", "57P01", "57P02", "57P03"]);

export function withIngestionDiagnosticComponent(error, component) {
  const cause = error instanceof Error
    ? error
    : new Error("A non-Error value was thrown.", { cause: error });
  if (findComponent(errorChain(cause))) {
    return cause;
  }
  const wrapped = new Error(cause.message || "The ingestion command failed.", { cause });
  wrapped.name = "IngestionDiagnosticError";
  wrapped.component = component;
  if (readSafeCode(cause.code)) {
    wrapped.code = cause.code;
  }
  if (Array.isArray(cause.errors)) {
    wrapped.errors = cause.errors;
  }
  return wrapped;
}

export function createIngestionFailureDiagnostic(error, {
  component,
  env = process.env
} = {}) {
  const chain = errorChain(error);
  const codes = chain.map((item) => readSafeCode(item.code)).filter(Boolean);
  const root = chain.at(-1);
  const resolvedComponent = findComponent(chain) || component || "market-data-ingestion";
  const httpStatus = findHttpStatus(chain);
  const classification = classifyFailure({
    chain,
    codes,
    component: resolvedComponent,
    httpStatus
  });
  const rootMessage = readMessage(root) || readMessage(chain[0]);
  const message = classification.message
    || safeDiagnosticMessage(classification, resolvedComponent, rootMessage);
  const diagnostic = {
    code: classification.code,
    category: classification.category,
    message,
    component: resolvedComponent,
    ...(classification.causeCode ? { causeCode: classification.causeCode } : {}),
    ...(Number.isInteger(httpStatus) ? { httpStatus } : {}),
    ...(root?.name ? { causeName: sanitizeDiagnosticText(root.name) } : {})
  };

  if (env.NODE_ENV === "development") {
    const stack = chain
      .map((item) => typeof item.stack === "string" ? item.stack : "")
      .filter(Boolean)
      .join("\nCaused by:\n");
    if (stack) {
      diagnostic.stack = sanitizeDiagnosticText(stack, MAX_STACK_LENGTH);
    }
  }

  return Object.freeze(diagnostic);
}

export function sanitizeDiagnosticText(value, maxLength = MAX_MESSAGE_LENGTH) {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .replace(/\b(password|passwd|passphrase|token|secret|authorization|api[_ -]?key)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1$2[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\b(postgres(?:ql)?|https?):\/\/[^/\s:@]+:[^/\s@]+@/gi, "$1://[REDACTED]@")
    .slice(0, maxLength);
}

function classifyFailure({ chain, codes, component, httpStatus }) {
  const errorNames = chain.map((item) => item.name).filter((name) => typeof name === "string");
  const causeCode = codes.at(-1);
  const isBitvavo = component.includes("bitvavo")
    || errorNames.includes("BitvavoProviderError");
  const isPostgres = component.includes("postgres")
    || errorNames.some((name) => name.startsWith("RepositoryUnavailableError")
      || name.startsWith("MarketIngestionStorageError"));

  if (Number.isInteger(httpStatus) && httpStatus >= 400 && httpStatus <= 599) {
    return {
      code: `BITVAVO_HTTP_${httpStatus}`,
      category: "bitvavo_http",
      message: `Bitvavo returned HTTP status ${httpStatus}.`,
      causeCode
    };
  }

  if (codes.some(isTlsCode)) {
    return {
      code: isBitvavo ? "BITVAVO_TLS_FAILED" : "POSTGRES_TLS_FAILED",
      category: "tls",
      causeCode
    };
  }

  if (codes.some((code) => DNS_CODES.has(code))) {
    return {
      code: isBitvavo ? "BITVAVO_DNS_FAILED" : isPostgres
        ? "POSTGRES_DNS_FAILED"
        : "INGESTION_DNS_FAILED",
      category: "dns",
      causeCode
    };
  }

  if (codes.some(isTimeoutCode) || errorNames.some((name) =>
    name === "TimeoutError" || name === "AbortError")) {
    return {
      code: isBitvavo ? "BITVAVO_TIMEOUT" : isPostgres
        ? "POSTGRES_CONNECTION_TIMEOUT"
        : "INGESTION_TIMEOUT",
      category: "timeout",
      causeCode
    };
  }

  if (codes.some((code) => CONNECTION_CODES.has(code))) {
    return {
      code: isBitvavo ? "BITVAVO_CONNECTION_FAILED" : isPostgres
        ? "POSTGRES_CONNECTION_FAILED"
        : "INGESTION_CONNECTION_FAILED",
      category: "connection",
      causeCode
    };
  }

  const postgresCode = [...codes].reverse().find((code) =>
    POSTGRES_SQLSTATE_PATTERN.test(code));
  if (postgresCode === "42501") {
    return { code: "POSTGRES_PERMISSION_DENIED", category: "database_privilege", causeCode: postgresCode };
  }
  if (postgresCode?.startsWith("28")) {
    return { code: "POSTGRES_AUTHENTICATION_FAILED", category: "database_authentication", causeCode: postgresCode };
  }
  if (postgresCode?.startsWith("08") || POSTGRES_CONNECTION_SQLSTATES.has(postgresCode)) {
    return { code: "POSTGRES_CONNECTION_FAILED", category: "database_connection", causeCode: postgresCode };
  }
  if (postgresCode) {
    return { code: "POSTGRES_QUERY_FAILED", category: "database_query", causeCode: postgresCode };
  }

  if (component === "configuration") {
    return { code: "INGESTION_CONFIGURATION_INVALID", category: "configuration" };
  }

  const contractErrors = chain.flatMap((item) =>
    Array.isArray(item.errors) ? item.errors : []
  );
  const contractError = codes.includes("INGESTION_CONTRACT_INVALID")
    || codes.includes("RUNTIME_CONTRACT_INVALID");
  if (contractError) {
    const privilegeFailure = contractErrors.some((item) =>
      typeof item === "string"
      && /PRIVILEGE|TOO_PRIVILEGED|UNSAFE_TABLE/.test(item)
    );
    return {
      code: codes.find((code) => code.includes("CONTRACT_INVALID")) || "INGESTION_CONTRACT_INVALID",
      category: privilegeFailure ? "database_privilege" : "database_contract"
    };
  }

  if (isBitvavo) {
    const providerCode = [...codes].reverse().find((code) => code.startsWith("PROVIDER_"));
    if (providerCode === "PROVIDER_TIMEOUT") {
      return { code: "BITVAVO_TIMEOUT", category: "timeout", causeCode: providerCode };
    }
    if (providerCode === "PROVIDER_UNAVAILABLE") {
      return { code: "BITVAVO_UNAVAILABLE", category: "provider", causeCode: providerCode };
    }
    if (providerCode === "PROVIDER_RESPONSE_TOO_LARGE") {
      return { code: "BITVAVO_RESPONSE_TOO_LARGE", category: "provider_response", causeCode: providerCode };
    }
    if (providerCode === "PROVIDER_EMPTY") {
      return { code: "BITVAVO_EMPTY_RESPONSE", category: "provider_response", causeCode: providerCode };
    }
    if (providerCode === "INVALID_PROVIDER_RESPONSE") {
      return { code: "BITVAVO_INVALID_RESPONSE", category: "provider_response", causeCode: providerCode };
    }
    if (codes.includes("MARKET_DATA_MISSING") || codes.includes("CANDLE_DATA_MISSING")) {
      return {
        code: "BITVAVO_MARKET_DATA_MISSING",
        category: "provider_response",
        causeCode: codes.includes("MARKET_DATA_MISSING")
          ? "MARKET_DATA_MISSING"
          : "CANDLE_DATA_MISSING"
      };
    }
    if (codes.includes("RATE_LIMITED")) {
      return { code: "BITVAVO_RATE_LIMITED", category: "bitvavo_http", causeCode: "RATE_LIMITED" };
    }
    if (codes.includes("MARKET_NOT_FOUND")) {
      return { code: "BITVAVO_MARKET_NOT_FOUND", category: "bitvavo_http", causeCode: "MARKET_NOT_FOUND" };
    }
    return {
      code: readKnownCode(codes) || "BITVAVO_REQUEST_FAILED",
      category: "provider"
    };
  }

  if (codes.includes("POSTGRES_WRITE_FAILED")) {
    return { code: "POSTGRES_WRITE_FAILED", category: "database_write", causeCode };
  }

  if (codes.includes("INGESTION_CONFIGURATION_INVALID")) {
    return { code: "INGESTION_CONFIGURATION_INVALID", category: "configuration" };
  }

  const knownCode = readKnownCode(codes);
  if (knownCode) {
    return {
      code: knownCode,
      category: knownCode.startsWith("INVALID_") ? "data_validation" : "ingestion"
    };
  }

  return {
    code: "INGESTION_UNEXPECTED_ERROR",
    category: "unexpected",
    causeCode
  };
}

function errorChain(error) {
  const chain = [];
  const visited = new Set();
  let current = error;
  while (current !== null && current !== undefined && chain.length < 8) {
    if (typeof current !== "object" && typeof current !== "function") {
      chain.push({
        name: "NonErrorThrown",
        message: typeof current === "string" ? current : "A non-Error value was thrown."
      });
      break;
    }
    if (visited.has(current)) {
      break;
    }
    visited.add(current);
    chain.push(current);
    current = current.cause;
  }
  return chain;
}

function findComponent(chain) {
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const component = chain[index].component;
    if (typeof component === "string" && /^[a-z0-9-]{1,64}$/.test(component)) {
      return component;
    }
  }
  return "";
}

function findHttpStatus(chain) {
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    if (Number.isInteger(chain[index].httpStatus)) {
      return chain[index].httpStatus;
    }
  }
  return undefined;
}

function isTlsCode(code) {
  return /^(CERT_|ERR_CERT_|ERR_TLS_|ERR_SSL_|ERR_OSSL_|SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO)/.test(code);
}

function isTimeoutCode(code) {
  return /TIMEOUT|TIMEDOUT|ABORT/.test(code);
}

function readSafeCode(value) {
  if (typeof value !== "string" || value === "UNKNOWN" || !SAFE_CODE_PATTERN.test(value)) {
    return "";
  }
  return value;
}

function readKnownCode(codes) {
  for (let index = codes.length - 1; index >= 0; index -= 1) {
    const code = codes[index];
    if (readSafeCode(code) && !POSTGRES_SQLSTATE_PATTERN.test(code)) {
      return code;
    }
  }
  return "";
}

function safeDiagnosticMessage(classification, component, rootMessage) {
  const sqlState = classification.causeCode
    && POSTGRES_SQLSTATE_PATTERN.test(classification.causeCode)
    ? ` (SQLSTATE ${classification.causeCode})`
    : "";
  switch (classification.category) {
    case "configuration":
      return sanitizeDiagnosticText(rootMessage) || "Ingestion configuration is invalid.";
    case "database_privilege":
      return `PostgreSQL denied a required privilege${sqlState}.`;
    case "database_authentication":
      return `PostgreSQL authentication failed${sqlState}.`;
    case "database_connection":
    case "connection":
      return component.includes("bitvavo")
        ? "Bitvavo connection failed."
        : "PostgreSQL connection failed.";
    case "database_query":
      return `PostgreSQL query failed${sqlState}.`;
    case "database_write":
      return `PostgreSQL write failed${sqlState}.`;
    case "dns":
      return component.includes("bitvavo")
        ? "Bitvavo DNS resolution failed."
        : "PostgreSQL DNS resolution failed.";
    case "tls":
      return component.includes("bitvavo")
        ? "Bitvavo TLS negotiation failed."
        : "PostgreSQL TLS negotiation failed.";
    case "timeout":
      return component.includes("bitvavo")
        ? "Bitvavo request timed out."
        : "PostgreSQL connection or query timed out.";
    case "provider_response":
      return `Bitvavo returned invalid or missing market data (${classification.code}).`;
    case "provider":
    case "bitvavo_http":
      return `Bitvavo request failed (${classification.code}).`;
    case "database_contract":
      return "The PostgreSQL ingestion contract is invalid.";
    case "data_validation":
    case "ingestion":
      return sanitizeDiagnosticText(rootMessage)
        || `Ingestion failed (${classification.code}).`;
    default:
      return `Unexpected error in ${component}.`;
  }
}

function readMessage(error) {
  return typeof error?.message === "string" ? error.message.trim() : "";
}
