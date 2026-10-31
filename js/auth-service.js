(function attachAuthService(root, createApi) {
  const api = createApi();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.CryptoPulseAuth = api;
})(globalThis, function createAuthApi() {
  function createSupabaseClient(createClient, config) {
    if (typeof createClient !== "function" || !config || !config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error("Supabase Authentication configuration is incomplete.");
    }

    return createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
  }

  function createAuthService(client) {
    if (!client || !client.auth) {
      throw new Error("A Supabase Authentication client is required.");
    }

    return {
      register(email, password, emailRedirectTo) {
        return resolve(client.auth.signUp({
          email,
          password,
          options: { emailRedirectTo }
        }));
      },
      login(email, password) {
        return resolve(client.auth.signInWithPassword({ email, password }));
      },
      logout() {
        return resolve(client.auth.signOut());
      },
      requestPasswordReset(email, redirectTo) {
        return resolve(client.auth.resetPasswordForEmail(email, { redirectTo }));
      },
      updatePassword(password) {
        return resolve(client.auth.updateUser({ password }));
      },
      getSession() {
        return resolve(client.auth.getSession()).then((data) => data.session);
      },
      onAuthStateChange(callback) {
        return client.auth.onAuthStateChange(callback);
      }
    };
  }

  function safeNextPath(candidate, allowedPaths) {
    const normalized = typeof candidate === "string" && candidate.endsWith(".html")
      ? candidate
      : `${candidate || ""}.html`;
    return allowedPaths.includes(normalized) ? normalized : "/dashboard.html";
  }

  async function resolve(operation) {
    const result = await operation;
    if (!result || result.error) {
      throw result && result.error ? result.error : new Error("Supabase Authentication returned no result.");
    }
    return result.data;
  }

  return { createAuthService, createSupabaseClient, safeNextPath };
});
