(function startRuntimeAccess(windowRef, documentRef) {
  const auth = windowRef.CryptoPulseAuth;
  const runtimeConfig = windowRef.CryptoPulseRuntimeConfig || {};
  const pageType = documentRef.body?.dataset.authPage || "";
  const loginPagePath = "/login.html";

  function showBootFailure(error) {
    const message = documentRef.querySelector("[data-auth-message]");
    if (message) {
      message.textContent = error.message || "Runtime access could not be initialized.";
      message.dataset.state = "error";
    } else {
      const alert = documentRef.createElement("p");
      alert.setAttribute("role", "alert");
      alert.textContent = error.message || "Runtime access could not be initialized.";
      documentRef.body.prepend(alert);
    }
  }

  function setReady() {
    documentRef.documentElement.classList.remove("auth-pending");
  }

  function startLogin(returnTo) {
    const loginUrl = auth.createAccessLoginUrl(
      runtimeConfig.apiOrigin,
      runtimeConfig.accessAudience,
      returnTo,
      windowRef.location.origin
    );
    windowRef.location.replace(loginUrl);
  }

  function initialize() {
    if (!auth) {
      throw new Error("Runtime access support is unavailable.");
    }
    if (pageType === "login" || pageType === "register" || pageType === "reset") {
      const requestedPath = new URLSearchParams(windowRef.location.search).get("next");
      startLogin(auth.safeNextPath(requestedPath));
      return;
    }
    if (pageType !== "protected") {
      setReady();
      return;
    }
    if (windowRef.location.pathname === "/admin.html" || windowRef.location.pathname === "/admin") {
      windowRef.location.replace("/dashboard.html");
      return;
    }

    const currentUrl = new URL(windowRef.location.href);
    if (currentUrl.searchParams.get("cp_access") === "1") {
      currentUrl.searchParams.delete("cp_access");
      windowRef.history.replaceState(null, "", currentUrl.pathname + currentUrl.search + currentUrl.hash);
      windowRef.sessionStorage.setItem("cryptopulse-access-authenticated", "1");
    }
    if (windowRef.sessionStorage.getItem("cryptopulse-access-authenticated") !== "1") {
      startLogin(`${currentUrl.pathname}${currentUrl.search}`);
      return;
    }
    bindLogout();
    setReady();
  }

  function bindLogout() {
    documentRef.querySelectorAll("[data-auth-logout]").forEach((button) => {
      button.addEventListener("click", () => {
        windowRef.sessionStorage.removeItem("cryptopulse-access-authenticated");
        windowRef.location.replace(auth.createAccessLogoutUrl(
          runtimeConfig.apiOrigin,
          loginPagePath
        ));
      });
    });
  }

  windowRef.CryptoPulseAuthReady = Promise.resolve().then(initialize).catch(showBootFailure);
})(window, document);
