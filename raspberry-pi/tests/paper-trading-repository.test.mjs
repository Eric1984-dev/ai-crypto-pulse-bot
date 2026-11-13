import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  PaperTradingRepository,
  PAPER_TRADING_RUN_LOCK_ID,
  SYSTEM_PROFILE_ID
} from "../src/repositories/paper-trading-repository.mjs";

test("paper repository only reads the explicitly provisioned system portfolio", async () => {
  const statements = [];
  const repository = new PaperTradingRepository({
    connect: async () => ({
      query: async () => ({ rows: [] }),
      release() {}
    })
  });
  const client = {
    async query(sql, values) {
      statements.push({ sql, values });
      if (sql.includes("AI_Crypto_Bot_Profiles")) {
        return { rows: [{ id: SYSTEM_PROFILE_ID }] };
      }
      return {
        rows: [{
          id: "00000000-0000-4000-8000-000000000001",
          user_id: SYSTEM_PROFILE_ID,
          starting_balance: "10000",
          available_balance: "9900",
          portfolio_value: "10000"
        }]
      };
    }
  };

  const account = await repository.getSystemPortfolio(client);

  assert.equal(account.status, "READY");
  assert.equal(account.portfolio.available_balance, "9900");
  assert.equal(statements.length, 2);
  assert.deepEqual(statements.map(({ values }) => values), [
    [SYSTEM_PROFILE_ID],
    [SYSTEM_PROFILE_ID]
  ]);
  assert.ok(statements.every(({ sql }) => /^\s*SELECT/i.test(sql)));
  assert.ok(statements[1].sql.includes("FOR UPDATE"));
});

test("paper repository reports missing profile and portfolio without writes", async () => {
  const repository = new PaperTradingRepository({
    connect: async () => ({
      query: async () => ({ rows: [] }),
      release() {}
    })
  });
  let queryCount = 0;
  const missingProfile = await repository.getSystemPortfolio({
    async query() {
      queryCount += 1;
      return { rows: [] };
    }
  });
  assert.deepEqual(missingProfile, { status: "PROFILE_MISSING" });
  assert.equal(queryCount, 1);

  const missingPortfolio = await repository.getSystemPortfolio({
    async query(sql) {
      queryCount += 1;
      return sql.includes("AI_Crypto_Bot_Profiles")
        ? { rows: [{ id: SYSTEM_PROFILE_ID }] }
        : { rows: [] };
    }
  });
  assert.deepEqual(missingPortfolio, { status: "PORTFOLIO_MISSING" });
  assert.equal(queryCount, 3);
});

test("paper repository uses snapshot sequence for same-time daily baselines", async () => {
  const database = new PGlite();
  try {
    const portfolioId = "00000000-0000-4000-8000-000000000101";
    await database.exec(`
      CREATE TABLE public."AI_Crypto_Bot_Portfolios" (
        id uuid PRIMARY KEY,
        starting_balance numeric NOT NULL,
        available_balance numeric NOT NULL,
        portfolio_value numeric NOT NULL
      );
      CREATE TABLE public."AI_Crypto_Bot_Positions" (
        id uuid PRIMARY KEY,
        portfolio_id uuid NOT NULL,
        amount numeric NOT NULL,
        current_price numeric NOT NULL,
        status text NOT NULL
      );
      CREATE TABLE public."AI_Crypto_Bot_Portfolio_Snapshots" (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        portfolio_id uuid NOT NULL,
        portfolio_value numeric NOT NULL,
        available_balance numeric NOT NULL,
        open_positions integer NOT NULL,
        captured_at timestamptz NOT NULL DEFAULT now(),
        snapshot_order bigint GENERATED ALWAYS AS IDENTITY
      );
      INSERT INTO public."AI_Crypto_Bot_Portfolios"
        (id, starting_balance, available_balance, portfolio_value)
      VALUES ('${portfolioId}', 1000, 900, 900);
      INSERT INTO public."AI_Crypto_Bot_Portfolio_Snapshots"
        (portfolio_id, portfolio_value, available_balance, open_positions, captured_at)
      VALUES
        ('${portfolioId}', 1000, 1000, 0, '2026-03-19T23:59:59.000Z'),
        ('${portfolioId}', 900, 900, 0, '2026-03-19T23:59:59.000Z');
    `);

    const repository = new PaperTradingRepository({
      connect: async () => ({
        query: database.query.bind(database),
        release() {}
      })
    });
    const state = await repository.refreshPortfolioState(
      database,
      portfolioId,
      new Date("2026-03-20T00:00:00.000Z")
    );

    assert.equal(state.dailyStartValue, "900");
    assert.equal(state.peakValue, "1000");
  } finally {
    await database.close();
  }
});

test("paper repository rejects multiple system portfolios", async () => {
  const repository = new PaperTradingRepository({
    connect: async () => ({
      query: async () => ({ rows: [] }),
      release() {}
    })
  });

  await assert.rejects(repository.getSystemPortfolio({
    async query(sql) {
      return sql.includes("AI_Crypto_Bot_Profiles")
        ? { rows: [{ id: SYSTEM_PROFILE_ID }] }
        : {
          rows: [
            {
              id: "00000000-0000-4000-8000-000000000001",
              user_id: SYSTEM_PROFILE_ID,
              starting_balance: "10000",
              available_balance: "10000",
              portfolio_value: "10000"
            },
            {
              id: "00000000-0000-4000-8000-000000000002",
              user_id: SYSTEM_PROFILE_ID,
              starting_balance: "10000",
              available_balance: "10000",
              portfolio_value: "10000"
            }
          ]
        };
    }
  }), { code: "PAPER_TRADING_SYSTEM_PORTFOLIO_INVALID" });
});

test("paper repository uses direct parameterized SQL for position aggregation", async () => {
  let captured;
  const repository = new PaperTradingRepository({
    connect: async () => ({
      query: async () => ({ rows: [] }),
      release() {}
    })
  });
  const client = {
    async query(sql, values) {
      captured = { sql, values };
      return { rows: [{ amount: "2.000000000000", entry_cost_basis: "200.000000000000" }] };
    }
  };

  const totals = await repository.getOpenPositionTotals(
    client,
    "00000000-0000-4000-8000-000000000001",
    "BTC-EUR"
  );

  assert.equal(totals.amount, "2.000000000000");
  assert.equal(totals.entryCostBasis, "200.000000000000");
  assert.match(captured.sql, /SUM\(position\.entry_price \* position\.amount\)/i);
  assert.deepEqual(captured.values, [
    "00000000-0000-4000-8000-000000000001",
    "BTC-EUR"
  ]);
});

test("paper repository ratchets exit state without lowering the stop", async () => {
  const database = new PGlite();
  try {
    const positionId = "00000000-0000-4000-8000-000000000101";
    await database.exec(`
      CREATE TABLE public."AI_Crypto_Bot_Positions" (
        id uuid PRIMARY KEY,
        high_water_price numeric NOT NULL,
        trailing_stop_price numeric,
        status text NOT NULL
      );
      INSERT INTO public."AI_Crypto_Bot_Positions"
        (id, high_water_price, trailing_stop_price, status)
      VALUES ('${positionId}', 110, 107, 'OPEN');
    `);
    const repository = new PaperTradingRepository({
      connect: async () => ({
        query: database.query.bind(database),
        release() {}
      })
    });

    const updated = await repository.updatePositionExitState(database, {
      positionId,
      highWaterPrice: "120",
      trailingStopPrice: "103"
    });
    const unchangedStop = await repository.updatePositionExitState(database, {
      positionId,
      highWaterPrice: "119",
      trailingStopPrice: null
    });

    assert.deepEqual(updated, {
      highWaterPrice: "120",
      trailingStopPrice: "107"
    });
    assert.deepEqual(unchangedStop, {
      highWaterPrice: "120",
      trailingStopPrice: "107"
    });
  } finally {
    await database.close();
  }
});

test("Phase 8.14 migration backfills exit state and constrains automatic SELL attribution", async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE TABLE public."AI_Crypto_Bot_Positions" (
        id uuid PRIMARY KEY,
        entry_price numeric(28, 12) NOT NULL,
        current_price numeric(28, 12) NOT NULL
      );
      CREATE TABLE public."AI_Crypto_Bot_Trades" (
        id uuid PRIMARY KEY,
        ai_decision_id uuid,
        side text NOT NULL
      );
      CREATE TABLE public."AI_Crypto_Bot_Candles" (
        symbol text NOT NULL
      );
      CREATE ROLE paper_writer LOGIN;
      INSERT INTO public."AI_Crypto_Bot_Positions" (id, entry_price, current_price)
      VALUES ('00000000-0000-4000-8000-000000000106', 100, 105);
      INSERT INTO public."AI_Crypto_Bot_Trades" (id, ai_decision_id, side)
      VALUES ('00000000-0000-4000-8000-000000000107', NULL, 'SELL');
    `);
    await database.query(`
      SELECT pg_catalog.set_config(
        'cryptopulse.paper_database_user',
        'paper_writer',
        false
      )
    `);
    const migration = await readFile(
      new URL("../migrations/phase-8.14-position-aware-trailing-exits.sql", import.meta.url),
      "utf8"
    );

    await database.exec(migration);

    const position = await database.query(`
      SELECT high_water_price, trailing_stop_price
      FROM public."AI_Crypto_Bot_Positions"
      WHERE id = '00000000-0000-4000-8000-000000000106'
    `);
    const trade = await database.query(`
      SELECT execution_reason
      FROM public."AI_Crypto_Bot_Trades"
      WHERE id = '00000000-0000-4000-8000-000000000107'
    `);
    assert.equal(position.rows[0].high_water_price, "105.000000000000");
    assert.equal(position.rows[0].trailing_stop_price, null);
    assert.equal(trade.rows[0].execution_reason, "AI_DECISION");
    const candlePrivileges = await database.query(`
      SELECT pg_catalog.has_table_privilege(
        'paper_writer',
        'public."AI_Crypto_Bot_Candles"',
        'SELECT'
      ) AS can_select,
      pg_catalog.has_table_privilege(
        'paper_writer',
        'public."AI_Crypto_Bot_Candles"',
        'UPDATE'
      ) AS can_update
    `);
    assert.equal(candlePrivileges.rows[0].can_select, true);
    assert.equal(candlePrivileges.rows[0].can_update, false);

    await database.query(`
      INSERT INTO public."AI_Crypto_Bot_Trades"
        (id, ai_decision_id, side, execution_reason)
      VALUES ('00000000-0000-4000-8000-000000000108', NULL, 'SELL', 'ATR_TRAILING_EXIT')
    `);
    await assert.rejects(database.query(`
      INSERT INTO public."AI_Crypto_Bot_Trades"
        (id, ai_decision_id, side, execution_reason)
      VALUES ('00000000-0000-4000-8000-000000000109', NULL, 'BUY', 'ATR_TRAILING_EXIT')
    `));
  } finally {
    await database.close();
  }
});

test("automatic position exits create auditable SELL trades without AI-decision attribution", async () => {
  const statements = [];
  const repository = new PaperTradingRepository({
    connect: async () => ({
      query: async () => ({ rows: [] }),
      release() {}
    })
  });
  const client = {
    async query(sql, values) {
      statements.push({ sql, values });
      if (sql.includes('UPDATE public."AI_Crypto_Bot_Positions"')) {
        return { rowCount: 1, rows: [{ id: values[1] }] };
      }
      if (sql.includes('INSERT INTO public."AI_Crypto_Bot_Trades"')) {
        return { rowCount: 1, rows: [{ id: "00000000-0000-4000-8000-000000000104" }] };
      }
      if (sql.includes('UPDATE public."AI_Crypto_Bot_Portfolios"')) {
        return {
          rows: [{
            available_balance: "1000",
            portfolio_value: "1000",
            open_positions: 0
          }]
        };
      }
      return { rowCount: 1, rows: [] };
    }
  };
  const portfolioId = "00000000-0000-4000-8000-000000000102";
  const positionId = "00000000-0000-4000-8000-000000000103";

  await repository.insertSell(client, {
    portfolioId,
    decisionId: null,
    idempotencyKey: "00000000-0000-4000-8000-000000000105",
    symbol: "BTC-EUR",
    marketPrice: "110",
    positionId,
    executionReason: "ATR_TRAILING_EXIT",
    quote: {
      execution_price: "109.89",
      amount: "1",
      fee: "0.274725",
      slippage: "0.11",
      realized_pnl: "9",
      net_proceeds: "109.615275"
    }
  });

  const closeStatement = statements.find(({ sql }) =>
    sql.includes('UPDATE public."AI_Crypto_Bot_Positions"'));
  const insertStatement = statements.find(({ sql }) =>
    sql.includes('INSERT INTO public."AI_Crypto_Bot_Trades"'));
  assert.deepEqual(closeStatement.values, [portfolioId, positionId, "110"]);
  assert.equal(insertStatement.values[1], null);
  assert.equal(insertStatement.values[10], "ATR_TRAILING_EXIT");
});

test("paper repository acquires its transaction lock and status updates use distinct helpers", async () => {
  const statements = [];
  const client = {
    async query(sql, values) {
      statements.push({ sql, values });
      if (sql.includes("pg_try_advisory_xact_lock")) {
        return { rows: [{ locked: true }] };
      }
      if (sql.includes("AI_Crypto_Bot_Status") && sql.trimStart().startsWith("SELECT")) {
        return {
          rows: [{
            status: "ACTIVE",
            is_active: true,
            is_analyzing: false,
            last_run: null
          }]
        };
      }
      if (sql.includes("UPDATE public.\"AI_Crypto_Bot_Status\"")) {
        return { rows: [{ status: values[0] }] };
      }
      return { rows: [] };
    },
    release() {}
  };
  const repository = new PaperTradingRepository({
    connect: async () => client
  });

  assert.equal(await repository.withTransaction(async (transaction) => {
    assert.equal(await repository.tryAcquireRunLock(transaction), true);
    return repository.updateStatusInTransaction(transaction, {
      status: "IDLE",
      updatedAt: new Date("2026-01-01T00:00:00.000Z")
    });
  }), "IDLE");

  assert.equal(statements[1].values[0], PAPER_TRADING_RUN_LOCK_ID);
  assert.ok(statements.some(({ sql }) => sql.includes("UPDATE public.\"AI_Crypto_Bot_Status\"")));
  assert.equal(statements.at(-1).sql, "COMMIT");
});

test("paper repository evaluates shadow exits in a separate transaction", async () => {
  const statements = [];
  const evaluation = {
    status: "COMPLETED",
    positionsEvaluated: 2,
    scenariosCreated: 1,
    scenariosUpdated: 1,
    scenariosTriggered: 0,
    positionsFinalized: 0,
    waitingForFreshData: 0
  };
  const repository = new PaperTradingRepository({
    async connect() {
      return {
        async query(sql) {
          statements.push(sql);
          return sql.includes("AI_Crypto_Bot_Evaluate_Shadow_Exit_Scenarios")
            ? { rows: [{ evaluation }] }
            : { rows: [] };
        },
        release() {}
      };
    }
  });

  assert.deepEqual(await repository.evaluateShadowExitScenarios(), evaluation);
  assert.equal(statements[0], "BEGIN READ WRITE");
  assert.match(statements[1], /SELECT public\."AI_Crypto_Bot_Evaluate_Shadow_Exit_Scenarios"\(\)/);
  assert.equal(statements[2], "COMMIT");
});

test("paper repository rejects malformed shadow-exit evaluator results", async () => {
  const repository = new PaperTradingRepository({
    async connect() {
      return {
        async query(sql) {
          return sql.includes("AI_Crypto_Bot_Evaluate_Shadow_Exit_Scenarios")
            ? { rows: [{ evaluation: { status: "COMPLETED", scenariosCreated: -1 } }] }
            : { rows: [] };
        },
        release() {}
      };
    }
  });

  await assert.rejects(
    repository.evaluateShadowExitScenarios(),
    { code: "SHADOW_EXIT_RESULT_INVALID" }
  );
});

test("paper repository attaches emergency-state SELECT context to SQLSTATE errors", async () => {
  const denied = Object.assign(
    new Error('permission denied for table "AI_Crypto_Bot_Emergency_State"'),
    { code: "42501" }
  );
  const client = {
    async query(sql) {
      if (sql.includes("AI_Crypto_Bot_Emergency_State")) {
        throw denied;
      }
      return { rows: [] };
    },
    release() {}
  };
  const repository = new PaperTradingRepository({
    connect: async () => client
  });

  await assert.rejects(
    repository.withTransaction((transaction) =>
      repository.getLatestEmergencyStatus(transaction)),
    (error) => {
      assert.equal(error.code, "42501");
      assert.deepEqual(error.paperTradingContext, {
        table: "AI_Crypto_Bot_Emergency_State",
        operation: "SELECT",
        requiredPrivilege: "SELECT",
        repositoryOperation: "getLatestEmergencyStatus"
      });
      return true;
    }
  );
});

test("paper repository reads emergency state without an UPDATE-dependent row lock", async () => {
  let capturedSql;
  const repository = new PaperTradingRepository({
    async connect() {
      return { async query() { return { rows: [] }; }, release() {} };
    }
  });

  assert.equal(await repository.getLatestEmergencyStatus({
    async query(sql) {
      capturedSql = sql;
      return { rows: [] };
    }
  }), "NORMAL");
  assert.match(capturedSql, /FROM public\."AI_Crypto_Bot_Emergency_State"/);
  assert.doesNotMatch(capturedSql, /FOR\s+UPDATE/i);
});

test("paper repository fails closed on malformed agent status", async () => {
  const repository = new PaperTradingRepository({
    async query() {
      return { rows: [{ status: "UNKNOWN", is_active: false, is_analyzing: false }] };
    },
    async connect() {
      return {
        async query() {
          return { rows: [{ status: "UNKNOWN", is_active: false, is_analyzing: false }] };
        },
        release() {}
      };
    }
  });

  await assert.rejects(repository.getAgentStatus({
    query: async () => ({
      rows: [{ status: "UNKNOWN", is_active: false, is_analyzing: false }]
    })
  }), { code: "PAPER_TRADING_STATUS_INVALID" });
});
