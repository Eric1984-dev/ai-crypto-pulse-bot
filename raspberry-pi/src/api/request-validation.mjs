import { ApiError } from "./api-error.mjs";

export function validateQuery(request, schema = {}) {
  const url = new URL(request.url || "/", "http://localhost");
  const params = url.searchParams;
  const result = {};

  for (const key of params.keys()) {
    if (!Object.hasOwn(schema, key)) {
      throw invalidQuery();
    }
    if (params.getAll(key).length !== 1) {
      throw invalidQuery();
    }
  }

  for (const [key, descriptor] of Object.entries(schema)) {
    const value = params.get(key);
    if (value === null) {
      if (descriptor.required) {
        throw invalidQuery();
      }
      continue;
    }
    if (descriptor.validate && !descriptor.validate(value)) {
      throw invalidQuery();
    }
    result[key] = descriptor.parse ? descriptor.parse(value) : value;
  }

  return Object.freeze(result);
}

function invalidQuery() {
  return new ApiError(400, "INVALID_QUERY", "The request query is invalid.");
}
