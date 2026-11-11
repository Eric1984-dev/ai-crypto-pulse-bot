import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const serviceUrl = new URL("../deploy/cryptopulse-runtime.service", import.meta.url);

test("systemd unit starts at boot and continuously restarts the runtime", async () => {
  const service = await readFile(serviceUrl, "utf8");

  assert.match(service, /^Restart=always$/m);
  assert.match(service, /^RestartSec=10s$/m);
  assert.match(service, /^StartLimitIntervalSec=0$/m);
  assert.match(service, /^WantedBy=multi-user\.target$/m);
  assert.match(service, /^After=network-online\.target$/m);
});
