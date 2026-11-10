export function composeMiddleware(middleware, terminalHandler) {
  if (!Array.isArray(middleware)
    || middleware.some((entry) => typeof entry !== "function")
    || typeof terminalHandler !== "function") {
    throw new TypeError("Middleware and a terminal handler are required.");
  }

  return async function runPipeline(context) {
    let lastIndex = -1;
    async function dispatch(index) {
      if (index <= lastIndex) {
        throw new Error("Middleware called next more than once.");
      }
      lastIndex = index;
      const current = middleware[index];
      if (!current) {
        return terminalHandler(context);
      }
      return current(context, () => dispatch(index + 1));
    }
    return dispatch(0);
  };
}
