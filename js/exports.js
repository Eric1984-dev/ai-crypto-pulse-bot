(function attachExports(root, createApi) {
  const api = createApi();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    window.CryptoPulseExports = api;
    api.startExports({ windowRef: window, documentRef: document });
  }
})(globalThis, function createExportsApi() {
  const analysisExportSources = Object.freeze([
    "trades",
    "positions",
    "decisions",
    "portfolioSnapshots",
    "shadowExitScenarios",
    "shadowExitEvents",
    "analyticsRuns",
    "candleWindows"
  ]);
  const analysisExportSourceLabels = Object.freeze({
    trades: "TRADES",
    positions: "POSITIONS",
    decisions: "AI DECISIONS",
    portfolioSnapshots: "PORTFOLIO SNAPSHOTS",
    shadowExitScenarios: "SHADOW-EXIT SCENARIOS",
    shadowExitEvents: "SHADOW-EXIT EVENTS",
    analyticsRuns: "ANALYTICS RUNS",
    candleWindows: "CANDLES"
  });
  const analysisExportFilePrefix = "cryptopulse-analysis";
  const utf8Encoder = new TextEncoder();
  const countFormat = new Intl.NumberFormat("en-GB");
  const runtimeApiUrl = (path) => {
    if (!globalThis.CryptoPulseRuntimeApi) {
      throw new Error("Raspberry Pi runtime API is not configured.");
    }
    return globalThis.CryptoPulseRuntimeApi.url(path);
  };

  function getExportFolderName(date = new Date()) {
    const pad = (value) => String(value).padStart(2, "0");
    const timestamp = `${pad(date.getDate())}${pad(date.getMonth() + 1)}`
      + `${date.getFullYear()}${pad(date.getHours())}${pad(date.getMinutes())}`
      + pad(date.getSeconds());
    return `${analysisExportFilePrefix}-${timestamp}`;
  }

  function buildAnalysisExportUrl(view, { source, asOf, cursor } = {}) {
    if (!["analysis-export-manifest", "analysis-export-page"].includes(view)) {
      throw new TypeError("A valid analysis export view is required.");
    }
    const params = new URLSearchParams({ view });
    if (view === "analysis-export-page") {
      if (!analysisExportSources.includes(source)
        || typeof asOf !== "string" || !Number.isFinite(Date.parse(asOf))
        || (cursor !== undefined && cursor !== null && typeof cursor !== "string")) {
        throw new TypeError("Valid source, as-of time, and cursor values are required.");
      }
      params.set("source", source);
      params.set("asOf", asOf);
      if (cursor) {
        params.set("cursor", cursor);
      }
    }
    return runtimeApiUrl(`/api/v1/dashboard-data?${params}`);
  }

  function createAbortError() {
    const error = new Error("The export was cancelled.");
    error.name = "AbortError";
    return error;
  }

  function waitForRetry(delayMs, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(createAbortError());
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        reject(createAbortError());
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, delayMs);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  function getRetryDelay(response) {
    const retryAfter = response.headers?.get?.("Retry-After");
    if (retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter)) {
      return Math.max(0, Number(retryAfter) * 1000);
    }
    const retryAt = retryAfter ? Date.parse(retryAfter) : NaN;
    return Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : 1000;
  }

  async function requestExportJson(fetchImpl, url, signal) {
    let rateLimitRetries = 0;
    while (true) {
      if (signal?.aborted) {
        throw createAbortError();
      }
      const response = await fetchImpl(url, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
        headers: { Accept: "application/json" },
        signal
      });
      if (response.status === 429) {
        if (rateLimitRetries >= 5) {
          throw new Error("The runtime API rate limit is still active. Resume the export later.");
        }
        rateLimitRetries += 1;
        await waitForRetry(getRetryDelay(response), signal);
        continue;
      }
      if (response.status === 401) {
        const error = new Error("Authentication is required.");
        error.status = 401;
        throw error;
      }
      if (!response.ok) {
        throw new Error("The historical export request failed.");
      }
      let result;
      try {
        result = await response.json();
      } catch {
        throw new Error("The historical export response is invalid.");
      }
      if (!result || !result.data || typeof result.data !== "object") {
        throw new Error("The historical export response is invalid.");
      }
      return result.data;
    }
  }

  async function requestAnalysisExportManifest(fetchImpl, signal) {
    const manifest = await requestExportJson(
      fetchImpl,
      buildAnalysisExportUrl("analysis-export-manifest"),
      signal
    );
    if (manifest.formatVersion !== "cryptopulse-analysis-export-v2"
      || typeof manifest.asOf !== "string" || !Number.isFinite(Date.parse(manifest.asOf))
      || !Array.isArray(manifest.sources)
      || manifest.sources.length !== analysisExportSources.length
      || analysisExportSources.some((source, index) => manifest.sources[index] !== source)
      || !Number.isSafeInteger(manifest.limits?.maxFileBytes)
      || manifest.limits.maxFileBytes < 1024) {
      throw new Error("The historical export manifest is invalid.");
    }
    return manifest;
  }

  async function requestAnalysisExportPage(fetchImpl, {
    source,
    asOf,
    cursor = null,
    signal
  }) {
    const page = await requestExportJson(
      fetchImpl,
      buildAnalysisExportUrl("analysis-export-page", { source, asOf, cursor }),
      signal
    );
    const isCandlePage = source === "candleWindows";
    const pageAnchorKeys = new Set((Array.isArray(page.anchors) ? page.anchors : [])
      .filter((anchor) => anchor && typeof anchor.symbol === "string"
        && typeof anchor.anchorAt === "string")
      .map((anchor) => `${anchor.symbol}\u0000${anchor.anchorAt}`));
    if (page.source !== source || page.asOf !== asOf
      || (!isCandlePage && !Array.isArray(page.items))
      || typeof page.hasMore !== "boolean"
      || (page.nextCursor !== null && typeof page.nextCursor !== "string")
      || page.hasMore !== Boolean(page.nextCursor)
      || (page.hasMore && page.nextCursor === cursor)
      || (page.nextCursor !== null
        && (page.nextCursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(page.nextCursor)))
      || (!isCandlePage
        && page.items.some((item) => !item || typeof item !== "object" || Array.isArray(item)))
      || (isCandlePage && (
        !Array.isArray(page.anchors) || !Array.isArray(page.candleWindows)
        || page.anchors.some((anchor) => !anchor
          || typeof anchor.symbol !== "string"
          || !Number.isFinite(Date.parse(anchor.anchorAt || "")))
        || page.candleWindows.some((candle) => !candle
          || typeof candle.symbol !== "string"
          || typeof candle.timestamp !== "string"
          || !Number.isFinite(Date.parse(candle.timestamp))
          || !Array.isArray(candle.anchorTimes)
          || candle.anchorTimes.length === 0
          || candle.anchorTimes.some((anchorAt) =>
            typeof anchorAt !== "string"
            || !Number.isFinite(Date.parse(anchorAt))
            || !pageAnchorKeys.has(`${candle.symbol}\u0000${anchorAt}`)))
      ))) {
      throw new Error(`The historical export page for ${source} is invalid.`);
    }
    return page;
  }

  function createJsonlWriter(directoryHandle, prefix, maxFileBytes, files) {
    let currentWriter = null;
    let currentBytes = 0;
    let fileNumber = 0;
    let pendingLines = [];
    let pendingBytes = 0;

    async function flush() {
      if (currentWriter && pendingLines.length > 0) {
        await currentWriter.write(pendingLines.join(""));
        currentBytes += pendingBytes;
        pendingLines = [];
        pendingBytes = 0;
      }
    }

    async function closeCurrent() {
      if (currentWriter) {
        await flush();
        const writer = currentWriter;
        currentWriter = null;
        await writer.close();
      }
    }

    async function openNext() {
      await closeCurrent();
      fileNumber += 1;
      const fileName = `${prefix}-${String(fileNumber).padStart(4, "0")}.jsonl`;
      const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
      currentWriter = await fileHandle.createWritable();
      currentBytes = 0;
      files.push(fileName);
    }

    return {
      async appendMany(values) {
        for (const value of values) {
          const serialized = JSON.stringify(value);
          if (typeof serialized !== "string") {
            throw new Error("An export record could not be serialized.");
          }
          const line = `${serialized}\n`;
          const byteLength = utf8Encoder.encode(line).byteLength;
          if (byteLength > maxFileBytes) {
            throw new Error("A single source record exceeds the configured file-size limit.");
          }
          if (currentWriter
            && currentBytes + pendingBytes + byteLength > maxFileBytes) {
            await openNext();
          }
          if (!currentWriter) {
            await openNext();
          }
          if (pendingBytes + byteLength > 65536) {
            await flush();
          }
          if (currentBytes + pendingBytes + byteLength > maxFileBytes) {
            await openNext();
          }
          pendingLines.push(line);
          pendingBytes += byteLength;
          if (pendingBytes >= 65536) {
            await flush();
          }
        }
      },
      async append(value) {
        return this.appendMany([value]);
      },
      close: closeCurrent
    };
  }

  async function writeManifest(directoryHandle, manifest) {
    const fileHandle = await directoryHandle.getFileHandle("manifest.json", { create: true });
    const writer = await fileHandle.createWritable();
    try {
      await writer.write(`${JSON.stringify(manifest, null, 2)}\n`);
    } finally {
      await writer.close();
    }
  }

  async function exportFullHistory({
    fetchImpl,
    directoryHandle,
    signal,
    onProgress = () => {}
  }) {
    if (typeof fetchImpl !== "function" || !directoryHandle
      || typeof directoryHandle.getDirectoryHandle !== "function") {
      throw new TypeError("A fetch implementation and writable directory are required.");
    }
    const manifest = await requestAnalysisExportManifest(fetchImpl, signal);
    const outputDirectoryName = getExportFolderName();
    try {
      await directoryHandle.getDirectoryHandle(outputDirectoryName, { create: false });
      throw new Error(`The export folder ${outputDirectoryName} already exists. Wait a second and retry.`);
    } catch (error) {
      if (error.name !== "NotFoundError") {
        throw error;
      }
    }
    const outputDirectory = await directoryHandle.getDirectoryHandle(outputDirectoryName, {
      create: true
    });
    const outputManifest = {
      ...manifest,
      exportStatus: "in_progress",
      files: [],
      sourceCounts: {},
      candleDataFormat: {
        anchorIdentity: ["symbol", "anchorAt"],
        candleIdentity: ["symbol", "interval", "timestamp"],
        candleLinkIdentity: ["symbol", "interval", "anchorAt", "candleTimestamp"],
        candleRowsAreUnique: true,
        files: {
          anchors: "candle-anchors-*.jsonl",
          candles: "candle-windows-*.jsonl",
          anchorCandleLinks: "candle-window-links-*.jsonl"
        }
      },
      completedSources: []
    };
    const writers = [];
    let failure = null;
    try {
      await writeManifest(outputDirectory, outputManifest);
      for (const source of manifest.sources) {
        let cursor = null;
        let pageCount = 0;
        let recordCount = 0;
        let anchorCount = 0;
        let candleCount = 0;
        let windowLinkCount = 0;
        const sourceFiles = [];
        let sourceWriter;
        let anchorWriter;
        let windowLinkWriter;
        let lastAnchorKey = null;
        let seenCandleKeys;
        if (source === "candleWindows") {
          anchorWriter = createJsonlWriter(
            outputDirectory,
            "candle-anchors",
            manifest.limits.maxFileBytes,
            outputManifest.files
          );
          sourceWriter = createJsonlWriter(
            outputDirectory,
            "candle-windows",
            manifest.limits.maxFileBytes,
            outputManifest.files
          );
          windowLinkWriter = createJsonlWriter(
            outputDirectory,
            "candle-window-links",
            manifest.limits.maxFileBytes,
            outputManifest.files
          );
          seenCandleKeys = new Set();
          writers.push(anchorWriter, sourceWriter);
          writers.push(windowLinkWriter);
        } else {
          sourceWriter = createJsonlWriter(
            outputDirectory,
            source,
            manifest.limits.maxFileBytes,
            outputManifest.files
          );
          writers.push(sourceWriter);
        }
        do {
          if (signal?.aborted) {
            throw createAbortError();
          }
          const page = await requestAnalysisExportPage(fetchImpl, {
            source,
            asOf: manifest.asOf,
            cursor,
            signal
          });
          pageCount += 1;
          if (source === "candleWindows") {
            const allowedAnchorKeys = new Set();
            const anchorRecords = [];
            for (const anchor of page.anchors) {
              const anchorKey = `${anchor.symbol}\u0000${anchor.anchorAt}`;
              if (anchorKey === lastAnchorKey) {
                continue;
              }
              lastAnchorKey = anchorKey;
              allowedAnchorKeys.add(anchorKey);
              anchorRecords.push(anchor);
            }
            const candleRecords = [];
            const linkRecords = [];
            for (const candle of page.candleWindows) {
              const matchedAnchorTimes = candle.anchorTimes.filter((anchorAt) =>
                allowedAnchorKeys.has(`${candle.symbol}\u0000${anchorAt}`));
              if (matchedAnchorTimes.length === 0) {
                continue;
              }
              for (const anchorAt of matchedAnchorTimes) {
                linkRecords.push({
                  symbol: candle.symbol,
                  interval: candle.interval,
                  anchorAt,
                  candleTimestamp: candle.timestamp
                });
              }
              const candleKey = `${candle.symbol}\u0000${candle.interval}\u0000${candle.timestamp}`;
              if (!seenCandleKeys.has(candleKey)) {
                seenCandleKeys.add(candleKey);
                candleRecords.push({
                  symbol: candle.symbol,
                  interval: candle.interval,
                  timestamp: candle.timestamp,
                  open: candle.open,
                  high: candle.high,
                  low: candle.low,
                  close: candle.close,
                  volume: candle.volume
                });
              }
            }
            await anchorWriter.appendMany(anchorRecords);
            anchorCount += anchorRecords.length;
            await sourceWriter.appendMany(candleRecords);
            candleCount += candleRecords.length;
            await windowLinkWriter.appendMany(linkRecords);
            windowLinkCount += linkRecords.length;
            recordCount += anchorRecords.length + candleRecords.length + linkRecords.length;
          } else {
            await sourceWriter.appendMany(page.items);
            recordCount += page.items.length;
          }
          cursor = page.nextCursor;
          outputManifest.sourceCounts[source] = {
            records: recordCount,
            ...(source === "candleWindows"
              ? { anchors: anchorCount, uniqueCandles: candleCount, windowLinks: windowLinkCount }
              : {}),
            pages: pageCount,
            files: outputManifest.files.filter((fileName) =>
              fileName.startsWith(source === "candleWindows" ? "candle-" : `${source}-`))
          };
          onProgress({
            source,
            pages: pageCount,
            records: recordCount,
            anchors: anchorCount,
            uniqueCandles: candleCount,
            windowLinks: windowLinkCount,
            completedSources: outputManifest.completedSources.length
          });
        } while (cursor);
        await sourceWriter.close();
        await anchorWriter?.close();
        await windowLinkWriter?.close();
        sourceFiles.push(...outputManifest.files.filter((fileName) =>
          fileName.startsWith(source === "candleWindows" ? "candle-" : `${source}-`)));
        outputManifest.sourceCounts[source] = {
          records: recordCount,
          ...(source === "candleWindows"
            ? { anchors: anchorCount, uniqueCandles: candleCount, windowLinks: windowLinkCount }
            : {}),
          pages: pageCount,
          files: sourceFiles
        };
        outputManifest.completedSources.push(source);
        await writeManifest(outputDirectory, outputManifest);
      }
      outputManifest.exportStatus = "complete";
    } catch (error) {
      failure = error;
      outputManifest.exportStatus = error.name === "AbortError" ? "cancelled" : "failed";
      outputManifest.failure = error.name === "AbortError"
        ? "Cancelled by the user."
        : "A source could not be exported completely.";
    } finally {
      for (const writer of writers) {
        try {
          await writer.close();
        } catch (error) {
          failure ||= error;
          outputManifest.exportStatus = "failed";
          outputManifest.failure = "An export file could not be finalized.";
        }
      }
      try {
        await writeManifest(outputDirectory, outputManifest);
      } catch (error) {
        failure ||= error;
      }
    }
    if (failure) {
      throw failure;
    }
    return {
      directoryName: outputDirectoryName,
      manifest: outputManifest
    };
  }

  function startExports({
    windowRef = window,
    documentRef = document,
    fetchImpl = windowRef.fetch.bind(windowRef)
  } = {}) {
    if (!documentRef.querySelector("[data-exports-page]")) {
      return () => {};
    }

    const startAnalysisExportButton = documentRef.querySelector(
      "[data-analysis-export-start]"
    );
    const cancelAnalysisExportButton = documentRef.querySelector(
      "[data-analysis-export-cancel]"
    );
    const analysisExportProgress = documentRef.querySelector(
      "[data-analysis-export-progress]"
    );
    const analysisExportSource = documentRef.querySelector(
      "[data-analysis-export-source]"
    );
    const analysisExportDetail = documentRef.querySelector(
      "[data-analysis-export-detail]"
    );
    const analysisExportStatus = documentRef.querySelector(
      "[data-analysis-export-status]"
    );
    const piHealthPanel = documentRef.querySelector("[data-pi-health]");
    const piHealthState = documentRef.querySelector("[data-pi-health-state]");
    const piHealthUpdated = documentRef.querySelector("[data-pi-health-updated]");
    let activeExportController = null;
    let analysisExportRunning = false;
    let piHealthInterval = null;
    let piHealthRequestRunning = false;
    let hasPiHealthReading = false;
    let cpuCriticalSamples = 0;

    function setAnalysisExportStatus(message, state = "") {
      if (analysisExportStatus) {
        analysisExportStatus.textContent = message;
        analysisExportStatus.dataset.state = state;
      }
    }

    function setAnalysisExportProgress(message, state = "", source = "") {
      if (!analysisExportProgress) {
        return;
      }
      analysisExportProgress.dataset.state = state;
      if (analysisExportSource) {
        analysisExportSource.textContent = source;
        analysisExportSource.hidden = !source;
      }
      if (analysisExportDetail) {
        analysisExportDetail.textContent = message;
      } else {
        analysisExportProgress.textContent = source
          ? `Exporting ${source}: ${message}`
          : message;
      }
    }

    function renderPiMetric(name, value) {
      const card = documentRef.querySelector(`[data-pi-metric="${name}"]`);
      const valueElement = documentRef.querySelector(`[data-pi-health-value="${name}"]`);
      const bar = documentRef.querySelector(`[data-pi-health-bar="${name}"]`);
      const maxValue = name === "temperature" ? 200 : 100;
      const available = Number.isFinite(value) && value >= 0 && value <= maxValue;
      let state = "unavailable";

      if (available) {
        if (name === "temperature") {
          state = value >= 80 ? "critical" : value >= 70 ? "warning" : "normal";
        } else if (name === "memory") {
          state = value >= 90 ? "critical" : value >= 80 ? "warning" : "normal";
        } else {
          state = value >= 90
            ? (cpuCriticalSamples >= 2 ? "critical" : "warning")
            : value >= 75 ? "warning" : "normal";
        }
      }

      if (card) {
        card.dataset.state = state;
      }
      if (valueElement) {
        valueElement.textContent = available
          ? name === "temperature" ? `${value.toFixed(1)}°C` : `${Math.round(value)}%`
          : "—";
      }
      if (bar) {
        bar.style.width = available ? `${Math.min(100, value)}%` : "0%";
      }
      return state;
    }

    function renderPiModel(value) {
      const card = documentRef.querySelector('[data-pi-metric="model"]');
      const valueElement = documentRef.querySelector('[data-pi-health-value="model"]');
      const model = typeof value === "string" ? value.trim() : "";
      const validModel = model.length > 0 && model.length <= 128
        && !/[\u0000-\u001f\u007f]/.test(model);
      if (card) {
        card.dataset.state = validModel ? "normal" : "unavailable";
      }
      if (valueElement) {
        valueElement.textContent = validModel ? model : "—";
      }
    }

    function setPiHealthSummary(states, updatedText) {
      if (!piHealthPanel) {
        return;
      }
      const availableStates = states.filter((state) => state !== "unavailable");
      const state = availableStates.includes("critical")
        ? "critical"
        : availableStates.includes("warning")
          ? "warning"
          : availableStates.length
            ? "normal"
            : "unavailable";
      piHealthPanel.dataset.state = state;
      if (piHealthState) {
        piHealthState.textContent = state === "critical"
          ? "High system load"
          : state === "warning"
            ? "Elevated system load"
            : state === "normal"
              ? "System running normally"
              : "Metrics unavailable";
      }
      if (piHealthUpdated) {
        piHealthUpdated.textContent = updatedText;
      }
    }

    async function refreshPiHealth() {
      if (!piHealthPanel || piHealthRequestRunning || documentRef.hidden) {
        return;
      }
      piHealthRequestRunning = true;
      try {
        const response = await fetchImpl(runtimeApiUrl("/api/v1/monitoring"), {
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
          throw new Error("System metrics are temporarily unavailable.");
        }

        let result;
        try {
          result = await response.json();
        } catch {
          throw new Error("System metrics response is invalid.");
        }
        const system = result?.data?.system;
        if (!system || typeof system !== "object") {
          throw new Error("System metrics response is invalid.");
        }

        cpuCriticalSamples = Number.isFinite(system.cpuUsagePercent)
          && system.cpuUsagePercent >= 90
          ? cpuCriticalSamples + 1
          : 0;
        renderPiModel(system.model);
        const states = [
          renderPiMetric("temperature", system.temperatureC),
          renderPiMetric("cpu", system.cpuUsagePercent),
          renderPiMetric("memory", system.memory?.usedPercent)
        ];
        hasPiHealthReading = states.some((state) => state !== "unavailable");
        const updatedAt = new Intl.DateTimeFormat(undefined, {
          hour: "2-digit",
          minute: "2-digit"
        }).format(new Date());
        setPiHealthSummary(states, `Updated ${updatedAt}`);
      } catch (error) {
        cpuCriticalSamples = 0;
        if (error.status === 401 && typeof windowRef.location?.assign === "function") {
          windowRef.location.assign("/login.html?next=%2Fexports.html");
          return;
        }
        if (piHealthPanel) {
          piHealthPanel.dataset.state = hasPiHealthReading ? "stale" : "unavailable";
        }
        if (piHealthState) {
          piHealthState.textContent = hasPiHealthReading
            ? "Connection issue · showing last reading"
            : "Metrics unavailable";
        }
        if (piHealthUpdated) {
          piHealthUpdated.textContent = hasPiHealthReading
            ? "Refresh failed"
            : "Retrying in 30 sec";
        }
      } finally {
        piHealthRequestRunning = false;
      }
    }

    function onPiHealthVisibilityChange() {
      if (!documentRef.hidden) {
        refreshPiHealth();
      }
    }

    async function startAnalysisExport() {
      if (analysisExportRunning) {
        return;
      }
      if (typeof windowRef.showDirectoryPicker !== "function") {
        setAnalysisExportStatus(
          "Choose a browser that supports saving files to a folder, such as a current desktop Chromium browser.",
          "error"
        );
        return;
      }
      analysisExportRunning = true;
      const AbortControllerConstructor = windowRef.AbortController || AbortController;
      activeExportController = new AbortControllerConstructor();
      if (startAnalysisExportButton) {
        startAnalysisExportButton.disabled = true;
        startAnalysisExportButton.dataset.exporting = "true";
        startAnalysisExportButton.setAttribute?.("aria-busy", "true");
      }
      if (cancelAnalysisExportButton) {
        cancelAnalysisExportButton.hidden = false;
      }
      setAnalysisExportProgress("Choose a destination folder for the export.", "active");
      setAnalysisExportStatus("");
      try {
        const directoryHandle = await windowRef.showDirectoryPicker({ mode: "readwrite" });
        if (activeExportController.signal.aborted) {
          throw createAbortError();
        }
        const result = await exportFullHistory({
          fetchImpl,
          directoryHandle,
          signal: activeExportController.signal,
          onProgress({
            source,
            pages,
            records,
            anchors,
            uniqueCandles,
            windowLinks,
            completedSources
          }) {
            const label = analysisExportSourceLabels[source] || source.toUpperCase();
            const detail = source === "candleWindows"
              ? `${countFormat.format(anchors)} anchors, `
                + `${countFormat.format(uniqueCandles)} unique candles, `
                + `${countFormat.format(windowLinks)} window links; ${pages} page(s); `
                + `${completedSources} of ${analysisExportSources.length} sources complete.`
              : `${countFormat.format(records)} records in ${pages} page(s); `
                + `${completedSources} of ${analysisExportSources.length} sources complete.`;
            setAnalysisExportProgress(
              detail,
              "active",
              label
            );
          }
        });
        setAnalysisExportProgress(
          `${analysisExportSources.length} sources exported. Files are in ${result.directoryName}.`
        );
        setAnalysisExportStatus("Historical export completed.", "success");
      } catch (error) {
        if (error.status === 401 && typeof windowRef.location?.assign === "function") {
          windowRef.location.assign("/login.html?next=%2Fexports.html");
          return;
        }
        if (error.name === "AbortError") {
          setAnalysisExportStatus("Export cancelled. If files were written, check the folder manifest for status.", "error");
        } else {
          setAnalysisExportStatus(error.message || "The historical export could not be completed.", "error");
        }
      } finally {
        analysisExportRunning = false;
        activeExportController = null;
        if (startAnalysisExportButton) {
          startAnalysisExportButton.disabled = false;
          delete startAnalysisExportButton.dataset.exporting;
          startAnalysisExportButton.removeAttribute?.("aria-busy");
        }
        if (analysisExportProgress) {
          analysisExportProgress.dataset.state = "";
        }
        if (analysisExportSource) {
          analysisExportSource.hidden = true;
        }
        if (cancelAnalysisExportButton) {
          cancelAnalysisExportButton.hidden = true;
        }
      }
    }

    function cancelAnalysisExport() {
      activeExportController?.abort();
    }

    function onAnalysisExportPageHide() {
      activeExportController?.abort();
      startAnalysisExportButton?.removeEventListener("click", startAnalysisExport);
      cancelAnalysisExportButton?.removeEventListener("click", cancelAnalysisExport);
      documentRef.removeEventListener?.("visibilitychange", onPiHealthVisibilityChange);
      if (piHealthInterval !== null) {
        windowRef.clearInterval?.(piHealthInterval);
        piHealthInterval = null;
      }
      windowRef.removeEventListener?.("pagehide", onAnalysisExportPageHide);
    }

    startAnalysisExportButton?.addEventListener("click", startAnalysisExport);
    cancelAnalysisExportButton?.addEventListener("click", cancelAnalysisExport);
    if (piHealthPanel) {
      refreshPiHealth();
      piHealthInterval = windowRef.setInterval?.(refreshPiHealth, 30_000) ?? null;
      documentRef.addEventListener?.("visibilitychange", onPiHealthVisibilityChange);
    }
    windowRef.addEventListener?.("pagehide", onAnalysisExportPageHide);

    return () => {
      onAnalysisExportPageHide();
    };
  }

  return {
    buildAnalysisExportUrl,
    exportFullHistory,
    requestAnalysisExportManifest,
    requestAnalysisExportPage,
    startExports
  };
});
