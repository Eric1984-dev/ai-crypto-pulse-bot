const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
require("./helpers/runtime-api.js");
const dashboard = require("../js/dashboard.js");

const rootDirectory = path.resolve(__dirname, "..");
const generatedAt = new Date("2026-03-20T12:00:00.000Z");

function createElement() {
  const styleProperties = new Map();
  return {
    textContent: "",
    hidden: false,
    disabled: false,
    dataset: {},
    style: {
      setProperty(name, value) {
        styleProperties.set(name, value);
      },
      getPropertyValue(name) {
        return styleProperties.get(name) || "";
      },
      removeProperty(name) {
        styleProperties.delete(name);
      }
    },
    children: [],
    listeners: {},
    classList: { contains: () => false },
    getBoundingClientRect() {
      if (!this.parentNode) {
        return { top: 100, bottom: 100 };
      }
      const index = this.parentNode.children.indexOf(this);
      const itemHeight = this.className === "position-ai-status-card" ? 80 : 40;
      const gap = Number(this.parentNode.dataset.mockRowGap || 0);
      const top = 100 + index * (itemHeight + gap) - (this.parentNode.scrollTop || 0);
      return { top, bottom: top + itemHeight };
    },
    replaceChildren() {
      this.children = [];
      this.textContent = "";
    },
    append(...children) {
      for (const child of children) {
        if (typeof child !== "string" && child) {
          child.parentNode = this;
        }
      }
      this.children.push(...children);
      this.textContent += children.map((child) => (
        typeof child === "string" ? child : child && child.textContent || ""
      )).join("");
    },
    addEventListener(name, callback) {
      this.listeners[name] = callback;
    },
    setAttribute(name, value) {
      this.attributes = this.attributes || {};
      this.attributes[name] = value;
    },
    getContext() {
      return {};
    }
  };
}

function createDashboardDocument() {
  const selectors = [
    "[data-dashboard-value=\"portfolioValue\"]",
    "[data-dashboard-value=\"totalPnl\"]",
    "[data-dashboard-value=\"realizedPnl\"]",
    "[data-dashboard-value=\"unrealizedPnl\"]",
    "[data-dashboard-value=\"dailyPnl\"]",
    "[data-dashboard-value=\"winRate\"]",
    "[data-dashboard-value=\"openPositions\"]",
    "[data-dashboard-value=\"openPositionAiStatus\"]",
    "[data-dashboard-value=\"availableBalance\"]",
    "[data-dashboard-value=\"aiDecisions\"]",
    "[data-dashboard-value=\"paperTrades\"]",
    "[data-dashboard-value=\"trackedMarkets\"]",
    "[data-dashboard-value=\"portfolioCount\"]",
    "[data-dashboard-activity=\"bot-run\"]",
    "[data-dashboard-activity=\"market-data\"]",
    "[data-dashboard-activity=\"paper-trade\"]",
    "[data-dashboard-status=\"agent\"]",
    "[data-dashboard-status=\"emergency\"]",
    "[data-archive-health=\"server\"]",
    "[data-archive-health=\"model\"]",
    "[data-archive-health=\"postgresql\"]",
    "[data-archive-health=\"database\"]",
    "[data-archive-health=\"disk-usage\"]",
    "[data-archive-health=\"database-size\"]",
    "[data-archive-health=\"last-check\"]",
    "[data-archive-health-meter]",
    "[data-dashboard-list=\"positions\"]",
    "[data-dashboard-list=\"trades\"]",
    "[data-dashboard-list=\"position-ai-status\"]",
    "[data-shadow-exit-list]",
    "[data-shadow-exit-status]",
    "[data-shadow-exit-empty]",
    "[data-dashboard-empty=\"positions\"]",
    "[data-dashboard-empty=\"trades\"]",
    "[data-dashboard-empty=\"position-ai-status\"]",
    "[data-portfolio-chart]",
    "[data-dashboard-chart-empty]",
    "[data-dashboard-loading]",
    "[data-dashboard-error]",
    "[data-dashboard-retry]",
    "[data-agent-brain]",
    "[data-agent-brain-stage]",
    "[data-agent-brain-fallback]"
  ];
  const elements = new Map(selectors.map((selector) => [selector, [createElement()]]));
  elements.set("[data-dashboard-value=\"openPositions\"]", [createElement(), createElement()]);
  elements.set("[data-dashboard-value=\"paperTrades\"]", [createElement(), createElement()]);
  elements.set("[data-dashboard-value=\"trackedMarkets\"]", [createElement(), createElement()]);
  elements.set("[data-dashboard-value=\"aiDecisions\"]", [createElement(), createElement()]);
  const dashboardDocument = {
    body: { dataset: { authPage: "protected" } },
    visibilityState: "visible",
    documentElement: { classList: { contains: () => false } },
    listeners: {},
    querySelector(selector) {
      return (elements.get(selector) || [])[0] || null;
    },
    querySelectorAll(selector) {
      return elements.get(selector) || [];
    },
    addEventListener(name, callback) {
      this.listeners[name] = callback;
    },
    removeEventListener(name) {
      delete this.listeners[name];
    },
    createElement() {
      return createElement();
    }
  };
  return { dashboardDocument, elements };
}

test("dashboard distinguishes offline services from unavailable monitoring data", () => {
  const { dashboardDocument, elements } = createDashboardDocument();
  const health = {
    server: "online",
    postgresql: "online",
    database: "online",
    diskUsage: 12.5,
    databaseSize: "<b>2.3 GB</b>",
    lastHealthCheck: "2026-11-06T12:00:00.000Z",
    system: { model: "Raspberry Pi 5 Model B Rev 1.0" }
  };
  dashboard.renderArchiveHealth(health, dashboardDocument);

  assert.equal(elements.get("[data-archive-health=\"model\"]")[0].textContent, "Raspberry Pi 5 Model B Rev 1.0");
  assert.equal(elements.get("[data-archive-health=\"server\"]")[0].textContent, "Online");
  assert.equal(elements.get("[data-archive-health=\"server\"]")[0].dataset.state, "online");
  assert.equal(elements.get("[data-archive-health=\"postgresql\"]")[0].textContent, "Online");
  assert.equal(elements.get("[data-archive-health=\"database\"]")[0].textContent, "Online");
  assert.equal(elements.get("[data-archive-health=\"disk-usage\"]")[0].textContent, "12.5%");
  assert.equal(elements.get("[data-archive-health-meter]")[0].value, 12.5);
  assert.equal(elements.get("[data-archive-health=\"database-size\"]")[0].textContent, "<b>2.3 GB</b>");
  assert.match(elements.get("[data-archive-health=\"last-check\"]")[0].textContent, /2026/);

  dashboard.renderArchiveHealth(health, dashboardDocument, { unavailable: true });
  assert.equal(elements.get("[data-archive-health=\"server\"]")[0].textContent, "Unknown");
  assert.equal(elements.get("[data-archive-health=\"server\"]")[0].dataset.state, "unknown");
  assert.equal(elements.get("[data-archive-health=\"disk-usage\"]")[0].textContent, "12.5%");
  assert.match(elements.get("[data-archive-health=\"last-check\"]")[0].textContent, /Unavailable · last success/);

  dashboard.renderArchiveHealth(null, dashboardDocument);
  assert.equal(elements.get("[data-archive-health=\"server\"]")[0].textContent, "Unknown");
  assert.equal(elements.get("[data-archive-health=\"server\"]")[0].dataset.state, "unknown");
  assert.equal(elements.get("[data-archive-health=\"postgresql\"]")[0].textContent, "Unknown");
  assert.equal(elements.get("[data-archive-health=\"database\"]")[0].textContent, "Unknown");
  assert.equal(elements.get("[data-archive-health=\"model\"]")[0].textContent, "—");
  assert.equal(elements.get("[data-archive-health=\"disk-usage\"]")[0].textContent, "—");
  assert.equal(elements.get("[data-archive-health-meter]")[0].hidden, true);
  assert.equal(elements.get("[data-archive-health=\"database-size\"]")[0].textContent, "—");
  assert.equal(elements.get("[data-archive-health=\"last-check\"]")[0].textContent, "—");
});

test("dashboard renders database summaries, recent lists, and an actual-snapshot chart", () => {
  const { dashboardDocument, elements } = createDashboardDocument();
  let chartConfig;
  class FakeChart {
    constructor(context, config) {
      assert.ok(context);
      chartConfig = config;
    }
  }
  const data = {
    agentStatus: { status: "ANALYZING", last_run: "2026-03-20T11:55:00.000Z" },
    lastMarketDataAt: "2026-03-20T11:59:00.000Z",
    emergencyState: { status: "PAUSED" },
    portfolio: {
      count: 1,
      portfolioValue: 1100,
      totalPnl: 100,
      realizedPnl: 20,
      unrealizedPnl: 100,
      dailyPnl: 20,
      availableBalance: 800,
      winRate: 50
    },
    openPositions: {
      count: 2,
      items: [
        {
          symbol: "<img src=x>",
          amount: 0.01,
          entry_price: 0.00453954,
          current_price: 0.05671234,
          unrealized_pnl: 100,
          created_at: "2026-03-20T10:00:00.000Z"
        },
        {
          symbol: "BEAM-EUR",
          amount: 220837,
          entry_price: 0.00454,
          current_price: 0.00397,
          unrealized_pnl: -125.78,
          created_at: "2026-03-20T09:00:00.000Z"
        }
      ]
    },
    openPositionAiStatus: {
      count: 2,
      items: [
        {
          symbol: "BEAM-EUR",
          amount: 1000,
          entry_price: 1,
          current_price: 0.87422,
          current_market_price: 0.87422,
          unrealized_pnl: -125.78,
          latestAiDecision: {
            decision: "HOLD",
            confidence: 55.55,
            marketStrength: -7.59,
            created_at: "2026-03-20T11:01:00.000Z"
          }
        },
        {
          symbol: "WIN-EUR",
          amount: 1000,
          entry_price: 1,
          current_price: 1.03452,
          current_market_price: 1.03452,
          unrealized_pnl: 34.52,
          latestAiDecision: null
        }
      ]
    },
    recentTrades: {
      count: 3,
      items: [
        {
          side: "SELL",
          symbol: "BTC-EUR",
          quantity: 1,
          price: 1124,
          fees: 2.81,
          realized_pnl: 118.69,
          created_at: generatedAt.toISOString()
        },
        {
          side: "BUY",
          symbol: "WIN-EUR",
          quantity: "16348102.95927201",
          price: "0.000061",
          created_at: generatedAt,
          openPosition: {
            amount: "16348102.95927201",
            entry_price: "0.00006123",
            current_market_price: "0.000067"
          }
        },
        {
          side: "SELL",
          symbol: "BEAM-EUR",
          quantity: 220837,
          price: 0.00397,
          fees: 0.22,
          realized_pnl: -125.78,
          created_at: generatedAt.toISOString()
        }
      ]
    },
    watchedMarkets: { count: 1, items: [{ symbol: "BTC-EUR", priority: 1 }] },
    aiDecisions: {
      count: 1,
      items: [{
        decision: "HOLD",
        symbol: "BTC-EUR",
        confidence: 80,
        reason: "No action.",
        created_at: generatedAt.toISOString()
      }]
    },
    portfolioSnapshots: [
      { portfolio_id: "portfolio-1", portfolio_value: "1100", captured_at: "2026-03-20T11:00:00.000Z" },
      { portfolio_id: "portfolio-1", portfolio_value: "1050", captured_at: "2026-03-20T10:00:00.000Z" }
    ]
  };

  data.portfolio.totalPnl = -25;
  dashboard.renderDashboard(data, dashboardDocument, FakeChart);

  assert.match(elements.get("[data-dashboard-value=\"portfolioValue\"]")[0].textContent, /1,100/);
  assert.equal(elements.get("[data-dashboard-value=\"totalPnl\"]")[0].dataset.valueTone, "negative");
  assert.equal(elements.get("[data-dashboard-value=\"openPositions\"]")[0].textContent, "2");
  assert.equal(elements.get("[data-dashboard-value=\"openPositions\"]")[1].textContent, "2");
  assert.equal(elements.get("[data-dashboard-status=\"agent\"]")[0].textContent, "ANALYZING");
  assert.equal(elements.get("[data-dashboard-status=\"emergency\"]")[0].dataset.state, "paused");
  assert.equal(elements.get("[data-dashboard-activity=\"bot-run\"]")[0].textContent, "20/03/2026, 12:55");
  assert.equal(elements.get("[data-dashboard-activity=\"market-data\"]")[0].textContent, "20/03/2026, 12:59");
  assert.equal(elements.get("[data-dashboard-activity=\"paper-trade\"]")[0].textContent, "20/03/2026, 13:00");
  assert.equal(elements.get("[data-dashboard-list=\"positions\"]")[0].children[0].children[0].textContent, "<img src=x> · 0.01 units");
  assert.equal(
    elements.get("[data-dashboard-list=\"positions\"]")[0].children[0].children[0].children[1].className,
    "market-symbol"
  );
  assert.match(
    elements.get("[data-dashboard-list=\"positions\"]")[0].children[0].children[1].textContent,
    /Entry €\s?0\.00454 · Current €\s?0\.05671 · P&L €\s?100\.00 · Opened .*11:00/
  );
  assert.ok(elements.get("[data-dashboard-list=\"positions\"]")[0].children[0].children[1].children.some((child) => (
    child && child.dataset && child.dataset.valueTone === "positive"
      && child.textContent === "P&L €100.00"
  )));
  assert.ok(elements.get("[data-dashboard-list=\"positions\"]")[0].children[1].children[1].children.some((child) => (
    child && child.dataset && child.dataset.valueTone === "negative"
      && child.textContent === "P&L -€125.78"
  )));
  assert.match(
    elements.get("[data-dashboard-list=\"trades\"]")[0].children[0].children[1].textContent,
    /SELL · Quantity: 1.*Exit: €\s?1,124\.00.*\+€118\.69 \(\+11\.84%\).*13:00.*Status: CLOSED/s
  );
  assert.equal(
    elements.get("[data-dashboard-list=\"trades\"]")[0].children[0].children[1].children[1].className,
    "trade-action-sell"
  );
  assert.equal(
    elements.get("[data-dashboard-list=\"trades\"]")[0].children[1].children[0].textContent,
    "WIN-EUR"
  );
  assert.match(
    elements.get("[data-dashboard-list=\"trades\"]")[0].children[1].children[1].textContent,
    /BUY · Quantity: 16\.35M.*Entry: €\s?0\.00006123.*Current: €\s?0\.000067.*P&L: \+€.*\(\+9\.42%\).*Status: OPEN/s
  );
  assert.equal(
    elements.get("[data-dashboard-list=\"trades\"]")[0].children[1].children[1].children[1].className,
    "trade-action-buy"
  );
  assert.ok(elements.get("[data-dashboard-list=\"trades\"]")[0].children[2].children[1].children.some((child) => (
    child && child.dataset && child.dataset.valueTone === "negative"
      && child.textContent.startsWith("P&L: -€125.78")
  )));
  assert.equal(elements.get("[data-dashboard-value=\"openPositionAiStatus\"]")[0].textContent, "2");
  const statusCards = elements.get("[data-dashboard-list=\"position-ai-status\"]")[0].children;
  assert.equal(statusCards.length, 2);
  assert.match(statusCards[0].textContent, /BEAM-EUR.*DecisionHOLD.*Market ViewNeutral.*AI CommentaryNo strong bullish or bearish trend detected\..*Current Unrealized P&L-€125\.78 \(-12\.58%\).*Updated20\/03\/2026, 12:01/s);
  assert.equal(statusCards[0].children[1].children[3].children[1].dataset.valueTone, "negative");
  assert.doesNotMatch(statusCards[0].textContent, /Confidence|55\.55|-7\.59/);
  assert.match(statusCards[1].textContent, /WIN-EUR.*DecisionNo decision.*Market ViewUnavailable.*AI CommentaryNo recent AI decision is available for this market\..*Current Unrealized P&L\+€34\.52 \(\+3\.45%\).*Updated—/s);
  assert.equal(elements.get("[data-dashboard-list=\"positions\"]")[0].hidden, false);
  assert.equal(elements.get("[data-dashboard-empty=\"positions\"]")[0].hidden, true);
  assert.equal(elements.get("[data-dashboard-value=\"trackedMarkets\"]")[0].textContent, "1");
  assert.equal(elements.has("[data-dashboard-list=\"markets\"]"), false);
  assert.equal(elements.get("[data-portfolio-chart]")[0].hidden, false);
  assert.deepEqual(chartConfig.data.datasets[0].data, [1050, 1100]);
  assert.ok(chartConfig.data.labels.some((label) => label.endsWith("12:00")));
});

test("dashboard displays prospective shadow rule outcomes separately from actual P&L", () => {
  const { dashboardDocument, elements } = createDashboardDocument();
  const data = dashboard.emptyDashboardData();
  data.portfolio.totalPnl = 12.34;
  data.shadowExitScenarios = {
    status: "AVAILABLE",
    positions: [
      {
        positionId: "open-position",
        symbol: "BTC-EUR",
        positionOpenedAt: "2026-03-20T10:00:00.000Z",
        isOpen: true,
        scenarios: [
          {
            rule_id: "fixed_tp_5",
            rule_name: "Fixed take-profit · +5%",
            rule_version: "1.0.0",
            parameters: { targetGainPct: 5 },
            status: "TRIGGERED",
            tracking_started_at: "2026-03-20T10:01:00.000Z",
            triggered_at: "2026-03-20T10:20:00.000Z",
            trigger_mark: 95,
            modeled_net_pnl: 4.25,
            data_quality_status: "FRESH",
            events: [{
              event_type: "HYPOTHETICAL_TRIGGERED",
              event_at: "2026-03-20T10:20:00.000Z",
              observed_mark: 95,
              data_quality_status: "FRESH",
              error_code: null
            }]
          },
          {
            rule_id: "trailing_stop_5",
            rule_name: "Trailing stop · arm +5%, retrace 5%",
            rule_version: "1.0.0",
            parameters: { armGainPct: 5, drawdownPct: 5 },
            status: "TRACKING",
            tracking_started_at: "2026-03-20T10:01:00.000Z",
            last_mark: 94,
            last_mark_captured_at: "2026-03-20T10:19:00.000Z",
            data_quality_status: "STALE",
            events: []
          }
        ]
      },
      {
        positionId: "closed-position",
        symbol: "ETH-EUR",
        positionOpenedAt: "2026-03-19T10:00:00.000Z",
        isOpen: false,
        actualClosedAt: "2026-03-20T09:30:00.000Z",
        actualClosePrice: 2100,
        actualNetPnl: -8.5,
        scenarios: [{
          rule_id: "fixed_tp_5",
          rule_name: "Fixed take-profit · +5%",
          rule_version: "1.0.0",
          parameters: { targetGainPct: 5 },
          status: "CLOSED_WITHOUT_TRIGGER",
          tracking_started_at: "2026-03-19T10:01:00.000Z",
          modeled_net_pnl: null,
          data_quality_status: "FRESH"
        }]
      }
    ]
  };

  dashboard.renderDashboard(data, dashboardDocument, null);

  const positionCards = elements.get("[data-shadow-exit-list]")[0].children;
  assert.equal(positionCards.length, 2);
  assert.match(positionCards[0].textContent, /Fixed take-profit · \+5%.*Triggered hypothetically · no trade placed.*\+€4\.25/);
  assert.match(positionCards[0].textContent, /Hypothetical exit triggered.*Observed mark €95\.00/);
  assert.match(positionCards[0].textContent, /last valid state retained.*€94\.00/);
  assert.match(positionCards[1].textContent, /Actual close time.*Actual SELL execution price.*Actual net P&L.*-€8\.50/);
  assert.equal(
    positionCards[1].children[0].children[1].children[3].children[1].dataset.valueTone,
    "negative"
  );
  assert.match(positionCards[1].textContent, /Closed without trigger/);
  assert.equal(data.portfolio.totalPnl, 12.34);
  assert.match(elements.get("[data-dashboard-value=\"totalPnl\"]")[0].textContent, /12\.34/);
});

test("dashboard reports unavailable shadow data without hiding actual portfolio content", () => {
  const { dashboardDocument, elements } = createDashboardDocument();
  const data = dashboard.emptyDashboardData();
  data.portfolio.portfolioValue = 10000;
  data.shadowExitScenarios = { status: "UNAVAILABLE", positions: [] };

  dashboard.renderDashboard(data, dashboardDocument, null);

  assert.equal(elements.get("[data-shadow-exit-status]")[0].hidden, false);
  assert.match(
    elements.get("[data-shadow-exit-status]")[0].textContent,
    /Actual trading and portfolio data are unaffected\./i
  );
  assert.equal(elements.get("[data-shadow-exit-list]")[0].hidden, true);
  assert.match(elements.get("[data-dashboard-value=\"portfolioValue\"]")[0].textContent, /10,000/);
});

test("dashboard maps market-strength boundaries to the requested market views", () => {
  const { dashboardDocument, elements } = createDashboardDocument();
  const strengths = [-40, -39.99, -20, -19.99, 19.99, 20, 39.99, 40];
  const expectedViews = [
    "Strong Bearish",
    "Bearish",
    "Bearish",
    "Neutral",
    "Neutral",
    "Bullish",
    "Bullish",
    "Strong Bullish"
  ];

  dashboard.renderDashboard({
    openPositionAiStatus: {
      count: strengths.length,
      items: strengths.map((marketStrength, index) => ({
        symbol: `TEST${index}-EUR`,
        amount: 1,
        entry_price: 1,
        current_price: 1,
        unrealized_pnl: 0,
        latestAiDecision: {
          decision: "HOLD",
          confidence: 50,
          marketStrength,
          created_at: generatedAt.toISOString()
        }
      }))
    }
  }, dashboardDocument, null);

  const cards = elements.get("[data-dashboard-list=\"position-ai-status\"]")[0].children;
  assert.deepEqual(cards.map((card) => (
    card.children[1].children[1].children[1].textContent
  )), expectedViews);
});

test("dashboard AI commentary is short, decision-aware, and adapts HOLD to market view", () => {
  const { dashboardDocument, elements } = createDashboardDocument();
  const cases = [
    ["BUY", 40, "Bullish trend detected. AI currently favors upward continuation."],
    ["SELL", -40, "Bearish trend detected. Downside risk currently outweighs upside potential."],
    ["WAIT", null, "Insufficient or unreliable data. AI is waiting for better market conditions."],
    ["HOLD", 0, "No strong bullish or bearish trend detected."],
    ["HOLD", 20, "Bullish conditions are present, but the AI currently recommends holding."],
    ["HOLD", -20, "Bearish pressure is present, but the AI currently recommends holding."],
    ["HOLD", null, "Market conditions are unavailable; the AI currently recommends holding."]
  ];

  dashboard.renderDashboard({
    openPositionAiStatus: {
      count: cases.length,
      items: cases.map(([decision, marketStrength], index) => ({
        symbol: `TEST${index}-EUR`,
        amount: 1,
        entry_price: 1,
        current_market_price: 1,
        latestAiDecision: {
          decision,
          confidence: 83.25,
          marketStrength
        }
      }))
    }
  }, dashboardDocument, null);

  const cards = elements.get("[data-dashboard-list=\"position-ai-status\"]")[0].children;
  assert.deepEqual(cards.map((card) => card.children[1].children[2].children[1].textContent), (
    cases.map(([, , commentary]) => commentary)
  ));
  for (const card of cards) {
    assert.doesNotMatch(card.textContent, /Confidence|83\.25|Market Strength|(?:^|\s)(?:40|-40|20|-20)(?:\s|$)/);
  }
});

test("dashboard omits all scanner content and uses only its watched-market summary", () => {
  const html = fs.readFileSync(path.join(rootDirectory, "dashboard.html"), "utf8");
  const script = fs.readFileSync(path.join(rootDirectory, "js", "dashboard.js"), "utf8");

  assert.doesNotMatch(html, /Top Gainers|Top Losers|Highest Volume|Strongest Momentum|AI Opportunities|scanner-preview/i);
  assert.doesNotMatch(script, /market-summary|scanner-gainers|scanner-opportunities/i);
  assert.match(html, /href="\/scanner\.html"/);
  assert.match(html, /Portfolio history/);
  assert.match(html, /data-portfolio-chart/);
});

test("infrastructure monitoring uses the Raspberry Pi label", () => {
  const html = fs.readFileSync(path.join(rootDirectory, "dashboard.html"), "utf8");

  assert.match(html, /<h2 id="archive-health-heading">Raspberry Pi<\/h2>/);
  assert.ok(html.indexOf('data-archive-health="model"') < html.indexOf('data-archive-health="server"'));
  assert.match(html, /aria-label="Raspberry Pi disk usage"/);
  assert.doesNotMatch(html, />Archive Server<\/h2>|aria-label="Archive server disk usage"/);
});

test("Agent Status spans the dashboard while Risk Control sits beside Position Monitoring", () => {
  const html = fs.readFileSync(path.join(rootDirectory, "dashboard.html"), "utf8");
  const styles = fs.readFileSync(path.join(rootDirectory, "css", "styles.css"), "utf8");
  const statusPanel = html.indexOf('class="dashboard-panel status-panel"');
  const agentStatus = html.indexOf("<h2>Agent Status</h2>", statusPanel);
  const brain = html.indexOf('data-agent-brain-stage', agentStatus);
  const portfolioChart = html.indexOf('class="dashboard-panel chart-panel"');
  const portfolioSummary = html.indexOf('id="summary-heading"');
  const summaries = html.match(
    /<section class="dashboard-grid dashboard-grid-lists"[^>]*>([\s\S]*?)<\/section>/
  );
  const riskControl = summaries && summaries[1].indexOf('class="dashboard-panel emergency-panel"');
  const positionMonitoring = summaries && summaries[1].indexOf('data-dashboard-list="position-ai-status"');

  assert.ok(statusPanel >= 0);
  assert.ok(agentStatus > statusPanel);
  assert.ok(brain > agentStatus && brain < portfolioChart);
  assert.ok(summaries);
  assert.ok(positionMonitoring >= 0 && riskControl > positionMonitoring);
  assert.doesNotMatch(html, /dashboard-grid-risk/);
  assert.ok(portfolioSummary < statusPanel);
  assert.match(html, /class="agent-status-monitor"[\s\S]*Live backend signal[\s\S]*status-wave/);
  assert.match(html, /Agent circuit visualization; status UNKNOWN/);
  assert.match(html, /Circuit visualization unavailable/);
  assert.match(styles, /\.dashboard-grid-lists\s*\{\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(styles, /\.agent-brain-stage\s*\{[^}]*width:\s*min\(100%,\s*90vh\);[^}]*aspect-ratio:\s*1;/s);
  assert.match(styles, /\.agent-status-monitor\s*\{[^}]*margin-top:\s*8px;/s);
  assert.match(styles, /\.circuit-board-image\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;/s);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /\.agent-brain\[data-visualization="ready"\].*\.agent-brain-fallback\s*\{\s*display:\s*none\s*!important;/s);
});

test("portfolio chart legend icons are gray without recoloring chart datasets", () => {
  const defaultLabels = [{
    text: "Portfolio 1",
    fillStyle: "#5b9cff22",
    strokeStyle: "#5b9cff",
    datasetIndex: 0
  }];
  const ChartConstructor = {
    defaults: {
      plugins: {
        legend: {
          labels: {
            generateLabels: () => defaultLabels
          }
        }
      }
    }
  };
  const config = dashboard.createPortfolioChartConfig([
    { portfolio_id: "one", captured_at: "2026-03-20T10:00:00.000Z", portfolio_value: "100" },
    { portfolio_id: "two", captured_at: "2026-03-20T10:00:00.000Z", portfolio_value: "200" }
  ], ChartConstructor);
  const labels = config.options.plugins.legend.labels.generateLabels({
    data: config.data,
    isDatasetVisible: () => true
  });

  assert.equal(config.options.plugins.legend.display, true);
  assert.equal(labels[0].fillStyle, "#8792a1");
  assert.equal(labels[0].strokeStyle, "#8792a1");
  assert.notEqual(config.data.datasets[0].borderColor, "#8792a1");
});

test("dashboard renders safe empty states without inventing portfolio history", () => {
  const { dashboardDocument, elements } = createDashboardDocument();

  dashboard.renderDashboard(dashboard.emptyDashboardData(), dashboardDocument, null);

  assert.equal(elements.get("[data-dashboard-value=\"portfolioValue\"]")[0].textContent, "—");
  assert.equal(elements.get("[data-dashboard-value=\"totalPnl\"]")[0].textContent, "—");
  assert.equal(elements.get("[data-dashboard-value=\"trackedMarkets\"]")[0].textContent, "0");
  assert.equal(elements.get("[data-dashboard-status=\"agent\"]")[0].textContent, "UNKNOWN");
  assert.equal(elements.get("[data-dashboard-activity=\"bot-run\"]")[0].textContent, "—");
  assert.equal(elements.get("[data-dashboard-activity=\"market-data\"]")[0].textContent, "—");
  assert.equal(elements.get("[data-dashboard-activity=\"paper-trade\"]")[0].textContent, "—");
  assert.equal(elements.get("[data-dashboard-list=\"positions\"]")[0].hidden, true);
  assert.equal(elements.get("[data-dashboard-empty=\"positions\"]")[0].hidden, false);
  assert.equal(elements.get("[data-portfolio-chart]")[0].hidden, true);
  assert.equal(elements.get("[data-dashboard-chart-empty]")[0].hidden, false);
  assert.match(elements.get("[data-dashboard-chart-empty]")[0].textContent, /first database snapshot/);
});

test("dashboard summary lists show two complete items and scroll for the rest", () => {
  const { dashboardDocument, elements } = createDashboardDocument();
  const data = dashboard.emptyDashboardData();
  const createdAt = generatedAt.toISOString();
  const positions = (count) => Array.from({ length: count }, (_, index) => ({
    symbol: `M${index}-EUR`,
    amount: 1,
    entry_price: 1,
    current_price: 1,
    unrealized_pnl: 0,
    created_at: createdAt
  }));
  const trades = (count) => Array.from({ length: count }, (_, index) => ({
    side: "BUY",
    symbol: `M${index}-EUR`,
    quantity: 1,
    price: 1,
    created_at: createdAt
  }));
  const monitoredPositions = (count) => Array.from({ length: count }, (_, index) => ({
    symbol: `M${index}-EUR`,
    amount: 1,
    entry_price: 1,
    current_price: 1,
    unrealized_pnl: 0,
    created_at: createdAt,
    latestAiDecision: null
  }));

  const positionMonitoringList = elements.get('[data-dashboard-list="position-ai-status"]')[0];
  positionMonitoringList.dataset.mockRowGap = "12";
  data.openPositions = { count: 2, items: positions(2) };
  data.recentTrades = { count: 2, items: trades(2) };
  data.openPositionAiStatus = { count: 2, items: monitoredPositions(2) };
  dashboard.renderDashboard(data, dashboardDocument, null);

  const lists = [
    elements.get('[data-dashboard-list="positions"]')[0],
    elements.get('[data-dashboard-list="trades"]')[0],
    elements.get('[data-dashboard-list="position-ai-status"]')[0]
  ];
  assert.deepEqual(lists.map(({ dataset }) => dataset.scrollable), ["false", "false", "false"]);

  data.openPositions = { count: 3, items: positions(3) };
  data.recentTrades = { count: 3, items: trades(3) };
  data.openPositionAiStatus = { count: 3, items: monitoredPositions(3) };
  dashboard.renderDashboard(data, dashboardDocument, null);
  assert.deepEqual(lists.map(({ dataset }) => dataset.scrollable), ["true", "true", "true"]);
  const styles = fs.readFileSync(path.join(rootDirectory, "css", "styles.css"), "utf8");
  assert.match(
    styles,
    /\.dashboard-list\[data-scrollable="true"\]\s*\{[^}]*max-height:\s*var\(--dashboard-list-max-height,\s*200px\);[^}]*overflow-y:\s*auto;/s
  );
  assert.match(
    styles,
    /\.dashboard-list\[data-dashboard-list="position-ai-status"\]\[data-scrollable="true"\]\s*\{[^}]*grid-template-columns:\s*1fr;[^}]*max-height:\s*var\(--dashboard-list-max-height,\s*520px\);/s
  );
  for (const listName of ["positions", "trades", "position-ai-status"]) {
    assert.equal(elements.get(`[data-dashboard-list="${listName}"]`)[0].children.length, 3);
  }
  assert.equal(lists[0].style.getPropertyValue("--dashboard-list-max-height"), "80px");
  assert.equal(lists[1].style.getPropertyValue("--dashboard-list-max-height"), "80px");
  assert.equal(lists[2].style.getPropertyValue("--dashboard-list-max-height"), "172px");

  data.openPositions = { count: 2, items: positions(2) };
  data.recentTrades = { count: 2, items: trades(2) };
  data.openPositionAiStatus = { count: 2, items: monitoredPositions(2) };
  dashboard.renderDashboard(data, dashboardDocument, null);
  assert.deepEqual(lists.map(({ dataset }) => dataset.scrollable), ["false", "false", "false"]);
  assert.deepEqual(
    lists.map((list) => list.style.getPropertyValue("--dashboard-list-max-height")),
    ["", "", ""]
  );
});

test("dashboard KPI information is accessible, English-only, and covers all portfolio metrics", () => {
  const html = fs.readFileSync(path.join(rootDirectory, "dashboard.html"), "utf8");
  const requiredKpis = [
    ["portfolio-value", "Portfolio Value"],
    ["total-pnl", "Total P&amp;L"],
    ["realized-pnl", "Realized P&amp;L"],
    ["unrealized-pnl", "Open Positions Gain/Loss", "Explain gain or loss on open positions"],
    ["daily-pnl", "Daily P&amp;L"],
    ["win-rate", "Win Rate"],
    ["open-positions", "Open Positions"],
    ["available-balance", "Available Balance"],
    ["ai-decisions", "AI Decisions"],
    ["paper-trades", "Paper Trades"],
    ["tracked-markets", "Tracked Markets"]
  ];

  assert.match(html, /<html lang="en"/);
  assert.equal((html.match(/data-dashboard-kpi-info/g) || []).length, requiredKpis.length);
  for (const [id, label, ariaLabel = `Explain ${label}`] of requiredKpis) {
    assert.match(html, new RegExp(`aria-label="${ariaLabel}"`));
    assert.match(html, new RegExp(`aria-controls="kpi-info-${id}"`));
    assert.match(html, new RegExp(`aria-describedby="kpi-info-${id}"`));
    assert.match(html, new RegExp(`id="kpi-info-${id}" role="tooltip" hidden`));
  }
  assert.match(
    html,
    /<span class="metric-label">Open Positions Gain\/Loss<\/span>/
  );
  assert.match(
    html,
    /id="kpi-info-unrealized-pnl" role="tooltip" hidden>Estimated gain or loss on positions you still hold, based on current prices\. It is not realized profit or loss from a completed sale\./
  );
  assert.doesNotMatch(html, /Hoofdnavigatie|Instellingen|Uitloggen|Alle bedragen|Databasegegevens|Opnieuw proberen|Overzicht|afzonderlijk|Geen echte orders/i);
});

test("dashboard KPI info icons use neutral gray while retaining keyboard focus visibility", () => {
  const styles = fs.readFileSync(path.join(rootDirectory, "css/styles.css"), "utf8");

  assert.match(
    styles,
    /\.kpi-info-trigger\s*\{[^}]*border:\s*1px solid #6d7785;[^}]*background:\s*var\(--surface-raised\);[^}]*color:\s*var\(--muted\);/s
  );
  assert.match(styles, /\.kpi-info-trigger:hover,[\s\S]*?background:\s*#303741;/);
  assert.match(styles, /\.kpi-info-trigger:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent\);/s);
});

test("BUY and SELL labels use the shared positive and negative colors", () => {
  const styles = fs.readFileSync(path.join(rootDirectory, "css/styles.css"), "utf8");

  assert.match(styles, /\.trade-action-buy\s*\{[^}]*color:\s*var\(--positive\);/s);
  assert.match(styles, /\.trade-action-sell\s*\{[^}]*color:\s*var\(--negative\);/s);
  assert.match(styles, /\.history-filters option\[value="buy"\]\s*\{[^}]*color:\s*var\(--positive\);/s);
  assert.match(styles, /\.history-filters option\[value="sell"\]\s*\{[^}]*color:\s*var\(--negative\);/s);
});

test("dashboard collapses portfolio metrics after Win Rate by default", () => {
  const html = fs.readFileSync(path.join(rootDirectory, "dashboard.html"), "utf8");
  const winRateIndex = html.indexOf('data-dashboard-value="winRate"');
  const additionalMetricsIndex = html.indexOf('<details class="dashboard-extra-metrics">');

  assert.ok(winRateIndex >= 0);
  assert.ok(additionalMetricsIndex > winRateIndex);
  assert.match(html, /<details class="dashboard-extra-metrics">\s*<summary>Show additional metrics<\/summary>/);
  assert.doesNotMatch(html, /<details class="dashboard-extra-metrics" open>/);
  assert.match(html, /<details class="dashboard-extra-metrics">[\s\S]*data-dashboard-value="openPositions"/);
});

test("dashboard list panels start collapsed and prioritize open-position AI status", () => {
  const html = fs.readFileSync(path.join(rootDirectory, "dashboard.html"), "utf8");
  const styles = fs.readFileSync(path.join(rootDirectory, "css", "styles.css"), "utf8");
  const listSection = html.match(
    /<section class="dashboard-grid dashboard-grid-lists"[^>]*>([\s\S]*?)<\/section>/
  );
  const panels = listSection
    ? [...listSection[1].matchAll(/<details class="dashboard-panel dashboard-list-panel">([\s\S]*?)<\/details>/g)]
    : [];
  assert.equal(panels.length, 3);
  assert.deepEqual(panels.map(([, panel]) => panel.match(/<p class="eyebrow">([^<]+)<\/p>/)[1]), [
    "Portfolio",
    "Activity",
    "Position monitoring"
  ]);
  assert.doesNotMatch(html, /Market universe|data-dashboard-list="markets"/);
  assert.doesNotMatch(listSection[1], /<details\b[^>]*\bopen(?:\s|>)/);
  for (const [title, value] of [
    ["Open Positions", "openPositions"],
    ["Recent Trades", "paperTrades"],
    ["Open Position AI Status", "openPositionAiStatus"]
  ]) {
    assert.match(
      listSection[1],
      new RegExp(`<h2>${title} <span class="dashboard-panel-count">\\(<span data-dashboard-value="${value}">0<\\/span>\\)<\\/span><\\/h2>`)
    );
  }
  assert.doesNotMatch(listSection[1], /class="count-pill"/);
  assert.match(styles, /\.dashboard-shell\s*\{[^}]*padding-block:\s*16px 64px;/s);
  for (const listName of ["positions", "trades", "position-ai-status"]) {
    assert.match(listSection[1], new RegExp(`data-dashboard-list="${listName}"`));
  }
  assert.doesNotMatch(listSection[1], /Recent AI Decisions/);
  assert.match(listSection[1], /href="\/history\.html">View history<\/a>/);

  const activityStrip = html.match(/<dl class="activity-strip">([\s\S]*?)<\/dl>/);
  assert.ok(activityStrip);
  assert.match(activityStrip[1], /Bot run[\s\S]*data-dashboard-activity="bot-run"/);
  assert.match(activityStrip[1], /Market data[\s\S]*data-dashboard-activity="market-data"/);
  assert.match(activityStrip[1], /Paper trade[\s\S]*data-dashboard-activity="paper-trade"/);
  assert.match(activityStrip[1], /Analytics[\s\S]*On demand[\s\S]*Market scan[\s\S]*On demand/);
  assert.match(
    styles,
    /\.activity-strip\s*\{[^}]*background:\s*linear-gradient\(105deg,\s*#193a31,\s*var\(--positive-dark\)\s+58%,\s*#193a31\);/s
  );
  assert.match(styles, /\.activity-strip dt\s*\{[^}]*color:\s*var\(--positive\);/s);

  const shadowSection = html.match(
    /<section class="dashboard-panel shadow-exit-panel"[^>]*>([\s\S]*?)<\/section>/
  );
  assert.ok(shadowSection);
  assert.match(shadowSection[0], /aria-labelledby="shadow-exits-heading"/);
  assert.match(shadowSection[0], /data-shadow-exit-list[^>]*aria-label=/);
  assert.match(shadowSection[0], /data-shadow-exit-status role="status" aria-live="polite"/);
  assert.match(shadowSection[0], /simulations only[\s\S]*never place trades[\s\S]*historical candles and intrabar highs or lows are not used/i);
  assert.match(styles, /\.shadow-exit-rule-list\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,/s);
});

test("dashboard KPI information opens, toggles, dismisses outside, and closes with Escape", () => {
  function createInfoElement(controlId = null) {
    return {
      attributes: controlId ? { "aria-controls": controlId, "aria-expanded": "false" } : {},
      descendants: new Set(),
      hidden: true,
      listeners: {},
      addEventListener(name, callback) {
        this.listeners[name] = callback;
      },
      removeEventListener(name) {
        delete this.listeners[name];
      },
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      getAttribute(name) {
        return this.attributes[name] || null;
      },
      contains(target) {
        return target === this || this.descendants.has(target);
      },
      focus() {
        this.focused = true;
      },
      dispatch(name, event = {}) {
        this.listeners[name]?.(event);
      }
    };
  }

  const firstTrigger = createInfoElement("kpi-info-first");
  const secondTrigger = createInfoElement("kpi-info-second");
  const firstPopover = createInfoElement();
  const secondPopover = createInfoElement();
  const firstPopoverContent = {};
  firstPopover.descendants.add(firstPopoverContent);
  const documentRef = {
    listeners: {},
    querySelectorAll() {
      return [firstTrigger, secondTrigger];
    },
    getElementById(id) {
      return {
        "kpi-info-first": firstPopover,
        "kpi-info-second": secondPopover
      }[id] || null;
    },
    addEventListener(name, callback) {
      this.listeners[name] = callback;
    },
    removeEventListener(name) {
      delete this.listeners[name];
    },
    dispatch(name, event = {}) {
      this.listeners[name]?.(event);
    }
  };
  const dispose = dashboard.initializeKpiInfo(documentRef);

  firstTrigger.dispatch("click");
  documentRef.dispatch("click", { target: firstTrigger });
  assert.equal(firstPopover.hidden, false);
  assert.equal(firstTrigger.attributes["aria-expanded"], "true");

  documentRef.dispatch("click", { target: firstPopoverContent });
  assert.equal(firstPopover.hidden, false);

  secondTrigger.dispatch("click");
  documentRef.dispatch("click", { target: secondTrigger });
  assert.equal(firstPopover.hidden, true);
  assert.equal(firstTrigger.attributes["aria-expanded"], "false");
  assert.equal(secondPopover.hidden, false);

  let escapePrevented = false;
  documentRef.dispatch("keydown", {
    key: "Escape",
    preventDefault() {
      escapePrevented = true;
    }
  });
  assert.equal(secondPopover.hidden, true);
  assert.equal(secondTrigger.attributes["aria-expanded"], "false");
  assert.equal(secondTrigger.focused, true);
  assert.equal(escapePrevented, true);

  firstTrigger.dispatch("click");
  documentRef.dispatch("click", { target: firstTrigger });
  documentRef.dispatch("click", { target: {} });
  assert.equal(firstPopover.hidden, true);
  assert.equal(firstTrigger.attributes["aria-expanded"], "false");

  dispose();
  assert.equal(firstTrigger.listeners.click, undefined);
  assert.equal(documentRef.listeners.click, undefined);
  assert.equal(documentRef.listeners.keydown, undefined);
});

test("chart rendering failures do not hide already-rendered dashboard values", () => {
  const { dashboardDocument, elements } = createDashboardDocument();
  class BrokenChart {
    constructor() {
      throw new Error("chart library failure");
    }
  }
  const data = dashboard.emptyDashboardData();
  data.portfolio.portfolioValue = 1200;
  data.portfolioSnapshots = [{
    portfolio_id: "portfolio-1",
    portfolio_value: "1200",
    captured_at: "2026-03-20T11:00:00.000Z"
  }];

  dashboard.renderDashboard(data, dashboardDocument, BrokenChart);

  assert.match(elements.get("[data-dashboard-value=\"portfolioValue\"]")[0].textContent, /1,200/);
  assert.equal(elements.get("[data-portfolio-chart]")[0].hidden, true);
  assert.equal(elements.get("[data-dashboard-chart-empty]")[0].hidden, false);
  assert.match(elements.get("[data-dashboard-chart-empty]")[0].textContent, /chart is currently unavailable/);
});

test("dashboard requests Raspberry Pi API data and validates error responses", async () => {
  let request;
  const expected = { data: { portfolioValue: 12 } };
  assert.deepEqual(await dashboard.requestDashboardData(async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, json: async () => expected };
  }), expected.data);
  assert.equal(request.url, "/api/v1/dashboard-data");
  assert.equal(request.options.credentials, "include");
  assert.equal(request.options.cache, "no-store");

  let statusRequest;
  assert.equal(await dashboard.requestAgentStatus(async (url, options) => {
    statusRequest = { url, options };
    return { ok: true, status: 200, json: async () => ({ data: { status: "ACTIVE" } }) };
  }), "ACTIVE");
  assert.equal(statusRequest.url, "/api/v1/agent-status");
  assert.equal(statusRequest.options.credentials, "include");
  assert.equal(statusRequest.options.cache, "no-store");

  await assert.rejects(
    () => dashboard.requestDashboardData(async () => ({ ok: false, status: 401 })),
    (error) => error.status === 401
  );
  await assert.rejects(
    () => dashboard.requestDashboardData(async () => ({ ok: true, status: 200, json: async () => ({}) })),
    /response is invalid/
  );
  await assert.rejects(
    () => dashboard.requestAgentStatus(async () => ({ ok: false, status: 503 })),
    /status is unavailable/
  );
});

test("dashboard retries one rate-limited request after Retry-After", async () => {
  let requests = 0;
  const data = await dashboard.requestDashboardData(async () => {
    requests += 1;
    if (requests === 1) {
      return {
        ok: false,
        status: 429,
        headers: { get: () => "0" }
      };
    }
    return { ok: true, status: 200, json: async () => ({ data: { portfolioValue: 12 } }) };
  });

  assert.deepEqual(data, { portfolioValue: 12 });
  assert.equal(requests, 2);
});

test("dashboard waits for authentication and offers retry after a load error", async () => {
  const { dashboardDocument, elements } = createDashboardDocument();
  let resolveAuth;
  const fetchCalls = [];
  const authReady = new Promise((resolve) => { resolveAuth = resolve; });
  const windowRef = {
    CryptoPulseAuthReady: authReady,
    location: { replace() {} },
    setInterval: () => 1,
    clearInterval() {},
    fetch: async (url) => {
      fetchCalls.push(url);
      throw new Error("network unavailable");
    }
  };

  dashboard.startDashboard({ windowRef, documentRef: dashboardDocument });
  await Promise.resolve();
  assert.equal(fetchCalls.length, 0);

  resolveAuth();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(fetchCalls, [
    "/api/v1/dashboard-data",
    "/api/v1/monitoring"
  ]);
  assert.equal(elements.get("[data-dashboard-error]")[0].hidden, false);
  assert.equal(elements.get("[data-dashboard-retry]")[0].hidden, false);
});

test("dashboard keeps the tracked-markets KPI without displaying the market list", async () => {
  const { dashboardDocument, elements } = createDashboardDocument();
  const dashboardData = dashboard.emptyDashboardData();
  dashboardData.watchedMarkets = {
    count: 1,
    items: [{ symbol: "BTC-EUR", priority: 1 }]
  };
  const windowRef = {
    CryptoPulseAuthReady: Promise.resolve(),
    CryptoPulseAgentBrain: {
      createAgentBrain: () => ({ available: true, setStatus() {}, dispose() {} })
    },
    location: { replace() {} },
    setInterval: () => 1,
    clearInterval() {},
    fetch: async (url) => {
      if (url === "/api/v1/dashboard-data") {
        return { ok: true, status: 200, json: async () => ({ data: dashboardData }) };
      }
      if (url === "/api/v1/agent-status") {
        return { ok: true, status: 200, json: async () => ({ data: { status: null } }) };
      }
      throw new Error(`Unexpected dashboard request: ${url}`);
    }
  };

  const controller = dashboard.startDashboard({
    windowRef,
    documentRef: dashboardDocument,
    ChartConstructor: null,
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(elements.get("[data-dashboard-value=\"trackedMarkets\"]")[0].textContent, "1");
  assert.equal(elements.has("[data-dashboard-list=\"markets\"]"), false);
  controller.dispose();
});

test("dashboard refreshes all data periodically and when returning to the foreground", async () => {
  const { dashboardDocument, elements } = createDashboardDocument();
  const dashboardData = dashboard.emptyDashboardData();
  dashboardData.agentStatus = { status: "ACTIVE" };
  dashboardData.aiDecisions = { count: 1, items: [] };
  const requests = [];
  const intervals = new Map();
  let nextIntervalId = 0;
  let holdNextDashboardRequest = false;
  let failNextDashboardRequest = false;
  let failNextArchiveRequest = false;
  let resolveHeldDashboardRequest;
  const windowRef = {
    CryptoPulseAuthReady: Promise.resolve(),
    CryptoPulseAgentBrain: {
      createAgentBrain: () => ({ available: true, setStatus() {}, dispose() {} })
    },
    location: { replace() {} }
  };
  const controller = dashboard.startDashboard({
    windowRef,
    documentRef: dashboardDocument,
    ChartConstructor: null,
    fetchImpl: async (url) => {
      requests.push(url);
      if (url === "/api/v1/dashboard-data") {
        if (failNextDashboardRequest) {
          failNextDashboardRequest = false;
          return { ok: false, status: 503 };
        }
        if (holdNextDashboardRequest) {
          holdNextDashboardRequest = false;
          return new Promise((resolve) => {
            resolveHeldDashboardRequest = () => resolve({
              ok: true,
              status: 200,
              json: async () => ({ data: dashboardData })
            });
          });
        }
        return { ok: true, status: 200, json: async () => ({ data: dashboardData }) };
      }
      if (url === "/api/v1/agent-status") {
        return { ok: true, status: 200, json: async () => ({ data: { status: "ACTIVE" } }) };
      }
      if (url === "/api/v1/monitoring") {
        if (failNextArchiveRequest) {
          failNextArchiveRequest = false;
          return { ok: false, status: 503 };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              server: "online",
              postgresql: "online",
              database: "online",
              diskUsage: 12,
              databaseSize: "2.3 GB",
              lastHealthCheck: "2026-11-06T12:00:00.000Z"
            }
          })
        };
      }
      throw new Error(`Unexpected dashboard request: ${url}`);
    },
    setIntervalImpl(callback, delay) {
      const id = ++nextIntervalId;
      intervals.set(id, { callback, delay });
      return id;
    },
    clearIntervalImpl(id) {
      intervals.delete(id);
    }
  });
  const flushDashboardLoad = async () => {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  };
  await flushDashboardLoad();

  assert.equal(requests.filter((url) => url === "/api/v1/dashboard-data").length, 1);
  assert.equal(requests.some((url) => url.includes("market-summary")), false);
  assert.deepEqual(
    [...intervals.values()].map(({ delay }) => delay).sort(),
    [15000, 30000, 300000]
  );
  const dashboardInterval = [...intervals.values()].find(({ delay }) => delay === 30000);
  const archiveInterval = [...intervals.values()].find(({ delay }) => delay === 300000);
  assert.equal(elements.get("[data-archive-health=\"server\"]")[0].textContent, "Online");

  dashboardData.aiDecisions.count = 2;
  await dashboardInterval.callback();
  assert.equal(requests.filter((url) => url === "/api/v1/dashboard-data").length, 2);
  assert.equal(requests.some((url) => url.includes("market-summary")), false);
  assert.equal(elements.get("[data-dashboard-value=\"aiDecisions\"]")[0].textContent, "2");

  holdNextDashboardRequest = true;
  const heldRefresh = dashboardInterval.callback();
  await Promise.resolve();
  const duplicateRefresh = controller.load();
  assert.equal(requests.filter((url) => url === "/api/v1/dashboard-data").length, 3);

  dashboardDocument.visibilityState = "hidden";
  dashboardDocument.listeners.visibilitychange();
  assert.equal(intervals.size, 0);
  const requestCountWhileHidden = requests.length;
  await dashboardInterval.callback();
  assert.equal(requests.length, requestCountWhileHidden);

  dashboardData.aiDecisions.count = 4;
  dashboardDocument.visibilityState = "visible";
  dashboardDocument.listeners.visibilitychange();
  assert.equal(intervals.size, 3);
  resolveHeldDashboardRequest();
  await Promise.all([heldRefresh, duplicateRefresh]);
  await flushDashboardLoad();
  assert.equal(requests.filter((url) => url === "/api/v1/dashboard-data").length, 4);
  assert.equal(requests.some((url) => url.includes("market-summary")), false);
  assert.equal(elements.get("[data-dashboard-value=\"aiDecisions\"]")[0].textContent, "4");

  dashboardDocument.visibilityState = "hidden";
  dashboardDocument.listeners.visibilitychange();
  assert.equal(intervals.size, 0);
  const requestCountAfterBackgrounding = requests.length;
  await dashboardInterval.callback();
  assert.equal(requests.length, requestCountAfterBackgrounding);

  dashboardData.aiDecisions.count = 5;
  dashboardDocument.visibilityState = "visible";
  dashboardDocument.listeners.visibilitychange();
  await flushDashboardLoad();
  assert.equal(requests.filter((url) => url === "/api/v1/dashboard-data").length, 5);
  assert.equal(requests.some((url) => url.includes("market-summary")), false);
  assert.equal(elements.get("[data-dashboard-value=\"aiDecisions\"]")[0].textContent, "5");
  assert.equal(intervals.size, 3);

  failNextArchiveRequest = true;
  await archiveInterval.callback();
  assert.equal(elements.get("[data-archive-health=\"server\"]")[0].textContent, "Offline");
  assert.equal(elements.get("[data-dashboard-error]")[0].hidden, true);
  assert.equal(elements.get("[data-dashboard-value=\"aiDecisions\"]")[0].textContent, "5");

  failNextDashboardRequest = true;
  await dashboardInterval.callback();
  assert.equal(elements.get("[data-dashboard-value=\"aiDecisions\"]")[0].textContent, "5");
  assert.equal(elements.get("[data-dashboard-error]")[0].hidden, false);
  assert.equal(elements.get("[data-dashboard-retry]")[0].hidden, false);

  controller.dispose();
  assert.equal(intervals.size, 0);
});

test("dashboard redirects to login when the data API reports an expired session", async () => {
  const { dashboardDocument } = createDashboardDocument();
  const redirects = [];
  const windowRef = {
    CryptoPulseAuthReady: Promise.resolve(),
    location: { replace: (target) => redirects.push(target) },
    setInterval: () => 1,
    clearInterval() {},
    fetch: async () => ({ ok: false, status: 401 })
  };

  dashboard.startDashboard({ windowRef, documentRef: dashboardDocument });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(redirects, ["/login.html?next=%2Fdashboard.html"]);
});

test("dashboard applies live database status updates and pauses polling while hidden", async () => {
  const { dashboardDocument, elements } = createDashboardDocument();
  const statusUpdates = [];
  const intervals = new Map();
  const clearedIntervals = [];
  let nextIntervalId = 0;
  let pollStatus = "ANALYZING";
  const dashboardData = dashboard.emptyDashboardData();
  dashboardData.agentStatus = { status: "ACTIVE" };
  const agentBrainApi = {
    createAgentBrain(options) {
      statusUpdates.push(options.initialStatus);
      return {
        available: true,
        setStatus(status) {
          statusUpdates.push(status);
        },
        dispose() {}
      };
    }
  };
  const windowRef = {
    CryptoPulseAuthReady: Promise.resolve(),
    CryptoPulseAgentBrain: agentBrainApi,
    location: { replace() {} },
    fetch: async (url) => {
      if (url === "/api/v1/dashboard-data") {
        return { ok: true, status: 200, json: async () => ({ data: dashboardData }) };
      }
      if (url === "/api/v1/agent-status") {
        return { ok: true, status: 200, json: async () => ({ data: { status: pollStatus } }) };
      }
      throw new Error(`Unexpected dashboard request: ${url}`);
    }
  };
  const controller = dashboard.startDashboard({
    windowRef,
    documentRef: dashboardDocument,
    ChartConstructor: null,
    setIntervalImpl(callback, delay) {
      const id = ++nextIntervalId;
      intervals.set(id, { callback, delay });
      return id;
    },
    clearIntervalImpl(id) {
      clearedIntervals.push(id);
      intervals.delete(id);
    }
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(elements.get("[data-dashboard-status=\"agent\"]")[0].textContent, "ACTIVE");
  assert.equal(elements.get("[data-agent-brain-fallback]")[0].hidden, true);
  assert.deepEqual(statusUpdates, ["ACTIVE"]);
  assert.equal(intervals.size, 3);
  const [intervalId, interval] = [...intervals.entries()]
    .find(([, currentInterval]) => currentInterval.delay === 15000);
  const [dashboardIntervalId, dashboardInterval] = [...intervals.entries()]
    .find(([, currentInterval]) => currentInterval.delay === 30000);
  const [archiveIntervalId, archiveInterval] = [...intervals.entries()]
    .find(([, currentInterval]) => currentInterval.delay === 300000);
  assert.equal(interval.delay, 15000);
  assert.equal(dashboardInterval.delay, 30000);
  assert.equal(archiveInterval.delay, 300000);

  await controller.refreshAgentStatus();
  assert.equal(elements.get("[data-dashboard-status=\"agent\"]")[0].textContent, "ANALYZING");
  elements.get("[data-agent-brain-fallback]")[0].hidden = false;
  await controller.refreshAgentStatus();
  assert.equal(elements.get("[data-agent-brain-fallback]")[0].hidden, true);
  assert.deepEqual(statusUpdates, ["ACTIVE", "ANALYZING", "ANALYZING"]);

  dashboardDocument.visibilityState = "hidden";
  dashboardDocument.listeners.visibilitychange();
  assert.equal(intervals.size, 0);
  assert.deepEqual(
    new Set(clearedIntervals),
    new Set([intervalId, dashboardIntervalId, archiveIntervalId])
  );
  const callsBeforeHiddenPoll = statusUpdates.length;
  await interval.callback();
  await dashboardInterval.callback();
  await archiveInterval.callback();
  assert.equal(statusUpdates.length, callsBeforeHiddenPoll);

  dashboardDocument.visibilityState = "visible";
  pollStatus = "STOPPED";
  dashboardData.agentStatus.status = "STOPPED";
  dashboardDocument.listeners.visibilitychange();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements.get("[data-dashboard-status=\"agent\"]")[0].textContent, "STOPPED");
  assert.equal(intervals.size, 3);
  controller.dispose();
  assert.equal(intervals.size, 0);
});

test("dashboard keeps the circuit static and accessible when status is UNKNOWN", async () => {
  const { dashboardDocument, elements } = createDashboardDocument();
  const dashboardData = dashboard.emptyDashboardData();
  dashboardData.agentStatus = null;
  const windowRef = {
    CryptoPulseAuthReady: Promise.resolve(),
    CryptoPulseAgentBrain: require("../js/agent-brain.js"),
    location: { replace() {} },
    setInterval: () => 1,
    clearInterval() {},
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ data: dashboardData }) })
  };

  dashboard.startDashboard({
    windowRef,
    documentRef: dashboardDocument,
    ChartConstructor: null
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(elements.get("[data-dashboard-status=\"agent\"]")[0].textContent, "UNKNOWN");
  assert.equal(elements.get("[data-agent-brain]")[0].dataset.state, "unknown");
  assert.equal(elements.get("[data-agent-brain]")[0].dataset.visualization, "ready");
  assert.equal(elements.get("[data-agent-brain-fallback]")[0].hidden, true);
  assert.match(elements.get("[data-agent-brain-stage]")[0].innerHTML, /circuit-flow--stopped/);
  assert.equal(
    elements.get("[data-agent-brain-stage]")[0].attributes["aria-label"],
    "Agent circuit visualization; status UNKNOWN"
  );
});

test("dashboard retries circuit initialization after a transient failure", async () => {
  const { dashboardDocument, elements } = createDashboardDocument();
  const dashboardData = dashboard.emptyDashboardData();
  let initializationAttempts = 0;
  const windowRef = {
    CryptoPulseAuthReady: Promise.resolve(),
    CryptoPulseAgentBrain: {
      createAgentBrain() {
        initializationAttempts += 1;
        if (initializationAttempts === 1) {
          return {
            available: false,
            setStatus() {},
            dispose() {}
          };
        }
        return {
          available: true,
          setStatus() {},
          dispose() {}
        };
      }
    },
    location: { replace() {} },
    setInterval: () => 1,
    clearInterval() {},
    fetch: async (url) => {
      if (url === "/api/v1/dashboard-data") {
        return { ok: true, status: 200, json: async () => ({ data: dashboardData }) };
      }
      return { ok: true, status: 200, json: async () => ({ data: { status: null } }) };
    }
  };
  const controller = dashboard.startDashboard({
    windowRef,
    documentRef: dashboardDocument,
    ChartConstructor: null
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(initializationAttempts, 1);
  assert.equal(elements.get("[data-agent-brain-fallback]")[0].hidden, false);
  assert.equal(elements.get("[data-agent-brain]")[0].dataset.visualization, "unavailable");

  await controller.refreshAgentStatus();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(initializationAttempts, 2);
  assert.equal(elements.get("[data-agent-brain-fallback]")[0].hidden, true);
  assert.equal(elements.get("[data-agent-brain]")[0].dataset.visualization, "ready");
  controller.dispose();
});

test("dashboard keeps fallback hidden when the circuit survives a status update error", async () => {
  const { dashboardDocument, elements } = createDashboardDocument();
  const dashboardData = dashboard.emptyDashboardData();
  dashboardData.agentStatus = { status: "ACTIVE" };
  let disposeCalls = 0;
  const windowRef = {
    CryptoPulseAuthReady: Promise.resolve(),
    CryptoPulseAgentBrain: {
      createAgentBrain() {
        return {
          available: true,
          isAvailable: () => true,
          setStatus() {
            throw new Error("Status animation update failed.");
          },
          dispose() {
            disposeCalls += 1;
          }
        };
      }
    },
    location: { replace() {} },
    setInterval: () => 1,
    clearInterval() {},
    fetch: async (url) => {
      if (url === "/api/v1/dashboard-data") {
        return { ok: true, status: 200, json: async () => ({ data: dashboardData }) };
      }
      return { ok: true, status: 200, json: async () => ({ data: { status: "ANALYZING" } }) };
    }
  };
  const controller = dashboard.startDashboard({
    windowRef,
    documentRef: dashboardDocument,
    ChartConstructor: null
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  await controller.refreshAgentStatus();

  assert.equal(elements.get("[data-agent-brain-fallback]")[0].hidden, true);
  assert.equal(elements.get("[data-agent-brain]")[0].dataset.visualization, "ready");
  assert.equal(disposeCalls, 0);
  controller.dispose();
});
