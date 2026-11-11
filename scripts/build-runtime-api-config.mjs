import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptDirectory, "..");

export function createRuntimeApiConfig(environment = process.env) {
  const rawApiOrigin = environment.CRYPTOPULSE_RUNTIME_API_ORIGIN?.trim() || "";
  const isVercelBuild = environment.VERCEL === "1";
  if (!rawApiOrigin && isVercelBuild) {
    throw new Error("CRYPTOPULSE_RUNTIME_API_ORIGIN is required for Vercel builds.");
  }

  const apiOrigin = rawApiOrigin
    ? normalizeApiOrigin(rawApiOrigin, isVercelBuild)
    : "";
  const accessEnabledValue = environment.CRYPTOPULSE_ACCESS_ENABLED ?? "false";
  if (accessEnabledValue !== "true" && accessEnabledValue !== "false") {
    throw new Error("CRYPTOPULSE_ACCESS_ENABLED must be 'true' or 'false'.");
  }

  const accessEnabled = accessEnabledValue === "true";
  const accessAudience = environment.CRYPTOPULSE_ACCESS_AUDIENCE?.trim() || "";
  if (accessEnabled && !accessAudience) {
    throw new Error("CRYPTOPULSE_ACCESS_AUDIENCE is required when Access is enabled.");
  }

  return { apiOrigin, accessEnabled, accessAudience };
}

export function renderRuntimeApiConfig(environment = process.env) {
  const config = createRuntimeApiConfig(environment);
  return `window.CryptoPulseRuntimeConfig = Object.freeze(${JSON.stringify(config, null, 2)});\n`;
}

function normalizeApiOrigin(value, isVercelBuild) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("CRYPTOPULSE_RUNTIME_API_ORIGIN must be an absolute HTTPS origin.");
  }

  const hostname = parsed.hostname.replace(/\.$/, "");
  const isLocalhost = hostname === "localhost";
  const hasAllowedProtocol = parsed.protocol === "https:"
    || (!isVercelBuild && isLocalhost && parsed.protocol === "http:");
  if (!hasAllowedProtocol
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash) {
    throw new Error("CRYPTOPULSE_RUNTIME_API_ORIGIN must be an HTTPS origin without credentials or a path.");
  }

  if (isVercelBuild && isLocalhost) {
    throw new Error("CRYPTOPULSE_RUNTIME_API_ORIGIN must use a stable public hostname for Vercel builds.");
  }

  if (hostname === "trycloudflare.com" || hostname.endsWith(".trycloudflare.com")) {
    throw new Error("Quick Tunnel origins are not supported for dashboard deployments.");
  }

  return parsed.origin;
}

function runBuild() {
  const outputPath = resolve(projectDirectory, "js", "runtime-api-config.js");
  writeFileSync(outputPath, renderRuntimeApiConfig(), "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runBuild();
}
