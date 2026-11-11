(function startDashboardAuth(windowRef, documentRef) {
  const auth = windowRef.CryptoPulseAuth;
  const pageType = documentRef.body?.dataset.authPage || "";
  const loginPagePath = "/login.html";
  let csrfToken = "";

  function setReady() {
    documentRef.documentElement.classList.remove("auth-pending");
  }

  function showMessage(message, state = "error") {
    let target = documentRef.querySelector("[data-auth-message]");
    if (!target) {
      target = documentRef.createElement("p");
      target.setAttribute("role", "alert");
      documentRef.body.prepend(target);
    }
    target.textContent = message;
    target.dataset.state = state;
  }

  function protectedDestination() {
    const requestedPath = new URLSearchParams(windowRef.location.search).get("next");
    return auth.safeNextPath(requestedPath);
  }

  async function initialize() {
    if (!auth) {
      throw new Error("Dashboard authentication support is unavailable.");
    }
    if (pageType === "register" || pageType === "reset") {
      windowRef.location.replace(loginPagePath);
      return;
    }
    if (pageType === "login") {
      const session = await auth.getSession();
      if (session) {
        windowRef.location.replace(protectedDestination());
        return;
      }
      bindLogin();
      setReady();
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

    const session = await auth.getSession();
    if (!session) {
      const next = `${windowRef.location.pathname}${windowRef.location.search}`;
      windowRef.location.replace(`${loginPagePath}?next=${encodeURIComponent(auth.safeNextPath(next))}`);
      return;
    }
    csrfToken = session.csrfToken;
    bindLogout();
    setReady();
  }

  function bindLogin() {
    const form = documentRef.querySelector("[data-login-form]");
    if (!form) {
      throw new Error("The dashboard sign-in form is unavailable.");
    }
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const username = form.elements.namedItem("username")?.value;
      const password = form.elements.namedItem("password")?.value;
      const submit = form.querySelector('[type="submit"]');
      if (submit) {
        submit.disabled = true;
      }
      try {
        const session = await auth.login(username, password);
        csrfToken = session.csrfToken;
        windowRef.location.replace(protectedDestination());
      } catch (error) {
        showMessage(error.message || "Sign-in failed.");
      } finally {
        if (submit) {
          submit.disabled = false;
        }
      }
    });
  }

  function bindLogout() {
    documentRef.querySelectorAll("[data-auth-logout]").forEach((button) => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await auth.logout(csrfToken);
          windowRef.location.replace(loginPagePath);
        } catch (error) {
          button.disabled = false;
          showMessage(error.message || "Sign-out failed.");
        }
      });
    });
  }

  windowRef.CryptoPulseAuthReady = Promise.resolve().then(initialize).catch((error) => {
    showMessage(error.message || "Dashboard authentication could not be initialized.");
    setReady();
  });
})(window, document);
