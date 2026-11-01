(function attachPortfolio(root, createApi) {
  const formatters = typeof module !== "undefined" && module.exports
    ? require("./formatters.js")
    : root.CryptoPulseFormatters;
  const api = createApi(formatters);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    api.startPortfolio({ windowRef: window, documentRef: document });
  }
})(globalThis, function createPortfolioApi(formatters) {
  const refreshIntervalMs = 30000;
  const currencyFormat = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2
  });
  const numberFormat = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 8 });

  async function requestPortfolioData(fetchImpl) {
    const response = await fetchImpl("/api/dashboard-data", {
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
      throw new Error("Portfolio data is unavailable.");
    }

    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("Portfolio data response is invalid.");
    }
    if (!result || !result.data || typeof result.data !== "object"
      || !result.data.portfolio || !result.data.openPositions || !result.data.recentTrades) {
      throw new Error("Portfolio data response is invalid.");
    }
    return result.data;
  }

  function renderPortfolio(data, documentRef) {
    const portfolio = data.portfolio;
    setText(documentRef, "count", formatCount(portfolio.count));
    setText(documentRef, "portfolioValue", formatCurrency(portfolio.portfolioValue));
    setText(documentRef, "availableBalance", formatCurrency(portfolio.availableBalance));
    setText(documentRef, "totalPnl", formatCurrency(portfolio.totalPnl));
    setText(documentRef, "realizedPnl", formatCurrency(portfolio.realizedPnl));
    setText(documentRef, "unrealizedPnl", formatCurrency(portfolio.unrealizedPnl));
    setText(documentRef, "dailyPnl", formatCurrency(portfolio.dailyPnl));
    setText(documentRef, "winRate", formatPercent(portfolio.winRate));
    setText(documentRef, "openPositions", formatCount(data.openPositions.count));
    setText(documentRef, "paperTrades", formatCount(data.recentTrades.count));

    renderCollection(documentRef, "positions", data.openPositions.items, (item) => [
      `${item.symbol || "—"} · ${formatNumber(item.amount)} units`,
      `Entry ${formatters.formatPrice(item.entry_price)} · Current ${formatters.formatPrice(item.current_price)} · P&L ${formatCurrency(item.unrealized_pnl)} · Opened ${formatters.formatTimestamp(item.created_at)}`
    ]);
    renderCollection(documentRef, "trades", data.recentTrades.items, (item) => [
      `${item.side || "—"} ${item.symbol || "—"} · ${formatNumber(item.quantity)} units`,
      `${formatters.formatPrice(item.price)} · Fee ${formatCurrency(item.fees)} · P&L ${formatCurrency(item.realized_pnl)} · Executed ${formatters.formatTimestamp(item.created_at)}`
    ]);
  }

  function startPortfolio({
    windowRef = window,
    documentRef = document,
    fetchImpl = windowRef.fetch.bind(windowRef)
  } = {}) {
    if (!documentRef.querySelector("[data-portfolio-page]")) {
      return () => {};
    }

    const loading = documentRef.querySelector("[data-portfolio-loading]");
    const errorMessage = documentRef.querySelector("[data-portfolio-error]");
    const retryButton = documentRef.querySelector("[data-portfolio-retry]");
    let activeLoad = null;
    let intervalId = null;
    let disposed = false;
    let realtimeCleanup = null;

    const refresh = () => {
      if (disposed) {
        return Promise.resolve();
      }
      if (activeLoad) {
        return activeLoad;
      }
      if (loading) {
        loading.hidden = false;
      }
      if (retryButton) {
        retryButton.hidden = true;
      }
      activeLoad = requestPortfolioData(fetchImpl)
        .then((data) => {
          renderPortfolio(data, documentRef);
          if (errorMessage) {
            errorMessage.hidden = true;
            errorMessage.textContent = "";
          }
        })
        .catch((error) => {
          if (error.status === 401 && typeof windowRef.location?.assign === "function") {
            windowRef.location.assign("/login.html");
            return;
          }
          if (errorMessage) {
            errorMessage.textContent = "Portfolio data could not be loaded. The last known values are still shown.";
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
        });
      return activeLoad;
    };

    const onVisibilityChange = () => {
      if (documentRef.visibilityState === "visible") {
        refresh();
        startPolling();
      } else {
        stopPolling();
      }
    };
    const startPolling = () => {
      if (intervalId === null && documentRef.visibilityState !== "hidden") {
        intervalId = windowRef.setInterval(refresh, refreshIntervalMs);
      }
    };
    const stopPolling = () => {
      if (intervalId !== null) {
        windowRef.clearInterval(intervalId);
        intervalId = null;
      }
    };
    const startRealtime = () => {
      if (disposed || realtimeCleanup) {
        return;
      }
      const realtime = windowRef.CryptoPulseRealtime;
      if (realtime && typeof realtime.startPageRealtime === "function") {
        realtimeCleanup = realtime.startPageRealtime({
          documentRef,
          onUpdate: refresh,
          surface: "portfolio",
          windowRef
        });
      }
    };
    const cleanup = () => {
      if (disposed) {
        return;
      }
      disposed = true;
      stopPolling();
      realtimeCleanup?.();
      realtimeCleanup = null;
      documentRef.removeEventListener("visibilitychange", onVisibilityChange);
      if (retryButton) {
        retryButton.removeEventListener("click", refresh);
      }
      windowRef.removeEventListener("pagehide", cleanup);
    };

    documentRef.addEventListener("visibilitychange", onVisibilityChange);
    windowRef.addEventListener("pagehide", cleanup, { once: true });
    if (retryButton) {
      retryButton.addEventListener("click", refresh);
    }
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

  function renderCollection(documentRef, name, items, describeItem) {
    const list = documentRef.querySelector(`[data-portfolio-list="${name}"]`);
    const emptyState = documentRef.querySelector(`[data-portfolio-empty="${name}"]`);
    if (!list || !emptyState) {
      return;
    }

    list.replaceChildren();
    for (const item of items || []) {
      const row = documentRef.createElement("li");
      const title = documentRef.createElement("strong");
      const details = documentRef.createElement("span");
      const [primary, secondary] = describeItem(item);
      title.textContent = primary;
      details.textContent = secondary;
      row.append(title, details);
      list.append(row);
    }
    list.hidden = !items || items.length === 0;
    emptyState.hidden = Boolean(items && items.length);
  }

  function setText(documentRef, name, value) {
    const element = documentRef.querySelector(`[data-portfolio-value="${name}"]`);
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

  function formatPercent(value) {
    const number = numericValue(value);
    return number === null ? "—" : `${numberFormat.format(number)}%`;
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

  return { requestPortfolioData, renderPortfolio, startPortfolio };
});
