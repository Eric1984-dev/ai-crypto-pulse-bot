(function attachAnalytics(root, createApi) {
  const formatters = typeof module !== "undefined" && module.exports
    ? require("./formatters.js")
    : root.CryptoPulseFormatters;
  const api = createApi(formatters);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    api.startAnalytics({ windowRef: window, documentRef: document });
  }
})(globalThis, function createAnalyticsApi(formatters) {
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

  const supportedPeriods = new Set(["30d", "90d", "365d"]);
  const runtimeApiUrl = (path) => {
    if (!globalThis.CryptoPulseRuntimeApi) {
      throw new Error("Raspberry Pi runtime API is not configured.");
    }
    return globalThis.CryptoPulseRuntimeApi.url(path);
  };
  const periodLabels = new Map([
    ["30d", "Last 30 days"],
    ["90d", "Last 90 days"],
    ["365d", "Last 365 days"]
  ]);

  async function requestAnalytics(fetchImpl, period = "30d") {
    if (!supportedPeriods.has(period)) {
      throw new TypeError("A valid analytics date range is required.");
    }
    const params = new URLSearchParams({ view: "analytics", period });
    const response = await fetchImpl(runtimeApiUrl(`/api/v1/dashboard-data?${params}`), {
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
    if (!response.ok) {
      throw new Error("Analytics data is unavailable.");
    }

    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("The analytics response is invalid.");
    }
    const data = result && result.data;
    if (!data || typeof data !== "object"
      || !data.tradePerformance || !data.aiPerformance || !data.portfolio
      || !Array.isArray(data.aiPerformance.confidenceBuckets)
      || !Array.isArray(data.portfolio.equityCurve)) {
      throw new Error("The analytics response is invalid.");
    }
    return data;
  }

  function renderAnalytics(data, documentRef, ChartConstructor, existingCharts = new Map()) {
    const trade = data.tradePerformance;
    const portfolio = data.portfolio;
    setText(documentRef, "winRate", formatPercent(trade.winRate));
    setText(documentRef, "lossRate", formatPercent(trade.lossRate));
    setText(documentRef, "averageWin", formatCurrency(trade.averageWin), trade.averageWin);
    setText(documentRef, "averageLoss", formatCurrency(trade.averageLoss), trade.averageLoss);
    setText(documentRef, "profitFactor", formatNumber(trade.profitFactor));
    setText(documentRef, "realizedPnl", formatCurrency(trade.realizedPnl), trade.realizedPnl);
    setText(documentRef, "unrealizedPnl", formatCurrency(trade.unrealizedPnl), trade.unrealizedPnl);
    setText(documentRef, "totalPnl", formatCurrency(trade.totalPnl), trade.totalPnl);
    setTradeText(documentRef, "bestTrade", trade.bestTrade);
    setTradeText(documentRef, "worstTrade", trade.worstTrade);
    setTradeText(documentRef, "largestWinner", trade.largestWinner);
    setTradeText(documentRef, "largestLoser", trade.largestLoser);
    setText(documentRef, "averageHoldTime", formatDuration(trade.averageHoldTimeSeconds));
    setText(documentRef, "openPositions", formatCount(trade.openPositions));
    setText(documentRef, "closedPositions", formatCount(trade.closedPositions));
    setText(documentRef, "closedTrades", formatCount(trade.closedTrades));
    setText(documentRef, "decisionCount", formatCount(data.aiPerformance.decisionCount));
    setText(documentRef, "portfolioGrowth", formatPercent(portfolio.growthPercent), portfolio.growthPercent);
    setText(
      documentRef,
      "best-confidence",
      data.aiPerformance.bestConfidenceRange
        ? `${data.aiPerformance.bestConfidenceRange.label} (${formatPercent(data.aiPerformance.bestConfidenceRange.winRate)} win rate)`
        : "Insufficient scored outcomes"
    );
    setText(
      documentRef,
      "worst-confidence",
      data.aiPerformance.worstConfidenceRange
        ? `${data.aiPerformance.worstConfidenceRange.label} (${formatPercent(data.aiPerformance.worstConfidenceRange.winRate)} win rate)`
        : "Insufficient scored outcomes"
    );
    setText(documentRef, "below-70", formatCount(data.aiPerformance.below70Count));
    renderConfidenceTable(documentRef, data.aiPerformance.confidenceBuckets);
    renderActionTable(documentRef, data.aiPerformance.actions);
    renderStrategyTable(documentRef, data.aiPerformance.strategies);
    renderSymbolTable(documentRef, trade.bestSymbols, trade.worstSymbols);
    renderPerformanceTable(documentRef, "daily", portfolio.dailyPerformance || [], 7);
    renderPerformanceTable(documentRef, "weekly", portfolio.weeklyPerformance || [], 4);
    renderPerformanceTable(documentRef, "monthly", portfolio.monthlyPerformance || [], 4);

    const charts = new Map(existingCharts);
    charts.set("equity", renderChart(
      documentRef,
      "equity",
      portfolio.equityCurve,
      ChartConstructor,
      charts.get("equity")
    ));
    charts.set("drawdown", renderChart(
      documentRef,
      "drawdown",
      portfolio.drawdownHistory,
      ChartConstructor,
      charts.get("drawdown")
    ));
    renderDataQuality(documentRef, data.dataQuality);
    const updated = documentRef.querySelector("[data-analytics-updated]");
    if (updated) {
      updated.textContent = `Updated ${formatTimestamp(data.generatedAt)} · ${periodLabels.get(data.period) || periodLabels.get("30d")}`;
    }
    return charts;
  }

  function renderConfidenceTable(documentRef, buckets) {
    const rows = buckets.map((bucket) => [
      bucket.label,
      formatCount(bucket.decisionCount),
      formatCount(bucket.scoredCount),
      formatPercent(bucket.winRate),
      colorCurrency(bucket.averagePnl),
      colorCurrency(bucket.netPnl)
    ]);
    renderTable(documentRef, "[data-analytics-confidence]", rows);
  }

  function renderActionTable(documentRef, actions) {
    const rows = ["BUY", "SELL", "HOLD"].map((action) => {
      const group = actions[action];
      return [
        { tradeAction: action },
        formatCount(group.decisionCount),
        formatCount(group.scoredCount),
        formatCount(group.unscoredCount),
        formatPercent(group.winRate),
        colorCurrency(group.netPnl)
      ];
    });
    renderTable(documentRef, "[data-analytics-actions]", rows);
  }

  function renderStrategyTable(documentRef, strategies) {
    const rows = (strategies || []).map((strategy) => [
      strategy.label,
      formatCount(strategy.decisionCount),
      formatCount(strategy.scoredCount),
      formatPercent(strategy.winRate),
      colorCurrency(strategy.netPnl)
    ]);
    renderTable(documentRef, "[data-analytics-strategies]", rows);
    setHidden(documentRef, "[data-analytics-strategies-empty]", rows.length > 0);
  }

  function renderSymbolTable(documentRef, bestSymbols, worstSymbols) {
    const symbols = new Map();
    for (const symbol of [...(bestSymbols || []), ...(worstSymbols || [])]) {
      symbols.set(symbol.symbol, symbol);
    }
    const rows = [...symbols.values()].map((symbol) => [
      { marketSymbol: symbol.symbol },
      formatCount(symbol.closedTrades),
      formatPercent(symbol.winRate),
      colorCurrency(symbol.realizedPnl)
    ]);
    renderTable(documentRef, "[data-analytics-symbols]", rows);
    setHidden(documentRef, "[data-analytics-symbols-empty]", rows.length > 0);
  }

  function renderPerformanceTable(documentRef, period, points, visibleCount) {
    const recent = points.slice(-visibleCount).reverse();
    const rows = recent.map((point) => [
      point.period,
      colorCurrency(point.pnl),
      formatCurrency(point.portfolioValue)
    ]);
    renderTable(documentRef, `[data-analytics-period="${period}"]`, rows);
    setHidden(documentRef, `[data-analytics-period-empty="${period}"]`, rows.length > 0);
  }

  function renderTable(documentRef, selector, rows) {
    const body = documentRef.querySelector(selector);
    if (!body) {
      return;
    }
    body.replaceChildren();
    for (const values of rows) {
      const row = documentRef.createElement("tr");
      for (const value of values) {
        const cell = documentRef.createElement("td");
        const isColoredValue = value && typeof value === "object"
          && Object.prototype.hasOwnProperty.call(value, "toneValue");
        const isMarketSymbol = value && typeof value === "object"
          && Object.prototype.hasOwnProperty.call(value, "marketSymbol");
        const isTradeAction = value && typeof value === "object"
          && Object.prototype.hasOwnProperty.call(value, "tradeAction");
        if (isMarketSymbol) {
          cell.append(formatters.createMarketSymbol(documentRef, value.marketSymbol));
        } else if (isTradeAction) {
          cell.append(formatters.createTradeActionLabel(documentRef, value.tradeAction));
        } else {
          cell.textContent = isColoredValue ? value.text : value;
        }
        if (isColoredValue) {
          formatters.setValueTone(cell, value.toneValue);
        }
        row.append(cell);
      }
      body.append(row);
    }
  }

  function renderChart(documentRef, type, points, ChartConstructor, previousChart) {
    const canvas = documentRef.querySelector(`[data-analytics-chart="${type}"]`);
    const emptyState = documentRef.querySelector(`[data-analytics-chart-empty="${type}"]`);
    previousChart?.destroy?.();
    if (!Array.isArray(points) || points.length === 0) {
      if (canvas) {
        canvas.hidden = true;
      }
      if (emptyState) {
        emptyState.hidden = false;
        emptyState.textContent = type === "equity"
          ? "Portfolio history will appear after the first snapshot."
          : "Drawdown history will appear after the first snapshot.";
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
    const context = canvas.getContext("2d");
    if (!context) {
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
    const isEquity = type === "equity";
    try {
      return new ChartConstructor(context, {
        type: "line",
        data: {
          labels: points.map((point) => point.period),
          datasets: [{
            data: points.map((point) => isEquity ? point.portfolioValue : point.drawdownPercent),
            borderColor: isEquity ? "#5b9cff" : "#ff6078",
            backgroundColor: isEquity ? "rgb(91 156 255 / 14%)" : "rgb(255 96 120 / 12%)",
            fill: true,
            tension: 0.25,
            pointRadius: points.length > 90 ? 0 : 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: { legend: { display: false } },
          scales: {
            x: {
              grid: { color: "rgb(255 255 255 / 5%)" },
              ticks: { color: "#9ca8ba", maxTicksLimit: 8 }
            },
            y: {
              grid: { color: "rgb(255 255 255 / 7%)" },
              ticks: {
                color: "#9ca8ba",
                callback: (value) => isEquity ? formatCurrency(value) : `${formatNumber(value)}%`
              }
            }
          }
        }
      });
    } catch {
      canvas.hidden = true;
      if (emptyState) {
        emptyState.hidden = false;
        emptyState.textContent = "The portfolio chart is currently unavailable.";
      }
      return null;
    }
  }

  function renderDataQuality(documentRef, dataQuality) {
    const element = documentRef.querySelector("[data-analytics-data-quality]");
    if (!element || !dataQuality) {
      return;
    }
    const issues = Object.entries(dataQuality)
      .filter(([, count]) => Number.isSafeInteger(count) && count > 0)
      .map(([name, count]) => `${formatCount(count)} ${name.replaceAll(/([A-Z])/g, " $1").toLowerCase()}`);
    element.textContent = issues.length
      ? `Data quality notice: ${issues.join(", ")} were found. Some decision or hold-time outcomes may be unscored.`
      : "";
    element.hidden = issues.length === 0;
  }

  function startAnalytics({
    windowRef = window,
    documentRef = document,
    fetchImpl = windowRef.fetch.bind(windowRef),
    ChartConstructor = windowRef.Chart
  } = {}) {
    if (!documentRef.querySelector("[data-analytics-page]")) {
      return () => {};
    }

    const loading = documentRef.querySelector("[data-analytics-loading]");
    const error = documentRef.querySelector("[data-analytics-error]");
    const retry = documentRef.querySelector("[data-analytics-retry]");
    const periodSelect = documentRef.querySelector("[data-analytics-range]");
    let charts = new Map();
    let activeLoad = null;
    let activePeriod = null;
    let requestSequence = 0;
    let disposed = false;

    const refresh = () => {
      if (disposed) {
        return Promise.resolve();
      }
      const period = periodSelect?.value || "30d";
      if (!supportedPeriods.has(period)) {
        if (error) {
          error.textContent = "Select a valid analytics date range.";
          error.hidden = false;
        }
        return Promise.resolve();
      }
      if (activeLoad && activePeriod === period) {
        return activeLoad;
      }
      const currentSequence = ++requestSequence;
      activePeriod = period;
      if (loading) {
        loading.hidden = false;
      }
      if (retry) {
        retry.hidden = true;
      }
      if (error) {
        error.hidden = true;
        error.textContent = "";
      }
      const currentLoad = requestAnalytics(fetchImpl, period)
        .then((data) => {
          if (!disposed && currentSequence === requestSequence) {
            charts = renderAnalytics(data, documentRef, ChartConstructor, charts);
          }
        })
        .catch((requestError) => {
          if (disposed || currentSequence !== requestSequence) {
            return;
          }
          if (requestError.status === 401 && typeof windowRef.location?.assign === "function") {
            windowRef.location.assign("/login.html?next=%2Fanalytics.html");
            return;
          }
          if (error) {
            error.textContent = "Analytics data could not be loaded. Please try again.";
            error.hidden = false;
          }
          if (retry) {
            retry.hidden = false;
          }
        })
        .finally(() => {
          if (currentSequence === requestSequence) {
            if (loading) {
              loading.hidden = true;
            }
            activeLoad = null;
            activePeriod = null;
          }
        });
      activeLoad = currentLoad;
      return currentLoad;
    };

    const cleanup = () => {
      if (disposed) {
        return;
      }
      disposed = true;
      retry?.removeEventListener("click", refresh);
      periodSelect?.removeEventListener("change", refresh);
      windowRef.removeEventListener?.("pagehide", cleanup);
      for (const chart of charts.values()) {
        chart?.destroy?.();
      }
      charts.clear();
    };
    retry?.addEventListener("click", refresh);
    periodSelect?.addEventListener("change", refresh);
    windowRef.addEventListener?.("pagehide", cleanup, { once: true });
    void refresh();
    return cleanup;
  }

  function setText(documentRef, name, value, toneValue) {
    const element = documentRef.querySelector(`[data-analytics-value="${name}"]`);
    if (element) {
      element.textContent = value;
      if (arguments.length > 3) {
        formatters.setValueTone(element, toneValue);
      }
    }
  }

  function setTradeText(documentRef, name, trade) {
    const target = documentRef.querySelector(`[data-analytics-value="${name}"]`);
    if (!target) {
      return;
    }
    if (!trade || typeof trade.realizedPnl !== "number") {
      target.textContent = "—";
      return;
    }
    const symbol = typeof trade.symbol === "string" && trade.symbol
      ? trade.symbol
      : "—";
    formatters.setMarketSymbolText(
      documentRef,
      target,
      `${formatCurrency(trade.realizedPnl)} · ${symbol}`,
      trade.symbol
    );
    formatters.setValueTone(target, trade.realizedPnl);
  }

  function setHidden(documentRef, selector, hasContent) {
    const element = documentRef.querySelector(selector);
    if (element) {
      element.hidden = hasContent;
    }
  }

  function formatCurrency(value) {
    return typeof value === "number" && Number.isFinite(value)
      ? currencyFormat.format(value)
      : "—";
  }

  function colorCurrency(value) {
    return { text: formatCurrency(value), toneValue: value };
  }

  function formatPercent(value) {
    return typeof value === "number" && Number.isFinite(value)
      ? `${numberFormat.format(value)}%`
      : "—";
  }

  function formatNumber(value) {
    return typeof value === "number" && Number.isFinite(value)
      ? numberFormat.format(value)
      : "—";
  }

  function formatCount(value) {
    return Number.isSafeInteger(value) && value >= 0
      ? countFormat.format(value)
      : "—";
  }

  function formatDuration(seconds) {
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
      return "—";
    }
    const totalMinutes = Math.round(seconds / 60);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    return [
      days ? `${days}d` : "",
      hours ? `${hours}h` : "",
      `${minutes}m`
    ].filter(Boolean).join(" ");
  }

  function formatTimestamp(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? timestampFormat.format(date) : "—";
  }

  return {
    formatDuration,
    renderAnalytics,
    requestAnalytics,
    startAnalytics
  };
});
