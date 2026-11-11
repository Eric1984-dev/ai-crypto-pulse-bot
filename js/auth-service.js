(function attachDashboardAuth(root, createApi) {
  const api = createApi();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.CryptoPulseAuth = api;
})(globalThis, function createDashboardAuthApi() {
  const protectedPaths = Object.freeze([
    "/dashboard.html",
    "/portfolio.html",
    "/scanner.html",
    "/analytics.html",
    "/recommendations.html",
    "/history.html",
    "/exports.html",
    "/settings.html",
    "/admin.html"
  ]);
  const SESSION_ENDPOINT = "/api/auth-session";

  function safeNextPath(candidate) {
    if (typeof candidate !== "string") {
      return "/dashboard.html";
    }
    try {
      const url = new URL(candidate, "https://dashboard.invalid");
      if (url.origin !== "https://dashboard.invalid" || !protectedPaths.includes(url.pathname)) {
        return "/dashboard.html";
      }
      return `${url.pathname}${url.search}`;
    } catch {
      return "/dashboard.html";
    }
  }

  async function getSession(fetchImpl = globalThis.fetch) {
    const response = await fetchImpl(SESSION_ENDPOINT, {
      method: "GET",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      cache: "no-store"
    });
    if (response.status === 401) {
      return null;
    }
    if (!response.ok) {
      throw new Error("Dashboard authentication is temporarily unavailable.");
    }
    return parseSessionResponse(response);
  }

  async function login(username, password, fetchImpl = globalThis.fetch) {
    const response = await fetchImpl(SESSION_ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify({ username, password })
    });
    if (response.status === 401) {
      throw new Error("Username or password is incorrect.");
    }
    if (!response.ok) {
      throw new Error("Dashboard sign-in is temporarily unavailable.");
    }
    return parseSessionResponse(response);
  }

  async function logout(csrfToken, fetchImpl = globalThis.fetch) {
    const response = await fetchImpl(SESSION_ENDPOINT, {
      method: "DELETE",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "x-csrf-token": csrfToken
      },
      cache: "no-store"
    });
    if (!response.ok && response.status !== 204) {
      throw new Error("Dashboard sign-out could not be completed.");
    }
  }

  async function parseSessionResponse(response) {
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error("Dashboard authentication returned an invalid response.");
    }
    const data = payload?.data;
    if (!data || typeof data.csrfToken !== "string"
      || !/^[A-Za-z0-9_-]{43}$/.test(data.csrfToken)
      || !Number.isFinite(data.expiresAt)) {
      throw new Error("Dashboard authentication returned an invalid response.");
    }
    return Object.freeze({ csrfToken: data.csrfToken, expiresAt: data.expiresAt });
  }

  return Object.freeze({ protectedPaths, getSession, login, logout, safeNextPath });
});
