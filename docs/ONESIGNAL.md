# OneSignal trade push notifications

CryptoPulse uses OneSignal Web Push for the installed dashboard web app. The
Pi runtime sends a notification after a paper trade has committed; a provider
failure is logged and does not roll back or fail the trade. Both AI BUY/SELL
trades and automatic ATR trailing SELL exits are included. Skipped decisions
do not produce notifications.

## OneSignal setup

1. In OneSignal, create or select a **Web Push** app and configure its exact
   HTTPS website origin (the dashboard's deployed hostname).
2. Copy the app's **App ID**. This value is public.
3. Create a **REST API Key** for that app with permission to send push
   notifications. Keep this key private.
4. The dashboard sends to the `Total Subscriptions` segment, matching the
   default audience shown in the OneSignal composer. Every subscribed device
   in this app receives the notification.

The existing OneSignal composer messages are not automatically triggered by
the runtime. CryptoPulse sends the title and dynamic BUY/SELL text through the
OneSignal API; the message text follows the same wording and includes market
and execution price.

## Configure CryptoPulse

- Set `ONESIGNAL_APP_ID` in the Vercel project's build environment. The build
  places this public ID in `js/runtime-api-config.js`; it never includes the
  REST API Key.
- On the Raspberry Pi, set both `ONESIGNAL_APP_ID` and
  `ONESIGNAL_REST_API_KEY` in `raspberry-pi/.env`. They must identify the same
  OneSignal app. Restart the Pi runtime after updating the environment.
- Deploy the dashboard so it includes the Settings subscription controls and
  the root `OneSignalSDKWorker.js` service worker.
- On iPhone/iPad with iOS/iPadOS 16.4 or newer, open CryptoPulse from its Home
  Screen icon, go to **Settings**, and tap **Enable trade notifications**.
  Permission must be granted by iOS. Use the Settings control to opt out later.

The `OneSignalSDKWorker.js` file must remain publicly accessible at the root of
the dashboard's HTTPS origin. No additional Vercel function or database
migration is required.

## Delivery behavior

Push requests are made only after the paper-trading transaction commits. The
notification contains the trade ID, side, market, execution price, quantity,
and execution reason as OneSignal data. Provider errors are logged with a safe
error code and do not change the result of an already committed paper trade.
Notifications are best-effort; there is no durable retry queue.
