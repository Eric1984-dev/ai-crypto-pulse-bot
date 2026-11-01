import configuredMarkets from "../config/markets.js";
import { buildMarketScannerSummary } from "./market-scanner.mjs";

export const MARKET_CACHE_TTL_MS = 60_000;
export const SUPPORTED_CANDLE_INTERVALS = Object.freeze(["1m", "5m", "15m", "1h", "4h", "1d"]);
export const MAX_CANDLE_LIMIT = 500;

const BITVAVO_API = "https://api.bitvavo.com/v2";
const MARKET_TABLE = "AI_Crypto_Bot_Watched_Markets";
const MARKET_DATA_TABLE = "AI_Crypto_Bot_Market_Data";
const CANDLES_TABLE = "AI_Crypto_Bot_Candles";
const SCANNER_EVENTS_TABLE = "AI_Crypto_Bot_Scanner_Events";
const REQUEST_TIMEOUT_MS = 8000;
const DB_ROW_LIMIT = 2000;
const SCANNER_QUERY_PAGE_SIZE = 1000;
const SCANNER_MAX_DECISION_ROWS = 5000;
const SCHEDULED_CANDLE_REFRESH_CONCURRENCY = 4;
const SCHEDULED_CANDLE_REFRESH_BATCH_SIZE = 5;
const CANDLE_INTERVAL_MS = Object.freeze({
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000
});

export function createMarketDataService({
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  logger = console,
  markets = configuredMarkets
} = {}) {
  let marketCatalogCache = null;
  let tickerCache = null;
  let lastMarketSync = 0;
  const candleCache = new Map();

  async function getMarketSummary({ config, accessToken, serviceRoleKey, refreshMetrics = null }) {
    const readHeaders = createDatabaseHeaders(config, accessToken, serviceRoleKey);
    let refreshStatus = serviceRoleKey ? "fresh" : "storage-not-configured";
    let watchedMarkets = await fetchDatabaseRows(
      config,
      readHeaders,
      MARKET_TABLE,
      { select: "symbol,enabled,priority", order: "priority.asc,symbol.asc", limit: String(DB_ROW_LIMIT) },
      fetchImpl,
      null,
      "summary.watched-markets.initial"
    );

    if (serviceRoleKey) {
      try {
        const catalog = await getMarketCatalog();
        const validCatalog = catalog.filter(isTradableEurMarket);
        const validSymbols = new Set(validCatalog.map(({ market }) => market));
        const invalidMarkets = markets.filter(({ symbol }) => !validSymbols.has(symbol));
        const eventAnchor = findEventAnchor(watchedMarkets, validSymbols);
        if (eventAnchor && invalidMarkets.length) {
          await writeScannerEvents(config, serviceRoleKey, invalidMarkets.map(({ symbol }) => ({
            symbol: eventAnchor,
            event_type: "MARKET_VALIDATION_ERROR",
            reason: `Configured market ${symbol} is unavailable or not trading on Bitvavo.`
          })), fetchImpl, logger);
        }

        const existingSymbols = new Set(watchedMarkets.map(({ symbol }) => symbol));
        const newMarkets = markets
          .filter(({ symbol }) => validSymbols.has(symbol) && !existingSymbols.has(symbol))
          .map(({ symbol, enabled, priority }) => ({ symbol, enabled, priority }));

        if (newMarkets.length && nowMs() - lastMarketSync >= MARKET_CACHE_TTL_MS) {
          await writeDatabaseRows(
            config,
            serviceRoleKey,
            MARKET_TABLE,
            newMarkets,
            "symbol",
            "ignore-duplicates",
            fetchImpl
          );
          lastMarketSync = nowMs();
          watchedMarkets = await fetchDatabaseRows(
            config,
            readHeaders,
            MARKET_TABLE,
            { select: "symbol,enabled,priority", order: "priority.asc,symbol.asc", limit: String(DB_ROW_LIMIT) },
            fetchImpl,
            null,
            "summary.watched-markets.after-sync"
          );
        } else if (nowMs() - lastMarketSync >= MARKET_CACHE_TTL_MS) {
          lastMarketSync = nowMs();
        }

        const enabledMarkets = watchedMarkets.filter((market) =>
          market.enabled === true && validSymbols.has(market.symbol)
        );
        const existingData = await fetchDatabaseRows(
          config,
          readHeaders,
          MARKET_DATA_TABLE,
          { select: "symbol,price,volume,daily_change,high_24h,low_24h,captured_at", limit: String(DB_ROW_LIMIT) },
          fetchImpl,
          null,
          "summary.market-data.refresh-check"
        );
        const dataBySymbol = new Map(existingData.map((item) => [item.symbol, item]));
        const staleMarkets = enabledMarkets.filter((market) =>
          !isFresh(dataBySymbol.get(market.symbol)?.captured_at, nowMs())
        );

        if (staleMarkets.length) {
          try {
            const tickers = await getTickers();
            const tickerBySymbol = new Map(tickers.map((ticker) => [ticker.market, ticker]));
            const capturedAt = nowIso();
            const updates = [];
            const missing = [];
            for (const market of staleMarkets) {
              const ticker = tickerBySymbol.get(market.symbol);
              const parsed = ticker && parseTicker24h(ticker, capturedAt);
              if (!parsed) {
                missing.push({
                  symbol: market.symbol,
                  event_type: "MARKET_DATA_MISSING",
                  reason: `Bitvavo returned no valid 24-hour ticker data for ${market.symbol}.`
                });
                continue;
              }
              updates.push(parsed);
            }

            if (updates.length) {
              await writeDatabaseRows(
                config,
                serviceRoleKey,
                MARKET_DATA_TABLE,
                updates,
                "symbol",
                "merge-duplicates",
                fetchImpl
              );
              if (refreshMetrics) {
                refreshMetrics.marketDataRecordsProcessed += updates.length;
              }
              refreshStatus = "refreshed";
            } else {
              refreshStatus = "empty";
            }
            if (missing.length) {
              await writeScannerEvents(config, serviceRoleKey, missing, fetchImpl, logger);
            }
          } catch (error) {
            refreshStatus = error instanceof ProviderError ? error.code : "storage-unavailable";
            logFailure(logger, "Bitvavo market data refresh failed.", error);
            const anchor = enabledMarkets[0]?.symbol;
            if (anchor) {
              await writeScannerEvents(config, serviceRoleKey, [{
                symbol: anchor,
                event_type: error instanceof ProviderError ? error.code : "MARKET_DATA_STORAGE_ERROR",
                reason: "Market data refresh failed; the latest stored snapshot remains in use."
              }], fetchImpl, logger);
            }
          }
        }
      } catch (error) {
        refreshStatus = error instanceof ProviderError ? error.code : "storage-unavailable";
        logFailure(logger, "Market validation or synchronization failed.", error);
        const eventAnchor = findEventAnchor(
          watchedMarkets,
          new Set(watchedMarkets.map(({ symbol }) => symbol))
        );
        if (eventAnchor) {
          await writeScannerEvents(config, serviceRoleKey, [{
            symbol: eventAnchor,
            event_type: error instanceof ProviderError ? error.code : "MARKET_DATA_STORAGE_ERROR",
            reason: "Market validation or refresh failed; the latest stored market data remains in use."
          }], fetchImpl, logger);
        }
      }

      try {
        watchedMarkets = await fetchDatabaseRows(
          config,
          readHeaders,
          MARKET_TABLE,
          { select: "symbol,enabled,priority", order: "priority.asc,symbol.asc", limit: String(DB_ROW_LIMIT) },
          fetchImpl,
          null,
          "summary.watched-markets.final"
        );
      } catch (error) {
        logFailure(logger, "Watched market refresh failed; using the last successful list.", error);
      }
    }

    const activeMarkets = watchedMarkets.filter((market) => market.enabled === true);
    const marketData = activeMarkets.length
      ? await fetchDatabaseRows(
        config,
        readHeaders,
        MARKET_DATA_TABLE,
        {
          select: "symbol,price,volume,daily_change,high_24h,low_24h,captured_at",
          symbol: `in.(${activeMarkets.map(({ symbol }) => symbol).join(",")})`,
          order: "captured_at.desc",
          limit: String(DB_ROW_LIMIT)
        },
        fetchImpl,
        null,
        "summary.active-market-data"
      )
      : [];
    const activeSymbols = new Set(activeMarkets.map(({ symbol }) => symbol));
    const visibleData = marketData.filter((row) => activeSymbols.has(row.symbol));
    const latestCapturedAt = visibleData.reduce((latest, row) =>
      row.captured_at > latest ? row.captured_at : latest, "");

    return {
      activeMarkets: activeMarkets.length,
      marketsWithData: new Set(visibleData.map(({ symbol }) => symbol)).size,
      items: visibleData,
      refreshedAt: latestCapturedAt || null,
      refreshStatus,
      enabledMarketRows: activeMarkets
    };
  }

  async function getMarketScannerSummary({ config, accessToken, serviceRoleKey, activeMarkets, marketData }) {
    const nowMsValue = nowMs();
    const nowDate = new Date(nowMsValue);
    const enabledMarkets = Array.isArray(activeMarkets)
      ? activeMarkets.filter((market) => market && market.enabled === true
        && typeof market.symbol === "string" && /^[A-Z0-9]+-EUR$/.test(market.symbol))
      : [];
    if (!enabledMarkets.length) {
      return buildMarketScannerSummary({
        activeMarkets: [],
        marketData: [],
        dailyCandles: [],
        hourlyCandles: [],
        decisions: [],
        now: nowDate
      });
    }

    const symbols = [...new Set(enabledMarkets.map(({ symbol }) => symbol))];
    const symbolFilter = `in.(${symbols.join(",")})`;
    const headers = createDatabaseHeaders(config, accessToken, serviceRoleKey);
    const [dailyCandles, hourlyCandles, decisions] = await Promise.all([
      fetchDatabaseRowsPaged(
        config,
        headers,
        CANDLES_TABLE,
        {
          select: "symbol,interval,close,volume,timestamp",
          symbol: symbolFilter,
          interval: "eq.1d",
          timestamp: `gte.${new Date(nowMsValue - 32 * 24 * 60 * 60 * 1000).toISOString()}`,
          order: "symbol.asc,timestamp.asc"
        },
        fetchImpl,
        symbols.length * 34,
        "scanner.daily-candles"
      ),
      fetchDatabaseRowsPaged(
        config,
        headers,
        CANDLES_TABLE,
        {
          select: "symbol,interval,close,volume,timestamp",
          symbol: symbolFilter,
          interval: "eq.1h",
          timestamp: `gte.${new Date(nowMsValue - 10 * 60 * 60 * 1000).toISOString()}`,
          order: "symbol.asc,timestamp.asc"
        },
        fetchImpl,
        symbols.length * 12,
        "scanner.hourly-candles"
      ),
      fetchLatestScannerDecisions(
        config,
        headers,
        symbolFilter,
        new Set(symbols),
        new Date(nowMsValue - 30 * 24 * 60 * 60 * 1000).toISOString(),
        fetchImpl,
        "scanner.ai-decisions"
      )
    ]);

    return buildMarketScannerSummary({
      activeMarkets: enabledMarkets,
      marketData: Array.isArray(marketData) ? marketData : [],
      dailyCandles,
      hourlyCandles,
      decisions,
      now: nowDate
    });
  }

  async function getMarket({ config, accessToken, serviceRoleKey, symbol, interval, limit }) {
    const summary = await getMarketSummary({ config, accessToken, serviceRoleKey });
    const market = summary.items.find((item) => item.symbol === symbol) || null;
    const watched = await fetchDatabaseRows(
      config,
      createDatabaseHeaders(config, accessToken, serviceRoleKey),
      MARKET_TABLE,
      { select: "symbol,enabled", symbol: `eq.${symbol}`, limit: "1" },
      fetchImpl
    );
    if (!watched[0] || watched[0].enabled !== true) {
      return { found: false, data: null };
    }

    let candleRefreshStatus = summary.refreshStatus;
    if (serviceRoleKey) {
      try {
        await refreshCandles({ config, serviceRoleKey, symbol, interval, limit });
      } catch (error) {
        candleRefreshStatus = error instanceof ProviderError ? error.code : "storage-unavailable";
        candleCache.set(`${symbol}:${interval}`, createCandleCacheEntry(limit, true));
        logFailure(logger, "Market candle refresh failed; stored candles remain in use.", error);
        await writeScannerEvents(config, serviceRoleKey, [{
          symbol,
          event_type: error instanceof ProviderError ? error.code : "CANDLE_DATA_STORAGE_ERROR",
          reason: "Candle refresh failed; the latest stored candles remain in use."
        }], fetchImpl, logger);
      }
    }

    const candles = await fetchDatabaseRows(
      config,
      createDatabaseHeaders(config, accessToken, serviceRoleKey),
      CANDLES_TABLE,
      {
        select: "symbol,interval,open,high,low,close,volume,timestamp",
        symbol: `eq.${symbol}`,
        interval: `eq.${interval}`,
        order: "timestamp.desc",
        limit: String(limit)
      },
      fetchImpl
    );

    return {
      found: true,
      data: {
        symbol,
        interval,
        marketData: market,
        candles,
        refreshStatus: candleRefreshStatus
      }
    };
  }

  async function refreshScheduledMarkets({ config, serviceRoleKey }) {
    if (!serviceRoleKey) {
      throw new StorageError("SUPABASE_SERVICE_ROLE_KEY is required for scheduled market refresh.");
    }
    const refreshStartedAt = performance.now();
    const refreshMetrics = { marketDataRecordsProcessed: 0 };
    const marketDataStartedAt = performance.now();
    const summary = await getMarketSummary({
      config,
      accessToken: null,
      serviceRoleKey,
      refreshMetrics
    });
    const marketDataRefreshDurationMs = elapsedMilliseconds(marketDataStartedAt);
    return {
      ...summary,
      metrics: {
        marketRefreshDurationMs: elapsedMilliseconds(refreshStartedAt),
        marketDataRefreshDurationMs,
        recordsProcessed: {
          marketData: refreshMetrics.marketDataRecordsProcessed,
          total: refreshMetrics.marketDataRecordsProcessed
        }
      }
    };
  }

  async function refreshScheduledCandleBatch({ config, serviceRoleKey, interval, batch }) {
    if (!SUPPORTED_CANDLE_INTERVALS.includes(interval)) {
      throw createCandleRefreshInputError("A supported candle interval is required.");
    }
    if (!Number.isSafeInteger(batch) || batch < 0) {
      throw createCandleRefreshInputError("The candle refresh batch must be a non-negative integer.");
    }
    if (!serviceRoleKey) {
      throw new StorageError("SUPABASE_SERVICE_ROLE_KEY is required for scheduled candle refresh.");
    }

    const refreshStartedAt = performance.now();
    const metricsFor = (recordsProcessed) => ({
      candleRefreshDurationMs: elapsedMilliseconds(refreshStartedAt),
      recordsProcessed: { candles: recordsProcessed }
    });
    let watchedMarkets;
    let catalog;
    try {
      [watchedMarkets, catalog] = await Promise.all([
        fetchDatabaseRows(
          config,
          createDatabaseHeaders(config, null, serviceRoleKey),
          MARKET_TABLE,
          {
            select: "symbol,enabled,priority",
            enabled: "eq.true",
            order: "priority.asc,symbol.asc",
            limit: String(DB_ROW_LIMIT)
          },
          fetchImpl
        ),
        getMarketCatalog()
      ]);
    } catch (error) {
      logFailure(logger, "Scheduled candle market selection failed.", error);
      const anchor = watchedMarkets?.[0]?.symbol;
      if (anchor) {
        await writeScannerEvents(config, serviceRoleKey, [{
          symbol: anchor,
          event_type: "CANDLE_REFRESH_UNAVAILABLE",
          reason: "Scheduled candle refresh could not load enabled markets or the public market catalog."
        }], fetchImpl, logger);
      }
      return {
        status: error instanceof ProviderError ? error.code : "storage-unavailable",
        markets: 0,
        interval,
        batch,
        batchSize: SCHEDULED_CANDLE_REFRESH_BATCH_SIZE,
        batchCount: 0,
        selectedMarkets: 0,
        attempted: 0,
        refreshed: 0,
        missing: 0,
        failed: 1,
        cached: 0,
        skipped: 0,
        unchanged: 0,
        providerRequests: 0,
        candlesUpserted: 0,
        metrics: metricsFor(0)
      };
    }

    const validSymbols = new Set(catalog.filter(isTradableEurMarket).map(({ market }) => market));
    const activeMarkets = watchedMarkets.filter((market) =>
      market.enabled === true && validSymbols.has(market.symbol)
    );
    const batchCount = Math.ceil(activeMarkets.length / SCHEDULED_CANDLE_REFRESH_BATCH_SIZE);
    if (batch >= batchCount && batchCount > 0) {
      throw createCandleRefreshInputError("The requested candle refresh batch is outside the active market range.");
    }
    const selectedMarkets = activeMarkets.slice(
      batch * SCHEDULED_CANDLE_REFRESH_BATCH_SIZE,
      (batch + 1) * SCHEDULED_CANDLE_REFRESH_BATCH_SIZE
    );
    const jobs = selectedMarkets.map(({ symbol }) => ({ symbol, interval }));
    const result = {
      status: jobs.length ? "fresh" : "no-markets",
      markets: activeMarkets.length,
      interval,
      batch,
      batchSize: SCHEDULED_CANDLE_REFRESH_BATCH_SIZE,
      batchCount,
      selectedMarkets: selectedMarkets.length,
      attempted: 0,
      refreshed: 0,
      missing: 0,
      failed: 0,
      cached: 0,
      unchanged: 0,
      providerRequests: 0,
      skipped: 0,
      candlesUpserted: 0
    };
    let latestCandles;
    try {
      latestCandles = await getLatestStoredCandles(config, serviceRoleKey, selectedMarkets, [interval]);
    } catch (error) {
      logFailure(logger, "Latest stored candle timestamps could not be loaded.", error);
      const anchor = selectedMarkets[0]?.symbol;
      if (anchor) {
        await writeScannerEvents(config, serviceRoleKey, [{
          symbol: anchor,
          event_type: "CANDLE_REFRESH_UNAVAILABLE",
          reason: "Scheduled candle refresh could not load the latest stored candle timestamps."
        }], fetchImpl, logger);
      }
      result.status = "storage-unavailable";
      result.failed = 1;
      result.skipped = jobs.length;
      result.metrics = metricsFor(result.candlesUpserted);
      return result;
    }
    let nextJobIndex = 0;
    let storageUnavailable = false;
    let providerUnavailable = false;

    async function refreshWorker() {
      while (!storageUnavailable && !providerUnavailable) {
        const job = jobs[nextJobIndex];
        nextJobIndex += 1;
        if (!job) {
          return;
        }
        result.attempted += 1;
        const intervalDuration = CANDLE_INTERVAL_MS[job.interval];
        const latestTimestamp = latestCandles.get(`${job.symbol}:${job.interval}`);
        const referenceTime = nowMs();
        let start = null;
        let limit = MAX_CANDLE_LIMIT;
        if (latestTimestamp !== undefined) {
          const elapsedSinceLatest = referenceTime - latestTimestamp;
          if (elapsedSinceLatest < intervalDuration) {
            result.unchanged += 1;
            continue;
          }
          start = latestTimestamp;
          limit = Math.min(
            MAX_CANDLE_LIMIT,
            Math.max(2, Math.floor(elapsedSinceLatest / intervalDuration) + 1)
          );
        }
        try {
          const cacheHit = isCandleCacheFresh(
            candleCache.get(`${job.symbol}:${job.interval}`),
            limit,
            referenceTime
          );
          if (!cacheHit) {
            result.providerRequests += 1;
          }
          const refresh = await refreshCandles({
            config,
            serviceRoleKey,
            symbol: job.symbol,
            interval: job.interval,
            limit,
            start
          });
          if (refresh.status === "refreshed") {
            result.refreshed += 1;
            result.candlesUpserted += refresh.candles;
          } else if (refresh.status === "missing") {
            result.missing += 1;
          } else {
            result.cached += 1;
          }
        } catch (error) {
          result.failed += 1;
          candleCache.set(`${job.symbol}:${job.interval}`, createCandleCacheEntry(MAX_CANDLE_LIMIT, true));
          logFailure(logger, "Scheduled candle refresh failed.", error);
          await writeScannerEvents(config, serviceRoleKey, [{
            symbol: job.symbol,
            event_type: error instanceof ProviderError ? error.code : "CANDLE_DATA_STORAGE_ERROR",
            reason: `Scheduled ${job.interval} candle refresh failed; existing candle history remains in use.`
          }], fetchImpl, logger);
          if (error instanceof StorageError) {
            storageUnavailable = true;
          } else if (error instanceof ProviderError && [
            "PROVIDER_TIMEOUT",
            "RATE_LIMITED",
            "PROVIDER_UNAVAILABLE",
            "INVALID_PROVIDER_RESPONSE"
          ].includes(error.code)) {
            providerUnavailable = true;
          }
        }
      }
    }
    const workerCount = Math.min(SCHEDULED_CANDLE_REFRESH_CONCURRENCY, jobs.length);
    await Promise.all(Array.from({ length: workerCount }, () => refreshWorker()));
    result.skipped = jobs.length - result.attempted;
    if (storageUnavailable) {
      result.status = "storage-unavailable";
    } else if (providerUnavailable) {
      result.status = "provider-unavailable";
    } else if (result.failed || result.missing) {
      result.status = "partial";
    } else if (result.refreshed) {
      result.status = "refreshed";
    } else if (result.cached) {
      result.status = "cached";
    } else if (result.unchanged) {
      result.status = "up-to-date";
    } else {
      result.status = jobs.length ? "cached" : "no-markets";
    }
    result.metrics = metricsFor(result.candlesUpserted);
    return result;
  }

  async function getLatestStoredCandles(
    config,
    serviceRoleKey,
    activeMarkets,
    intervals = SUPPORTED_CANDLE_INTERVALS
  ) {
    const latestByKey = new Map();
    if (!activeMarkets.length) {
      return latestByKey;
    }
    const symbols = activeMarkets.map(({ symbol }) => symbol);
    const headers = createDatabaseHeaders(config, null, serviceRoleKey);
    await Promise.all(intervals.map(async (interval) => {
      const rows = await fetchDatabaseRows(
        config,
        headers,
        CANDLES_TABLE,
        {
          select: "symbol,timestamp",
          symbol: `in.(${symbols.join(",")})`,
          interval: `eq.${interval}`,
          order: "timestamp.desc",
          limit: String(DB_ROW_LIMIT)
        },
        fetchImpl
      );
      for (const row of rows) {
        const timestamp = Date.parse(row.timestamp || "");
        const key = `${row.symbol}:${interval}`;
        if (Number.isFinite(timestamp) && (!latestByKey.has(key) || timestamp > latestByKey.get(key))) {
          latestByKey.set(key, timestamp);
        }
      }

      if (!rows.length) {
        return;
      }
      const missingSymbols = symbols.filter((symbol) => !latestByKey.has(`${symbol}:${interval}`));
      await Promise.all(missingSymbols.map(async (symbol) => {
        const latestRows = await fetchDatabaseRows(
          config,
          headers,
          CANDLES_TABLE,
          {
            select: "symbol,timestamp",
            symbol: `eq.${symbol}`,
            interval: `eq.${interval}`,
            order: "timestamp.desc",
            limit: "1"
          },
          fetchImpl
        );
        const timestamp = Date.parse(latestRows[0]?.timestamp || "");
        if (Number.isFinite(timestamp)) {
          latestByKey.set(`${symbol}:${interval}`, timestamp);
        }
      }));
    }));
    return latestByKey;
  }

  async function refreshCandles({ config, serviceRoleKey, symbol, interval, limit, start = null }) {
    const cacheKey = `${symbol}:${interval}`;
    if (isCandleCacheFresh(candleCache.get(cacheKey), limit, nowMs())) {
      return { status: "cached", candles: 0 };
    }
    const query = new URLSearchParams({ interval, limit: String(limit) });
    if (Number.isFinite(start)) {
      query.set("start", String(start));
    }
    const rows = await fetchBitvavoJson(
      `/${encodeURIComponent(symbol)}/candles?${query.toString()}`
    );
    const parsedCandles = parseCandles(rows, symbol, interval);
    if (!parsedCandles.length) {
      const event = {
        symbol,
        event_type: "CANDLE_DATA_MISSING",
        reason: `Bitvavo returned no valid ${interval} candle data for ${symbol}.`
      };
      await writeScannerEvents(config, serviceRoleKey, [event], fetchImpl, logger);
      candleCache.set(cacheKey, createCandleCacheEntry(limit, true));
      return { status: "missing", candles: 0 };
    }
    await writeDatabaseRows(
      config,
      serviceRoleKey,
      CANDLES_TABLE,
      parsedCandles,
      "symbol,interval,timestamp",
      "merge-duplicates",
      fetchImpl
    );
    candleCache.set(cacheKey, createCandleCacheEntry(limit, false));
    return { status: "refreshed", candles: parsedCandles.length };
  }

  async function getMarketCatalog() {
    const timestamp = nowMs();
    if (marketCatalogCache && marketCatalogCache.expiresAt > timestamp) {
      if (marketCatalogCache.error) {
        throw marketCatalogCache.error;
      }
      return marketCatalogCache.value;
    }
    try {
      const rows = await fetchBitvavoJson("/markets");
      if (!Array.isArray(rows) || rows.length === 0) {
        throw new ProviderError("PROVIDER_EMPTY", "Bitvavo returned an empty market catalog.");
      }
      marketCatalogCache = {
        value: rows.filter((item) =>
          item && typeof item.market === "string" && typeof item.status === "string"
        ),
        error: null,
        expiresAt: nowMs() + MARKET_CACHE_TTL_MS
      };
      return marketCatalogCache.value;
    } catch (error) {
      const providerError = normalizeProviderError(error);
      marketCatalogCache = {
        value: null,
        error: providerError,
        expiresAt: nowMs() + MARKET_CACHE_TTL_MS
      };
      throw providerError;
    }
  }

  async function getTickers() {
    const timestamp = nowMs();
    if (tickerCache && tickerCache.expiresAt > timestamp) {
      if (tickerCache.error) {
        throw tickerCache.error;
      }
      return tickerCache.value;
    }
    try {
      const rows = await fetchBitvavoJson("/ticker/24h");
      if (!Array.isArray(rows) || rows.length === 0) {
        throw new ProviderError("PROVIDER_EMPTY", "Bitvavo returned an empty ticker response.");
      }
      tickerCache = {
        value: rows.filter((item) => item && typeof item.market === "string"),
        error: null,
        expiresAt: nowMs() + MARKET_CACHE_TTL_MS
      };
      return tickerCache.value;
    } catch (error) {
      const providerError = normalizeProviderError(error);
      tickerCache = { value: null, error: providerError, expiresAt: nowMs() + MARKET_CACHE_TTL_MS };
      throw providerError;
    }
  }

  async function fetchBitvavoJson(path) {
    const response = await fetchImpl(`${BITVAVO_API}${path}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    }).catch((error) => {
      throw normalizeProviderError(error);
    });
    if (response.status === 429) {
      throw new ProviderError("RATE_LIMITED", "Bitvavo rate limit was reached.");
    }
    if (!response.ok) {
      throw new ProviderError(
        response.status === 404 ? "INVALID_MARKET" : "PROVIDER_UNAVAILABLE",
        "Bitvavo public market data could not be loaded."
      );
    }
    try {
      return await response.json();
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof TypeError) {
        throw new ProviderError("INVALID_PROVIDER_RESPONSE", "Bitvavo returned invalid JSON.");
      }
      throw error;
    }
  }

  return {
    getMarket,
    getMarketScannerSummary,
    getMarketSummary,
    refreshScheduledMarkets,
    refreshScheduledCandleBatch
  };

  function nowMs() {
    const value = now();
    return value instanceof Date && Number.isFinite(value.getTime()) ? value.getTime() : Date.now();
  }

  function nowIso() {
    return new Date(nowMs()).toISOString();
  }

  function createCandleCacheEntry(limit, failed) {
    return { checkedAt: nowIso(), limit, failed };
  }
}

export function isTradableEurMarket(market) {
  return Boolean(market
    && typeof market.market === "string"
    && market.market.endsWith("-EUR")
    && market.quote === "EUR"
    && market.status.toLowerCase() === "trading");
}

export function parseTicker24h(ticker, capturedAt) {
  const open = finiteNumber(ticker.open);
  const price = finiteNumber(ticker.last);
  const high = finiteNumber(ticker.high);
  const low = finiteNumber(ticker.low);
  const volume = finiteNumber(ticker.volume);
  if (!ticker.market || open === null || open <= 0 || price === null || price <= 0
    || high === null || low === null || volume === null || volume < 0
    || low <= 0 || low > high || high < open || high < price || low > open || low > price) {
    return null;
  }
  return {
    symbol: ticker.market,
    price,
    volume,
    daily_change: (price - open) / open * 100,
    high_24h: high,
    low_24h: low,
    captured_at: capturedAt
  };
}

export function parseCandles(response, symbol, interval) {
  if (!Array.isArray(response)) {
    return [];
  }
  const candles = [];
  for (const row of response) {
    const values = Array.isArray(row) ? row : row && Array.isArray(row.value) ? row.value : null;
    if (!values || values.length < 6) {
      continue;
    }
    const timestamp = finiteNumber(values[0]);
    const open = finiteNumber(values[1]);
    const high = finiteNumber(values[2]);
    const low = finiteNumber(values[3]);
    const close = finiteNumber(values[4]);
    const volume = finiteNumber(values[5]);
    if (timestamp === null || timestamp <= 0 || open === null || open <= 0
      || high === null || low === null || close === null || volume === null || volume < 0
      || high < low || high < open || high < close || low > open || low > close) {
      continue;
    }
    candles.push({
      symbol,
      interval,
      open,
      high,
      low,
      close,
      volume,
      timestamp: new Date(timestamp).toISOString()
    });
  }
  return candles;
}

function createDatabaseHeaders(config, accessToken, serviceRoleKey) {
  return accessToken
    ? { apikey: config.supabaseAnonKey, authorization: `Bearer ${accessToken}` }
    : { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` };
}

async function fetchDatabaseRowsPaged(config, headers, table, filters, fetchImpl, maximumRows, queryName) {
  const rows = [];
  for (let offset = 0; offset < maximumRows; offset += SCANNER_QUERY_PAGE_SIZE) {
    const pageSize = Math.min(SCANNER_QUERY_PAGE_SIZE, maximumRows - offset);
    const page = await fetchDatabaseRows(
      config,
      headers,
      table,
      { ...filters, limit: String(pageSize) },
      fetchImpl,
      { from: offset, to: offset + pageSize - 1 },
      queryName
    );
    rows.push(...page);
    if (page.length < pageSize) {
      break;
    }
  }
  return rows;
}

async function fetchLatestScannerDecisions(
  config,
  headers,
  symbolFilter,
  activeSymbols,
  since,
  fetchImpl,
  queryName
) {
  const maximumRows = Math.min(
    SCANNER_MAX_DECISION_ROWS,
    Math.max(SCANNER_QUERY_PAGE_SIZE, activeSymbols.size * 10)
  );
  const decisions = [];
  const symbolsWithDecisions = new Set();
  for (let offset = 0; offset < maximumRows; offset += SCANNER_QUERY_PAGE_SIZE) {
    const pageSize = Math.min(SCANNER_QUERY_PAGE_SIZE, maximumRows - offset);
    const page = await fetchDatabaseRows(
      config,
      headers,
      "AI_Crypto_Bot_AI_Decisions",
      {
        select: "id,symbol,decision,confidence,reason,created_at",
        symbol: symbolFilter,
        created_at: `gte.${since}`,
        order: "created_at.desc,id.desc",
        limit: String(pageSize)
      },
      fetchImpl,
      { from: offset, to: offset + pageSize - 1 },
      queryName
    );
    decisions.push(...page);
    for (const row of page) {
      if (row && activeSymbols.has(row.symbol)) {
        symbolsWithDecisions.add(row.symbol);
      }
    }
    if (symbolsWithDecisions.size === activeSymbols.size || page.length < pageSize) {
      break;
    }
  }
  return decisions;
}

async function fetchDatabaseRows(config, headers, table, filters, fetchImpl, range = null, queryName = table) {
  const url = new URL(`/rest/v1/${table}`, config.supabaseUrl);
  for (const [key, value] of Object.entries(filters)) {
    url.searchParams.set(key, value);
  }
  const requestHeaders = { ...headers, accept: "application/json" };
  if (range) {
    requestHeaders.Range = `${range.from}-${range.to}`;
  }
  let response;
  try {
    response = await fetchImpl(url.toString(), {
      method: "GET",
      headers: requestHeaders,
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    throw new StorageError("Supabase market data could not be loaded.", error, {
      queryName,
      failureKind: "NETWORK_OR_TIMEOUT"
    });
  }
  if (!response.ok) {
    const databaseCode = await readDatabaseErrorCode(response);
    const error = new StorageError("Supabase rejected a market data read.", undefined, {
      queryName,
      failureKind: classifyDatabaseFailure(response.status, databaseCode),
      httpStatus: response.status,
      databaseCode
    });
    if (response.status === 401) {
      error.code = "INVALID_SESSION";
    }
    throw error;
  }
  let rows;
  try {
    rows = await response.json();
  } catch (error) {
    throw new StorageError("Supabase returned invalid market data.", error, {
      queryName,
      failureKind: "MALFORMED_JSON",
      httpStatus: response.status
    });
  }
  if (!Array.isArray(rows)) {
    throw new StorageError("Supabase returned an unexpected market response.", undefined, {
      queryName,
      failureKind: "MALFORMED_RESPONSE",
      httpStatus: response.status
    });
  }
  return rows;
}

async function readDatabaseErrorCode(response) {
  try {
    const body = typeof response.clone === "function"
      ? await response.clone().json()
      : await response.json();
    return body && typeof body.code === "string" && /^[A-Z0-9_]{2,32}$/.test(body.code)
      ? body.code
      : null;
  } catch {
    return null;
  }
}

function classifyDatabaseFailure(status, databaseCode) {
  if (status === 401) {
    return "AUTHENTICATION";
  }
  if (status === 403 || databaseCode === "42501") {
    return "RLS_OR_PERMISSION";
  }
  if (status === 404 || ["PGRST204", "PGRST205", "42703", "42P01"].includes(databaseCode)) {
    return "SCHEMA_MISMATCH";
  }
  if (status >= 500) {
    return "SUPABASE_SERVER_ERROR";
  }
  return "QUERY_REJECTED";
}

async function writeDatabaseRows(config, serviceRoleKey, table, rows, conflictColumns, resolution, fetchImpl) {
  if (!rows.length) {
    return;
  }
  const url = new URL(`/rest/v1/${table}`, config.supabaseUrl);
  if (conflictColumns) {
    url.searchParams.set("on_conflict", conflictColumns);
  }
  let response;
  try {
    response = await fetchImpl(url.toString(), {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        "content-type": "application/json",
        prefer: resolution ? `resolution=${resolution},return=minimal` : "return=minimal"
      },
      body: JSON.stringify(rows),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    throw new StorageError("Supabase could not store market data.", error);
  }
  if (!response.ok) {
    throw new StorageError("Supabase rejected a market data write.");
  }
}

async function writeScannerEvents(config, serviceRoleKey, events, fetchImpl, logger) {
  if (!events.length) {
    return;
  }
  try {
    await writeDatabaseRows(
      config,
      serviceRoleKey,
      SCANNER_EVENTS_TABLE,
      events,
      "",
      null,
      fetchImpl
    );
  } catch (error) {
    logFailure(logger, "Scanner event could not be stored.", error);
  }
}

function findEventAnchor(watchedMarkets, validSymbols) {
  return watchedMarkets.find(({ symbol }) => validSymbols.has(symbol))?.symbol
    || watchedMarkets[0]?.symbol
    || null;
}

function isFresh(value, referenceTime = Date.now()) {
  const timestamp = typeof value === "number" ? value : Date.parse(value || "");
  const age = referenceTime - timestamp;
  return Number.isFinite(timestamp) && age >= 0 && age < MARKET_CACHE_TTL_MS;
}

function isCandleCacheFresh(entry, requestedLimit, referenceTime) {
  if (!entry || !isFresh(entry.checkedAt, referenceTime)) {
    return false;
  }
  return entry.failed === true || (Number.isInteger(entry.limit) && entry.limit >= requestedLimit);
}

function finiteNumber(value) {
  if (typeof value !== "number" && typeof value !== "string") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function elapsedMilliseconds(startedAt) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function normalizeProviderError(error) {
  if (error instanceof ProviderError) {
    return error;
  }
  if (error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return new ProviderError("PROVIDER_TIMEOUT", "Bitvavo request timed out.");
  }
  return new ProviderError("PROVIDER_UNAVAILABLE", "Bitvavo public market data is unavailable.");
}

function logFailure(logger, message, error) {
  const code = error instanceof ProviderError || error instanceof StorageError
    ? error.code || error.constructor.name
    : error instanceof Error ? error.name : "UnknownError";
  if (logger && typeof logger.error === "function") {
    logger.error(message, code);
  }
}

function createCandleRefreshInputError(message) {
  const error = new Error(message);
  error.code = "INVALID_CANDLE_REFRESH_REQUEST";
  return error;
}

class ProviderError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

class StorageError extends Error {
  constructor(message, cause, diagnostics = {}) {
    super(message, { cause });
    this.code = "STORAGE_UNAVAILABLE";
    this.queryName = diagnostics.queryName || null;
    this.failureKind = diagnostics.failureKind || "UNKNOWN";
    this.httpStatus = Number.isInteger(diagnostics.httpStatus) ? diagnostics.httpStatus : null;
    this.databaseCode = diagnostics.databaseCode || null;
  }
}
