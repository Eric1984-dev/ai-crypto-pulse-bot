(function attachAdminActions(root, createApi) {
  const api = createApi();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    api.startAdminPage({ windowRef: window, documentRef: document });
  }
})(globalThis, function createAdminApi() {
  async function requestAdminStatus(fetchImpl) {
    const response = await fetchImpl("/api/admin-actions", {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    });
    if (response.status === 401) {
      const error = new Error("Authentication is required.");
      error.status = 401;
      throw error;
    }
    if (response.status === 403) {
      return false;
    }
    if (!response.ok) {
      throw new Error("Administrator access could not be verified.");
    }

    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("Administrator access response is invalid.");
    }
    if (!result || !result.data || result.data.isAdmin !== true) {
      throw new Error("Administrator access response is invalid.");
    }
    return true;
  }

  async function requestAdminAction(action, fetchImpl) {
    if (action !== "ai-analysis" && action !== "paper-trading") {
      throw new Error("Choose a supported admin action.");
    }

    const response = await fetchImpl("/api/admin-actions", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action })
    });

    let result;
    try {
      result = await response.json();
    } catch {
      const error = new Error("Admin action response is invalid.");
      error.status = response.status;
      throw error;
    }
    if (!response.ok) {
      const error = new Error(
        result && result.error && typeof result.error.message === "string"
          ? result.error.message
          : "Admin action failed."
      );
      error.status = response.status;
      error.response = result.error || null;
      error.metrics = result.metrics || null;
      throw error;
    }
    if (!result || !result.data || typeof result.data !== "object"
      || !result.metrics || !Number.isFinite(result.metrics.executionDurationMs)
      || result.metrics.executionDurationMs < 0) {
      throw new Error("Admin action response is invalid.");
    }
    return result;
  }

  function startAdminPage({
    windowRef = window,
    documentRef = document,
    fetchImpl = windowRef.fetch.bind(windowRef)
  } = {}) {
    const adminNavLinks = [...documentRef.querySelectorAll("[data-admin-nav]")];
    const adminPage = documentRef.querySelector("[data-admin-page]");
    const accessMessage = documentRef.querySelector("[data-admin-access-message]");
    if (adminNavLinks.length === 0 && !adminPage) {
      return () => {};
    }

    const buttons = [...documentRef.querySelectorAll("[data-admin-action]")];
    const output = documentRef.querySelector("[data-admin-action-output]");
    const status = documentRef.querySelector("[data-admin-action-status]");
    const duration = documentRef.querySelector("[data-admin-action-duration]");
    const summary = documentRef.querySelector("[data-admin-action-summary]");
    const buttonListeners = [];
    let authorized = false;
    let actionInProgress = false;
    let disposed = false;

    function setAccessMessage(message, state) {
      if (accessMessage) {
        accessMessage.textContent = message;
        accessMessage.dataset.state = state;
        accessMessage.hidden = false;
      }
    }

    function setAuthorization(isAuthorized) {
      authorized = isAuthorized;
      for (const link of adminNavLinks) {
        link.hidden = !authorized;
      }
      if (adminPage) {
        adminPage.hidden = !authorized;
      }
    }

    function redirectToLogin() {
      if (windowRef.location && typeof windowRef.location.replace === "function") {
        windowRef.location.replace("/login.html?next=%2Fadmin.html");
      }
    }

    async function verifyAdminAccess() {
      try {
        const isAdmin = await requestAdminStatus(fetchImpl);
        if (disposed) {
          return;
        }
        setAuthorization(isAdmin);
        if (isAdmin) {
          if (accessMessage) {
            accessMessage.hidden = true;
          }
        } else if (adminPage) {
          setAccessMessage("Administrator access is required.", "error");
          if (windowRef.location && typeof windowRef.location.replace === "function") {
            windowRef.location.replace("/dashboard.html");
          }
        }
      } catch (error) {
        if (disposed) {
          return;
        }
        setAuthorization(false);
        if (error && error.status === 401) {
          redirectToLogin();
        } else if (adminPage) {
          setAccessMessage("Administrator access could not be verified. Please try again later.", "error");
        } else if (windowRef.console && typeof windowRef.console.warn === "function") {
          windowRef.console.warn("Administrator access could not be verified.");
        }
      }
    }

    async function runAdminAction(action) {
      if (!authorized || actionInProgress || disposed) {
        return;
      }

      actionInProgress = true;
      for (const button of buttons) {
        button.disabled = true;
      }
      const now = windowRef.performance && typeof windowRef.performance.now === "function"
        ? windowRef.performance.now.bind(windowRef.performance)
        : () => globalThis.performance.now();
      const startedAt = now();
      if (output) {
        output.hidden = false;
      }
      if (status) {
        status.textContent = "Running…";
        status.dataset.state = "running";
      }
      if (duration) {
        duration.textContent = "—";
      }
      if (summary) {
        summary.textContent = "";
      }

      try {
        const result = await requestAdminAction(action, fetchImpl);
        if (disposed) {
          return;
        }
        const resultStatus = typeof result.data.status === "string"
          ? ` (${result.data.status})`
          : "";
        if (status) {
          status.textContent = `Success${resultStatus}`;
          status.dataset.state = "success";
        }
        if (duration) {
          duration.textContent = `${result.metrics.executionDurationMs} ms`;
        }
        if (summary) {
          summary.textContent = JSON.stringify(result.data, null, 2);
        }
      } catch (error) {
        if (disposed) {
          return;
        }
        if (error && error.status === 401) {
          redirectToLogin();
        } else if (error && error.status === 403) {
          setAuthorization(false);
          setAccessMessage("Administrator access is required.", "error");
          if (windowRef.location && typeof windowRef.location.replace === "function") {
            windowRef.location.replace("/dashboard.html");
          }
        }
        if (status) {
          status.textContent = `Failure: ${error.message}`;
          status.dataset.state = "error";
        }
        const reportedDuration = error && error.metrics
          && Number.isFinite(error.metrics.executionDurationMs)
          ? error.metrics.executionDurationMs
          : Math.max(0, Math.round(now() - startedAt));
        if (duration) {
          duration.textContent = `${reportedDuration} ms`;
        }
        if (summary) {
          summary.textContent = JSON.stringify(
            error && error.response ? error.response : { message: error.message },
            null,
            2
          );
        }
      } finally {
        actionInProgress = false;
        for (const button of buttons) {
          button.disabled = false;
        }
      }
    }

    for (const button of buttons) {
      const onClick = () => {
        void runAdminAction(button.dataset.adminAction);
      };
      button.addEventListener("click", onClick);
      buttonListeners.push({ button, onClick });
    }

    function cleanup() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const { button, onClick } of buttonListeners) {
        button.removeEventListener("click", onClick);
      }
      windowRef.removeEventListener?.("pagehide", cleanup);
    }

    windowRef.addEventListener?.("pagehide", cleanup, { once: true });
    const authReady = windowRef.CryptoPulseAuthReady;
    if (authReady && typeof authReady.then === "function") {
      authReady.then(verifyAdminAccess, () => {
        if (!disposed) {
          setAuthorization(false);
          if (adminPage) {
            setAccessMessage("Authentication could not be initialized. Please sign in again.", "error");
          }
        }
      });
    } else {
      void verifyAdminAccess();
    }

    return cleanup;
  }

  return { requestAdminAction, requestAdminStatus, startAdminPage };
});
