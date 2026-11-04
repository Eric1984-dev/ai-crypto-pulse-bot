(function attachMarketScanner(root, createApi) {
  const formatters = typeof module !== "undefined" && module.exports
    ? require("./formatters.js")
    : root.CryptoPulseFormatters;
  const api = createApi(formatters);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    api.startMarketScanner({ windowRef: window, documentRef: document });
  }
})(globalThis, function createMarketScannerApi(formatters) {
  const timeframes = ["24h", "7d", "30d"];
  const rankings = ["topGainers", "topLosers", "highestVolume", "strongestMomentum", "aiOpportunities"];
  const numberFormat = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });
  const currencyFormat = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2
  });
  const refreshIntervalMs = 30000;

  async function requestMarketScannerSummary(fetchImpl) {
    const response = await fetchImpl("/api/market-summary", {
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
      throw new Error("Market scanner data is unavailable.");
    }

    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("Market scanner response is invalid.");
    }
    const summary = result && result.data && result.data.scanner;
    if (!summary || !summary.timeframes || !Number.isInteger(summary.activeMarkets)
      || !Number.isInteger(summary.marketsWithFreshData)
      || !Array.isArray(summary.watchedMarkets)
      || summary.watchedMarkets.length !== summary.activeMarkets
      || summary.watchedMarkets.some((market) => !market
        || typeof market.symbol !== "string"
        || !/^[A-Z0-9]+-EUR$/.test(market.symbol)
        || !Number.isFinite(market.priority))) {
      throw new Error("Market scanner response is invalid.");
    }
    for (const timeframe of timeframes) {
      const rankingsForTimeframe = summary.timeframes[timeframe];
      if (!rankingsForTimeframe || rankings.some((ranking) => !Array.isArray(rankingsForTimeframe[ranking]))) {
        throw new Error("Market scanner response is invalid.");
      }
    }
    return summary;
  }

  function renderMarketScannerSummary(summary, timeframe, documentRef) {
    const rankingData = summary && summary.timeframes && summary.timeframes[timeframe];
    if (!rankingData) {
      throw new TypeError("A valid scanner summary and timeframe are required.");
    }
    for (const ranking of rankings) {
      const list = documentRef.querySelector(`[data-scanner-list="${ranking}"]`);
      const empty = documentRef.querySelector(`[data-scanner-empty="${ranking}"]`);
      const items = rankingData[ranking];
      if (list) {
        list.replaceChildren();
        list.hidden = items.length === 0;
        for (const item of items) {
          const row = documentRef.createElement("li");
          const primary = documentRef.createElement("span");
          const secondary = documentRef.createElement("span");
          primary.className = "dashboard-row-primary";
          secondary.className = "dashboard-row-secondary";
          const [primaryText, secondaryText, marketSymbol, tradeAction] = describeRankingItem(ranking, item);
          if (marketSymbol || tradeAction) {
            formatters.setMarketAndTradeText(
              documentRef,
              primary,
              primaryText,
              marketSymbol,
              tradeAction
            );
          } else {
            primary.textContent = primaryText;
          }
          secondary.textContent = secondaryText;
          row.append(primary, secondary);
          list.append(row);
        }
      }
      if (empty) {
        empty.hidden = items.length > 0;
      }
    }

    const watchedMarketList = documentRef.querySelector("[data-scanner-watched-markets]");
    const watchedMarketEmpty = documentRef.querySelector("[data-scanner-watched-empty]");
    const watchedMarketCount = documentRef.querySelector("[data-scanner-watched-count]");
    if (watchedMarketCount) {
      watchedMarketCount.textContent = numberFormat.format(summary.watchedMarkets.length);
    }
    if (watchedMarketList) {
      watchedMarketList.replaceChildren();
      watchedMarketList.hidden = summary.watchedMarkets.length === 0;
      for (const market of summary.watchedMarkets) {
        const row = documentRef.createElement("li");
        const symbol = documentRef.createElement("span");
        const priority = documentRef.createElement("span");
        symbol.className = "market-symbol";
        symbol.textContent = market.symbol;
        priority.className = "scanner-market-priority";
        priority.textContent = `Priority ${numberFormat.format(market.priority)}`;
        row.append(symbol, priority);
        watchedMarketList.append(row);
      }
    }
    if (watchedMarketEmpty) {
      watchedMarketEmpty.hidden = summary.watchedMarkets.length > 0;
    }
  }

  function describeRankingItem(ranking, item) {
    const symbol = item.symbol || "—";
    if (ranking === "aiOpportunities") {
      return [
        `${item.decision || "—"} · ${symbol} · ${formatPercent(item.confidence)}`,
        `Recorded ${formatters.formatTimestamp(item.created_at)} · ${item.reason || "No decision reason recorded."}`,
        item.symbol,
        item.decision
      ];
    }
    const metric = ranking === "highestVolume"
      ? formatCurrency(item.volumeEur)
      : `${formatPercent(item[ranking === "strongestMomentum" ? "momentumPct" : "changePct"])}`
        + (ranking === "strongestMomentum" && item.momentumLabel ? ` (${item.momentumLabel})` : "");
    const secondary = ranking === "highestVolume"
      ? `Estimated quote volume · Price ${formatCurrency(item.price)}`
      : `Price ${formatCurrency(item.price)} · Captured ${formatTime(item.captured_at)}`;
    return [`${symbol} · ${metric}`, secondary, item.symbol];
  }

  function formatPercent(value) {
    return typeof value === "number" && Number.isFinite(value)
      ? `${numberFormat.format(value)}%`
      : "—";
  }

  function formatCurrency(value) {
    return typeof value === "number" && Number.isFinite(value)
      ? currencyFormat.format(value)
      : "—";
  }

  function formatTime(value) {
    return formatters.formatTimestamp(value, "time");
  }

  function startMarketScanner({
    windowRef = window,
    documentRef = document,
    fetchImpl = windowRef.fetch.bind(windowRef),
    setIntervalImpl = windowRef.setInterval.bind(windowRef),
    clearIntervalImpl = windowRef.clearInterval.bind(windowRef)
  } = {}) {
    const status = documentRef.querySelector("[data-scanner-status]");
    const refreshButton = documentRef.querySelector("[data-scanner-refresh]");
    const timeframeButtons = [...documentRef.querySelectorAll("[data-scanner-timeframe]")];
    let selectedTimeframe = "24h";
    let latestSummary = null;
    let inFlightRequest = null;
    let pollingTimer = null;
    let disposed = false;
    let realtimeCleanup = null;

    function setStatus(message, state) {
      if (status) {
        status.textContent = message;
        status.dataset.state = state;
      }
    }

    function render() {
      if (latestSummary) {
        renderMarketScannerSummary(latestSummary, selectedTimeframe, documentRef);
      }
    }

    async function load() {
      if (inFlightRequest) {
        return inFlightRequest;
      }
      const request = (async () => {
        if (refreshButton) {
          refreshButton.disabled = true;
        }
        setStatus("Refreshing scanner data…", "loading");
        try {
          latestSummary = await requestMarketScannerSummary(fetchImpl);
          if (disposed) {
            return;
          }
          render();
          const updatedAt = formatTime(latestSummary.generatedAt);
          setStatus(
            `${latestSummary.marketsWithFreshData} of ${latestSummary.activeMarkets} active markets · Updated ${updatedAt}`,
            "success"
          );
        } catch (error) {
          if (disposed) {
            return;
          }
          if (error && error.status === 401) {
            windowRef.location.replace("/login.html?next=%2Fscanner.html");
            return;
          }
          setStatus(error.message || "Market scanner data is unavailable.", "error");
        } finally {
          if (refreshButton) {
            refreshButton.disabled = false;
          }
        }
      })();
      inFlightRequest = request;
      try {
        await request;
      } finally {
        if (inFlightRequest === request) {
          inFlightRequest = null;
        }
      }
    }

    function startPolling() {
      if (pollingTimer !== null || disposed || documentRef.visibilityState === "hidden") {
        return;
      }
      pollingTimer = setIntervalImpl(() => void load(), refreshIntervalMs);
    }

    function stopPolling() {
      if (pollingTimer !== null) {
        clearIntervalImpl(pollingTimer);
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
          onUpdate: load,
          surface: "scanner",
          windowRef
        });
      }
    }

    function onVisibilityChange() {
      if (documentRef.visibilityState === "hidden") {
        stopPolling();
        return;
      }
      startPolling();
      void load();
    }

    function dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      stopPolling();
      realtimeCleanup?.();
      realtimeCleanup = null;
      documentRef.removeEventListener?.("visibilitychange", onVisibilityChange);
      windowRef.removeEventListener?.("pagehide", onPageHide);
      windowRef.removeEventListener?.("pageshow", onPageShow);
    }

    function onPageHide(event) {
      if (event && event.persisted) {
        stopPolling();
      } else {
        dispose();
      }
    }

    function onPageShow(event) {
      if (event && event.persisted) {
        onVisibilityChange();
      }
    }

    for (const button of timeframeButtons) {
      button.addEventListener("click", () => {
        const timeframe = button.dataset.scannerTimeframe;
        if (!timeframes.includes(timeframe)) {
          return;
        }
        selectedTimeframe = timeframe;
        for (const timeframeButton of timeframeButtons) {
          timeframeButton.setAttribute(
            "aria-pressed",
            String(timeframeButton.dataset.scannerTimeframe === selectedTimeframe)
          );
        }
        render();
      });
    }
    refreshButton?.addEventListener("click", () => void load());
    documentRef.addEventListener?.("visibilitychange", onVisibilityChange);
    windowRef.addEventListener?.("pagehide", onPageHide);
    windowRef.addEventListener?.("pageshow", onPageShow);

    const authReady = windowRef.CryptoPulseAuthReady;
    if (authReady && typeof authReady.then === "function") {
      authReady.then(() => {
        if (documentRef.body.dataset.authPage === "protected"
          && !documentRef.documentElement.classList.contains("auth-pending")) {
          void load();
          startPolling();
          startRealtime();
        }
      });
    }
    return { dispose, load, render };
  }

  return {
    refreshIntervalMs,
    renderMarketScannerSummary,
    requestMarketScannerSummary,
    startMarketScanner
  };
});
