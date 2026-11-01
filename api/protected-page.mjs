import fs from "node:fs";
import path from "node:path";
import authSession from "../lib/auth-session.js";

const {
  clearSessionCookie,
  getPublicConfig,
  readAccessToken,
  verifyAccessToken
} = authSession;

const protectedPages = new Set(["dashboard", "portfolio", "scanner", "history", "exports", "settings", "admin"]);

export function createHandler({
  env = process.env,
  verify = verifyAccessToken,
  readFile = (filePath) => fs.readFileSync(filePath, "utf8"),
  projectRoot = process.cwd()
} = {}) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "DENY");

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

    const config = getPublicConfig(env);
    if (!config) {
      res.statusCode = 503;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Supabase Authentication is not configured.");
      return;
    }

    const accessToken = readAccessToken(req.headers.cookie || "");
    if (!accessToken) {
      redirectToLogin(res, page);
      return;
    }

    try {
      if (!await verify(accessToken, config)) {
        res.setHeader("Set-Cookie", clearSessionCookie({ secure: env.NODE_ENV === "production" }));
        redirectToLogin(res, page);
        return;
      }
    } catch {
      res.statusCode = 503;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Supabase Authentication is temporarily unavailable.");
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
  const next = `/${page}.html`;
  res.statusCode = 302;
  res.setHeader("Location", `/login.html?next=${encodeURIComponent(next)}`);
  res.end();
}

export default createHandler();
