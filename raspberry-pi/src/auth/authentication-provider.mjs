export class AuthenticationProvider {
  async authenticate() {
    throw new Error("AuthenticationProvider.authenticate must be implemented.");
  }
}

export class DisabledAuthenticationProvider extends AuthenticationProvider {
  async authenticate() {
    return null;
  }
}

export class SessionAuthenticationProvider extends AuthenticationProvider {
  constructor(sessionStore, { cookieName = "__Host-cp_session" } = {}) {
    super();
    if (!sessionStore || typeof sessionStore.get !== "function") {
      throw new TypeError("A session store is required.");
    }
    this.sessionStore = sessionStore;
    this.cookieName = cookieName;
  }

  async authenticate(request) {
    const token = readCookie(request.headers.cookie, this.cookieName);
    if (!token) {
      return null;
    }
    const session = this.sessionStore.get(token);
    return session ? { principal: session.principal, session } : null;
  }
}

function readCookie(header, cookieName) {
  if (typeof header !== "string" || header.length > 8192) {
    return null;
  }

  let token = null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== cookieName) {
      continue;
    }
    if (token !== null) {
      return null;
    }
    token = part.slice(separator + 1).trim();
  }
  return token;
}
