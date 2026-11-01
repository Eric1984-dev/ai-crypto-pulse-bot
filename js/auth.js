(() => {
  const protectedPaths = new Set([
    "/dashboard.html",
    "/portfolio.html",
    "/scanner.html",
    "/history.html",
    "/settings.html"
  ]);
  const pageType = document.body.dataset.authPage;
  const nextPath = window.CryptoPulseAuth.safeNextPath(
    new URLSearchParams(window.location.search).get("next"),
    [...protectedPaths]
  );
  const message = document.querySelector("[data-auth-message]");
  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.slice(1));
  const recoveryAccessToken = hashParams.get("access_token") || searchParams.get("access_token");
  const isRecoveryLink = hashParams.get("type") === "recovery"
    || searchParams.get("type") === "recovery";
  const sdkUrl = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm";
  let clearCookieRequest;
  let recoverySessionDetected = false;

  function showMessage(text, isError = false) {
    if (!message) {
      return;
    }
    message.textContent = text;
    message.dataset.state = isError ? "error" : "success";
  }

  function showBootFailure(error) {
    if (pageType === "protected") {
      const loginUrl = new URL("/login.html", window.location.origin);
      loginUrl.searchParams.set("next", window.CryptoPulseAuth.safeNextPath(window.location.pathname, [...protectedPaths]));
      window.location.replace(loginUrl.toString());
      return;
    }
    showMessage(error.message || "Authentication could not be initialized.", true);
    document.documentElement.classList.remove("auth-pending");
  }

  async function requestSessionCookie(session) {
    if (!hasAccessToken(session)) {
      throw new Error("A valid Supabase session is required.");
    }

    const response = await fetch("/api/auth-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        accessToken: session.access_token,
        expiresIn: session.expires_in
      })
    });
    if (!response.ok) {
      throw new Error("Your session could not be verified. Please sign in again.");
    }
  }

  function clearSessionCookie() {
    if (!clearCookieRequest) {
      clearCookieRequest = fetch("/api/auth-session", { method: "DELETE", cache: "no-store" })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Your server session could not be cleared. Please try again.");
          }
        })
        .finally(() => {
          clearCookieRequest = null;
        });
    }
    return clearCookieRequest;
  }

  function hasAccessToken(session) {
    return typeof session?.access_token === "string" && session.access_token.length > 0;
  }

  function hasRecoverySession(session) {
    if (!hasAccessToken(session)) {
      return false;
    }
    if (recoverySessionDetected) {
      return true;
    }
    return isRecoveryLink && session.access_token === recoveryAccessToken;
  }

  function setRecoveryFormVisibility(isRecoverySession) {
    const requestForm = document.querySelector("#reset-request-form");
    const passwordForm = document.querySelector("#reset-password-form");

    if (requestForm) {
      requestForm.hidden = isRecoverySession;
    }
    if (passwordForm) {
      passwordForm.hidden = !isRecoverySession;
    }
    if (isRecoverySession) {
      showMessage("Choose a new password for your account.");
    }
  }

  async function initialize() {
    const response = await fetch("/api/auth-config", { cache: "no-store" });
    if (!response.ok) {
      const details = await response.json().catch(() => null);
      throw new Error(details?.error?.message || "Supabase Authentication is not configured.");
    }

    const config = await response.json();
    const sdk = await import(sdkUrl);
    const client = window.CryptoPulseAuth.createSupabaseClient(sdk.createClient, config);
    window.CryptoPulseSupabaseClient = client;
    const auth = window.CryptoPulseAuth.createAuthService(client);

    auth.onAuthStateChange((event, session) => {
      if (pageType === "reset" && event === "PASSWORD_RECOVERY" && hasAccessToken(session)) {
        recoverySessionDetected = true;
        setRecoveryFormVisibility(true);
      }
      if (event === "TOKEN_REFRESHED" && hasAccessToken(session)) {
        requestSessionCookie(session).catch((error) => showMessage(error.message, true));
      }
      if (event === "SIGNED_OUT") {
        clearSessionCookie()
          .then(() => {
            if (pageType === "protected") {
              const loginUrl = new URL("/login.html", window.location.origin);
              loginUrl.searchParams.set("next", window.CryptoPulseAuth.safeNextPath(window.location.pathname, [...protectedPaths]));
              window.location.replace(loginUrl.toString());
            }
          })
          .catch((error) => showMessage(error.message, true));
      }
    });
    bindLogout(auth);

    const session = await auth.getSession();
    if (pageType === "protected") {
      if (!hasAccessToken(session)) {
        const loginUrl = new URL("/login.html", window.location.origin);
        loginUrl.searchParams.set("next", window.CryptoPulseAuth.safeNextPath(window.location.pathname, [...protectedPaths]));
        window.location.replace(loginUrl.toString());
        return;
      }
      await requestSessionCookie(session);
      const emailTarget = document.querySelector("[data-user-email]");
      if (emailTarget) {
        emailTarget.textContent = session.user?.email || "";
      }
      document.documentElement.classList.remove("auth-pending");
      return;
    }

    if ((pageType === "login" || pageType === "register") && hasAccessToken(session)) {
      await requestSessionCookie(session);
      window.location.replace(nextPath);
      return;
    }

    if (pageType === "reset") {
      setRecoveryFormVisibility(hasRecoverySession(session) || recoverySessionDetected);
    }

    document.documentElement.classList.remove("auth-pending");
    bindForms(auth);
  }

  function bindForms(auth) {
    document.querySelector("#login-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      await submitForm(event.currentTarget, async (form) => {
        const result = await auth.login(form.elements.email.value.trim(), form.elements.password.value);
        if (!hasAccessToken(result.session)) {
          throw new Error("Supabase did not return a signed-in session.");
        }
        await requestSessionCookie(result.session);
        window.location.replace(nextPath);
      });
    });

    document.querySelector("#register-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      await submitForm(event.currentTarget, async (form) => {
        const password = form.elements.password.value;
        if (password !== form.elements.confirmPassword.value) {
          throw new Error("The passwords do not match.");
        }
        const redirectTo = new URL("/login.html?verified=1", window.location.origin).toString();
        const result = await auth.register(form.elements.email.value.trim(), password, redirectTo);
        if (hasAccessToken(result.session)) {
          await requestSessionCookie(result.session);
          window.location.replace("/dashboard.html");
          return;
        }
        showMessage("Registration received. Check your email to confirm your account before signing in.");
        form.reset();
      });
    });

    document.querySelector("#reset-request-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      await submitForm(event.currentTarget, async (form) => {
        await auth.requestPasswordReset(form.elements.email.value.trim(), window.location.origin);
        showMessage("If an account exists for that address, a password reset email has been sent.");
        form.reset();
      });
    });

    document.querySelector("#reset-password-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      await submitForm(event.currentTarget, async (form) => {
        const password = form.elements.password.value;
        if (password !== form.elements.confirmPassword.value) {
          throw new Error("The passwords do not match.");
        }
        const session = await auth.getSession();
        if (!hasRecoverySession(session)) {
          setRecoveryFormVisibility(false);
          throw new Error("Open a valid password recovery link before changing your password.");
        }
        await auth.updatePassword(password);
        const updatedSession = await auth.getSession();
        if (hasAccessToken(updatedSession)) {
          await requestSessionCookie(updatedSession);
          window.location.replace("/dashboard.html");
          return;
        }
        showMessage("Password updated. You can now sign in with your new password.");
        window.location.replace("/login.html");
      });
    });

    if (pageType === "login" && new URLSearchParams(window.location.search).has("verified")) {
      showMessage("Email confirmed. You can now sign in.");
    }
  }

  function bindLogout(auth) {
    document.querySelectorAll("[data-auth-logout]").forEach((button) => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await auth.logout();
          await clearSessionCookie();
          window.location.replace("/login.html");
        } catch (error) {
          showMessage(error.message || "Sign out failed.", true);
          button.disabled = false;
        }
      });
    });
  }

  async function submitForm(form, operation) {
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = true;
    }
    showMessage("");
    try {
      await operation(form);
    } catch (error) {
      showMessage(error.message || "Authentication request failed.", true);
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
      }
    }
  }

  window.CryptoPulseAuthReady = initialize().catch(showBootFailure);
})();
