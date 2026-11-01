(function attachTradeHistory(root, createApi) {
  const formatters = typeof module !== "undefined" && module.exports
    ? require("./formatters.js")
    : root.CryptoPulseFormatters;
  const api = createApi(formatters);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    api.startTradeHistory({ windowRef: window, documentRef: document });
  }
})(globalThis, function createTradeHistoryApi(formatters) {
  const pageSize = 25;
  const refreshIntervalMs = 30000;
  const currencyFormat = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2
  });
  const numberFormat = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 8 });
  function buildTradeHistoryUrl({
    page = 1,
    search = "",
    side = "all",
    period = "all",
    sort = "newest"
  } = {}) {
    const params = new URLSearchParams({
      view: "trade-history",
      page: String(page),
      side,
      period,
      sort
    });
    if (search.trim()) {
      params.set("search", search.trim());
    }
    return `/api/dashboard-data?${params}`;
  }

  async function requestTradeHistory(fetchImpl, filters) {
    const response = await fetchImpl(buildTradeHistoryUrl(filters), {
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
      throw new Error("Trade history is unavailable.");
    }

    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("Trade history response is invalid.");
    }
    if (!isValidTradeHistory(result && result.data)) {
      throw new Error("Trade history response is invalid.");
    }
    return result.data;
  }

  function isValidTradeHistory(data) {
    const stats = data && data.stats;
    return Boolean(
      data
      && Array.isArray(data.items)
      && Number.isInteger(data.page)
      && data.page >= 1
      && Number.isInteger(data.pageSize)
      && data.pageSize === pageSize
      && Number.isInteger(data.totalCount)
      && data.totalCount >= 0
      && Number.isInteger(data.totalPages)
      && data.totalPages >= 0
      && stats
      && ["closedTrades", "winningTrades", "losingTrades"].every(
        (key) => Number.isInteger(stats[key]) && stats[key] >= 0
      )
      && ["averageProfit", "averageLoss", "bestTrade", "worstTrade"].every(
        (key) => stats[key] === null || Number.isFinite(stats[key])
      )
    );
  }

  function renderTradeHistory(data, documentRef) {
    const stats = data.stats;
    setText(documentRef, "winningTrades", formatCount(stats.winningTrades));
    setText(documentRef, "losingTrades", formatCount(stats.losingTrades));
    setText(documentRef, "averageProfit", formatCurrency(stats.averageProfit));
    setText(documentRef, "averageLoss", formatCurrency(stats.averageLoss));
    setText(documentRef, "bestTrade", formatCurrency(stats.bestTrade));
    setText(documentRef, "worstTrade", formatCurrency(stats.worstTrade));
    setText(documentRef, "totalCount", formatCount(data.totalCount));
    setText(documentRef, "pageNumber", data.totalPages ? `${data.page} / ${data.totalPages}` : "0 / 0");

    const previousButton = documentRef.querySelector("[data-history-previous]");
    const nextButton = documentRef.querySelector("[data-history-next]");
    if (previousButton) {
      previousButton.disabled = data.page <= 1;
    }
    if (nextButton) {
      nextButton.disabled = data.page >= data.totalPages;
    }

    const table = documentRef.querySelector("[data-history-table]");
    const rows = documentRef.querySelector("[data-history-rows]");
    const emptyState = documentRef.querySelector("[data-history-empty]");
    if (rows) {
      rows.replaceChildren();
      for (const trade of data.items) {
        rows.append(createTradeRow(documentRef, trade));
      }
    }
    if (table) {
      table.hidden = data.items.length === 0;
    }
    if (emptyState) {
      emptyState.hidden = data.items.length > 0;
    }
  }

  function createTradeRow(documentRef, trade) {
    const row = documentRef.createElement("tr");
    const values = [
      formatters.formatTimestamp(trade.created_at, "medium"),
      trade.symbol,
      trade.side,
      formatters.formatPrice(trade.price),
      formatNumber(trade.quantity),
      formatCurrency(trade.fees),
      trade.side === "SELL" ? formatCurrency(trade.realized_pnl) : "—",
      "Executed · paper"
    ];
    for (const value of values) {
      const cell = documentRef.createElement("td");
      cell.textContent = value === null || value === undefined ? "—" : value;
      row.append(cell);
    }
    return row;
  }

  function startTradeHistory({
    windowRef = window,
    documentRef = document,
    fetchImpl = windowRef.fetch.bind(windowRef)
  } = {}) {
    if (!documentRef.querySelector("[data-history-page]")) {
      return () => {};
    }

    const form = documentRef.querySelector("[data-history-filters]");
    const searchInput = documentRef.querySelector("[data-history-search]");
    const sideFilter = documentRef.querySelector("[data-history-side]");
    const periodFilter = documentRef.querySelector("[data-history-period]");
    const sortFilter = documentRef.querySelector("[data-history-sort]");
    const loading = documentRef.querySelector("[data-history-loading]");
    const errorMessage = documentRef.querySelector("[data-history-error]");
    const retryButton = documentRef.querySelector("[data-history-retry]");
    const previousButton = documentRef.querySelector("[data-history-previous]");
    const nextButton = documentRef.querySelector("[data-history-next]");
    let page = 1;
    let activeLoad = null;
    let refreshPending = false;
    let intervalId = null;
    let disposed = false;
    let realtimeCleanup = null;

    function currentFilters() {
      return {
        page,
        search: searchInput ? searchInput.value : "",
        side: sideFilter ? sideFilter.value : "all",
        period: periodFilter ? periodFilter.value : "all",
        sort: sortFilter ? sortFilter.value : "newest"
      };
    }

    function refresh() {
      if (disposed) {
        return Promise.resolve();
      }
      if (activeLoad) {
        refreshPending = true;
        return activeLoad;
      }
      if (loading) {
        loading.hidden = false;
      }
      if (errorMessage) {
        errorMessage.hidden = true;
        errorMessage.textContent = "";
      }
      if (retryButton) {
        retryButton.hidden = true;
      }

      activeLoad = requestTradeHistory(fetchImpl, currentFilters())
        .then((data) => {
          if (disposed) {
            return;
          }
          page = data.page;
          renderTradeHistory(data, documentRef);
        })
        .catch((error) => {
          if (disposed) {
            return;
          }
          if (error.status === 401 && typeof windowRef.location?.assign === "function") {
            windowRef.location.assign("/login.html?next=%2Fhistory.html");
            return;
          }
          if (errorMessage) {
            errorMessage.textContent = "Trade history could not be loaded. Please try again.";
            errorMessage.hidden = false;
          }
          if (retryButton) {
            retryButton.hidden = false;
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
      return activeLoad;
    }

    function applyFilters() {
      page = 1;
      void refresh();
    }

    function onSubmit(event) {
      event.preventDefault();
      applyFilters();
    }

    function onPrevious() {
      page = Math.max(1, page - 1);
      void refresh();
    }

    function onNext() {
      page += 1;
      void refresh();
    }

    function stopPolling() {
      if (intervalId !== null) {
        windowRef.clearInterval(intervalId);
        intervalId = null;
      }
    }

    function startPolling() {
      if (intervalId === null && documentRef.visibilityState !== "hidden"
        && typeof windowRef.setInterval === "function") {
        intervalId = windowRef.setInterval(refresh, refreshIntervalMs);
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
          surface: "history",
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
      disposed = true;
      stopPolling();
      realtimeCleanup?.();
      realtimeCleanup = null;
      documentRef.removeEventListener?.("visibilitychange", onVisibilityChange);
      form?.removeEventListener("submit", onSubmit);
      previousButton?.removeEventListener("click", onPrevious);
      nextButton?.removeEventListener("click", onNext);
      retryButton?.removeEventListener("click", refresh);
      sideFilter?.removeEventListener("change", applyFilters);
      periodFilter?.removeEventListener("change", applyFilters);
      sortFilter?.removeEventListener("change", applyFilters);
      windowRef.removeEventListener?.("pagehide", cleanup);
    }

    form?.addEventListener("submit", onSubmit);
    previousButton?.addEventListener("click", onPrevious);
    nextButton?.addEventListener("click", onNext);
    retryButton?.addEventListener("click", refresh);
    sideFilter?.addEventListener("change", applyFilters);
    periodFilter?.addEventListener("change", applyFilters);
    sortFilter?.addEventListener("change", applyFilters);
    documentRef.addEventListener?.("visibilitychange", onVisibilityChange);
    windowRef.addEventListener?.("pagehide", cleanup, { once: true });
    void refresh();
    startPolling();
    const authReady = windowRef.CryptoPulseAuthReady;
    if (authReady && typeof authReady.then === "function") {
      authReady.then(startRealtime, () => {});
    } else {
      startRealtime();
    }
    return cleanup;
  }

  function setText(documentRef, name, value) {
    const element = documentRef.querySelector(`[data-history-value="${name}"]`);
    if (element) {
      element.textContent = value;
    }
  }

  function formatCurrency(value) {
    const number = numericValue(value);
    return number === null ? "—" : currencyFormat.format(number);
  }

  function formatNumber(value) {
    const number = numericValue(value);
    return number === null ? "—" : numberFormat.format(number);
  }

  function formatCount(value) {
    return Number.isInteger(value) ? numberFormat.format(value) : "—";
  }

  function numericValue(value) {
    if (value === null || value === undefined) {
      return null;
    }
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) ? number : null;
  }

  return {
    buildTradeHistoryUrl,
    renderTradeHistory,
    requestTradeHistory,
    startTradeHistory
  };
});
