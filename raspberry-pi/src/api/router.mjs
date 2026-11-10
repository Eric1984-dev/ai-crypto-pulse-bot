import { ApiError } from "./api-error.mjs";

const METHOD_PATTERN = /^[A-Z]+$/;
const PATH_PATTERN = /^\/[a-zA-Z0-9/_-]*$/;

export class ApiRouter {
  #routes = new Map();

  register(method, path, handler) {
    const normalizedMethod = String(method).toUpperCase();
    if (!METHOD_PATTERN.test(normalizedMethod)
      || !PATH_PATTERN.test(path)
      || typeof handler !== "function") {
      throw new TypeError("A valid HTTP method, static path, and handler are required.");
    }

    let pathRoutes = this.#routes.get(path);
    if (!pathRoutes) {
      pathRoutes = new Map();
      this.#routes.set(path, pathRoutes);
    }
    if (pathRoutes.has(normalizedMethod)) {
      throw new Error(`A route is already registered for ${normalizedMethod} ${path}.`);
    }
    pathRoutes.set(normalizedMethod, handler);
    return this;
  }

  resolve(method, path) {
    const pathRoutes = this.#routes.get(path);
    if (!pathRoutes) {
      throw new ApiError(404, "NOT_FOUND", "Endpoint not found.");
    }

    const normalizedMethod = String(method).toUpperCase();
    const handler = pathRoutes.get(normalizedMethod);
    if (!handler) {
      const allowedMethods = [...pathRoutes.keys(), "OPTIONS"].sort();
      throw new ApiError(405, "METHOD_NOT_ALLOWED", "Method not allowed.", {
        headers: { Allow: allowedMethods.join(", ") }
      });
    }
    return handler;
  }
}

export function routerMiddleware(router) {
  return async (context, next) => {
    context.routeHandler = router.resolve(context.request.method, context.pathname);
    await next();
  };
}
