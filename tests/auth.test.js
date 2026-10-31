const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const {
  createAuthService,
  createSupabaseClient,
  safeNextPath
} = require("../js/auth-service.js");
const {
  getPublicConfig,
  readAccessToken,
  verifyAccessToken
} = require("../lib/auth-session.js");

const rootDirectory = path.resolve(__dirname, "..");
const authConfigModule = import("../api/auth-config.mjs");
const authSessionModule = import("../api/auth-session.mjs");
const protectedPageModule = import("../api/protected-page.mjs");
const authEnv = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_ANON_KEY: "test-anon-key"
};
const testAccessToken = "header.payload.signature";

function createResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(value = "") {
      this.body = value;
    }
  };
}

function createFakeClient(session = { access_token: testAccessToken }) {
  const calls = [];
  const data = { session, user: { email: "trader@example.test" } };
  const auth = {
    signUp: async (args) => { calls.push(["signUp", args]); return { data, error: null }; },
    signInWithPassword: async (args) => { calls.push(["signInWithPassword", args]); return { data, error: null }; },
    signOut: async () => { calls.push(["signOut"]); return { data: {}, error: null }; },
    resetPasswordForEmail: async (...args) => { calls.push(["resetPasswordForEmail", ...args]); return { data: {}, error: null }; },
    updateUser: async (args) => { calls.push(["updateUser", args]); return { data: {}, error: null }; },
    getSession: async () => ({ data: { session: data.session }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
  };
  return { client: { auth }, calls, data };
}

test("registration calls Supabase Auth with confirmation redirect", async () => {
  const { client, calls, data } = createFakeClient();
  const auth = createAuthService(client);

  assert.deepEqual(await auth.register("trader@example.test", "Strong-password-1", "https://app.test/login.html"), data);
  assert.deepEqual(calls[0], ["signUp", {
    email: "trader@example.test",
    password: "Strong-password-1",
    options: { emailRedirectTo: "https://app.test/login.html" }
  }]);
});

test("login and logout use Supabase session operations", async () => {
  const { client, calls, data } = createFakeClient();
  const auth = createAuthService(client);

  assert.deepEqual(await auth.login("trader@example.test", "password"), data);
  assert.deepEqual(await auth.logout(), {});
  assert.equal(calls[0][0], "signInWithPassword");
  assert.deepEqual(calls[1], ["signOut"]);
});

test("session lookup unwraps Supabase data and returns null for anonymous users", async () => {
  const anonymousAuth = createAuthService(createFakeClient(null).client);
  assert.equal(await anonymousAuth.getSession(), null);

  const { client, data } = createFakeClient();
  const authenticatedAuth = createAuthService(client);
  assert.equal(await authenticatedAuth.getSession(), data.session);
});

test("password reset and password update use Supabase Auth", async () => {
  const { client, calls } = createFakeClient();
  const auth = createAuthService(client);

  await auth.requestPasswordReset("trader@example.test", "https://app.test/reset-password.html");
  await auth.updatePassword("New-strong-password-2");

  assert.deepEqual(calls[0], [
    "resetPasswordForEmail",
    "trader@example.test",
    { redirectTo: "https://app.test/reset-password.html" }
  ]);
  assert.deepEqual(calls[1], ["updateUser", { password: "New-strong-password-2" }]);
});

test("Supabase client persists sessions and handles auth redirect URLs", () => {
  let captured;
  const client = createSupabaseClient((...args) => {
    captured = args;
    return { auth: {} };
  }, { supabaseUrl: authEnv.SUPABASE_URL, supabaseAnonKey: authEnv.SUPABASE_ANON_KEY });

  assert.ok(client.auth);
  assert.deepEqual(captured[2].auth, {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  });
});

test("post-login redirects allow only protected internal pages", () => {
  const allowed = ["/dashboard.html", "/portfolio.html", "/scanner.html", "/history.html", "/settings.html"];

  assert.equal(safeNextPath("/scanner", allowed), "/scanner.html");
  assert.equal(safeNextPath("//attacker.example", allowed), "/dashboard.html");
  assert.equal(safeNextPath("/login.html", allowed), "/dashboard.html");
});

test("public auth configuration includes only the URL and anonymous key", () => {
  assert.deepEqual(getPublicConfig(authEnv), {
    supabaseUrl: authEnv.SUPABASE_URL,
    supabaseAnonKey: authEnv.SUPABASE_ANON_KEY
  });
  assert.equal(getPublicConfig({}), null);
  assert.equal(getPublicConfig({
    ...authEnv,
    SUPABASE_ANON_KEY: `header.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`
  }), null);
});

test("server-side token verification calls Supabase Auth with the anon key", async () => {
  let request;
  const verified = await verifyAccessToken(testAccessToken, {
    supabaseUrl: authEnv.SUPABASE_URL,
    supabaseAnonKey: authEnv.SUPABASE_ANON_KEY
  }, async (...args) => {
    request = args;
    return { status: 200, ok: true };
  });

  assert.equal(verified, true);
  assert.equal(request[0], `${authEnv.SUPABASE_URL}/auth/v1/user`);
  assert.equal(request[1].headers.apikey, authEnv.SUPABASE_ANON_KEY);
  assert.equal(request[1].headers.authorization, `Bearer ${testAccessToken}`);
});

test("auth config endpoint does not expose configuration when unset", () => {
  const res = createResponse();

  return authConfigModule.then((module) => {
    module.createHandler({ env: {} })({ method: "GET" }, res);
    assert.equal(res.statusCode, 503);
    assert.match(res.body, /AUTH_NOT_CONFIGURED/);
  });
});

test("logout clears the HttpOnly protected-page cookie", async () => {
  const authSession = await authSessionModule;
  const handler = authSession.createHandler({
    env: { ...authEnv, NODE_ENV: "production" }
  });
  const res = createResponse();

  await handler({ method: "DELETE", headers: {} }, res);

  assert.equal(res.statusCode, 204);
  assert.match(res.headers["set-cookie"], /HttpOnly/);
  assert.match(res.headers["set-cookie"], /Max-Age=0/);
  assert.match(res.headers["set-cookie"], /Secure/);
});

test("protected-page logout signs out, clears the cookie, and redirects to login", async () => {
  const authConfig = await authConfigModule;
  const authSession = await authSessionModule;
  const sessionHandler = authSession.createHandler({
    env: { ...authEnv, NODE_ENV: "production" },
    verify: async (token) => token === testAccessToken
  });
  const configHandler = authConfig.createHandler({ env: authEnv });
  const requests = [];
  const cookieHeaders = [];
  const authCalls = [];
  const redirects = [];
  let authStateListener;
  let logoutClickListener;
  let resolvePageReady;
  const pageReady = new Promise((resolve) => {
    resolvePageReady = resolve;
  });
  const session = {
    access_token: testAccessToken,
    expires_in: 3600,
    user: { email: "trader@example.test" }
  };
  const fakeClient = {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange(callback) {
        authStateListener = callback;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      async signOut() {
        authCalls.push("signOut");
        authStateListener("SIGNED_OUT", null);
        return { data: {}, error: null };
      }
    }
  };
  const button = {
    disabled: false,
    addEventListener(eventName, listener) {
      assert.equal(eventName, "click");
      logoutClickListener = listener;
    }
  };
  const userEmail = { textContent: "" };
  const document = {
    body: { dataset: { authPage: "protected" } },
    documentElement: { classList: { remove: resolvePageReady } },
    querySelector(selector) {
      if (selector === "[data-user-email]") {
        return userEmail;
      }
      return null;
    },
    querySelectorAll(selector) {
      assert.equal(selector, "[data-auth-logout]");
      return [button];
    }
  };
  const window = {
    CryptoPulseAuth: require("../js/auth-service.js"),
    location: {
      origin: "https://app.test",
      search: "",
      hash: "",
      pathname: "/dashboard.html",
      replace(destination) {
        redirects.push(destination);
      }
    }
  };
  const fetch = async (url, options = {}) => {
    const method = options.method || "GET";
    requests.push({ url, method });
    const res = createResponse();

    if (url === "/api/auth-config") {
      configHandler({ method }, res);
      return {
        ok: res.statusCode === 200,
        json: async () => JSON.parse(res.body)
      };
    }

    if (url === "/api/auth-session") {
      const request = {
        method,
        headers: {},
        body: method === "POST" ? JSON.parse(options.body) : undefined
      };
      await sessionHandler(request, res);
      if (res.headers["set-cookie"]) {
        cookieHeaders.push(res.headers["set-cookie"]);
      }
      return { ok: res.statusCode >= 200 && res.statusCode < 300 };
    }

    throw new Error(`Unexpected request: ${method} ${url}`);
  };
  const source = fs.readFileSync(path.join(rootDirectory, "js/auth.js"), "utf8");
  const sdkImport = "const sdk = await import(sdkUrl);";
  assert.ok(source.includes(sdkImport));
  const browserCode = source.replace(sdkImport, "const sdk = { createClient: () => fakeClient };");

  vm.runInNewContext(browserCode, {
    document,
    window,
    fetch,
    fakeClient,
    URL,
    URLSearchParams
  });

  let timeout;
  try {
    await Promise.race([
      pageReady,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Protected page auth did not finish initializing.")), 2000);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }

  assert.equal(userEmail.textContent, "trader@example.test");
  assert.equal(typeof logoutClickListener, "function");
  await logoutClickListener();

  assert.deepEqual(authCalls, ["signOut"]);
  assert.ok(requests.some((request) => request.url === "/api/auth-session" && request.method === "DELETE"));
  assert.ok(cookieHeaders.some((cookie) => /HttpOnly/.test(cookie) && /Max-Age=0/.test(cookie)));
  assert.ok(redirects.some((destination) => new URL(destination, "https://app.test").pathname === "/login.html"));
});

test("session cookie is HttpOnly and allows protected access across page requests", async () => {
  const authSession = await authSessionModule;
  const protectedPage = await protectedPageModule;
  const sessionHandler = authSession.createHandler({
    env: { ...authEnv, NODE_ENV: "production" },
    verify: async (token) => token === testAccessToken
  });
  const sessionResponse = createResponse();

  await sessionHandler({
    method: "POST",
    body: { accessToken: testAccessToken, expiresIn: 3600 },
    headers: {}
  }, sessionResponse);

  assert.equal(sessionResponse.statusCode, 204);
  assert.match(sessionResponse.headers["set-cookie"], /HttpOnly/);
  assert.match(sessionResponse.headers["set-cookie"], /Secure/);
  const cookie = sessionResponse.headers["set-cookie"].split(";")[0];
  assert.equal(readAccessToken(cookie), testAccessToken);

  const pageHandler = protectedPage.createHandler({
    env: authEnv,
    verify: async (token) => token === testAccessToken,
    readFile: (filePath) => `protected:${path.basename(filePath)}`,
    projectRoot: rootDirectory
  });
  const pageResponse = createResponse();
  await pageHandler({
    method: "GET",
    query: { page: "dashboard" },
    headers: { cookie }
  }, pageResponse);

  assert.equal(pageResponse.statusCode, 200);
  assert.equal(pageResponse.body, "protected:dashboard.html");
});

test("unauthenticated requests redirect before protected page content is read", async () => {
  const protectedPage = await protectedPageModule;
  let pageRead = false;
  const handler = protectedPage.createHandler({
    env: authEnv,
    verify: async () => true,
    readFile: () => { pageRead = true; return "private"; },
    projectRoot: rootDirectory
  });

  for (const page of ["dashboard", "portfolio", "scanner", "history", "settings"]) {
    const res = createResponse();
    await handler({ method: "GET", query: { page }, headers: {} }, res);

    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, `/login.html?next=%2F${page}.html`);
  }
  assert.equal(pageRead, false);
});

test("all required protected pages are served only after session verification", async () => {
  const protectedPage = await protectedPageModule;
  const pages = ["dashboard", "portfolio", "scanner", "history", "settings"];
  const handler = protectedPage.createHandler({
    env: authEnv,
    verify: async (token) => token === testAccessToken,
    readFile: (filePath) => path.basename(filePath),
    projectRoot: rootDirectory
  });

  for (const page of pages) {
    const res = createResponse();
    await handler({
      method: "GET",
      query: { page },
      headers: { cookie: `cp_access_token=${testAccessToken}` }
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body, `${page}.html`);
  }
});

test("invalid sessions are rejected and clear the session cookie", async () => {
  const protectedPage = await protectedPageModule;
  const handler = protectedPage.createHandler({
    env: authEnv,
    verify: async () => false,
    readFile: () => "must not be returned",
    projectRoot: rootDirectory
  });
  const res = createResponse();

  await handler({
    method: "GET",
    query: { page: "settings" },
    headers: { cookie: `cp_access_token=${testAccessToken}` }
  }, res);

  assert.equal(res.statusCode, 302);
  assert.match(res.headers["set-cookie"], /Max-Age=0/);
  assert.equal(res.body, "");
});

test("Supabase verification outages fail closed without serving protected HTML", async () => {
  const protectedPage = await protectedPageModule;
  const handler = protectedPage.createHandler({
    env: authEnv,
    verify: async () => { throw new Error("upstream unavailable"); },
    readFile: () => "must not be returned",
    projectRoot: rootDirectory
  });
  const res = createResponse();

  await handler({
    method: "GET",
    query: { page: "dashboard" },
    headers: { cookie: `cp_access_token=${testAccessToken}` }
  }, res);

  assert.equal(res.statusCode, 503);
  assert.match(res.body, /temporarily unavailable/);
});

test("authentication pages expose the required forms", () => {
  const expectedForms = {
    "login.html": "login-form",
    "register.html": "register-form",
    "reset-password.html": "reset-request-form"
  };

  for (const [page, formId] of Object.entries(expectedForms)) {
    const html = fs.readFileSync(path.join(rootDirectory, page), "utf8");
    const form = html.match(new RegExp(`<form[^>]*id="${formId}"[^>]*>`));
    assert.ok(form);
    assert.match(form[0], /method="post"/);
    assert.match(html, /\/js\/auth\.js/);
  }
});

test("every protected page exposes a logout control", () => {
  for (const page of ["dashboard.html", "portfolio.html", "scanner.html", "history.html", "settings.html"]) {
    const html = fs.readFileSync(path.join(rootDirectory, page), "utf8");
    assert.match(html, /<button[^>]*data-auth-logout[^>]*>/);
  }
});
