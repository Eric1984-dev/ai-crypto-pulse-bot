function initializeSettingsNotifications(windowRef, documentRef) {
  const status = documentRef.querySelector("[data-push-status]");
  const enableButton = documentRef.querySelector("[data-push-enable]");
  const disableButton = documentRef.querySelector("[data-push-disable]");
  const appId = windowRef.CryptoPulseRuntimeConfig?.oneSignalAppId || "";
  let oneSignalPromise = null;
  let oneSignalInstance = null;

  if (!status || !enableButton || !disableButton) {
    return;
  }

  function showStatus(message, state = "normal") {
    status.textContent = message;
    status.dataset.state = state;
  }

  async function loadOneSignal() {
    if (!appId) {
      throw new Error("Push notifications are not configured for this dashboard.");
    }
    if (oneSignalPromise) {
      return oneSignalPromise;
    }

    windowRef.OneSignalDeferred = windowRef.OneSignalDeferred || [];
    oneSignalPromise = new Promise((resolve, reject) => {
      const timeout = windowRef.setTimeout(() => {
        reject(new Error("OneSignal did not finish loading."));
      }, 15000);
      windowRef.OneSignalDeferred.push(async (OneSignal) => {
        try {
          await OneSignal.init({
            appId,
            serviceWorkerPath: "OneSignalSDKWorker.js",
            serviceWorkerParam: { scope: "/" },
            welcomeNotification: { disable: true }
          });
          windowRef.clearTimeout(timeout);
          oneSignalInstance = OneSignal;
          resolve(OneSignal);
        } catch (error) {
          windowRef.clearTimeout(timeout);
          reject(error);
        }
      });

      const script = documentRef.createElement("script");
      script.src = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
      script.defer = true;
      script.onerror = () => {
        windowRef.clearTimeout(timeout);
        reject(new Error("OneSignal could not be loaded."));
      };
      documentRef.head.append(script);
    });

    return oneSignalPromise;
  }

  function renderSubscription(OneSignal, supported) {
    enableButton.hidden = !supported;
    disableButton.hidden = !supported;
    enableButton.disabled = !supported;
    disableButton.disabled = !supported;
    if (!supported) {
      showStatus(
        "Pushmeldingen zijn niet beschikbaar in deze browser. Op iPhone is iOS 16.4 of hoger vereist.",
        "error"
      );
      return;
    }

    const optedIn = OneSignal.User.PushSubscription.optedIn === true;
    enableButton.hidden = optedIn;
    disableButton.hidden = !optedIn;
    showStatus(optedIn
      ? "Pushmeldingen voor uitgevoerde paper BUY- en SELL-trades staan aan."
      : "Pushmeldingen staan uit. Schakel ze in via deze knop; op iPhone moet je deze dashboard-app vanaf het beginscherm openen."
    );
  }

  async function initialize() {
    enableButton.disabled = true;
    disableButton.disabled = true;
    if (!appId) {
      showStatus(
        "OneSignal is nog niet geconfigureerd. Stel ONESIGNAL_APP_ID in bij de Vercel build-instellingen.",
        "error"
      );
      return;
    }

    try {
      await windowRef.CryptoPulseAuthReady;
      const OneSignal = await loadOneSignal();
      const supported = await OneSignal.Notifications.isPushSupported();
      OneSignal.Notifications.addEventListener("permissionChange", () =>
        renderSubscription(OneSignal, supported));
      OneSignal.User.PushSubscription.addEventListener("change", () =>
        renderSubscription(OneSignal, supported));
      renderSubscription(OneSignal, supported);
    } catch {
      showStatus(
        "OneSignal kon niet worden gestart. Controleer de App ID, de website-origin en of de dashboard-app via HTTPS is geopend.",
        "error"
      );
    }
  }

  enableButton.addEventListener("click", async () => {
    enableButton.disabled = true;
    try {
      const OneSignal = oneSignalInstance;
      if (!OneSignal) {
        throw new Error("OneSignal is not ready.");
      }
      const permissionRequest = OneSignal.Notifications.requestPermission();
      await permissionRequest;
      if (OneSignal.Notifications.permission) {
        await OneSignal.User.PushSubscription.optIn();
      }
      renderSubscription(
        OneSignal,
        await OneSignal.Notifications.isPushSupported()
      );
    } catch {
      enableButton.disabled = false;
      showStatus(
        "Pushmeldingen inschakelen is mislukt. Controleer de meldingsrechten van deze website in iPhone-instellingen.",
        "error"
      );
    }
  });

  disableButton.addEventListener("click", async () => {
    disableButton.disabled = true;
    try {
      const OneSignal = oneSignalInstance;
      if (!OneSignal) {
        throw new Error("OneSignal is not ready.");
      }
      await OneSignal.User.PushSubscription.optOut();
      renderSubscription(
        OneSignal,
        await OneSignal.Notifications.isPushSupported()
      );
    } catch {
      disableButton.disabled = false;
      showStatus("Pushmeldingen uitschakelen is mislukt. Probeer het opnieuw.", "error");
    }
  });

  return initialize();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = initializeSettingsNotifications;
} else {
  initializeSettingsNotifications(window, document);
}
