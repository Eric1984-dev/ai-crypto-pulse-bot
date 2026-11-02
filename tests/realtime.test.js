"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const realtime = require("../js/realtime.js");
const rootDirectory = path.resolve(__dirname, "..");

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(name, callback) {
      if (!listeners.has(name)) {
        listeners.set(name, new Set());
      }
      listeners.get(name).add(callback);
    },
    dispatch(name) {
      for (const callback of listeners.get(name) || []) {
        callback({ type: name });
      }
    },
    listenerCount() {
      return [...listeners.values()].reduce((count, callbacks) => count + callbacks.size, 0);
    },
    removeEventListener(name, callback) {
      listeners.get(name)?.delete(callback);
    }
  };
}

function createBrowserEnvironment() {
  const windowRef = createEventTarget();
  const documentRef = createEventTarget();
  const timers = new Map();
  let nextTimerId = 1;
  const statusElement = { dataset: {}, hidden: true, textContent: "" };

  windowRef.navigator = { onLine: true };
  windowRef.console = { error() {}, warn() {} };
  windowRef.setTimeout = (callback) => {
    const timerId = nextTimerId++;
    timers.set(timerId, callback);
    return timerId;
  };
  windowRef.clearTimeout = (timerId) => timers.delete(timerId);
  documentRef.visibilityState = "visible";
  documentRef.querySelector = (selector) => (
    selector === "[data-realtime-status]" ? statusElement : null
  );

  return {
    documentRef,
    flushTimers() {
      const currentTimers = [...timers.entries()];
      for (const [timerId, callback] of currentTimers) {
        if (timers.delete(timerId)) {
          callback();
        }
      }
    },
    statusElement,
    windowRef
  };
}

function createClient() {
  const channels = [];
  const removedChannels = [];
  return {
    channels,
    removedChannels,
    channel(name) {
      const channel = {
        bindings: [],
        name,
        on(eventType, filter, callback) {
          this.bindings.push({ callback, eventType, filter });
          return this;
        },
        subscribe(callback) {
          this.statusCallback = callback;
          callback("SUBSCRIBED");
          return this;
        },
        emit(table) {
          for (const binding of this.bindings) {
            if (binding.filter.table === table) {
              binding.callback({ eventType: "INSERT", new: { ignored: true } });
            }
          }
        },
        setStatus(status) {
          this.statusCallback(status);
        }
      };
      channels.push(channel);
      return channel;
    },
    removeChannel(channel) {
      removedChannels.push(channel);
      channel.setStatus("CLOSED");
      return Promise.resolve("ok");
    }
  };
}

function subscribe(client, environment, surface, onUpdate, onStatus) {
  return realtime.subscribeToChanges({
    client,
    documentRef: environment.documentRef,
    onStatus,
    onUpdate,
    surface,
    windowRef: environment.windowRef
  });
}

test("subscribes only to scanner tables and coalesces event bursts", () => {
  const client = createClient();
  const environment = createBrowserEnvironment();
  let updates = 0;
  const unsubscribe = subscribe(client, environment, "scanner", () => {
    updates += 1;
  });

  const channel = client.channels[0];
  assert.equal(channel.bindings.length, 4);
  assert.deepEqual(
    channel.bindings.map((binding) => binding.filter.table).sort(),
    [
      "AI_Crypto_Bot_AI_Decisions",
      "AI_Crypto_Bot_Candles",
      "AI_Crypto_Bot_Market_Data",
      "AI_Crypto_Bot_Watched_Markets"
    ].sort()
  );
  assert.equal(
    channel.bindings.find((binding) => binding.filter.table === "AI_Crypto_Bot_Candles")
      .filter.filter,
    "interval=in.(1h,1d)"
  );

  environment.flushTimers();
  assert.equal(updates, 1);
  channel.emit("AI_Crypto_Bot_Market_Data");
  channel.emit("AI_Crypto_Bot_Market_Data");
  channel.emit("AI_Crypto_Bot_AI_Decisions");
  environment.flushTimers();
  assert.equal(updates, 2);

  unsubscribe();
});

test("recommendations subscribe to analytics source tables only", () => {
  const client = createClient();
  const environment = createBrowserEnvironment();
  const unsubscribe = subscribe(client, environment, "recommendations", () => {});

  assert.deepEqual(
    client.channels[0].bindings.map((binding) => binding.filter.table).sort(),
    [
      "AI_Crypto_Bot_AI_Decisions",
      "AI_Crypto_Bot_Portfolio_Snapshots",
      "AI_Crypto_Bot_Portfolios",
      "AI_Crypto_Bot_Positions",
      "AI_Crypto_Bot_Trades"
    ].sort()
  );
  unsubscribe();
});

test("trade history refreshes for execution and market-price updates", () => {
  const client = createClient();
  const environment = createBrowserEnvironment();
  let updates = 0;
  const unsubscribe = subscribe(client, environment, "history", () => {
    updates += 1;
  });

  assert.deepEqual(
    client.channels[0].bindings.map((binding) => binding.filter.table).sort(),
    ["AI_Crypto_Bot_Market_Data", "AI_Crypto_Bot_Trades"].sort()
  );
  client.channels[0].emit("AI_Crypto_Bot_Market_Data");
  environment.flushTimers();
  assert.equal(updates, 1);
  unsubscribe();
});

test("recovers after a Realtime connection error and reports state", () => {
  const client = createClient();
  const environment = createBrowserEnvironment();
  const states = [];
  let updates = 0;
  const unsubscribe = subscribe(
    client,
    environment,
    "portfolio",
    () => {
      updates += 1;
    },
    (state) => states.push(state)
  );

  environment.flushTimers();
  client.channels[0].setStatus("CHANNEL_ERROR");
  assert.equal(environment.statusElement.dataset.state, "reconnecting");
  assert.match(environment.statusElement.textContent, /Automatic refresh remains active/);
  client.channels[0].setStatus("SUBSCRIBED");
  environment.flushTimers();

  assert.equal(updates, 2);
  assert.ok(states.includes("connected"));
  assert.ok(states.includes("reconnecting"));
  unsubscribe();
});

test("offline events pause refreshes and online recovery refreshes immediately", () => {
  const client = createClient();
  const environment = createBrowserEnvironment();
  let updates = 0;
  const unsubscribe = subscribe(client, environment, "history", () => {
    updates += 1;
  });

  environment.flushTimers();
  assert.equal(updates, 1);
  environment.windowRef.navigator.onLine = false;
  environment.windowRef.dispatch("offline");
  assert.equal(environment.statusElement.dataset.state, "offline");
  client.channels[0].emit("AI_Crypto_Bot_Trades");
  environment.flushTimers();
  assert.equal(updates, 1);

  environment.windowRef.navigator.onLine = true;
  environment.windowRef.dispatch("online");
  environment.flushTimers();
  assert.equal(updates, 2);
  assert.equal(environment.statusElement.dataset.state, "reconnecting");
  unsubscribe();
});

test("deduplicates page subscriptions, supports independent tabs, and releases resources", () => {
  const client = createClient();
  const environment = createBrowserEnvironment();
  let firstUpdates = 0;
  let secondUpdates = 0;
  const unsubscribeFirst = subscribe(client, environment, "history", () => {
    firstUpdates += 1;
  });
  const unsubscribeSecond = subscribe(client, environment, "history", () => {
    secondUpdates += 1;
  });

  assert.equal(client.channels.length, 1);
  environment.flushTimers();
  assert.equal(firstUpdates, 1);
  assert.equal(secondUpdates, 1);
  unsubscribeFirst();
  client.channels[0].emit("AI_Crypto_Bot_Trades");
  environment.flushTimers();
  assert.equal(firstUpdates, 1);
  assert.equal(secondUpdates, 2);
  assert.equal(client.removedChannels.length, 0);
  unsubscribeSecond();
  unsubscribeSecond();
  assert.equal(client.removedChannels.length, 1);
  assert.equal(environment.windowRef.listenerCount(), 0);
  assert.equal(environment.documentRef.listenerCount(), 0);

  const secondTabClient = createClient();
  const secondTab = createBrowserEnvironment();
  const unsubscribeSecondTab = subscribe(secondTabClient, secondTab, "history", () => {});
  assert.equal(secondTabClient.channels.length, 1);
  assert.notEqual(secondTabClient.channels[0], client.channels[0]);
  unsubscribeSecondTab();
});

test("refreshes visible pages after returning from a hidden state", () => {
  const client = createClient();
  const environment = createBrowserEnvironment();
  let updates = 0;
  const unsubscribe = subscribe(client, environment, "dashboard", () => {
    updates += 1;
  });

  environment.flushTimers();
  environment.documentRef.visibilityState = "hidden";
  client.channels[0].emit("AI_Crypto_Bot_Status");
  environment.flushTimers();
  assert.equal(updates, 1);
  environment.documentRef.visibilityState = "visible";
  environment.documentRef.dispatch("visibilitychange");
  environment.flushTimers();
  assert.equal(updates, 2);
  unsubscribe();
});

test("authenticated views wire the shared Realtime service after Auth initializes", () => {
  const views = [
    { file: "dashboard", surface: "dashboard" },
    { file: "portfolio", surface: "portfolio" },
    { file: "history", surface: "history" },
    { file: "scanner", surface: "scanner" }
  ];

  for (const { file, surface } of views) {
    const script = fs.readFileSync(path.join(rootDirectory, "js", `${file}.js`), "utf8");
    const page = fs.readFileSync(path.join(rootDirectory, `${file}.html`), "utf8");
    assert.match(script, /startPageRealtime/);
    assert.match(script, new RegExp(`surface: "${surface}"`));
    assert.ok(page.includes('<script src="/js/realtime.js" defer></script>'));
    assert.match(page, /data-realtime-status/);
  }

  const authScript = fs.readFileSync(path.join(rootDirectory, "js", "auth.js"), "utf8");
  assert.match(authScript, /CryptoPulseSupabaseClient = client/);
});
