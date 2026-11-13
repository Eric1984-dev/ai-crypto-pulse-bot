import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { DashboardRepository } from "../src/repositories/dashboard-repository.mjs";
import { SYSTEM_PROFILE_ID } from "../src/repositories/paper-trading-repository.mjs";

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE TABLE public."AI_Crypto_Bot_Profiles" (
      id uuid PRIMARY KEY,
      email text
    );
    CREATE TABLE public."AI_Crypto_Bot_Portfolios" (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL,
      starting_balance numeric NOT NULL,
      available_balance numeric NOT NULL,
      portfolio_value numeric NOT NULL,
      created_at timestamptz NOT NULL
    );
    CREATE TABLE public."AI_Crypto_Bot_Positions" (
      id uuid PRIMARY KEY,
      portfolio_id uuid NOT NULL,
      symbol text NOT NULL,
      amount numeric NOT NULL,
      entry_price numeric NOT NULL,
      current_price numeric NOT NULL,
      unrealized_pnl numeric NOT NULL,
      status text NOT NULL,
      created_at timestamptz NOT NULL
    );
    CREATE TABLE public."AI_Crypto_Bot_Trades" (
      id uuid PRIMARY KEY,
      portfolio_id uuid NOT NULL,
      ai_decision_id uuid,
      symbol text NOT NULL,
      side text NOT NULL,
      price numeric NOT NULL,
      quantity numeric NOT NULL,
      fees numeric NOT NULL,
      slippage numeric NOT NULL DEFAULT 0,
      realized_pnl numeric NOT NULL,
      created_at timestamptz NOT NULL
    );
    CREATE TABLE public."AI_Crypto_Bot_Portfolio_Snapshots" (
      id uuid PRIMARY KEY,
      portfolio_id uuid NOT NULL,
      portfolio_value numeric NOT NULL,
      available_balance numeric NOT NULL,
      open_positions integer NOT NULL,
      captured_at timestamptz NOT NULL
    );
    CREATE TABLE public."AI_Crypto_Bot_Emergency_State" (
      id uuid PRIMARY KEY,
      status text NOT NULL,
      reason text,
      created_at timestamptz NOT NULL
    );
    CREATE TABLE public."AI_Crypto_Bot_Shadow_Exit_Scenarios" (
      id uuid PRIMARY KEY,
      position_id uuid NOT NULL,
      portfolio_id uuid NOT NULL,
      symbol text NOT NULL,
      position_opened_at timestamptz NOT NULL,
      rule_id text NOT NULL,
      rule_version text NOT NULL,
      parameters jsonb NOT NULL,
      status text NOT NULL,
      data_quality_status text NOT NULL,
      tracking_started_at timestamptz,
      last_evaluated_at timestamptz NOT NULL,
      last_mark numeric,
      last_mark_captured_at timestamptz,
      high_water_mark numeric,
      trailing_armed boolean NOT NULL,
      activated_at timestamptz,
      triggered_at timestamptz,
      trigger_mark numeric,
      modeled_exit_price numeric,
      modeled_net_pnl numeric,
      actual_closed_at timestamptz,
      actual_close_price numeric,
      actual_net_pnl numeric
    );
    CREATE TABLE public."AI_Crypto_Bot_Shadow_Exit_Events" (
      id uuid PRIMARY KEY,
      scenario_id uuid NOT NULL,
      event_type text NOT NULL,
      event_at timestamptz NOT NULL,
      observed_mark numeric,
      data_quality_status text,
      error_code text
    );
    CREATE TABLE public."AI_Crypto_Bot_Market_Data" (
      symbol text PRIMARY KEY,
      price numeric NOT NULL,
      captured_at timestamptz NOT NULL
    );
    CREATE TABLE public."AI_Crypto_Bot_AI_Decisions" (
      id uuid PRIMARY KEY,
      symbol text NOT NULL,
      decision text NOT NULL,
      confidence numeric NOT NULL,
      reason text NOT NULL,
      indicators jsonb NOT NULL,
      strategy_name text,
      strategy_version text,
      created_at timestamptz NOT NULL
    );
    CREATE TABLE public."AI_Crypto_Bot_Analytics_Runs" (
      id uuid PRIMARY KEY,
      calculation_version text NOT NULL,
      period text NOT NULL,
      period_start timestamptz NOT NULL,
      period_end timestamptz NOT NULL,
      generated_at timestamptz NOT NULL,
      source_counts jsonb NOT NULL,
      analytics_summary jsonb NOT NULL,
      insights jsonb NOT NULL
    );
    CREATE TABLE public."AI_Crypto_Bot_Candles" (
      symbol text NOT NULL,
      interval text NOT NULL,
      open numeric NOT NULL,
      high numeric NOT NULL,
      low numeric NOT NULL,
      close numeric NOT NULL,
      volume numeric NOT NULL,
      timestamp timestamptz NOT NULL
    );
    INSERT INTO public."AI_Crypto_Bot_Profiles" (id, email)
    VALUES ('${SYSTEM_PROFILE_ID}', NULL);
    INSERT INTO public."AI_Crypto_Bot_Portfolios"
      (id, user_id, starting_balance, available_balance, portfolio_value, created_at)
    VALUES ('00000000-0000-4000-8000-000000000200', '${SYSTEM_PROFILE_ID}', 10000, 8000, 10100, NOW());
    INSERT INTO public."AI_Crypto_Bot_Positions"
      (id, portfolio_id, symbol, amount, entry_price, current_price, unrealized_pnl, status, created_at)
    VALUES ('00000000-0000-4000-8000-000000000300',
      '00000000-0000-4000-8000-000000000200', 'BTC-EUR', 0.02, 50000, 50500, 10, 'OPEN', NOW());
    INSERT INTO public."AI_Crypto_Bot_Trades"
      (id, portfolio_id, ai_decision_id, symbol, side, price, quantity, fees, realized_pnl, created_at)
    VALUES ('00000000-0000-4000-8000-000000000400',
      '00000000-0000-4000-8000-000000000200',
      '00000000-0000-4000-8000-000000000700', 'BTC-EUR', 'SELL', 51000, 0.01, 1, 9, NOW());
    INSERT INTO public."AI_Crypto_Bot_Portfolio_Snapshots"
      (id, portfolio_id, portfolio_value, available_balance, open_positions, captured_at)
    VALUES ('00000000-0000-4000-8000-000000000500',
      '00000000-0000-4000-8000-000000000200', 10100, 8000, 1, NOW());
    INSERT INTO public."AI_Crypto_Bot_Emergency_State" (id, status, reason, created_at)
    VALUES ('00000000-0000-4000-8000-000000000600', 'NORMAL', NULL, NOW());
    INSERT INTO public."AI_Crypto_Bot_Market_Data" (symbol, price, captured_at)
    VALUES ('BTC-EUR', 50600, NOW());
    INSERT INTO public."AI_Crypto_Bot_AI_Decisions"
      (id, symbol, decision, confidence, reason, indicators, created_at)
    VALUES ('00000000-0000-4000-8000-000000000700',
      'BTC-EUR', 'HOLD', 82, 'Consolidating.', '{"marketStrength": 12.5}', NOW());
  `);
  return database;
}

test("dashboard repository reads only the standalone system portfolio and bounded history", async () => {
  const database = await createDatabase();
  try {
    const pool = {
      async connect() {
        return {
          query: database.query.bind(database),
          release() {}
        };
      }
    };
    const repository = new DashboardRepository(pool, { logger: { error() {} } });
    const result = await repository.getSystemDashboardData();
    const history = await repository.getTradeHistory({
      page: 1,
      side: "SELL",
      period: "all",
      search: "BTC",
      sort: "newest",
      now: new Date()
    });
    const analytics = await repository.getAnalytics({ period: "30d", now: new Date() });
    const exportCount = await repository.getExportRecordCount({
      exportType: "trades",
      period: "all",
      now: new Date()
    });
    const exportRows = await repository.getExportRecords({
      exportType: "trades",
      period: "all",
      now: new Date()
    });

    assert.equal(result.portfolio.count, 1);
    assert.equal(result.portfolio.portfolioValue, 10100);
    assert.equal(result.portfolio.totalPnl, 100);
    assert.equal(result.portfolio.realizedPnl, 9);
    assert.equal(result.portfolio.unrealizedPnl, 10);
    assert.equal(result.portfolio.winRate, 100);
    assert.equal(result.openPositions.items[0].current_market_price, 50600);
    assert.equal(result.openPositionAiStatus.items[0].amount, 0.02);
    assert.equal(result.openPositionAiStatus.items[0].entry_price, 50000);
    assert.equal(result.openPositionAiStatus.items[0].current_market_price, 50600);
    assert.equal(result.openPositionAiStatus.items[0].unrealized_pnl, 10);
    assert.ok(result.openPositionAiStatus.items[0].current_market_captured_at);
    assert.equal(result.openPositionAiStatus.items[0].latestAiDecision.decision, "HOLD");
    assert.equal(result.recentTrades.items[0].side, "SELL");
    assert.equal(result.portfolioSnapshots.length, 1);
    assert.equal(result.emergencyState.status, "NORMAL");
    assert.equal(history.totalCount, 1);
    assert.equal(history.stats.winningTrades, 1);
    assert.equal(history.items[0].symbol, "BTC-EUR");
    assert.equal(analytics.tradePerformance.closedTrades, 1);
    assert.ok(Array.isArray(analytics.tradePerformance.bestSymbols));
    assert.equal(analytics.aiPerformance.decisionCount, 1);
    assert.ok(["BUY", "SELL", "HOLD", "WAIT"].every((action) =>
      analytics.aiPerformance.actions[action]));
    assert.equal(analytics.aiPerformance.actions.HOLD.scoredCount, 0);
    assert.equal(
      analytics.aiPerformance.confidenceBands.reduce((count, band) =>
        count + band.tradeCount, 0),
      0
    );
    assert.equal(analytics.portfolio.maxDrawdown, null);
    assert.equal(analytics.portfolio.snapshotCount, 1);
    assert.equal(analytics.portfolio.equityCurve.length, 1);
    assert.ok(Array.isArray(analytics.portfolio.drawdownHistory));
    assert.equal(exportCount, 1);
    assert.equal(exportRows[0].symbol, "BTC-EUR");
  } finally {
    await database.close();
  }
});

test("dashboard repository returns tracked positions, scenario states, and recent events", async () => {
  const database = await createDatabase();
  try {
    await database.exec(`
      INSERT INTO public."AI_Crypto_Bot_Shadow_Exit_Scenarios" (
        id, position_id, portfolio_id, symbol, position_opened_at, rule_id,
        rule_version, parameters, status, data_quality_status, tracking_started_at,
        last_evaluated_at, last_mark, last_mark_captured_at, high_water_mark,
        trailing_armed, trigger_mark, modeled_exit_price, modeled_net_pnl
      )
      VALUES (
        '00000000-0000-4000-8000-000000000800',
        '00000000-0000-4000-8000-000000000300',
        '00000000-0000-4000-8000-000000000200',
        'BTC-EUR', NOW(), 'fixed_tp_5', '1.0.0', '{"targetGainPct":5}',
        'TRIGGERED', 'FRESH', NOW(), NOW(), 53000, NOW(), 53000,
        false, 53000, 52947, 40
      );
      INSERT INTO public."AI_Crypto_Bot_Shadow_Exit_Events" (
        id, scenario_id, event_type, event_at, observed_mark, data_quality_status
      )
      VALUES (
        '00000000-0000-4000-8000-000000000801',
        '00000000-0000-4000-8000-000000000800',
        'HYPOTHETICAL_TRIGGERED', NOW(), 53000, 'FRESH'
      );
    `);
    const pool = {
      async connect() {
        return {
          query: database.query.bind(database),
          release() {}
        };
      }
    };
    const repository = new DashboardRepository(pool, { logger: { error() {} } });

    const result = await repository.getShadowExitScenarios();

    assert.equal(result.status, "AVAILABLE");
    assert.equal(result.positions.length, 1);
    assert.equal(result.positions[0].isOpen, true);
    assert.equal(result.positions[0].symbol, "BTC-EUR");
    assert.equal(result.positions[0].scenarios[0].status, "TRIGGERED");
    assert.equal(result.positions[0].scenarios[0].modeled_net_pnl, 40);
    assert.equal(result.positions[0].scenarios[0].events[0].event_type, "HYPOTHETICAL_TRIGGERED");
    assert.equal(result.positions[0].scenarios[0].events[0].observed_mark, 53000);
  } finally {
    await database.close();
  }
});

test("analytics aggregates large decision histories without loading every decision row", async () => {
  const database = await createDatabase();
  try {
    await database.query(`
      INSERT INTO public."AI_Crypto_Bot_AI_Decisions"
        (id, symbol, decision, confidence, reason, indicators,
         strategy_name, strategy_version, created_at)
      SELECT
        ('00000000-0000-4000-8001-' || pg_catalog.lpad(sample.id::text, 12, '0'))::uuid,
        CASE WHEN sample.id % 3 = 0 THEN 'ETH-EUR' ELSE 'BTC-EUR' END,
        CASE WHEN sample.id % 2 = 0 THEN 'BUY' ELSE 'WAIT' END,
        CASE WHEN sample.id % 2 = 0 THEN 82 ELSE 65 END,
        'sample decision',
        '{}'::jsonb,
        'Trend',
        'v1',
        pg_catalog.now()
      FROM pg_catalog.generate_series(1, 10001) AS sample(id)
    `);
    const repository = new DashboardRepository({
      async connect() {
        return {
          query: database.query.bind(database),
          release() {}
        };
      }
    }, { logger: { error() {} } });

    const analytics = await repository.getAnalytics({ period: "30d", now: new Date() });

    assert.equal(analytics.aiPerformance.decisionCount, 10002);
    assert.equal(analytics.aiPerformance.actions.BUY.decisionCount, 5000);
    assert.equal(analytics.aiPerformance.actions.WAIT.decisionCount, 5001);
    assert.equal(analytics.aiPerformance.actions.HOLD.decisionCount, 1);
    assert.equal(
      analytics.aiPerformance.confidenceBuckets.find(({ label }) => label === "80–85")
        .decisionCount,
      5001
    );
    assert.equal(
      analytics.aiPerformance.bySymbol.find(({ label }) => label === "BTC-EUR")
        .decisionCount,
      6669
    );
  } finally {
    await database.close();
  }
});

test("analytics SQL assigns confidence boundary values to non-overlapping bands", async () => {
  const database = await createDatabase();
  try {
    await database.query(`
      INSERT INTO public."AI_Crypto_Bot_AI_Decisions"
        (id, symbol, decision, confidence, reason, indicators, created_at)
      VALUES
        ('00000000-0000-4000-8000-000000000701', 'BTC-EUR', 'WAIT', 50, 'boundary', '{}', NOW()),
        ('00000000-0000-4000-8000-000000000702', 'BTC-EUR', 'WAIT', 60, 'boundary', '{}', NOW()),
        ('00000000-0000-4000-8000-000000000703', 'BTC-EUR', 'WAIT', 70, 'boundary', '{}', NOW()),
        ('00000000-0000-4000-8000-000000000704', 'BTC-EUR', 'WAIT', 80, 'boundary', '{}', NOW()),
        ('00000000-0000-4000-8000-000000000705', 'BTC-EUR', 'WAIT', 90, 'boundary', '{}', NOW()),
        ('00000000-0000-4000-8000-000000000706', 'BTC-EUR', 'WAIT', 100, 'boundary', '{}', NOW())
    `);
    const repository = new DashboardRepository({
      async connect() {
        return {
          query: database.query.bind(database),
          release() {}
        };
      }
    }, { logger: { error() {} } });

    const analytics = await repository.getAnalytics({ period: "30d", now: new Date() });

    assert.deepEqual(analytics.aiPerformance.confidenceBands.map(({ label, decisionCount }) =>
      [label, decisionCount]), [
      ["[50,60)", 1],
      ["[60,70)", 1],
      ["[70,80)", 1],
      ["[80,90)", 2],
      ["[90,100]", 2]
    ]);
  } finally {
    await database.close();
  }
});

test("shadow-exit analytics compares only matched actual closures and exposes attribution limits", async () => {
  const database = await createDatabase();
  try {
    await database.exec(`
      INSERT INTO public."AI_Crypto_Bot_Shadow_Exit_Scenarios" (
        id, position_id, portfolio_id, symbol, position_opened_at, rule_id,
        rule_version, parameters, status, data_quality_status, last_evaluated_at,
        trailing_armed, modeled_net_pnl, actual_closed_at, actual_net_pnl
      )
      VALUES (
        '00000000-0000-4000-8000-000000000810',
        '00000000-0000-4000-8000-000000000300',
        '00000000-0000-4000-8000-000000000200',
        'BTC-EUR', NOW(), 'fixed_tp_5', '1.0.0', '{}',
        'TRIGGERED', 'FRESH', NOW(), false, 15, NOW(), 10
      );
    `);
    const repository = new DashboardRepository({
      async connect() {
        return {
          query: database.query.bind(database),
          release() {}
        };
      }
    }, { logger: { error() {} } });

    const analytics = await repository.getAnalytics({ period: "30d", now: new Date() });

    assert.equal(analytics.shadowExitAnalytics.status, "AVAILABLE");
    assert.equal(analytics.shadowExitAnalytics.byRuleVersion[0].actualComparisonSampleSize, 1);
    assert.equal(analytics.shadowExitAnalytics.byRuleVersion[0].averageImprovementOverActual, 5);
    assert.equal(analytics.shadowExitAnalytics.byRuleVersion[0].confidenceIndicator, "LOW_SAMPLE");
    assert.equal(analytics.shadowExitAnalytics.strategyVersionAttribution.status, "UNAVAILABLE");
  } finally {
    await database.close();
  }
});

test("historical analysis bundle bounds linked records and includes anchored candle windows", async () => {
  const database = await createDatabase();
  try {
    await database.exec(`
      INSERT INTO public."AI_Crypto_Bot_Candles"
        (symbol, interval, open, high, low, close, volume, timestamp)
      VALUES ('BTC-EUR', '1m', 50000, 50100, 49900, 50050, 1, NOW() - INTERVAL '1 minute');
      INSERT INTO public."AI_Crypto_Bot_Trades"
        (id, portfolio_id, symbol, side, price, quantity, fees, realized_pnl, created_at)
      VALUES (
        '00000000-0000-4000-8000-000000000901',
        '00000000-0000-4000-8000-000000000200',
        'ETH-EUR', 'SELL', 3000, 0.1, 0.75, 4.25, NOW() - INTERVAL '1 hour'
      );
      INSERT INTO public."AI_Crypto_Bot_Analytics_Runs" (
        id, calculation_version, period, period_start, period_end, generated_at,
        source_counts, analytics_summary, insights
      )
      VALUES (
        '00000000-0000-4000-8000-000000000900',
        'phase-11.1',
        '30d',
        NOW() - INTERVAL '30 days',
        NOW(),
        NOW(),
        '{"trades":1}'::jsonb,
        '{"tradePerformance":{"closedTrades":1}}'::jsonb,
        '{"recommendations":[]}'::jsonb
      );
    `);
    const repository = new DashboardRepository({
      async connect() {
        return {
          query: database.query.bind(database),
          release() {}
        };
      }
    }, { logger: { error() {} } });

    const now = new Date();
    const history = await repository.getAnalyticsRunHistory({ period: "30d", now, limit: 10 });
    const bundle = await repository.getAnalysisBundle({ period: "30d", now, limit: 1 });

    assert.equal(history.items.length, 1);
    assert.equal(history.items[0].calculationVersion, "phase-11.1");
    assert.equal(bundle.manifest.requestedRange.timezone, "UTC");
    assert.equal(bundle.manifest.limits.rowsPerSource, 1);
    assert.equal(bundle.manifest.sourceCounts.trades, 2);
    assert.equal(bundle.trades.length, 1);
    assert.equal(bundle.decisions.length, 1);
    assert.equal(bundle.candleWindows.length, 1);
    assert.equal(bundle.candleWindows[0].interval, "1m");
    assert.equal(bundle.shadowExitScenarios.length, 0);
    assert.equal(bundle.manifest.includedCounts.trades, 1);
    assert.equal(bundle.manifest.truncation.trades, true);
  } finally {
    await database.close();
  }
});

test("analysis bundle samples decisions across dimensions and prioritizes trade-linked data", async () => {
  const database = await createDatabase();
  try {
    await database.query(`
      INSERT INTO public."AI_Crypto_Bot_AI_Decisions"
        (id, symbol, decision, confidence, reason, indicators,
         strategy_name, strategy_version, created_at)
      VALUES
        ('00000000-0000-4000-8000-000000000701', 'MARKET-1-EUR', 'BUY', 50, 'sample', '{}', 'Strategy-1', 'v1', NOW() - INTERVAL '1 day'),
        ('00000000-0000-4000-8000-000000000702', 'MARKET-2-EUR', 'SELL', 60, 'sample', '{}', 'Strategy-2', 'v1', NOW() - INTERVAL '2 days'),
        ('00000000-0000-4000-8000-000000000703', 'MARKET-3-EUR', 'HOLD', 70, 'sample', '{}', 'Strategy-3', 'v1', NOW() - INTERVAL '3 days'),
        ('00000000-0000-4000-8000-000000000704', 'MARKET-4-EUR', 'WAIT', 80, 'sample', '{}', 'Strategy-4', 'v1', NOW() - INTERVAL '4 days'),
        ('00000000-0000-4000-8000-000000000705', 'MARKET-5-EUR', 'BUY', 90, 'sample', '{}', 'Strategy-5', 'v1', NOW() - INTERVAL '5 days'),
        ('00000000-0000-4000-8000-000000000706', 'MARKET-6-EUR', 'SELL', 100, 'sample', '{}', 'Strategy-6', 'v1', NOW() - INTERVAL '6 days')
    `);
    const repository = new DashboardRepository({
      async connect() {
        return {
          query: database.query.bind(database),
          release() {}
        };
      }
    }, { logger: { error() {} } });

    const now = new Date();
    const bundle = await repository.getAnalysisBundle({ period: "30d", now, limit: 4 });
    const repeated = await repository.getAnalysisBundle({ period: "30d", now, limit: 4 });
    const completeSample = await repository.getAnalysisBundle({ period: "30d", now, limit: 7 });
    const sampling = bundle.manifest.decisionSampling;
    const sampleDistribution = sampling.sampleDistribution;

    assert.deepEqual(
      bundle.decisions.map(({ id }) => id),
      repeated.decisions.map(({ id }) => id)
    );
    assert.ok(bundle.decisions.some(({ id }) =>
      id === "00000000-0000-4000-8000-000000000700"
    ));
    assert.equal(sampling.method.startsWith("trade-linked-first; deterministic round-robin"), true);
    assert.equal(sampling.sourceCount, 7);
    assert.equal(sampling.includedInWindowCount, 4);
    assert.equal(sampling.sampledDecisionCount, 3);
    assert.equal(sampling.linkedDecisionCount, 1);
    assert.equal(sampling.omittedInWindowCount, 3);
    assert.equal(sampling.truncated, true);
    assert.equal(bundle.manifest.truncation.decisions, true);
    assert.equal(sampleDistribution.utcDays.reduce((sum, item) => sum + item.count, 0), 3);
    assert.equal(sampleDistribution.markets.reduce((sum, item) => sum + item.count, 0), 3);
    assert.equal(sampleDistribution.actions.reduce((sum, item) => sum + item.count, 0), 3);
    assert.equal(sampleDistribution.confidenceBands.reduce((sum, item) => sum + item.count, 0), 3);
    assert.equal(sampleDistribution.strategyVersions.reduce((sum, item) => sum + item.count, 0), 3);
    assert.equal(bundle.manifest.candleSampling.includedTradeRelatedAnchors, 1);
    assert.equal(bundle.manifest.candleSampling.includedSampledDecisionAnchors, 3);

    assert.deepEqual(
      completeSample.manifest.decisionSampling.sampleDistribution.confidenceBands,
      [
        { value: "[50,60)", count: 1 },
        { value: "[60,70)", count: 1 },
        { value: "[70,80)", count: 1 },
        { value: "[80,90)", count: 1 },
        { value: "[90,100]", count: 2 }
      ]
    );
    assert.equal(completeSample.manifest.decisionSampling.truncated, false);
  } finally {
    await database.close();
  }
});

test("analysis bundle reserves candle anchors for trade-linked activity before sampled decisions", async () => {
  const database = await createDatabase();
  try {
    await database.exec(`
      INSERT INTO public."AI_Crypto_Bot_Trades"
        (id, portfolio_id, symbol, side, price, quantity, fees, realized_pnl, created_at)
      SELECT
        ('00000000-0000-4000-8000-' || pg_catalog.lpad(sample.id::text, 12, '0'))::uuid,
        '00000000-0000-4000-8000-000000000200',
        'TRADE-' || sample.id::text || '-EUR',
        'BUY', 100, 1, 0, 0, NOW() - (sample.id * INTERVAL '1 minute')
      FROM pg_catalog.generate_series(1, 49) AS sample(id);
      INSERT INTO public."AI_Crypto_Bot_AI_Decisions"
        (id, symbol, decision, confidence, reason, indicators, created_at)
      VALUES (
        '00000000-0000-4000-8000-000000000750',
        'SAMPLED-EUR', 'WAIT', 60, 'sampled decision', '{}', NOW() - INTERVAL '1 hour'
      )
    `);
    const repository = new DashboardRepository({
      async connect() {
        return {
          query: database.query.bind(database),
          release() {}
        };
      }
    }, { logger: { error() {} } });

    const bundle = await repository.getAnalysisBundle({
      period: "30d",
      now: new Date(),
      limit: 100
    });

    assert.equal(bundle.trades.length, 50);
    assert.equal(bundle.manifest.candleSampling.tradeRelatedAnchorCount, 50);
    assert.equal(bundle.manifest.candleSampling.includedTradeRelatedAnchors, 50);
    assert.equal(bundle.manifest.candleSampling.sampledDecisionAnchorCount, 1);
    assert.equal(bundle.manifest.candleSampling.includedSampledDecisionAnchors, 0);
    assert.equal(bundle.manifest.candleSampling.omittedSampledDecisionAnchors, 1);
    assert.equal(bundle.manifest.truncation.candleWindows, true);
  } finally {
    await database.close();
  }
});

test("trade history filtering and pagination preserve all-time sell statistics", async () => {
  const database = await createDatabase();
  try {
    await database.query(`
      INSERT INTO public."AI_Crypto_Bot_Trades"
        (id, portfolio_id, symbol, side, price, quantity, fees, realized_pnl, created_at)
      VALUES
        ('00000000-0000-4000-8000-000000000401',
         '00000000-0000-4000-8000-000000000200', 'ETH-EUR', 'BUY', 200, 1, 0.5, 0,
         '2026-03-20T10:00:00.000Z'),
        ('00000000-0000-4000-8000-000000000402',
         '00000000-0000-4000-8000-000000000200', 'SOL-EUR', 'BUY', 300, 1, 0.5, 0,
         '2026-03-20T11:00:00.000Z')
    `);
    const pool = {
      async connect() {
        return {
          query: database.query.bind(database),
          release() {}
        };
      }
    };
    const repository = new DashboardRepository(pool, { logger: { error() {} } });
    const firstPage = await repository.getTradeHistory({
      page: 1,
      pageSize: 1,
      side: "BUY",
      sort: "price-high",
      now: new Date("2026-03-21T00:00:00.000Z")
    });
    const secondPage = await repository.getTradeHistory({
      page: 2,
      pageSize: 1,
      side: "BUY",
      sort: "price-high",
      now: new Date("2026-03-21T00:00:00.000Z")
    });
    const searched = await repository.getTradeHistory({
      page: 1,
      side: "BUY",
      search: "ETH",
      sort: "oldest",
      now: new Date("2026-03-21T00:00:00.000Z")
    });

    assert.equal(firstPage.totalCount, 2);
    assert.equal(firstPage.totalPages, 2);
    assert.equal(firstPage.items[0].symbol, "SOL-EUR");
    assert.equal(secondPage.items[0].symbol, "ETH-EUR");
    assert.equal(searched.totalCount, 1);
    assert.equal(searched.items[0].symbol, "ETH-EUR");
    for (const result of [firstPage, secondPage, searched]) {
      assert.equal(result.stats.closedTrades, 1);
      assert.equal(result.stats.winningTrades, 1);
      assert.equal(result.stats.averageProfit, 9);
    }
  } finally {
    await database.close();
  }
});

test("full-history export paginates every source and deduplicates candle anchors across pages", async () => {
  const database = await createDatabase();
  try {
    const anchorTimes = Array.from({ length: 11 }, (_, index) =>
      new Date(Date.UTC(2026, 2, 20, index)).toISOString());
    await database.query(`
      UPDATE public."AI_Crypto_Bot_Trades"
      SET created_at = $1
      WHERE id = '00000000-0000-4000-8000-000000000400'
    `, [anchorTimes[0]]);
    await database.query(`
      UPDATE public."AI_Crypto_Bot_AI_Decisions"
      SET created_at = $1
      WHERE id = '00000000-0000-4000-8000-000000000700'
    `, [anchorTimes[0]]);

    for (let index = 1; index < anchorTimes.length; index += 1) {
      const suffix = String(709 + index).padStart(12, "0");
      const symbol = index % 2 === 0 ? "BTC-EUR" : "ETH-EUR";
      await database.query(`
        INSERT INTO public."AI_Crypto_Bot_AI_Decisions"
          (id, symbol, decision, confidence, reason, indicators, created_at)
        VALUES ($1::uuid, $2, 'HOLD', 70, 'Recorded for export pagination.', '{}', $3)
      `, [`00000000-0000-4000-8000-${suffix}`, symbol, anchorTimes[index]]);
      await database.query(`
        INSERT INTO public."AI_Crypto_Bot_Candles"
          (symbol, interval, open, high, low, close, volume, timestamp)
        VALUES ($1, '1m', 10, 11, 9, 10.5, 2, $2)
      `, [symbol, anchorTimes[index]]);
    }
    await database.query(`
      INSERT INTO public."AI_Crypto_Bot_Candles"
        (symbol, interval, open, high, low, close, volume, timestamp)
      VALUES ('BTC-EUR', '1m', 10, 11, 9, 10.5, 2, $1)
    `, [anchorTimes[0]]);
    await database.query(`
      INSERT INTO public."AI_Crypto_Bot_Shadow_Exit_Scenarios"
        (id, position_id, portfolio_id, symbol, position_opened_at, rule_id,
         rule_version, parameters, status, data_quality_status, last_evaluated_at,
         trailing_armed)
      VALUES ('00000000-0000-4000-8000-000000000800',
        '00000000-0000-4000-8000-000000000300',
        '00000000-0000-4000-8000-000000000200',
        'BTC-EUR', $1, 'test-rule', '1', '{}', 'TRACKING', 'FRESH', $1, false)
    `, [anchorTimes[0]]);
    await database.query(`
      INSERT INTO public."AI_Crypto_Bot_Shadow_Exit_Events"
        (id, scenario_id, event_type, event_at, observed_mark, data_quality_status, error_code)
      VALUES ('00000000-0000-4000-8000-000000000801',
        '00000000-0000-4000-8000-000000000800',
        'TRACKING_STARTED', $1, 10, 'FRESH', NULL)
    `, [anchorTimes[0]]);
    await database.query(`
      INSERT INTO public."AI_Crypto_Bot_Analytics_Runs"
        (id, calculation_version, period, period_start, period_end, generated_at,
         source_counts, analytics_summary, insights)
      VALUES ('00000000-0000-4000-8000-000000000802',
        'phase-11.1', '30d', $1, $1, $1, '{}', '{}', '[]')
    `, [anchorTimes[0]]);

    const pool = {
      async connect() {
        return {
          query: database.query.bind(database),
          release() {}
        };
      }
    };
    const repository = new DashboardRepository(pool, { logger: { error() {} } });
    const asOf = new Date("2099-01-01T00:00:00.000Z");
    const manifest = repository.getAnalysisExportManifest({ now: asOf });
    assert.equal(manifest.asOf, asOf.toISOString());
    assert.equal(manifest.limits.rowsPerRequest, 250);
    assert.equal(manifest.limits.candleAnchorsPerRequest, 10);
    assert.ok(manifest.sources.includes("analyticsRuns"));

    for (const [source, expected] of [
      ["trades", 1],
      ["positions", 1],
      ["decisions", 11],
      ["portfolioSnapshots", 1],
      ["shadowExitScenarios", 1],
      ["shadowExitEvents", 1],
      ["analyticsRuns", 1]
    ]) {
      const page = await repository.getAnalysisExportPage({ source, asOf });
      assert.equal(page.items.length, expected, `${source} rows are exported`);
      assert.equal(page.hasMore, false);
    }

    const anchorPages = [];
    let cursor = null;
    do {
      const page = await repository.getAnalysisExportPage({
        source: "candleWindows",
        asOf,
        cursor
      });
      anchorPages.push(page);
      cursor = page.nextCursor;
      assert.ok(page.candleWindows.length <= 1200);
      assert.equal(
        new Set(page.candleWindows.map(({ symbol, interval, timestamp }) =>
          `${symbol}\u0000${interval}\u0000${timestamp}`)).size,
        page.candleWindows.length,
        "each API page returns unique candle rows"
      );
      const pageAnchorKeys = new Set(page.anchors.map(({ symbol, anchorAt }) =>
        `${symbol}\u0000${anchorAt}`));
      assert.ok(page.candleWindows.every(({ symbol, anchorTimes }) =>
        anchorTimes.length > 0 && anchorTimes.every((anchorAt) =>
          pageAnchorKeys.has(`${symbol}\u0000${anchorAt}`))));
    } while (cursor);
    const uniqueAnchors = new Set(anchorPages.flatMap(({ anchors }) =>
      anchors.map(({ symbol, anchorAt }) => `${symbol}\u0000${anchorAt}`)));
    assert.equal(uniqueAnchors.size, 11);
    assert.ok(anchorPages.length > 1);
    assert.ok(anchorPages.every(({ hasMore }) => typeof hasMore === "boolean"));
  } finally {
    await database.close();
  }
});

test("full-history export decision pages use stable keyset cursors without gaps", async () => {
  const database = await createDatabase();
  try {
    await database.exec(`
      DELETE FROM public."AI_Crypto_Bot_AI_Decisions"
      WHERE id = '00000000-0000-4000-8000-000000000700';
      INSERT INTO public."AI_Crypto_Bot_AI_Decisions"
        (id, symbol, decision, confidence, reason, indicators, created_at)
      SELECT ('00000000-0000-4000-8000-' || lpad(sequence_number::text, 12, '0'))::uuid,
             'BTC-EUR', 'HOLD', 70, 'Keyset pagination fixture.', '{}',
             '2026-03-20T00:00:00.000Z'::timestamptz
      FROM generate_series(1, 251) AS values(sequence_number)
    `);
    const pool = {
      async connect() {
        return {
          query: database.query.bind(database),
          release() {}
        };
      }
    };
    const repository = new DashboardRepository(pool, { logger: { error() {} } });
    const asOf = new Date("2099-01-01T00:00:00.000Z");
    const firstPage = await repository.getAnalysisExportPage({
      source: "decisions",
      asOf
    });
    const secondPage = await repository.getAnalysisExportPage({
      source: "decisions",
      asOf,
      cursor: firstPage.nextCursor
    });
    const beforeHistory = await repository.getAnalysisExportPage({
      source: "decisions",
      asOf: new Date("2026-03-19T00:00:00.000Z")
    });

    assert.equal(firstPage.items.length, 250);
    assert.equal(firstPage.hasMore, true);
    assert.ok(firstPage.nextCursor);
    assert.equal(secondPage.items.length, 1);
    assert.equal(secondPage.hasMore, false);
    assert.equal(new Set([...firstPage.items, ...secondPage.items].map(({ id }) => id)).size, 251);
    assert.equal(beforeHistory.items.length, 0);
  } finally {
    await database.close();
  }
});
