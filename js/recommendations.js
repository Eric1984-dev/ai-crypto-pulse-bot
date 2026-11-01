(function attachRecommendations(root, createApi) {
  const api = createApi();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    api.startRecommendations({ windowRef: window, documentRef: document });
  }
})(globalThis, function createRecommendationsApi() {
  const supportedPeriods = new Map([
    ["30d", "Last 30 days"],
    ["90d", "Last 90 days"],
    ["365d", "Last 365 days"]
  ]);
  const currencyFormat = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  const numberFormat = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });
  const countFormat = new Intl.NumberFormat("en-GB");
  const timestampFormat = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Brussels"
  });
  const refreshIntervalMs = 30_000;

  async function requestRecommendations(fetchImpl, period = "30d") {
    if (!supportedPeriods.has(period)) {
      throw new TypeError("A valid recommendations date range is required.");
    }
    const params = new URLSearchParams({ view: "recommendations", period });
    const response = await fetchImpl(`/api/dashboard-data?${params}`, {
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
    if (!response.ok) {
      throw new Error("AI recommendations are unavailable.");
    }

    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("The recommendations response is invalid.");
    }
    const data = result && result.data;
    if (!data || data.analysisPeriod !== period
      || typeof data.generatedAt !== "string"
      || !Array.isArray(data.categories)
      || !Array.isArray(data.recommendations)
      || typeof data.insufficientData !== "boolean") {
      throw new Error("The recommendations response is invalid.");
    }
    return data;
  }

  function renderRecommendations(data, documentRef) {
    for (const category of data.categories) {
      const container = documentRef.querySelector(
        `[data-recommendation-category="${category.name}"]`
      );
      if (!container) {
        continue;
      }
      container.replaceChildren();
      for (const recommendation of category.recommendations) {
        container.append(createRecommendationCard(recommendation, documentRef));
      }
      const empty = documentRef.querySelector(
        `[data-recommendation-empty="${category.name}"]`
      );
      if (empty) {
        empty.hidden = category.recommendations.length > 0;
      }
    }

    const notice = documentRef.querySelector("[data-recommendations-insufficient]");
    if (notice) {
      notice.hidden = !data.insufficientData;
      notice.textContent = data.insufficientData
        ? "Insufficient historical data. At least 10 closed trades are required for preliminary recommendations."
        : "";
    }
    const noRecommendations = documentRef.querySelector("[data-recommendations-empty]");
    if (noRecommendations) {
      noRecommendations.hidden = data.insufficientData || data.recommendations.length > 0;
    }
    const updated = documentRef.querySelector("[data-recommendations-updated]");
    if (updated) {
      updated.textContent = `Generated ${formatTimestamp(data.generatedAt)} · ${supportedPeriods.get(data.analysisPeriod)}`;
    }
  }

  function createRecommendationCard(recommendation, documentRef) {
    const article = documentRef.createElement("article");
    article.className = "recommendation-card";
    appendText(article, documentRef, "h3", recommendation.title);
    appendText(article, documentRef, "p", recommendation.reason, "recommendation-reason");

    const details = documentRef.createElement("dl");
    details.className = "recommendation-details";
    for (const item of recommendation.metrics) {
      appendDetail(details, documentRef, item.label, formatMetric(item));
    }
    appendDetail(details, documentRef, "Estimated impact", recommendation.estimatedImpact);
    appendDetail(details, documentRef, "Confidence level", recommendation.confidenceLevel);
    appendDetail(
      details,
      documentRef,
      "Sample size",
      `${countFormat.format(recommendation.sampleSize)} ${recommendation.sampleUnit}`
    );
    appendDetail(details, documentRef, "Analysis period", supportedPeriods.get(recommendation.analysisPeriod));
    appendDetail(details, documentRef, "Generated at", formatTimestamp(recommendation.generatedAt));
    article.append(details);
    return article;
  }

  function appendDetail(list, documentRef, label, value) {
    const wrapper = documentRef.createElement("div");
    appendText(wrapper, documentRef, "dt", label);
    appendText(wrapper, documentRef, "dd", value);
    list.append(wrapper);
  }

  function appendText(parent, documentRef, tagName, text, className = "") {
    const element = documentRef.createElement(tagName);
    element.textContent = text;
    if (className) {
      element.className = className;
    }
    parent.append(element);
    return element;
  }

  function formatMetric(item) {
    if (item.format === "currency") {
      return typeof item.value === "number" && Number.isFinite(item.value)
        ? currencyFormat.format(item.value)
        : "—";
    }
    if (item.format === "percent") {
      return typeof item.value === "number" && Number.isFinite(item.value)
        ? `${numberFormat.format(item.value)}%`
        : "—";
    }
    return Number.isSafeInteger(item.value) && item.value >= 0
      ? countFormat.format(item.value)
      : "—";
  }

  function formatTimestamp(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? timestampFormat.format(date) : "—";
  }

  function startRecommendations({
    windowRef = window,
    documentRef = document,
    fetchImpl = windowRef.fetch.bind(windowRef)
  } = {}) {
    if (!documentRef.querySelector("[data-recommendations-page]")) {
      return () => {};
    }

    const range = documentRef.querySelector("[data-recommendations-range]");
    const loading = documentRef.querySelector("[data-recommendations-loading]");
    const error = documentRef.querySelector("[data-recommendations-error]");
    const retry = documentRef.querySelector("[data-recommendations-retry]");
    let activeLoad = null;
    let refreshPending = false;
    let pollingTimer = null;
    let realtimeCleanup = null;
    let disposed = false;

    function refresh() {
      if (disposed || documentRef.visibilityState === "hidden") {
        return Promise.resolve();
      }
      if (activeLoad) {
        refreshPending = true;
        return activeLoad;
      }
      const period = range?.value || "30d";
      if (!supportedPeriods.has(period)) {
        if (error) {
          error.textContent = "Select a valid recommendations date range.";
          error.hidden = false;
        }
        return Promise.resolve();
      }
      if (loading) {
        loading.hidden = false;
      }
      if (error) {
        error.hidden = true;
        error.textContent = "";
      }
      if (retry) {
        retry.hidden = true;
      }

      const currentLoad = requestRecommendations(fetchImpl, period)
        .then((data) => {
          if (!disposed && range?.value === data.analysisPeriod) {
            renderRecommendations(data, documentRef);
          }
        })
        .catch((requestError) => {
          if (disposed) {
            return;
          }
          if (requestError.status === 401 && typeof windowRef.location?.assign === "function") {
            windowRef.location.assign("/login.html?next=%2Frecommendations.html");
            return;
          }
          if (error) {
            error.textContent = "AI recommendations could not be loaded. Please try again.";
            error.hidden = false;
          }
          if (retry) {
            retry.hidden = false;
          }
        })
        .finally(() => {
          if (loading) {
            loading.hidden = true;
          }
          activeLoad = null;
          if (refreshPending && !disposed) {
            refreshPending = false;
            void refresh();
          }
        });
      activeLoad = currentLoad;
      return currentLoad;
    }

    function startPolling() {
      if (pollingTimer === null && !disposed
        && documentRef.visibilityState !== "hidden"
        && typeof windowRef.setInterval === "function") {
        pollingTimer = windowRef.setInterval(refresh, refreshIntervalMs);
      }
    }

    function stopPolling() {
      if (pollingTimer !== null) {
        windowRef.clearInterval?.(pollingTimer);
        pollingTimer = null;
      }
    }

    function startRealtime() {
      if (disposed || realtimeCleanup) {
        return;
      }
      const realtime = windowRef.CryptoPulseRealtime;
      if (realtime && typeof realtime.startPageRealtime === "function") {
        realtimeCleanup = realtime.startPageRealtime({
          documentRef,
          onUpdate: refresh,
          surface: "recommendations",
          windowRef
        });
      }
    }

    function onVisibilityChange() {
      if (documentRef.visibilityState === "visible") {
        void refresh();
        startPolling();
      } else {
        stopPolling();
      }
    }

    function cleanup() {
      if (disposed) {
        return;
      }
      disposed = true;
      stopPolling();
      realtimeCleanup?.();
      realtimeCleanup = null;
      documentRef.removeEventListener?.("visibilitychange", onVisibilityChange);
      range?.removeEventListener("change", refresh);
      retry?.removeEventListener("click", refresh);
      windowRef.removeEventListener?.("pagehide", cleanup);
    }

    range?.addEventListener("change", refresh);
    retry?.addEventListener("click", refresh);
    documentRef.addEventListener?.("visibilitychange", onVisibilityChange);
    windowRef.addEventListener?.("pagehide", cleanup, { once: true });
    void refresh();
    startPolling();
    startRealtime();
    return cleanup;
  }

  return {
    formatMetric,
    renderRecommendations,
    requestRecommendations,
    startRecommendations
  };
});
