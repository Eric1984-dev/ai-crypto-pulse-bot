(function attachExports(root, createApi) {
  const api = createApi();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    window.CryptoPulseExports = api;
    api.startExports({ windowRef: window, documentRef: document });
  }
})(globalThis, function createExportsApi() {
  const supportedPeriods = new Set(["24h", "7d", "30d", "all"]);
  const analyticsPeriods = new Set(["30d", "90d", "365d"]);
  const analyticsExportTypes = new Set([
    "analytics-summary",
    "trade-analytics",
    "portfolio-analytics",
    "ai-analytics",
    "recommendations",
    "recommendation-history"
  ]);
  const countFormat = new Intl.NumberFormat("en-GB");

  function buildExportUrl(type, period, view = "export-count") {
    const validPeriod = analyticsExportTypes.has(type)
      ? analyticsPeriods.has(period)
      : supportedPeriods.has(period);
    if (typeof type !== "string" || !type || !validPeriod
      || !["export-count", "export"].includes(view)) {
      throw new TypeError("A valid export type, period, and view are required.");
    }
    const params = new URLSearchParams({ view, type, period });
    return `/api/dashboard-data?${params}`;
  }

  async function requestExportCount(fetchImpl, type, period) {
    const response = await fetchImpl(buildExportUrl(type, period), {
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
      throw new Error("The export record count is unavailable.");
    }

    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("The export count response is invalid.");
    }
    const data = result && result.data;
    if (!data || data.exportType !== type || data.period !== period
      || !Number.isSafeInteger(data.recordCount) || data.recordCount < 0) {
      throw new Error("The export count response is invalid.");
    }
    return data.recordCount;
  }

  async function requestAnalyticsExportCounts(fetchImpl, period = "30d") {
    if (!analyticsPeriods.has(period)) {
      throw new TypeError("A valid analytics date range is required.");
    }
    const params = new URLSearchParams({ view: "analytics", period });
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
      throw new Error("Analytics export counts are unavailable.");
    }

    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("The analytics export count response is invalid.");
    }
    const counts = result && result.data && result.data.exportCounts;
    if (!result.data || result.data.period !== period || !counts || typeof counts !== "object"
      || [...analyticsExportTypes].some((type) =>
        !Number.isSafeInteger(counts[type]) || counts[type] < 0
      )) {
      throw new Error("The analytics export count response is invalid.");
    }
    return counts;
  }

  function startExports({
    windowRef = window,
    documentRef = document,
    fetchImpl = windowRef.fetch.bind(windowRef)
  } = {}) {
    if (!documentRef.querySelector("[data-exports-page]")) {
      return () => {};
    }

    const cleanupCallbacks = [];
    const cards = [...documentRef.querySelectorAll("[data-export-card]")];
    const analyticsPeriodSelect = documentRef.querySelector("[data-analytics-export-period]");
    const analyticsCountRequests = new Map();
    const analyticsCardRefreshers = [];

    function getAnalyticsCounts(period) {
      if (!analyticsCountRequests.has(period)) {
        analyticsCountRequests.set(period, requestAnalyticsExportCounts(fetchImpl, period));
      }
      return analyticsCountRequests.get(period);
    }

    for (const card of cards) {
      const type = card.dataset.exportCard;
      const periodSelect = card.querySelector("[data-export-period]");
      const countElement = card.querySelector("[data-export-count]");
      const emptyState = card.querySelector("[data-export-empty]");
      const downloadButton = card.querySelector("[data-export-download]");
      const statusElement = card.querySelector("[data-export-status]");
      let recordCount = null;
      let requestNumber = 0;
      let disposed = false;

      function setStatus(message, state = "") {
        if (statusElement) {
          statusElement.textContent = message;
          statusElement.dataset.state = state;
        }
      }

      async function loadCount() {
        const currentRequest = ++requestNumber;
        const period = periodSelect
          ? periodSelect.value
          : (analyticsExportTypes.has(type) ? analyticsPeriodSelect?.value || "30d" : "all");
        const validPeriod = analyticsExportTypes.has(type)
          ? analyticsPeriods.has(period)
          : supportedPeriods.has(period);
        if (!validPeriod) {
          recordCount = null;
          if (downloadButton) {
            downloadButton.disabled = true;
          }
          setStatus("Select a valid date range.", "error");
          return;
        }
        if (downloadButton) {
          downloadButton.disabled = true;
        }
        if (emptyState) {
          emptyState.hidden = true;
        }
        if (countElement) {
          countElement.textContent = "Loading record count…";
        }
        setStatus("");

        try {
          const count = analyticsExportTypes.has(type)
            ? (await getAnalyticsCounts(period))[type]
            : await requestExportCount(fetchImpl, type, period);
          if (disposed || currentRequest !== requestNumber) {
            return;
          }
          recordCount = count;
          if (countElement) {
            const noun = analyticsExportTypes.has(type)
              ? (count === 1 ? "report row" : "report rows")
              : (count === 1 ? "record" : "records");
            countElement.textContent = `${countFormat.format(count)} ${noun} available`;
          }
          if (emptyState) {
            emptyState.hidden = count > 0;
          }
          if (downloadButton) {
            downloadButton.disabled = count === 0;
          }
        } catch (error) {
          if (disposed || currentRequest !== requestNumber) {
            return;
          }
          recordCount = null;
          if (error.status === 401 && typeof windowRef.location?.assign === "function") {
            windowRef.location.assign("/login.html?next=%2Fexports.html");
            return;
          }
          if (countElement) {
            countElement.textContent = "Record count unavailable.";
          }
          setStatus("The record count could not be loaded. Please try again.", "error");
        }
      }

      function downloadCsv() {
        if (recordCount === null || recordCount === 0 || !downloadButton) {
          return;
        }
        try {
          const period = periodSelect
            ? periodSelect.value
            : (analyticsExportTypes.has(type) ? analyticsPeriodSelect?.value || "30d" : "all");
          const anchor = documentRef.createElement("a");
          anchor.href = buildExportUrl(type, period, "export");
          anchor.download = `cryptopulse-${type}-${period}.csv`;
          anchor.hidden = true;
          documentRef.body.append(anchor);
          anchor.click();
          anchor.remove();
          setStatus("CSV download requested. Check your browser downloads.", "success");
        } catch {
          setStatus("The CSV download could not be started. Please try again.", "error");
        }
      }

      const onPeriodChange = () => { void loadCount(); };
      const onDownload = () => downloadCsv();
      const onPageHide = () => {
        disposed = true;
        requestNumber += 1;
        periodSelect?.removeEventListener("change", onPeriodChange);
        downloadButton?.removeEventListener("click", onDownload);
        windowRef.removeEventListener?.("pagehide", onPageHide);
      };

      periodSelect?.addEventListener("change", onPeriodChange);
      downloadButton?.addEventListener("click", onDownload);
      windowRef.addEventListener?.("pagehide", onPageHide);
      cleanupCallbacks.push(onPageHide);
      if (analyticsExportTypes.has(type)) {
        analyticsCardRefreshers.push(loadCount);
      }
      void loadCount();
    }

    const onAnalyticsPeriodChange = () => {
      analyticsCountRequests.clear();
      for (const refresh of analyticsCardRefreshers) {
        void refresh();
      }
    };
    analyticsPeriodSelect?.addEventListener("change", onAnalyticsPeriodChange);
    cleanupCallbacks.push(() => {
      analyticsPeriodSelect?.removeEventListener("change", onAnalyticsPeriodChange);
    });

    return () => {
      for (const cleanup of cleanupCallbacks) {
        cleanup();
      }
    };
  }

  return {
    buildExportUrl,
    requestAnalyticsExportCounts,
    requestExportCount,
    startExports
  };
});
