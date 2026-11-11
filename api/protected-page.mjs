import fs from "node:fs";
import path from "node:path";
import {
  clearSessionCookie,
  createSessionCookieHeader,
  createRuntimeApiUrl,
  readSessionToken
} from "../lib/runtime-api-proxy.mjs";

const protectedPages = new Set([
  "dashboard",
  "portfolio",
  "scanner",
  "analytics",
  "recommendations",
  "history",
  "exports",
  "settings",
  "admin"
]);

export function createHandler({
  env = process.env,
  fetchImpl = globalThis.fetch,
  readFile = (filePath) => fs.readFileSync(filePath, "utf8"),
  projectRoot = process.cwd()
} = {}) {
  return async function handler(req, res) {
    setSecurityHeaders(res);
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      res.statusCode = 405;
      res.end("Method not allowed.");
      return;
    }

    const page = getPageName(req);
    if (!protectedPages.has(page)) {
      res.statusCode = 404;
      res.end("Not found.");
      return;
    }

    if (!readSessionToken(req.headers?.cookie || "")) {
      clearSessionCookie(res);
      redirectToLogin(res, page);
      return;
    }

    let response;
    try {
      const url = createRuntimeApiUrl(env, "/api/v1/auth/session");
      const headers = {
        accept: "application/json",
        cookie: createSessionCookieHeader(req.headers.cookie)
      };
      const accessToken = req.headers?.["cf-access-jwt-assertion"];
      if (typeof accessToken === "string" && accessToken.length <= 8192) {
        headers["cf-access-jwt-assertion"] = accessToken;
      }
      response = await fetchImpl(url, {
        method: "GET",
        headers
      });
    } catch {
      sendUnavailable(res);
      return;
    }

    if (response.status === 401) {
      clearSessionCookie(res);
      redirectToLogin(res, page);
      return;
    }
    if (!response.ok) {
      sendUnavailable(res);
      return;
    }

    const pagePath = path.join(projectRoot, `${page}.html`);
    try {
      const html = readFile(pagePath);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.statusCode = 200;
      res.end(html);
    } catch {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("The protected page could not be loaded.");
    }
  };
}

function getPageName(req) {
  if (req.query && typeof req.query.page === "string") {
    return req.query.page;
  }
  try {
    return new URL(req.url, "http://localhost").searchParams.get("page") || "";
  } catch {
    return "";
  }
}

function redirectToLogin(res, page) {
  res.statusCode = 302;
  res.setHeader("Location", `/login.html?next=${encodeURIComponent(`/${page}.html`)}`);
  res.end();
}

function sendUnavailable(res) {
  res.statusCode = 503;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end("Dashboard authentication could not be verified.");
}

function setSecurityHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
}

export default createHandler();
