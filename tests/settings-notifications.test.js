const assert = require("node:assert/strict");
const test = require("node:test");
const initializeSettingsNotifications = require("../js/settings-notifications.js");

function createElement() {
  const listeners = new Map();
  return {
    hidden: false,
    disabled: false,
    dataset: {},
    textContent: "",
    addEventListener(name, callback) {
      listeners.set(name, callback);
    },
    async trigger(name) {
      const callback = listeners.get(name);
      assert.equal(typeof callback, "function", `${name} handler should be registered`);
      await callback();
    }
  };
}

function createPage(appId = "123e4567-e89b-12d3-a456-426614174000") {
  const status = createElement();
  const enableButton = createElement();
  const disableButton = createElement();
  const scripts = [];
  const windowRef = {
    CryptoPulseRuntimeConfig: { oneSignalAppId: appId },
    CryptoPulseAuthReady: Promise.resolve(),
    setTimeout: () => 1,
    clearTimeout() {}
  };
  const documentRef = {
    querySelector(selector) {
      return {
        "[data-push-status]": status,
        "[data-push-enable]": enableButton,
        "[data-push-disable]": disableButton
      }[selector] || null;
    },
    createElement() {
      return {};
    },
    head: {
      append(script) {
        scripts.push(script);
      }
    }
  };
  return { windowRef, documentRef, status, enableButton, disableButton, scripts };
}

function createOneSignal() {
  const calls = [];
  const eventListeners = [];
  const pushSubscription = {
    optedIn: false,
    addEventListener(name, callback) {
      eventListeners.push({ name, callback });
    },
    async optIn() {
      calls.push("optIn");
      this.optedIn = true;
    },
    async optOut() {
      calls.push("optOut");
      this.optedIn = false;
    }
  };
  const notifications = {
    permission: false,
    async isPushSupported() {
      return true;
    },
    addEventListener(name, callback) {
      eventListeners.push({ name, callback });
    },
    requestPermission() {
      calls.push("requestPermission");
      this.permission = true;
      return Promise.resolve();
    }
  };
  return {
    calls,
    eventListeners,
    Notifications: notifications,
    User: { PushSubscription: pushSubscription },
    async init(options) {
      calls.push("init");
      assert.equal(options.serviceWorkerPath, "OneSignalSDKWorker.js");
      assert.deepEqual(options.serviceWorkerParam, { scope: "/" });
      assert.equal(options.welcomeNotification.disable, true);
    }
  };
}

test("settings prompts for push permission only after a click and supports opting out", async () => {
  const page = createPage();
  const oneSignal = createOneSignal();
  const ready = initializeSettingsNotifications(page.windowRef, page.documentRef);
  await Promise.resolve();

  assert.equal(page.scripts.length, 1);
  assert.equal(page.scripts[0].src, "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js");
  assert.equal(oneSignal.calls.length, 0);
  await page.windowRef.OneSignalDeferred[0](oneSignal);
  await ready;
  assert.equal(page.enableButton.disabled, false);
  assert.equal(page.enableButton.hidden, false);

  await page.enableButton.trigger("click");
  assert.deepEqual(oneSignal.calls.slice(-2), ["requestPermission", "optIn"]);
  assert.equal(page.disableButton.hidden, false);
  assert.match(page.status.textContent, /staan aan/);

  await page.disableButton.trigger("click");
  assert.equal(oneSignal.calls.at(-1), "optOut");
  assert.equal(page.enableButton.hidden, false);
  assert.match(page.status.textContent, /staan uit/);
});

test("settings report missing OneSignal build configuration without loading the SDK", async () => {
  const page = createPage("");

  await initializeSettingsNotifications(page.windowRef, page.documentRef);

  assert.equal(page.scripts.length, 0);
  assert.equal(page.enableButton.disabled, true);
  assert.match(page.status.textContent, /ONESIGNAL_APP_ID/);
  assert.equal(page.status.dataset.state, "error");
});
