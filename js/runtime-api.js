(function attachRuntimeApi(root) {
  const config = root.CryptoPulseRuntimeConfig || {};

  function url(path) {
    if (typeof path !== "string" || !path.startsWith("/api/v1/")) {
      throw new TypeError("A Raspberry Pi runtime API path is required.");
    }
    let origin;
    try {
      origin = new URL(config.apiOrigin).origin;
      const parsed = new URL(config.apiOrigin);
      if ((parsed.protocol !== "https:" && parsed.hostname !== "localhost")
        || parsed.username || parsed.password || parsed.pathname !== "/"
        || parsed.search || parsed.hash) {
        throw new Error();
      }
    } catch {
      throw new Error("Raspberry Pi runtime API origin is not configured.");
    }
    return `${origin}${path}`;
  }

  root.CryptoPulseRuntimeApi = Object.freeze({ url });
})(globalThis);
