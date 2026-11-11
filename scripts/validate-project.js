const fs = require("node:fs");
const path = require("node:path");

const rootDirectory = path.resolve(__dirname, "..");
const isVercelBuild = process.env.VERCEL === "1";
const requiredDirectories = [
  "api",
  ...(!isVercelBuild ? ["archive-server"] : []),
  "css",
  "js",
  "lib",
  "scripts",
  "tests"
];
const requiredPages = [
  "index.html",
  "dashboard.html",
  "portfolio.html",
  "scanner.html",
  "analytics.html",
  "recommendations.html",
  "history.html",
  "exports.html",
  "admin.html",
  "settings.html",
  "login.html",
  "register.html",
  "reset-password.html"
];

function validateProject() {
  const errors = [];

  for (const directory of requiredDirectories) {
    if (!fs.existsSync(path.join(rootDirectory, directory))) {
      errors.push(`Missing required directory: ${directory}`);
    }
  }

  for (const page of requiredPages) {
    const pagePath = path.join(rootDirectory, page);
    if (!fs.existsSync(pagePath)) {
      errors.push(`Missing required page: ${page}`);
      continue;
    }

    const html = fs.readFileSync(pagePath, "utf8");
    if (!html.toLowerCase().includes("<!doctype html>")) {
      errors.push(`Missing HTML doctype: ${page}`);
    }
    if (!html.includes('href="/css/styles.css"')) {
      errors.push(`Missing shared stylesheet: ${page}`);
    }
    if (!html.includes('src="/js/main.js"')) {
      errors.push(`Missing shared JavaScript entry point: ${page}`);
    }

    const references = html.matchAll(/(?:href|src)="([^"]+)"/g);
    for (const [, reference] of references) {
      if (/^(?:[a-z]+:|\/\/|#)/i.test(reference)) {
        continue;
      }

      const localPath = new URL(reference, "https://cryptopulse.local").pathname;
      const targetPath = path.join(rootDirectory, decodeURIComponent(localPath).replace(/^\/+/, ""));
      if (!fs.existsSync(targetPath)) {
        errors.push(`Broken local reference in ${page}: ${reference}`);
      }
    }
  }

  const vercelConfigPath = path.join(rootDirectory, "vercel.json");
  let vercelConfig = null;
  if (!fs.existsSync(vercelConfigPath)) {
    errors.push("Missing Vercel configuration: vercel.json");
  } else {
    vercelConfig = JSON.parse(fs.readFileSync(vercelConfigPath, "utf8"));
    if (vercelConfig.cleanUrls !== true) {
      errors.push("Vercel cleanUrls must be enabled.");
    }
    if (vercelConfig.outputDirectory !== ".") {
      errors.push("Vercel outputDirectory must target the project root.");
    }
    if (vercelConfig.buildCommand !== "npm run build") {
      errors.push("Vercel buildCommand must run npm run build to configure the runtime API origin.");
    }
  }

  const envExamplePath = path.join(rootDirectory, ".env.example");
  if (!fs.existsSync(envExamplePath)) {
    errors.push("Missing environment template: .env.example");
  } else {
    const envExample = fs.readFileSync(envExamplePath, "utf8");
    if (!/^ENABLE_LIVE_TRADING=false$/m.test(envExample)) {
      errors.push("The environment template must keep ENABLE_LIVE_TRADING=false.");
    }
    for (const variable of ["SUPABASE_URL", "SUPABASE_ANON_KEY"]) {
      if (!new RegExp(`^${variable}=`, "m").test(envExample)) {
        errors.push(`The environment template must declare ${variable}.`);
      }
    }
    for (const variable of [
      "SUPABASE_SERVICE_ROLE_KEY",
      "ARCHIVE_SERVER_URL",
      "ARCHIVE_HEALTH_TOKEN",
      "CRON_SECRET",
      "ADMIN_USER_IDS"
    ]) {
      if (!new RegExp(`^${variable}=`, "m").test(envExample)) {
        errors.push(`The environment template must declare ${variable}.`);
      }
    }
  }

  if (!isVercelBuild) {
    const archiveEnvPath = path.join(rootDirectory, "archive-server", ".env.example");
    if (!fs.existsSync(archiveEnvPath)) {
      errors.push("Missing archive-server environment template.");
    } else {
      const archiveEnv = fs.readFileSync(archiveEnvPath, "utf8");
      for (const variable of [
        "ARCHIVE_DB_HOST",
        "ARCHIVE_DB_PORT",
        "ARCHIVE_DB_NAME",
        "ARCHIVE_DB_USER",
        "ARCHIVE_DB_PASSWORD",
        "ARCHIVE_HEALTH_TOKEN"
      ]) {
        if (!new RegExp(`^${variable}=`, "m").test(archiveEnv)) {
          errors.push(`The archive-server environment template must declare ${variable}.`);
        }
      }
    }
  }

  for (const endpoint of [
    "api/auth-config.mjs",
    "api/auth-session.mjs",
    "api/protected-page.mjs",
    "api/dashboard-data.mjs",
    "api/agent-status.mjs",
    "api/market.mjs",
    "api/market-summary.mjs",
    "api/market-refresh.mjs",
    "api/candle-refresh.mjs",
    "api/ai-analysis.mjs",
    "api/paper-trading.mjs",
    "api/admin-actions.mjs"
  ]) {
    if (!fs.existsSync(path.join(rootDirectory, endpoint))) {
      errors.push(`Missing required API endpoint: ${endpoint}`);
    }
  }

  if (!fs.existsSync(path.join(rootDirectory, "js/agent-brain.js"))) {
    errors.push("Missing Three.js Agent Brain module: js/agent-brain.js");
  }
  if (!fs.existsSync(path.join(rootDirectory, "lib", "market-data.mjs"))) {
    errors.push("Missing shared market-data service: lib/market-data.mjs");
  }
  if (!fs.existsSync(path.join(rootDirectory, "lib", "ai-engine.mjs"))) {
    errors.push("Missing shared AI engine service: lib/ai-engine.mjs");
  }
  if (!fs.existsSync(path.join(rootDirectory, "lib", "cron-auth.js"))) {
    errors.push("Missing shared scheduler authorization helper: lib/cron-auth.js");
  }
  if (!fs.existsSync(path.join(rootDirectory, "lib", "paper-trading.mjs"))) {
    errors.push("Missing server-side paper-trading service: lib/paper-trading.mjs");
  }
  if (!fs.existsSync(path.join(rootDirectory, "lib", "admin-auth.js"))) {
    errors.push("Missing server-side administrator authorization helper: lib/admin-auth.js");
  }

  if ((vercelConfig?.routes || []).some((route) =>
    typeof route.dest === "string" && route.dest.startsWith("/api/protected-page")
  )) {
    errors.push("Vercel must serve dashboard pages as static files; API authentication is enforced by the Raspberry Pi runtime.");
  }
  if (vercelConfig?.functions?.["api/protected-page.mjs"]) {
    errors.push("Vercel must not bundle the legacy protected-page function for dashboard access.");
  }

  return errors;
}

if (require.main === module) {
  const errors = validateProject();
  if (errors.length > 0) {
    console.error(`Static project validation failed:\n- ${errors.join("\n- ")}`);
    process.exitCode = 1;
  } else {
    console.log("Static project validation passed.");
  }
}

module.exports = { requiredDirectories, requiredPages, validateProject };
