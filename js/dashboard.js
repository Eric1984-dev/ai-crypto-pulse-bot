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
  const archiveHealthRefreshIntervalMs = 300000;
  const dashboardListVisibleItemCount = 2;
  const dashboardListNames = ["positions", "trades", "position-ai-status"];
  const runtimeApiUrl = (path) => {
    if (!globalThis.CryptoPulseRuntimeApi) {
      throw new Error("Raspberry Pi runtime API is not configured.");
    }
    return globalThis.CryptoPulseRuntimeApi.url(path);
  };

  function getRateLimitRetryDelay(response) {
    const retryAfter = response.headers?.get?.("Retry-After");
    if (retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter)) {
      return Math.min(3600000, Math.max(0, Number(retryAfter) * 1000));
    }
    const retryAt = retryAfter ? Date.parse(retryAfter) : NaN;
    return Number.isFinite(retryAt)
      ? Math.min(3600000, Math.max(0, retryAt - Date.now()))
      : 1000;
  }

  function waitForRateLimitRetry(delayMs) {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  async function fetchDashboardResponse(fetchImpl, url, options) {
    let response = await fetchImpl(url, options);
    if (response.status === 429) {
      await waitForRateLimitRetry(getRateLimitRetryDelay(response));
      response = await fetchImpl(url, options);
    }
    return response;
  }

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
    const response = await fetchDashboardResponse(fetchImpl, runtimeApiUrl("/api/v1/dashboard-data"), {
      method: "GET",
      cache: "no-store",
      credentials: "include",
      headers: { Accept: "application/json" }
    });
    if (response.status === 401) {
      const error = new Error("Authentication is required.");
      error.status = 401;
      throw error;
    }
    if (response.status === 429) {
      throw new Error("Dashboard data is rate limited. Please try again shortly.");
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
    const response = await fetchDashboardResponse(fetchImpl, runtimeApiUrl("/api/v1/agent-status"), {
      method: "GET",
      cache: "no-store",
      credentials: "include",
      headers: { Accept: "application/json" }
    });
    if (response.status === 401) {
      const error = new Error("Authentication is required.");
      error.status = 401;
      throw error;
    }
    if (response.status === 429) {
      throw new Error("Agent status is rate limited.");
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

  async function requestArchiveHealth(fetchImpl) {
    const response = await fetchDashboardResponse(fetchImpl, runtimeApiUrl("/api/v1/monitoring"), {
      method: "GET",
      cache: "no-store",
      credentials: "include",
      headers: { Accept: "application/json" }
    });
    if (response.status === 401) {
      const error = new Error("Authentication is required.");
      error.status = 401;
      throw error;
    }
    if (response.status === 429) {
      throw new Error("System monitoring is rate limited.");
    }
    if (!response.ok) {
      throw new Error("Archive server health is unavailable.");
    }

    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("Archive server health response is invalid.");
    }
    if (!result || !result.data || typeof result.data !== "object") {
      throw new Error("Archive server health response is invalid.");
    }
    return result.data;
  }

  function renderArchiveHealth(
    health,
    documentRef,
    { unavailable = false, cpuCriticalSamples = 0 } = {}
  ) {
    const statusFields = ["server", "postgresql", "database"];
    const serviceStates = [];
    for (const field of statusFields) {
      const element = documentRef.querySelector(`[data-archive-health="${field}"]`);
      const value = health && typeof health[field] === "string"
        ? health[field].trim().toLowerCase()
        : "";
      const state = unavailable
        ? "unknown"
        : value === "online" || value === "offline" ? value : "unknown";
      serviceStates.push(state);
      if (!element) {
        continue;
      }
      element.textContent = state === "online"
        ? "Online"
        : state === "offline" ? "Offline" : "Unknown";
      element.dataset.state = state;
    }

    const diskUsageElement = documentRef.querySelector("[data-archive-health=\"disk-usage\"]");
    const diskUsageMeter = documentRef.querySelector("[data-archive-health-meter]");
    const diskUsage = health && typeof health.diskUsage === "number"
      && Number.isFinite(health.diskUsage) && health.diskUsage >= 0 && health.diskUsage <= 100
      ? health.diskUsage
      : null;
    if (diskUsageElement) {
      diskUsageElement.textContent = diskUsage === null
        ? "—"
        : `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(diskUsage)}%`;
    }
    if (diskUsageMeter) {
      diskUsageMeter.hidden = diskUsage === null;
      if (diskUsage !== null) {
        diskUsageMeter.value = diskUsage;
      }
    }

    const system = health && health.system && typeof health.system === "object"
      ? health.system
      : {};
    renderRuntimeActivity(health, documentRef);
    const modelElement = documentRef.querySelector("[data-archive-health=\"model\"]");
    const model = typeof system.model === "string" ? system.model.trim() : "";
    const validModel = model.length > 0 && model.length <= 128
      && !/[\u0000-\u001f\u007f]/.test(model);
    if (modelElement) {
      modelElement.textContent = validModel ? model : "—";
    }
    const systemMetrics = [
      {
        name: "temperature",
        value: system.temperatureC,
        unit: "°C",
        maximum: 200,
        fractionDigits: 1
      },
      {
        name: "cpu-usage",
        value: system.cpuUsagePercent,
        unit: "%",
        maximum: 100,
        fractionDigits: 0
      },
      {
        name: "memory-usage",
        value: system.memory && system.memory.usedPercent,
        unit: "%",
        maximum: 100,
        fractionDigits: 0
      }
    ];
    const systemMetricStates = [];
    for (const metric of systemMetrics) {
      const valueElement = documentRef.querySelector(
        `[data-archive-health="${metric.name}"]`
      );
      const meter = documentRef.querySelector(
        `[data-archive-health-meter="${metric.name}"]`
      );
      const value = typeof metric.value === "number"
        && Number.isFinite(metric.value)
        && metric.value >= 0
        && metric.value <= metric.maximum
        ? metric.value
        : null;
      let state = "unavailable";
      if (value !== null) {
        if (metric.name === "temperature") {
          state = value >= 80 ? "critical" : value >= 70 ? "warning" : "normal";
        } else if (metric.name === "memory-usage") {
          state = value >= 90 ? "critical" : value >= 80 ? "warning" : "normal";
        } else {
          state = value >= 90
            ? cpuCriticalSamples >= 2 ? "critical" : "warning"
            : value >= 75 ? "warning" : "normal";
        }
      }
      systemMetricStates.push(state);
      if (valueElement) {
        valueElement.textContent = value === null
          ? "—"
          : `${new Intl.NumberFormat("en-GB", {
            maximumFractionDigits: metric.fractionDigits
          }).format(value)}${metric.unit}`;
      }
      if (meter) {
        if (!unavailable) {
          meter.dataset.state = state;
        }
        meter.hidden = value === null;
        if (value !== null) {
          meter.value = Math.min(value, 100);
        }
      }
    }
    renderDashboardPiHealthSummary({
      serviceStates,
      systemMetricStates,
      unavailable
    }, documentRef);

    const databaseSizeElement = documentRef.querySelector("[data-archive-health=\"database-size\"]");
    const databaseSize = health && typeof health.databaseSize === "string"
      ? health.databaseSize.trim()
      : "";
    if (databaseSizeElement) {
      databaseSizeElement.textContent = databaseSize && databaseSize.length <= 64
        ? databaseSize
        : "—";
    }

    const lastCheckElement = documentRef.querySelector("[data-archive-health=\"last-check\"]");
    const lastCheck = health && typeof health.lastHealthCheck === "string"
      ? new Date(health.lastHealthCheck)
      : null;
    const formattedLastCheck = lastCheck && Number.isFinite(lastCheck.getTime())
      ? formatters.formatTimestamp(lastCheck)
      : null;
    if (lastCheckElement) {
      lastCheckElement.textContent = unavailable
        ? formattedLastCheck
          ? `Unavailable · last success ${formattedLastCheck}`
          : "Unavailable"
        : formattedLastCheck || "—";
    }
  }

  function renderDashboardPiHealthSummary(
    { serviceStates, systemMetricStates, unavailable },
    documentRef
  ) {
    const summary = documentRef.querySelector("[data-dashboard-pi-health]");
    const status = documentRef.querySelector("[data-dashboard-pi-health-state]");
    if (!summary || !status) {
      return;
    }

    let state = "error";
    let label = "System status unavailable";
    if (!unavailable) {
      if (serviceStates.includes("offline")) {
        label = "System service offline";
      } else if (serviceStates.includes("unknown")) {
        label = "System status unavailable";
      } else if (systemMetricStates.includes("critical")) {
        label = "High system load";
      } else if (systemMetricStates.includes("warning")) {
        label = "Elevated system load";
      } else if (systemMetricStates.some((metricState) => metricState !== "unavailable")) {
        state = "normal";
        label = "System running normally";
      } else {
        label = "Metrics unavailable";
      }
    }

    summary.dataset.state = state;
    status.textContent = label;
  }

  function renderDashboard(data, documentRef, ChartConstructor, previousChart = null) {
    const view = data || emptyDashboardData();
    const portfolio = view.portfolio || emptyDashboardData().portfolio;
    const openPositions = view.openPositions || { count: 0, items: [] };
    const openPositionAiStatus = view.openPositionAiStatus || { count: 0, items: [] };
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
    setText(documentRef, "openPositionAiStatus", formatCount(openPositionAiStatus.count));
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
    renderPositionAiStatus(documentRef, openPositionAiStatus.items);
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
      list.dataset.scrollable = String(safeItems.length > dashboardListVisibleItemCount);
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
      updateDashboardListViewport(list);
    }
    if (emptyState) {
      emptyState.hidden = safeItems.length > 0;
    }
  }

  function renderPositionAiStatus(documentRef, items) {
    const list = documentRef.querySelector('[data-dashboard-list="position-ai-status"]');
    const emptyState = documentRef.querySelector('[data-dashboard-empty="position-ai-status"]');
    const safeItems = Array.isArray(items) ? items : [];

    if (list) {
      list.replaceChildren();
      list.hidden = safeItems.length === 0;
      list.dataset.scrollable = String(safeItems.length > dashboardListVisibleItemCount);
      for (const item of safeItems) {
        const latestDecision = item.latestAiDecision || null;
        const decision = typeof latestDecision?.decision === "string"
          ? latestDecision.decision.toUpperCase()
          : "No decision";
        const metrics = item.current_market_price === undefined
          ? null
          : formatters.getOpenPositionMetrics(item);
        const unrealizedPnl = metrics ? metrics.unrealizedPnl : item.unrealized_pnl;
        const card = documentRef.createElement("li");
        const symbol = documentRef.createElement("h3");
        const details = documentRef.createElement("dl");
        card.className = "position-ai-status-card";
        symbol.className = "position-ai-status-symbol";
        symbol.textContent = item.symbol || "—";
        details.className = "position-ai-status-details";

        const marketStrength = latestDecision && latestDecision.marketStrength;
        const marketView = describeMarketView(marketStrength);
        appendPositionAiField(documentRef, details, "decision", "Decision", decision);
        appendPositionAiField(
          documentRef,
          details,
          "marketView",
          "Market View",
          marketView
        );
        appendPositionAiField(
          documentRef,
          details,
          "aiCommentary",
          "AI Commentary",
          describeAiCommentary(latestDecision && latestDecision.decision, marketView)
        );
        appendPositionAiField(
          documentRef,
          details,
          "unrealizedPnl",
          "Current Unrealized P&L",
          formatPnlSummary(
            unrealizedPnl,
            metrics ? metrics.unrealizedPnlPercent : null
          ),
          unrealizedPnl
        );
        appendPositionAiField(
          documentRef,
          details,
          "decisionTimestamp",
          "Updated",
          latestDecision && latestDecision.created_at
            ? formatters.formatTimestamp(latestDecision.created_at)
            : "—"
        );
        card.append(symbol, details);
        list.append(card);
      }
      updateDashboardListViewport(list);
    }

    if (emptyState) {
      emptyState.hidden = safeItems.length > 0;
    }
  }

  function updateDashboardListViewport(list) {
    if (!list || !list.style) {
      return;
    }

    if (list.dataset.scrollable !== "true") {
      list.style.removeProperty("--dashboard-list-max-height");
      return;
    }

    if (!list.dataset.scrollToggleBound) {
      const panel = typeof list.closest === "function" ? list.closest("details") : null;
      if (panel && typeof panel.addEventListener === "function") {
        panel.addEventListener("toggle", () => updateDashboardListViewport(list));
        list.dataset.scrollToggleBound = "true";
      }
    }

    const visibleItems = Array.from(list.children).slice(0, dashboardListVisibleItemCount);
    if (visibleItems.length !== dashboardListVisibleItemCount
      || typeof list.getBoundingClientRect !== "function"
      || typeof visibleItems[1].getBoundingClientRect !== "function") {
      return;
    }

    const listTop = list.getBoundingClientRect().top;
    const lastVisibleItemBottom = visibleItems[1].getBoundingClientRect().bottom;
    const maxHeight = lastVisibleItemBottom - listTop + (list.scrollTop || 0);
    if (Number.isFinite(maxHeight) && maxHeight > 0) {
      list.style.setProperty("--dashboard-list-max-height", `${maxHeight}px`);
    }
  }

  function updateDashboardListViewports(documentRef) {
    for (const name of dashboardListNames) {
      updateDashboardListViewport(
        documentRef.querySelector(`[data-dashboard-list="${name}"]`)
      );
    }
  }

  function appendPositionAiField(documentRef, details, name, label, text, toneValue) {
    const field = documentRef.createElement("div");
    const term = documentRef.createElement("dt");
    const value = documentRef.createElement("dd");
    field.className = name === "aiCommentary"
      ? "position-ai-status-field position-ai-status-commentary"
      : "position-ai-status-field";
    term.textContent = label;
    value.dataset.positionAiField = name;
    value.textContent = text;
    if (toneValue !== undefined) {
      formatters.setValueTone(value, toneValue);
    }
    field.append(term, value);
    details.append(field);
  }

  function describeMarketView(value) {
    const strength = value === null || value === undefined
      ? null
      : typeof value === "number" ? value : Number(value);
    if (strength === null || !Number.isFinite(strength)) {
      return "Unavailable";
    }
    if (strength <= -40) {
      return "Strong Bearish";
    }
    if (strength <= -20) {
      return "Bearish";
    }
    if (strength < 20) {
      return "Neutral";
    }
    if (strength < 40) {
      return "Bullish";
    }
    return "Strong Bullish";
  }

  function describeAiCommentary(decision, marketView) {
    const normalizedDecision = typeof decision === "string" ? decision.toUpperCase() : "";
    if (normalizedDecision === "BUY") {
      return "Bullish trend detected. AI currently favors upward continuation.";
    }
    if (normalizedDecision === "SELL") {
      return "Bearish trend detected. Downside risk currently outweighs upside potential.";
    }
    if (normalizedDecision === "WAIT") {
      return "Insufficient or unreliable data. AI is waiting for better market conditions.";
    }
    if (normalizedDecision === "HOLD") {
      if (marketView === "Bullish" || marketView === "Strong Bullish") {
        return "Bullish conditions are present, but the AI currently recommends holding.";
      }
      if (marketView === "Bearish" || marketView === "Strong Bearish") {
        return "Bearish pressure is present, but the AI currently recommends holding.";
      }
      if (marketView === "Neutral") {
        return "No strong bullish or bearish trend detected.";
      }
      return "Market conditions are unavailable; the AI currently recommends holding.";
    }
    return "No recent AI decision is available for this market.";
  }

  function renderActivityTimestamps(documentRef, view, recentTrades) {
    const latestTrade = Array.isArray(recentTrades.items) ? recentTrades.items[0] : null;
    const values = {
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

  function renderRuntimeActivity(health, documentRef) {
    const cycle = health && health.runtime && health.runtime.lastCycle;
    const cycleAt = cycle && typeof cycle.cycleAt === "string"
      && Number.isFinite(Date.parse(cycle.cycleAt))
      ? cycle.cycleAt
      : "";
    const stages = cycle && cycle.stages && typeof cycle.stages === "object"
      ? cycle.stages
      : {};
    const statusLabels = {
      completed: ["Completed", "completed"],
      COMPLETED: ["Completed", "completed"],
      FAILED: ["Failed", "failed"],
      SKIPPED: ["Skipped", "skipped"]
    };

    for (const [activity, stage, timeActivity] of [
      ["ai-analysis", "aiAnalysis", "ai-analysis"],
      ["paper-trading", "paperTrading", "paper-trading-run"]
    ]) {
      const statusElement = documentRef.querySelector(
        `[data-dashboard-activity-status="${activity}"]`
      );
      const timeElement = documentRef.querySelector(
        `[data-dashboard-activity="${timeActivity}"]`
      );
      const stageStatus = stages[stage];
      const mappedStatus = typeof stageStatus === "string"
        && Object.hasOwn(statusLabels, stageStatus)
        ? statusLabels[stageStatus]
        : null;
      const [label, state] = mappedStatus
        || [cycle ? "Not run" : "No run yet", "unknown"];

      if (statusElement) {
        statusElement.textContent = label;
        statusElement.dataset.state = state;
      }
      if (timeElement) {
        timeElement.textContent = cycleAt ? formatters.formatTimestamp(cycleAt) : "—";
        timeElement.dateTime = cycleAt;
      }
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
    let archiveRequestInProgress = false;
    let archiveForegroundRefreshPending = false;
    let archiveCpuCriticalSamples = 0;
    let lastArchiveHealth = null;
    let foregroundRefreshPending = false;
    let loginRedirected = false;
    let dashboardDataLoaded = false;
    let dashboardPollingCleanup = null;
    let statusPollingTimer = null;
    let archivePollingTimer = null;
    let brain = null;
    let currentAgentStatus = null;
    let disposed = false;
    let realtimeCleanup = null;
    const onDashboardResize = () => updateDashboardListViewports(documentRef);
    function redirectToLogin() {
      if (loginRedirected) {
        return;
      }
      loginRedirected = true;
      foregroundRefreshPending = false;
      windowRef.location.replace("/login.html?next=%2Fdashboard.html");
    }
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
          redirectToLogin();
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
          redirectToLogin();
          return;
        }
        applyAgentStatus(null);
      } finally {
        statusRequestInProgress = false;
        runPendingForegroundRefresh();
      }
    }

    async function refreshArchiveHealth() {
      if (archiveRequestInProgress) {
        archiveForegroundRefreshPending = documentRef.visibilityState !== "hidden";
        return;
      }
      if (disposed || documentRef.visibilityState === "hidden") {
        return;
      }
      archiveRequestInProgress = true;
      try {
        const health = await requestArchiveHealth(fetchImpl);
        if (!disposed && documentRef.visibilityState !== "hidden") {
          lastArchiveHealth = health;
          const cpuUsage = health.system?.cpuUsagePercent;
          archiveCpuCriticalSamples = typeof cpuUsage === "number"
            && Number.isFinite(cpuUsage)
            && cpuUsage >= 90
            && cpuUsage <= 100
            ? archiveCpuCriticalSamples + 1
            : 0;
          renderArchiveHealth(health, documentRef, {
            cpuCriticalSamples: archiveCpuCriticalSamples
          });
        }
      } catch (error) {
        if (disposed) {
          return;
        }
        if (error && error.status === 401) {
          redirectToLogin();
          return;
        }
        archiveCpuCriticalSamples = 0;
        renderArchiveHealth(lastArchiveHealth, documentRef, {
          unavailable: true,
          cpuCriticalSamples: archiveCpuCriticalSamples
        });
      } finally {
        archiveRequestInProgress = false;
        if (archiveForegroundRefreshPending && !disposed
          && documentRef.visibilityState !== "hidden") {
          archiveForegroundRefreshPending = false;
          void refreshArchiveHealth();
        }
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

    function startArchivePolling() {
      if (archivePollingTimer !== null || disposed
        || documentRef.visibilityState === "hidden"
        || typeof setIntervalImpl !== "function") {
        return;
      }
      archivePollingTimer = setIntervalImpl(
        refreshArchiveHealth,
        archiveHealthRefreshIntervalMs
      );
    }

    function stopArchivePolling() {
      if (archivePollingTimer !== null) {
        clearIntervalImpl(archivePollingTimer);
        archivePollingTimer = null;
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
        stopArchivePolling();
        return;
      }
      if (documentRef.body.dataset.authPage === "protected"
        && !documentRef.documentElement.classList.contains("auth-pending")) {
        startDashboardPolling();
        startStatusPolling();
        startArchivePolling();
        void refreshArchiveHealth();
        refreshDashboardOnForeground();
      }
    }

    function onPageHide(event) {
      if (event && event.persisted) {
        stopDashboardPolling();
        stopStatusPolling();
        stopArchivePolling();
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
      stopArchivePolling();
      realtimeCleanup?.();
      realtimeCleanup = null;
      if (typeof documentRef.removeEventListener === "function") {
        documentRef.removeEventListener("visibilitychange", onVisibilityChange);
      }
      disposeKpiInfo();
      if (typeof windowRef.removeEventListener === "function") {
        windowRef.removeEventListener("pagehide", onPageHide);
        windowRef.removeEventListener("pageshow", onPageShow);
        windowRef.removeEventListener("resize", onDashboardResize);
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
    windowRef.addEventListener?.("resize", onDashboardResize);
    const authReady = windowRef.CryptoPulseAuthReady;
    if (authReady && typeof authReady.then === "function") {
      authReady.then(async () => {
        if (documentRef.body.dataset.authPage === "protected"
          && !documentRef.documentElement.classList.contains("auth-pending")) {
          await load();
          startDashboardPolling();
          startStatusPolling();
          startArchivePolling();
          void refreshArchiveHealth();
          startRealtime();
        }
        return undefined;
      });
    }
    return { dispose, load, refreshAgentStatus, refreshArchiveHealth };
  }

  return {
    createPortfolioChartConfig,
    emptyDashboardData,
    initializeKpiInfo,
    requestAgentStatus,
    requestArchiveHealth,
    renderArchiveHealth,
    renderDashboard,
    requestDashboardData,
    startDashboard
  };
});
