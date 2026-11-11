(function attachRuntimeAccess(root, createApi) {
  const api = createApi();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.CryptoPulseAuth = api;
})(globalThis, function createRuntimeAccessApi() {
  const protectedPaths = Object.freeze([
    "/dashboard.html",
    "/portfolio.html",
    "/scanner.html",
    "/analytics.html",
    "/recommendations.html",
    "/history.html",
    "/exports.html",
    "/settings.html"
  ]);

  function safeNextPath(candidate) {
    if (typeof candidate !== "string") {
      return "/dashboard.html";
    }
    let path;
    try {
      const url = new URL(candidate, "https://dashboard.invalid");
      path = protectedPaths.includes(url.pathname) ? `${url.pathname}${url.search}` : null;
    } catch {
      path = null;
    }
    return path || "/dashboard.html";
  }

  function createAccessLoginUrl(
    apiOrigin,
    audience,
    returnTo,
    dashboardOrigin = globalThis.location?.origin || "https://dashboard.invalid"
  ) {
    const origin = validateApiOrigin(apiOrigin);
    if (typeof audience !== "string" || !audience.trim()) {
      throw new Error("Cloudflare Access application audience is not configured.");
    }
    const destination = new URL(safeNextPath(returnTo), "https://dashboard.invalid");
    const redirectUrl = new URL(
      destination.pathname + destination.search,
      dashboardOrigin
    );
    redirectUrl.searchParams.set("cp_access", "1");
    const login = new URL(
      `/cdn-cgi/access/login/${encodeURIComponent(audience.trim())}`,
      origin
    );
    login.searchParams.set("redirect_url", redirectUrl.toString());
    return login.toString();
  }

  function createAccessLogoutUrl(apiOrigin, returnTo) {
    const origin = validateApiOrigin(apiOrigin);
    const logout = new URL("/cdn-cgi/access/logout", origin);
    if (typeof returnTo === "string" && returnTo.startsWith("/")) {
      logout.searchParams.set("returnTo", new URL(
        returnTo,
        globalThis.location?.origin || "https://dashboard.invalid"
      ).toString());
    }
    return logout.toString();
  }

  function validateApiOrigin(value) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error("Raspberry Pi runtime API origin is not configured.");
    }
    if ((url.protocol !== "https:" && url.hostname !== "localhost")
      || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("Raspberry Pi runtime API origin is invalid.");
    }
    return url.origin;
  }

  return {
    protectedPaths,
    createAccessLoginUrl,
    createAccessLogoutUrl,
    safeNextPath,
    validateApiOrigin
  };
});
