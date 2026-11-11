(function attachRuntimeApi(root) {
  function url(path) {
    if (typeof path !== "string" || !path.startsWith("/api/v1/")) {
      throw new TypeError("A Raspberry Pi runtime API path is required.");
    }
    let target;
    try {
      target = new URL(path, "https://dashboard.invalid");
      if (target.origin !== "https://dashboard.invalid"
        || !target.pathname.startsWith("/api/v1/")
        || target.username || target.password || target.hash) {
        throw new Error();
      }
    } catch {
      throw new Error("Raspberry Pi runtime API path is invalid.");
    }
    return `/api/dashboard-data?path=${encodeURIComponent(target.pathname + target.search)}`;
  }

  root.CryptoPulseRuntimeApi = Object.freeze({ url });
})(globalThis);
