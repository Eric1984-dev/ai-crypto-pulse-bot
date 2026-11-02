(function attachDashboard(root, createApi) {
  const formatters = typeof module !== "undefined" && module.exports
    ? require("./formatters.js")
    : root.CryptoPulseFormatters;
  const api = createApi(formatters);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    api.startDashboard({ windowRef: window, documentRef: document });
  }
})(globalThis, function createDashboardApi(formatters) {
  const numberFormat = new Intl.NumberFormat("en-GB");
  const currencyFormat = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2
  });
  const chartColors = ["#5b9cff", "#34d399", "#fbbf24", "#a78bfa", "#ff6078"];
  const supportedAgentStatuses = ["ACTIVE", "ANALYZING", "IDLE", "STOPPED", "ERROR"];
  const agentStatusPollIntervalMs = 15000;
  const dashboardRefreshIntervalMs = 30000;

  function emptyDashboardData() {
    return {
      agentStatus: null,
      emergencyState: null,
      lastMarketDataAt: null,
      portfolio: {
        count: 0,
        portfolioValue: null,
        totalPnl: null,
        realizedPnl: null,
        unrealizedPnl: null,
        dailyPnl: null,
        availableBalance: null,
        winRate: null
      },
      openPositions: { count: 0, items: [] },
      recentTrades: { count: 0, items: [] },
      watchedMarkets: { count: 0, items: [] },
      aiDecisions: { count: 0, items: [] },
      portfolioSnapshots: []
    };
  }

  async function requestDashboardData(fetchImpl) {
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
      throw new Error("Dashboard data is unavailable.");
    }

    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("Dashboard data response is invalid.");
    }
    if (!result || !result.data || typeof result.data !== "object") {
      throw new Error("Dashboard data response is invalid.");
    }
    return result.data;
  }

  async function requestAgentStatus(fetchImpl) {
    const response = await fetchImpl("/api/agent-status", {
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
      throw new Error("Agent status is unavailable.");
    }

    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("Agent status response is invalid.");
    }
    if (!result || !result.data || !Object.prototype.hasOwnProperty.call(result.data, "status")) {
      throw new Error("Agent status response is invalid.");
    }
    return result.data.status;
  }

  function renderDashboard(data, documentRef, ChartConstructor, previousChart = null) {
    const view = data || emptyDashboardData();
    const portfolio = view.portfolio || emptyDashboardData().portfolio;
    const openPositions = view.openPositions || { count: 0, items: [] };
    const recentTrades = view.recentTrades || { count: 0, items: [] };
    const watchedMarkets = view.watchedMarkets || { count: 0, items: [] };
    const aiDecisions = view.aiDecisions || { count: 0, items: [] };

    setText(documentRef, "portfolioValue", formatCurrency(portfolio.portfolioValue));
    setText(documentRef, "totalPnl", formatCurrency(portfolio.totalPnl), portfolio.totalPnl);
    setText(documentRef, "realizedPnl", formatCurrency(portfolio.realizedPnl), portfolio.realizedPnl);
    setText(documentRef, "unrealizedPnl", formatCurrency(portfolio.unrealizedPnl), portfolio.unrealizedPnl);
    setText(documentRef, "dailyPnl", formatCurrency(portfolio.dailyPnl), portfolio.dailyPnl);
    setText(documentRef, "winRate", formatPercent(portfolio.winRate));
    setText(documentRef, "openPositions", formatCount(openPositions.count));
    setText(documentRef, "availableBalance", formatCurrency(portfolio.availableBalance));
    setText(documentRef, "aiDecisions", formatCount(aiDecisions.count));
    setText(documentRef, "paperTrades", formatCount(recentTrades.count));
    setText(
      documentRef,
      "trackedMarkets",
      formatCount(watchedMarkets.count)
    );

    setStatus(documentRef, "agent", view.agentStatus && view.agentStatus.status);
    setStatus(documentRef, "emergency", view.emergencyState && view.emergencyState.status);
    renderActivityTimestamps(documentRef, view, recentTrades);
    setText(documentRef, "portfolioCount", formatCount(portfolio.count || 0));

    renderCollection(documentRef, "positions", openPositions.items, (item) => {
      const currentPrice = item.current_market_price === undefined
        ? item.current_price
        : item.current_market_price;
      const metrics = item.current_market_price === undefined
        ? null
        : formatters.getOpenPositionMetrics(item);
      const unrealizedPnl = metrics ? metrics.unrealizedPnl : item.unrealized_pnl;
      return [
        `${item.symbol || "—"} · ${formatters.formatQuantity(item.amount)} units`,
        `Entry ${formatters.formatPrice(item.entry_price)} · Current ${formatters.formatPrice(currentPrice)} · P&L ${formatCurrency(unrealizedPnl)} · Opened ${formatters.formatTimestamp(item.created_at)}`,
        item.symbol
      ];
    });
    renderCollection(documentRef, "trades", recentTrades.items, (item) => [
      item.symbol || "—",
      describeRecentTrade(item),
      item.symbol,
      item.side
    ]);
    renderCollection(documentRef, "markets", watchedMarkets.items, (item) => [
      item.symbol || "—",
      `Priority ${formatCount(item.priority)}`,
      item.symbol
    ]);
    renderCollection(documentRef, "decisions", aiDecisions.items, (item) => [
      `${item.decision || "—"} · ${item.symbol || "—"} · ${formatPercent(item.confidence)}`,
      `Recorded ${formatters.formatTimestamp(item.created_at)} · ${item.reason || "No decision reason recorded."}`,
      item.symbol,
      item.decision
    ]);
    const chart = renderPortfolioChart(
      documentRef,
      view.portfolioSnapshots || [],
      ChartConstructor,
      previousChart
    );
    return chart;
  }

  function renderPortfolioChart(documentRef, snapshots, ChartConstructor, previousChart) {
    const canvas = documentRef.querySelector("[data-portfolio-chart]");
    const emptyState = documentRef.querySelector("[data-dashboard-chart-empty]");
    if (previousChart && typeof previousChart.destroy === "function") {
      previousChart.destroy();
    }

    if (!Array.isArray(snapshots) || snapshots.length === 0) {
      if (canvas) {
        canvas.hidden = true;
      }
      if (emptyState) {
        emptyState.hidden = false;
        emptyState.textContent = "Portfolio history will appear after the first database snapshot.";
      }
      return null;
    }

    if (typeof ChartConstructor !== "function" || !canvas || typeof canvas.getContext !== "function") {
      if (canvas) {
        canvas.hidden = true;
      }
      if (emptyState) {
        emptyState.hidden = false;
        emptyState.textContent = "The portfolio chart is currently unavailable.";
      }
      return null;
    }

    const chartContext = canvas.getContext("2d");
    if (!chartContext) {
      canvas.hidden = true;
      if (emptyState) {
        emptyState.hidden = false;
        emptyState.textContent = "The portfolio chart is currently unavailable.";
      }
      return null;
    }

    canvas.hidden = false;
    if (emptyState) {
      emptyState.hidden = true;
    }
    try {
      return new ChartConstructor(chartContext, createPortfolioChartConfig(snapshots, ChartConstructor));
    } catch {
      canvas.hidden = true;
      if (emptyState) {
        emptyState.hidden = false;
        emptyState.textContent = "The portfolio chart is currently unavailable.";
      }
      return null;
    }
  }

  function createPortfolioChartConfig(snapshots, ChartConstructor) {
    const timestamps = [...new Set(snapshots.map((snapshot) => snapshot.captured_at))]
      .filter((timestamp) => Number.isFinite(Date.parse(timestamp)))
      .sort((left, right) => Date.parse(left) - Date.parse(right));
    const portfolioIds = [...new Set(snapshots.map((snapshot) => snapshot.portfolio_id))];
    const labels = timestamps.map((timestamp) => formatters.formatTimestamp(timestamp));
    const datasets = portfolioIds.map((portfolioId, index) => {
      const snapshotsByTime = new Map(
        snapshots
          .filter((snapshot) => snapshot.portfolio_id === portfolioId)
          .map((snapshot) => [snapshot.captured_at, numericValue(snapshot.portfolio_value)])
      );
      return {
        label: `Portfolio ${index + 1}`,
        data: timestamps.map((timestamp) => snapshotsByTime.get(timestamp) ?? null),
        borderColor: chartColors[index % chartColors.length],
        backgroundColor: `${chartColors[index % chartColors.length]}22`,
        borderWidth: 2,
        pointRadius: 2,
        tension: 0.25,
        spanGaps: false
      };
    });

    const legendLabels = ChartConstructor
      && ChartConstructor.defaults
      && ChartConstructor.defaults.plugins
      && ChartConstructor.defaults.plugins.legend
      && ChartConstructor.defaults.plugins.legend.labels;
    const defaultGenerateLabels = legendLabels && legendLabels.generateLabels;

    return {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: portfolioIds.length > 1,
            labels: {
              color: "#9ca8ba",
              generateLabels(chart) {
                const labels = typeof defaultGenerateLabels === "function"
                  ? defaultGenerateLabels.call(legendLabels, chart)
                  : chart.data.datasets.map((dataset, index) => ({
                    text: dataset.label,
                    fillStyle: dataset.backgroundColor,
                    strokeStyle: dataset.borderColor,
                    lineWidth: dataset.borderWidth,
                    hidden: typeof chart.isDatasetVisible === "function"
                      ? !chart.isDatasetVisible(index)
                      : false,
                    datasetIndex: index
                  }));
                return labels.map((label) => ({
                  ...label,
                  fillStyle: "#8792a1",
                  strokeStyle: "#8792a1"
                }));
              }
            }
          },
          tooltip: { mode: "index", intersect: false }
        },
        scales: {
          x: {
            grid: { color: "rgba(156, 168, 186, 0.08)" },
            ticks: { color: "#9ca8ba", maxTicksLimit: 6 }
          },
          y: {
            grid: { color: "rgba(156, 168, 186, 0.08)" },
            ticks: {
              color: "#9ca8ba",
              callback(value) {
                return currencyFormat.format(value);
              }
            }
          }
        }
      }
    };
  }

  function renderCollection(documentRef, name, items, describeItem) {
    const list = documentRef.querySelector(`[data-dashboard-list="${name}"]`);
    const emptyState = documentRef.querySelector(`[data-dashboard-empty="${name}"]`);
    const safeItems = Array.isArray(items) ? items : [];
    if (list) {
      list.replaceChildren();
      list.hidden = safeItems.length === 0;
      for (const item of safeItems) {
        const [primaryText, secondaryText, marketSymbol, tradeAction] = describeItem(item);
        const row = documentRef.createElement("li");
        const primary = documentRef.createElement("span");
        const secondary = documentRef.createElement("span");
        primary.className = "dashboard-row-primary";
        secondary.className = "dashboard-row-secondary";
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
        if (tradeAction) {
          formatters.setTradeActionText(documentRef, secondary, secondaryText, tradeAction);
        } else {
          formatters.setTradeDetailsText(documentRef, secondary, secondaryText);
        }
        row.append(primary, secondary);
        list.append(row);
      }
    }
    if (emptyState) {
      emptyState.hidden = safeItems.length > 0;
    }
  }

  function renderActivityTimestamps(documentRef, view, recentTrades) {
    const latestTrade = Array.isArray(recentTrades.items) ? recentTrades.items[0] : null;
    const values = {
      "bot-run": view.agentStatus && view.agentStatus.last_run,
      "market-data": view.lastMarketDataAt,
      "paper-trade": latestTrade && latestTrade.created_at
    };

    for (const [name, value] of Object.entries(values)) {
      const target = documentRef.querySelector(`[data-dashboard-activity="${name}"]`);
      if (!target) {
        continue;
      }
      const timestamp = typeof value === "string" && Number.isFinite(Date.parse(value))
        ? value
        : "";
      target.textContent = timestamp ? formatters.formatTimestamp(timestamp) : "—";
      target.dateTime = timestamp;
    }
  }

  function setText(documentRef, name, text, toneValue) {
    const targets = documentRef.querySelectorAll(`[data-dashboard-value="${name}"]`);
    for (const target of targets) {
      target.textContent = text;
      if (arguments.length > 3) {
        formatters.setValueTone(target, toneValue);
      }
    }
  }

  function setStatus(documentRef, name, value) {
    const target = documentRef.querySelector(`[data-dashboard-status="${name}"]`);
    const normalized = typeof value === "string" && value ? value.toUpperCase() : "";
    if (target) {
      target.textContent = normalized || "UNKNOWN";
      target.dataset.state = normalized ? normalized.toLowerCase() : "unknown";
    }
  }

  function formatCurrency(value) {
    const number = numericValue(value);
    return number === null ? "—" : currencyFormat.format(number);
  }

  function formatPercent(value) {
    const number = numericValue(value);
    return number === null ? "—" : `${numberFormat.format(number)}%`;
  }

  function formatCount(value) {
    const number = numericValue(value);
    return number === null ? "0" : numberFormat.format(number);
  }

  function describeRecentTrade(trade) {
    const side = typeof trade.side === "string" ? trade.side.toUpperCase() : "—";
    const details = [
      `${side} · Quantity: ${formatters.formatQuantity(trade.quantity)}`
    ];
    if (side === "BUY" && trade.openPosition) {
      const metrics = formatters.getOpenPositionMetrics(trade.openPosition);
      details.push(
        `Entry: ${formatters.formatPrice(trade.openPosition.entry_price)}`,
        `Current: ${formatters.formatPrice(trade.openPosition.current_market_price)}`,
        `P&L: ${formatPnlSummary(
          metrics ? metrics.unrealizedPnl : null,
          metrics ? metrics.unrealizedPnlPercent : null
        )}`,
        `Date: ${formatters.formatTimestamp(trade.created_at)}`,
        "Status: OPEN"
      );
    } else if (side === "SELL") {
      const metrics = formatters.getClosedTradeMetrics(trade);
      details.push(
        `Entry: ${formatters.formatPrice(metrics ? metrics.entryPrice : null)}`,
        `Exit: ${formatters.formatPrice(trade.price)}`,
        `P&L: ${formatPnlSummary(
          trade.realized_pnl,
          metrics ? metrics.realizedPnlPercent : null
        )}`,
        `Date: ${formatters.formatTimestamp(trade.created_at)}`,
        "Status: CLOSED"
      );
    } else {
      details.push(
        `Execution: ${formatters.formatPrice(trade.price)}`,
        `Date: ${formatters.formatTimestamp(trade.created_at)}`,
        "Status: Executed · Paper Trade"
      );
    }
    return details.join("\n");
  }

  function formatPnlSummary(amount, percentage) {
    const formattedAmount = formatters.formatSignedCurrency(amount);
    return percentage === null || percentage === undefined
      ? formattedAmount
      : `${formattedAmount} (${formatters.formatSignedPercent(percentage)})`;
  }

  function numericValue(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function initializeKpiInfo(documentRef) {
    const triggers = Array.from(documentRef.querySelectorAll("[data-dashboard-kpi-info]"));
    let openInfo = null;

    function closeOpenInfo(restoreFocus = false) {
      if (!openInfo) {
        return;
      }
      const { trigger, popover } = openInfo;
      popover.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      openInfo = null;
      if (restoreFocus && typeof trigger.focus === "function") {
        trigger.focus();
      }
    }

    const entries = triggers.map((trigger) => {
      const popover = documentRef.getElementById(trigger.getAttribute("aria-controls"));
      if (!popover) {
        return null;
      }
      const onClick = () => {
        if (openInfo && openInfo.trigger === trigger) {
          closeOpenInfo();
          return;
        }
        closeOpenInfo();
        popover.hidden = false;
        trigger.setAttribute("aria-expanded", "true");
        openInfo = { trigger, popover };
      };
      trigger.addEventListener("click", onClick);
      return { trigger, onClick };
    }).filter(Boolean);

    function onDocumentClick(event) {
      if (openInfo
        && !openInfo.trigger.contains(event.target)
        && !openInfo.popover.contains(event.target)) {
        closeOpenInfo();
      }
    }

    function onDocumentKeydown(event) {
      if (event.key === "Escape" && openInfo) {
        event.preventDefault();
        closeOpenInfo(true);
      }
    }

    documentRef.addEventListener("click", onDocumentClick);
    documentRef.addEventListener("keydown", onDocumentKeydown);

    return function disposeKpiInfo() {
      closeOpenInfo();
      for (const { trigger, onClick } of entries) {
        trigger.removeEventListener("click", onClick);
      }
      documentRef.removeEventListener("click", onDocumentClick);
      documentRef.removeEventListener("keydown", onDocumentKeydown);
    };
  }

  function startDashboard({
    windowRef = window,
    documentRef = document,
    fetchImpl = windowRef.fetch.bind(windowRef),
    ChartConstructor = windowRef.Chart,
    setIntervalImpl = windowRef.setInterval
      ? windowRef.setInterval.bind(windowRef)
      : globalThis.setInterval,
    clearIntervalImpl = windowRef.clearInterval
      ? windowRef.clearInterval.bind(windowRef)
      : globalThis.clearInterval
  } = {}) {
    const disposeKpiInfo = initializeKpiInfo(documentRef);
    let chart = null;
    let requestInProgress = false;
    let statusRequestInProgress = false;
    let foregroundRefreshPending = false;
    let dashboardDataLoaded = false;
    let dashboardPollingCleanup = null;
    let statusPollingTimer = null;
    let brain = null;
    let currentAgentStatus = null;
    let disposed = false;
    let realtimeCleanup = null;
    const loading = documentRef.querySelector("[data-dashboard-loading]");
    const errorBanner = documentRef.querySelector("[data-dashboard-error]");
    const retryButton = documentRef.querySelector("[data-dashboard-retry]");
    const brainElement = documentRef.querySelector("[data-agent-brain]");
    const brainStage = documentRef.querySelector("[data-agent-brain-stage]");
    const brainFallback = documentRef.querySelector("[data-agent-brain-fallback]");
    async function load() {
      if (requestInProgress || disposed || documentRef.visibilityState === "hidden") {
        return;
      }
      requestInProgress = true;
      if (loading && !dashboardDataLoaded) {
        loading.hidden = false;
      }
      if (errorBanner) {
        errorBanner.hidden = true;
      }
      if (retryButton) {
        retryButton.disabled = true;
        retryButton.hidden = true;
      }

      try {
        const data = await requestDashboardData(fetchImpl);
        if (disposed) {
          return;
        }
        chart = renderDashboard(data, documentRef, ChartConstructor, chart);
        applyAgentStatus(data.agentStatus && data.agentStatus.status);
        dashboardDataLoaded = true;
      } catch (error) {
        if (disposed) {
          return;
        }
        if (error && error.status === 401) {
          foregroundRefreshPending = false;
          windowRef.location.replace("/login.html?next=%2Fdashboard.html");
          return;
        }
        if (!dashboardDataLoaded) {
          chart = renderDashboard(emptyDashboardData(), documentRef, ChartConstructor, chart);
          applyAgentStatus(null);
        }
        if (errorBanner) {
          errorBanner.textContent = dashboardDataLoaded
            ? "Dashboard data could not be refreshed. Please try again."
            : "Dashboard data could not be loaded. Please try again.";
          errorBanner.hidden = false;
        }
        if (retryButton) {
          retryButton.hidden = false;
        }
      } finally {
        requestInProgress = false;
        if (loading) {
          loading.hidden = true;
        }
        if (retryButton) {
          retryButton.disabled = false;
        }
        runPendingForegroundRefresh();
      }
    }

    function applyAgentStatus(status) {
      const normalizedStatus = typeof status === "string"
        ? status.trim().toUpperCase()
        : "";
      currentAgentStatus = supportedAgentStatuses.includes(normalizedStatus)
        ? normalizedStatus
        : null;
      setStatus(documentRef, "agent", currentAgentStatus);
      if (brainElement) {
        brainElement.dataset.state = (currentAgentStatus || "UNKNOWN").toLowerCase();
      }
      if (brainStage) {
        brainStage.setAttribute(
          "aria-label",
          `Agent circuit visualization; status ${currentAgentStatus || "UNKNOWN"}`
        );
      }

      if (brain) {
        if (!hasAvailableBrain()) {
          if (typeof brain.dispose === "function") {
            brain.dispose();
          }
          brain = null;
          setBrainFallback(true);
        } else {
          try {
            brain.setStatus(currentAgentStatus);
            setBrainFallback(false);
          } catch (error) {
            logBrainError(error);
            if (!hasAvailableBrain()) {
              brain.dispose();
              brain = null;
              setBrainFallback(true);
            } else {
              setBrainFallback(false);
            }
          }
          return;
        }
      }
      if (!brainStage) {
        return;
      }
      if (!windowRef.CryptoPulseAgentBrain) {
        logBrainError(new Error("Agent circuit visualization module is unavailable."));
        setBrainFallback(true);
        return;
      }

      try {
        const initializedBrain = windowRef.CryptoPulseAgentBrain.createAgentBrain({
          container: brainStage,
          stateElement: brainElement,
          initialStatus: currentAgentStatus
        });
        if (!initializedBrain || initializedBrain.available !== true) {
          if (initializedBrain && typeof initializedBrain.dispose === "function") {
            initializedBrain.dispose();
          }
          throw initializedBrain && initializedBrain.error
            ? initializedBrain.error
            : new Error("Agent circuit visualization could not be initialized.");
        }
        brain = initializedBrain;
        setBrainFallback(false);
      } catch (error) {
        logBrainError(error);
        brain = null;
        setBrainFallback(true);
      }
    }

    function setBrainFallback(isVisible) {
      const rendererIsReady = hasAvailableBrain();
      const shouldShowFallback = isVisible && !rendererIsReady;
      if (brainFallback) {
        brainFallback.hidden = !shouldShowFallback;
      }
      if (brainElement) {
        brainElement.dataset.visualization = rendererIsReady
          ? "ready"
          : shouldShowFallback ? "unavailable" : "loading";
      }
    }

    function hasAvailableBrain() {
      if (!brain || brain.available !== true) {
        return false;
      }
      if (typeof brain.isAvailable !== "function") {
        return true;
      }
      try {
        return brain.isAvailable() === true;
      } catch {
        return false;
      }
    }

    function logBrainError(error) {
      if (windowRef.console && typeof windowRef.console.error === "function") {
        windowRef.console.error("Agent circuit visualization initialization or update failed.", error);
      }
    }

    async function refreshAgentStatus() {
      if (statusRequestInProgress || requestInProgress || disposed
        || documentRef.visibilityState === "hidden") {
        return;
      }
      statusRequestInProgress = true;
      try {
        const status = await requestAgentStatus(fetchImpl);
        if (!disposed && documentRef.visibilityState !== "hidden") {
          applyAgentStatus(status);
        }
      } catch (error) {
        if (disposed) {
          return;
        }
        if (error && error.status === 401) {
          foregroundRefreshPending = false;
          windowRef.location.replace("/login.html?next=%2Fdashboard.html");
          return;
        }
        applyAgentStatus(null);
      } finally {
        statusRequestInProgress = false;
        runPendingForegroundRefresh();
      }
    }

    function startDashboardPolling() {
      if (dashboardPollingCleanup !== null || disposed
        || documentRef.visibilityState === "hidden"
        || typeof setIntervalImpl !== "function") {
        return;
      }
      const realtime = windowRef.CryptoPulseRealtime;
      if (realtime && typeof realtime.startAlignedPolling === "function") {
        dashboardPollingCleanup = realtime.startAlignedPolling({
          callback: load,
          intervalMs: dashboardRefreshIntervalMs,
          windowRef,
          setIntervalImpl,
          clearIntervalImpl
        });
        return;
      }
      const timer = setIntervalImpl(load, dashboardRefreshIntervalMs);
      dashboardPollingCleanup = () => clearIntervalImpl(timer);
    }

    function stopDashboardPolling() {
      dashboardPollingCleanup?.();
      dashboardPollingCleanup = null;
    }

    function refreshDashboardOnForeground() {
      if (requestInProgress || statusRequestInProgress) {
        foregroundRefreshPending = true;
        return;
      }
      foregroundRefreshPending = false;
      load();
    }

    function runPendingForegroundRefresh() {
      if (!foregroundRefreshPending || requestInProgress || statusRequestInProgress
        || disposed || documentRef.visibilityState === "hidden") {
        return;
      }
      foregroundRefreshPending = false;
      load();
    }

    function startStatusPolling() {
      if (statusPollingTimer !== null || disposed
        || documentRef.visibilityState === "hidden"
        || typeof setIntervalImpl !== "function") {
        return;
      }
      statusPollingTimer = setIntervalImpl(refreshAgentStatus, agentStatusPollIntervalMs);
    }

    function stopStatusPolling() {
      if (statusPollingTimer !== null) {
        clearIntervalImpl(statusPollingTimer);
        statusPollingTimer = null;
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
          onUpdate: refreshDashboardOnForeground,
          surface: "dashboard",
          windowRef
        });
      }
    }

    function onVisibilityChange() {
      if (documentRef.visibilityState === "hidden") {
        stopDashboardPolling();
        stopStatusPolling();
        return;
      }
      if (documentRef.body.dataset.authPage === "protected"
        && !documentRef.documentElement.classList.contains("auth-pending")) {
        startDashboardPolling();
        startStatusPolling();
        refreshDashboardOnForeground();
      }
    }

    function onPageHide(event) {
      if (event && event.persisted) {
        stopDashboardPolling();
        stopStatusPolling();
        return;
      }
      dispose();
    }

    function onPageShow(event) {
      if (event && event.persisted) {
        onVisibilityChange();
      }
    }

    function dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      foregroundRefreshPending = false;
      stopDashboardPolling();
      stopStatusPolling();
      realtimeCleanup?.();
      realtimeCleanup = null;
      if (typeof documentRef.removeEventListener === "function") {
        documentRef.removeEventListener("visibilitychange", onVisibilityChange);
      }
      disposeKpiInfo();
      if (typeof windowRef.removeEventListener === "function") {
        windowRef.removeEventListener("pagehide", onPageHide);
        windowRef.removeEventListener("pageshow", onPageShow);
      }
      if (brain && typeof brain.dispose === "function") {
        brain.dispose();
      }
      if (chart && typeof chart.destroy === "function") {
        chart.destroy();
      }
    }

    retryButton?.addEventListener("click", load);
    documentRef.addEventListener?.("visibilitychange", onVisibilityChange);
    windowRef.addEventListener?.("pagehide", onPageHide);
    windowRef.addEventListener?.("pageshow", onPageShow);
    const authReady = windowRef.CryptoPulseAuthReady;
    if (authReady && typeof authReady.then === "function") {
      authReady.then(async () => {
        if (documentRef.body.dataset.authPage === "protected"
          && !documentRef.documentElement.classList.contains("auth-pending")) {
          await load();
          startDashboardPolling();
          startStatusPolling();
          startRealtime();
        }
        return undefined;
      });
    }
    return { dispose, load, refreshAgentStatus };
  }

  return {
    createPortfolioChartConfig,
    emptyDashboardData,
    initializeKpiInfo,
    requestAgentStatus,
    renderDashboard,
    requestDashboardData,
    startDashboard
  };
});
