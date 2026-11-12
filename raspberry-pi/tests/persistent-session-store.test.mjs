import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPersistentSessionStore } from "../src/auth/persistent-session-store.mjs";
import { hashSessionToken } from "../src/auth/session-store.mjs";

const dashboardAuth = Object.freeze({
  username: "operator",
  passwordHash: "$2a$10$mqVzXb8xEv/4khOjtskpme6LMSS9d/BQTwDX/LLAm7ig6xKOgptea"
});

async function createTemporaryStore(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cryptopulse-session-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "dashboard-sessions.json");
  return {
    filePath,
    createStore: (overrides = {}) => createPersistentSessionStore({
      filePath,
      dashboardAuth,
      ...options,
      ...overrides
    })
  };
}

test("persistent sessions survive store recreation without storing raw tokens", async (t) => {
  const { filePath, createStore } = await createTemporaryStore(t);
  const firstStore = await createStore();
  const created = await firstStore.create({ subject: "dashboard-admin", roles: ["admin"] });
  const persisted = await readFile(filePath, "utf8");

  assert.equal(persisted.includes(created.token), false);
  assert.equal(persisted.includes(hashSessionToken(created.token)), true);

  const restartedStore = await createStore();
  assert.deepEqual(await restartedStore.get(created.token), created.session);
  if (process.platform !== "win32") {
    assert.equal((await stat(filePath)).mode & 0o777, 0o600);
  }
});

test("persistent sessions are revoked by logout and invalidated when credentials change", async (t) => {
  const { createStore } = await createTemporaryStore(t);
  const firstStore = await createStore();
  const created = await firstStore.create({ subject: "dashboard-admin", roles: ["admin"] });

  const restartedStore = await createStore();
  assert.equal(await restartedStore.delete(created.token), true);
  assert.equal(await (await createStore()).get(created.token), null);

  const secondSession = await restartedStore.create({
    subject: "dashboard-admin",
    roles: ["admin"]
  });
  const changedCredentialsStore = await createStore({
    dashboardAuth: {
      username: dashboardAuth.username,
      passwordHash: `${dashboardAuth.passwordHash}changed`
    }
  });
  assert.equal(await changedCredentialsStore.get(secondSession.token), null);
});

test("persistent session capacity is enforced across store instances", async (t) => {
  const { createStore } = await createTemporaryStore(t, { maxSessions: 1 });
  const firstStore = await createStore();
  await firstStore.create({ subject: "dashboard-admin", roles: ["admin"] });

  const restartedStore = await createStore();
  await assert.rejects(
    restartedStore.create({ subject: "dashboard-admin", roles: ["admin"] }),
    { code: "SESSION_CAPACITY_EXCEEDED" }
  );
});

test("persistent session store fails closed on malformed state", async (t) => {
  const { filePath, createStore } = await createTemporaryStore(t);
  const store = await createStore();
  await store.create({ subject: "dashboard-admin", roles: ["admin"] });
  await writeFile(filePath, "{broken", "utf8");

  await assert.rejects(createStore(), /unreadable or malformed/);
});
