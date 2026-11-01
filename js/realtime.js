(function attachCryptoPulseRealtime(root, createApi) {
  const api = createApi();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.CryptoPulseRealtime = api;
})(globalThis, function createRealtimeApi() {
  const surfaceSubscriptions = {
    dashboard: [
      { table: "AI_Crypto_Bot_Status" },
      { table: "AI_Crypto_Bot_Emergency_State" },
      { table: "AI_Crypto_Bot_Portfolios" },
      { table: "AI_Crypto_Bot_Positions" },
      { table: "AI_Crypto_Bot_Trades" },
      { table: "AI_Crypto_Bot_Portfolio_Snapshots" },
      { table: "AI_Crypto_Bot_AI_Decisions" },
      { table: "AI_Crypto_Bot_Watched_Markets" },
      { table: "AI_Crypto_Bot_Market_Data" },
      { table: "AI_Crypto_Bot_Candles", filter: "interval=in.(1h,1d)" }
    ],
    portfolio: [
      { table: "AI_Crypto_Bot_Portfolios" },
      { table: "AI_Crypto_Bot_Positions" },
      { table: "AI_Crypto_Bot_Trades" }
    ],
    history: [
      { table: "AI_Crypto_Bot_Trades" }
    ],
    scanner: [
      { table: "AI_Crypto_Bot_AI_Decisions" },
      { table: "AI_Crypto_Bot_Watched_Markets" },
      { table: "AI_Crypto_Bot_Market_Data" },
      { table: "AI_Crypto_Bot_Candles", filter: "interval=in.(1h,1d)" }
    ]
  };
  const connectionsByClient = new WeakMap();
  const refreshDebounceMs = 250;

  function subscribeToChanges({
    client,
    documentRef,
    onUpdate,
    onStatus,
    surface,
    windowRef
  }) {
    if (!client || typeof client.channel !== "function") {
      throw new TypeError("An authenticated Supabase client is required for Realtime.");
    }
    if (!Object.hasOwn(surfaceSubscriptions, surface)) {
      throw new TypeError("A supported Realtime surface is required.");
    }
    if (!documentRef || !windowRef || typeof onUpdate !== "function") {
      throw new TypeError("Realtime requires page references and an update callback.");
    }

    let surfaceConnections = connectionsByClient.get(client);
    if (!surfaceConnections) {
      surfaceConnections = new Map();
      connectionsByClient.set(client, surfaceConnections);
    }

    let connection = surfaceConnections.get(surface);
    if (!connection) {
      connection = createConnection({
        client,
        documentRef,
        surface,
        windowRef
      });
      surfaceConnections.set(surface, connection);
    }

    const listener = { documentRef, onStatus, onUpdate };
    connection.add(listener);
    let released = false;
    return function unsubscribeFromChanges() {
      if (released) {
        return;
      }
      released = true;
      if (connection.remove(listener)) {
        surfaceConnections.delete(surface);
        if (surfaceConnections.size === 0) {
          connectionsByClient.delete(client);
        }
      }
    };
  }

  function createConnection({ client, documentRef, surface, windowRef }) {
    const channel = client.channel(`cryptopulse-${surface}-updates`);
    if (!channel || typeof channel.on !== "function" || typeof channel.subscribe !== "function") {
      throw new TypeError("Supabase Realtime returned an invalid channel.");
    }

    const listeners = new Set();
    const setTimeoutImpl = typeof windowRef.setTimeout === "function"
      ? windowRef.setTimeout.bind(windowRef)
      : globalThis.setTimeout;
    const clearTimeoutImpl = typeof windowRef.clearTimeout === "function"
      ? windowRef.clearTimeout.bind(windowRef)
      : globalThis.clearTimeout;
    let state = windowRef.navigator && windowRef.navigator.onLine === false
      ? "offline"
      : "connecting";
    let refreshTimer = null;
    let disposed = false;

    function logCallbackFailure(error) {
      if (windowRef.console && typeof windowRef.console.error === "function") {
        windowRef.console.error(
          "Realtime page callback failed.",
          error instanceof Error ? error.name : "Unknown error"
        );
      }
    }

    function renderStatus(listener, nextState) {
      const element = listener.documentRef.querySelector("[data-realtime-status]");
      if (element) {
        element.dataset.state = nextState;
        element.hidden = nextState === "connected";
        element.textContent = nextState === "offline"
          ? "You are offline. Live updates will resume when the connection returns."
          : nextState === "connected"
            ? ""
            : "Live updates are reconnecting. Automatic refresh remains active.";
      }
      if (typeof listener.onStatus === "function") {
        try {
          listener.onStatus(nextState);
        } catch (error) {
          logCallbackFailure(error);
        }
      }
    }

    function setState(nextState) {
      if (disposed || state === nextState) {
        return;
      }
      state = nextState;
      for (const listener of listeners) {
        renderStatus(listener, state);
      }
    }

    function dispatchUpdate() {
      refreshTimer = null;
      if (disposed || documentRef.visibilityState === "hidden"
        || (windowRef.navigator && windowRef.navigator.onLine === false)) {
        return;
      }
      for (const listener of listeners) {
        try {
          const result = listener.onUpdate();
          if (result && typeof result.catch === "function") {
            result.catch(logCallbackFailure);
          }
        } catch (error) {
          logCallbackFailure(error);
        }
      }
    }

    function scheduleUpdate() {
      if (disposed || refreshTimer !== null) {
        return;
      }
      refreshTimer = setTimeoutImpl(dispatchUpdate, refreshDebounceMs);
    }

    function onChannelStatus(status) {
      if (disposed) {
        return;
      }
      if (status === "SUBSCRIBED") {
        setState("connected");
        scheduleUpdate();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        setState(windowRef.navigator && windowRef.navigator.onLine === false
          ? "offline"
          : "reconnecting");
      }
    }

    function onOffline() {
      setState("offline");
    }

    function onOnline() {
      setState("reconnecting");
      scheduleUpdate();
    }

    function onVisibilityChange() {
      if (documentRef.visibilityState === "visible") {
        scheduleUpdate();
      }
    }

    function removeChannel() {
      try {
        const result = typeof client.removeChannel === "function"
          ? client.removeChannel(channel)
          : channel.unsubscribe();
        Promise.resolve(result).catch(logCallbackFailure);
      } catch (error) {
        logCallbackFailure(error);
      }
    }

    try {
      let subscribedChannel = channel;
      for (const subscription of surfaceSubscriptions[surface]) {
        const filter = {
          event: "*",
          schema: "public",
          table: subscription.table
        };
        if (subscription.filter) {
          filter.filter = subscription.filter;
        }
        subscribedChannel = subscribedChannel.on("postgres_changes", filter, scheduleUpdate);
      }
      subscribedChannel.subscribe(onChannelStatus);
    } catch (error) {
      disposed = true;
      removeChannel();
      throw error;
    }

    windowRef.addEventListener?.("online", onOnline);
    windowRef.addEventListener?.("offline", onOffline);
    documentRef.addEventListener?.("visibilitychange", onVisibilityChange);

    return {
      add(listener) {
        listeners.add(listener);
        renderStatus(listener, state);
      },
      remove(listener) {
        listeners.delete(listener);
        if (listeners.size > 0) {
          return false;
        }
        disposed = true;
        if (refreshTimer !== null) {
          clearTimeoutImpl(refreshTimer);
          refreshTimer = null;
        }
        windowRef.removeEventListener?.("online", onOnline);
        windowRef.removeEventListener?.("offline", onOffline);
        documentRef.removeEventListener?.("visibilitychange", onVisibilityChange);
        removeChannel();
        return true;
      }
    };
  }

  function startPageRealtime({ documentRef, onUpdate, surface, windowRef }) {
    const client = windowRef.CryptoPulseSupabaseClient;
    if (!client) {
      if (windowRef.console && typeof windowRef.console.warn === "function") {
        windowRef.console.warn("Realtime is unavailable; existing polling remains active.");
      }
      return () => {};
    }
    try {
      return subscribeToChanges({
        client,
        documentRef,
        onUpdate,
        surface,
        windowRef
      });
    } catch (error) {
      if (windowRef.console && typeof windowRef.console.error === "function") {
        windowRef.console.error(
          "Realtime could not start; existing polling remains active.",
          error instanceof Error ? error.name : "Unknown error"
        );
      }
      return () => {};
    }
  }

  return {
    refreshDebounceMs,
    startPageRealtime,
    subscribeToChanges,
    surfaceSubscriptions
  };
});
