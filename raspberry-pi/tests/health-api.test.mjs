import test from "node:test";
import assert from "node:assert/strict";
import { createHealthApiServer } from "../src/api/server.mjs";

async function withServer(options, run) {
  const server = createHealthApiServer(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) =>
      error ? reject(error) : resolve()));
  }
}

test("health API exposes liveness, readiness, diagnostics, and no operational routes", async () => {
  let checks = 0;
  const readiness = {
    async check() {
      checks += 1;
      return true;
    },
    getSnapshot() {
      return { contracts: "valid", enabledMarkets: 100, database: null };
    }
  };

  await withServer({
    readiness,
    getDiagnostics: () => ({ node: { architecture: "arm" } })
  }, async (baseUrl) => {
    const live = await fetch(`${baseUrl}/api/v1/health/live`);
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), { data: { status: "live" } });
    assert.equal(live.headers.get("cache-control"), "no-store");

    const ready = await fetch(`${baseUrl}/api/v1/health/ready`);
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), {
      data: {
        status: "ready",
        database: "available",
        contracts: "valid",
        enabledMarkets: 100
      }
    });

    const diagnostics = await fetch(`${baseUrl}/api/v1/health/diagnostics`);
    assert.equal(diagnostics.status, 200);
    assert.deepEqual(await diagnostics.json(), {
      data: { node: { architecture: "arm" } }
    });

    const operational = await fetch(`${baseUrl}/api/v1/paper-trading`);
    assert.equal(operational.status, 404);
    assert.equal(checks, 1);
  });
});

test("health API fails readiness closed and rejects non-GET methods", async () => {
  await withServer({
    readiness: {
      async check() { return false; },
      getSnapshot() { return { contracts: "invalid", enabledMarkets: null }; }
    },
    getDiagnostics: () => ({})
  }, async (baseUrl) => {
    const ready = await fetch(`${baseUrl}/api/v1/health/ready`);
    assert.equal(ready.status, 503);

    const post = await fetch(`${baseUrl}/api/v1/health/live`, { method: "POST" });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("allow"), "GET");
  });
});
