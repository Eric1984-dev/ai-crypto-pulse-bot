const SESSION_COOKIE_NAME = "cp_access_token";

function isServiceRoleKey(key) {
  if (/^sb_secret_/i.test(key)) {
    return true;
  }

  const segments = key.split(".");
  if (segments.length !== 3) {
    return false;
  }

  try {
    return JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8")).role === "service_role";
  } catch {
    return false;
  }
}

function getPublicConfig(env = process.env) {
  const supabaseUrl = typeof env.SUPABASE_URL === "string" ? env.SUPABASE_URL.trim() : "";
  const supabaseAnonKey = typeof env.SUPABASE_ANON_KEY === "string" ? env.SUPABASE_ANON_KEY.trim() : "";

  if (!supabaseUrl || !supabaseAnonKey || isServiceRoleKey(supabaseAnonKey)) {
    return null;
  }

  try {
    const parsedUrl = new URL(supabaseUrl);
    if (!["http:", "https:"].includes(parsedUrl.protocol) || parsedUrl.pathname !== "/" || parsedUrl.search || parsedUrl.hash) {
      return null;
    }

    return {
      supabaseUrl: parsedUrl.origin,
      supabaseAnonKey
    };
  } catch {
    return null;
  }
}

function readAccessToken(cookieHeader = "") {
  for (const cookie of cookieHeader.split(";")) {
    const separator = cookie.indexOf("=");
    if (separator < 0 || cookie.slice(0, separator).trim() !== SESSION_COOKIE_NAME) {
      continue;
    }

    try {
      const token = decodeURIComponent(cookie.slice(separator + 1).trim());
      return token.length <= 8192 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
        ? token
        : null;
    } catch {
      return null;
    }
  }

  return null;
}

function createSessionCookie(accessToken, { maxAge = 3600, secure = false } = {}) {
  const secureAttribute = secure ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(accessToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureAttribute}`;
}

function clearSessionCookie({ secure = false } = {}) {
  const secureAttribute = secure ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureAttribute}`;
}

async function verifyAccessToken(accessToken, config, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(`${config.supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: config.supabaseAnonKey,
      authorization: `Bearer ${accessToken}`
    },
    cache: "no-store"
  });

  if (response.status === 401 || response.status === 403) {
    return false;
  }
  if (!response.ok) {
    throw new Error("Supabase Authentication could not verify the session.");
  }

  return true;
}

module.exports = {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  createSessionCookie,
  getPublicConfig,
  readAccessToken,
  verifyAccessToken
};
