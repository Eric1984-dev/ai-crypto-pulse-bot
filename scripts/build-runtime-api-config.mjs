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

  const deploymentMode = resolveDeploymentMode(environment, isVercelBuild);
  const apiOrigin = rawApiOrigin
    ? normalizeApiOrigin(rawApiOrigin, deploymentMode, isVercelBuild)
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

function resolveDeploymentMode(environment, isVercelBuild) {
  const vercelEnvironment = environment.VERCEL_ENV?.trim() || "";
  const vercelModes = {
    production: "production",
    preview: "validation",
    development: "development"
  };
  const inferredMode = vercelModes[vercelEnvironment];
  if (vercelEnvironment && !inferredMode) {
    throw new Error("VERCEL_ENV must be production, preview, or development.");
  }

  const explicitMode = environment.CRYPTOPULSE_ENVIRONMENT?.trim() || "";
  const deploymentMode = explicitMode || inferredMode || "development";
  if (!["development", "validation", "production"].includes(deploymentMode)) {
    throw new Error("CRYPTOPULSE_ENVIRONMENT must be development, validation, or production.");
  }
  if (isVercelBuild && !inferredMode && !explicitMode) {
    throw new Error("Set CRYPTOPULSE_ENVIRONMENT when VERCEL_ENV is unavailable.");
  }
  if (inferredMode === "production" && deploymentMode !== "production") {
    throw new Error("Vercel production builds must use CRYPTOPULSE_ENVIRONMENT=production.");
  }

  return deploymentMode;
}

function normalizeApiOrigin(value, deploymentMode, isVercelBuild) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("CRYPTOPULSE_RUNTIME_API_ORIGIN must be an absolute URL origin.");
  }

  const hostname = parsed.hostname.replace(/\.$/, "");
  const isLocalhost = hostname === "localhost";
  const hasAllowedProtocol = parsed.protocol === "https:"
    || (!isVercelBuild && deploymentMode !== "production" && isLocalhost && parsed.protocol === "http:");
  if (!hasAllowedProtocol
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash) {
    throw new Error("CRYPTOPULSE_RUNTIME_API_ORIGIN must be a secure origin without credentials or a path.");
  }

  if ((isVercelBuild || deploymentMode === "production") && isLocalhost) {
    throw new Error("CRYPTOPULSE_RUNTIME_API_ORIGIN must use a stable public hostname for Vercel builds.");
  }

  if (hostname === "trycloudflare.com" || hostname.endsWith(".trycloudflare.com")) {
    if (deploymentMode === "production") {
      throw new Error("Quick Tunnel origins are not allowed in production deployments.");
    }
  }

  parsed.hostname = hostname;
  return parsed.origin;
}

function runBuild() {
  const outputPath = resolve(projectDirectory, "js", "runtime-api-config.js");
  writeFileSync(outputPath, renderRuntimeApiConfig(), "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runBuild();
}
