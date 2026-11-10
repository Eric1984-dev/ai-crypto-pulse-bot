import { ApiError } from "../api/api-error.mjs";
import { requireAuthenticated } from "./authentication-middleware.mjs";

export function requireRole(context, requiredRole) {
  requireAuthenticated(context);
  if (!context.auth.principal.roles.includes(requiredRole)) {
    throw new ApiError(403, "FORBIDDEN", "Access is not permitted.");
  }
}
