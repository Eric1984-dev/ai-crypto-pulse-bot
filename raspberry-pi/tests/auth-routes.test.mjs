import test from "node:test";
import assert from "node:assert/strict";
import { createApiServer } from "../src/api/server.mjs";
import { createSessionStore } from "../src/auth/session-store.mjs";

const origin = "https://dashboard.example.com";
const passwordHash = "$2a$10$mqVzXb8xEv/4khOjtskpme6LMSS9d/BQTwDX/LLAm7ig6xKOgptea";
const logger = Object.freeze({ info() {}, error() {} });
const dataRepositories = {
  watchedMarkets: {
    async listEnabled() { return []; },
    async findEnabledBySymbol() { return null; }
  },
  marketData: {
    async findForEnabledSymbol() { return null; },
    async listCandles() { return []; },
    async listForEnabledMarkets() { return []; },
    async listRecentCandlesForEnabledMarkets() { return []; }
  },
  aiDecisions: {
    async listRecent() { return []; },
    async listHistory() { return { items: [], total: 0 }; }
  },
  dashboard: {
    async getSystemDashboardData() { return {}; },
    async getShadowExitScenarios() { return { status: "AVAILABLE", positions: [] }; },
    async getTradeHistory() { return { items: [], total: 0 }; },
    async getAnalytics() { return {}; },
    async getExportRecordCount() { return 0; },
    async getExportRecords() { return []; },
    async getMonitoringMetrics() { return {}; }
  },
  runtimeStatus: {
    async getStatus() { return null; }
  }
};

async function withServer(run) {
  const sessionStore = createSessionStore();
  const server = createApiServer({
    readiness: { async check() { return true; } },
    getOperationalHealth: () => ({ status: "healthy" }),
    dataRepositories,
    sessionStore,
    dashboardAuth: { username: "operator", passwordHash },
    allowedOrigins: [origin],
    logger
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`, sessionStore);
  } finally {
    await new Promise((resolve, reject) => server.close((error) =>
      error ? reject(error) : resolve()));
  }
}

test("dashboard login rejects incorrect credentials without issuing a session", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ username: "operator", password: "wrong-password" })
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "INVALID_CREDENTIALS");
    assert.equal(response.headers.get("set-cookie"), null);
  });
});

test("dashboard login creates a secure session that survives refresh and logout revokes it", async () => {
  await withServer(async (baseUrl, sessionStore) => {
    const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ username: "operator", password: "unit-test-password" })
    });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get("set-cookie");
    assert.match(setCookie, /^__Host-cp_session=[A-Za-z0-9_-]{43};/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /Secure/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.match(setCookie, /Path=\//);
    const cookie = setCookie.split(";", 1)[0];
    const { data: session } = await login.json();
    assert.match(session.csrfToken, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(Number.isFinite(session.expiresAt));

    for (let refresh = 0; refresh < 2; refresh += 1) {
      const current = await fetch(`${baseUrl}/api/v1/auth/session`, {
        headers: { Cookie: cookie }
      });
      assert.equal(current.status, 200);
      assert.deepEqual((await current.json()).data, session);
    }

    const operational = await fetch(`${baseUrl}/api/v1/health/operational`, {
      headers: { Cookie: cookie }
    });
    assert.equal(operational.status, 200);
    const markets = await fetch(`${baseUrl}/api/v1/markets`, {
      headers: { Cookie: cookie }
    });
    assert.equal(markets.status, 200);
    assert.deepEqual(await markets.json(), { data: { count: 0, items: [] } });

    const logout = await fetch(`${baseUrl}/api/v1/auth/session`, {
      method: "DELETE",
      headers: {
        Cookie: cookie,
        Origin: origin,
        "X-CSRF-Token": session.csrfToken
      }
    });
    assert.equal(logout.status, 204);
    assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
    const token = cookie.slice(cookie.indexOf("=") + 1);
    assert.equal(sessionStore.get(token), null);

    const afterLogout = await fetch(`${baseUrl}/api/v1/auth/session`, {
      headers: { Cookie: cookie }
    });
    assert.equal(afterLogout.status, 401);
  });
});

test("dashboard login requires an allowlisted browser origin", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
      body: JSON.stringify({ username: "operator", password: "unit-test-password" })
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "ORIGIN_NOT_ALLOWED");
  });
});

test("dashboard reads and administrative health reject unauthenticated requests", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/health/operational`);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "UNAUTHENTICATED");
    const markets = await fetch(`${baseUrl}/api/v1/markets`);
    assert.equal(markets.status, 401);
    assert.equal((await markets.json()).error.code, "UNAUTHENTICATED");
    const session = await fetch(`${baseUrl}/api/v1/auth/session`);
    assert.equal(session.status, 401);
  });
});
