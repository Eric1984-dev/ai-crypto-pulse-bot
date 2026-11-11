import { ApiError } from "../api/api-error.mjs";

export function authenticationMiddleware(provider) {
  if (!provider || typeof provider.authenticate !== "function") {
    throw new TypeError("An authentication provider interface is required.");
  }
  return async (context, next) => {
    const identity = await provider.authenticate(context.request);
    if (identity === null || identity === undefined) {
      context.auth = null;
    } else if (isValidIdentity(identity)) {
      context.auth = identity;
    } else {
      throw new Error("The authentication provider returned an invalid identity.");
    }
    await next();
  };
}

function isValidIdentity(identity) {
  return identity
    && identity.principal
    && typeof identity.principal.subject === "string"
    && Array.isArray(identity.principal.roles)
    && identity.principal.roles.every((role) => typeof role === "string");
}

export function requireAuthenticated(context) {
  if (!context.auth?.principal) {
    throw new ApiError(401, "UNAUTHENTICATED", "Authentication is required.");
  }
}

export function requireDashboardReadAccess(context) {
  if (context.auth?.principal || context.dashboardAccessMode === "anonymous-read-only") {
    return;
  }
  throw new ApiError(401, "UNAUTHENTICATED", "Authentication is required.");
}
