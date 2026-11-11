export class ApiError extends Error {
  constructor(statusCode, code, message, { headers = {} } = {}) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.headers = Object.freeze({ ...headers });
  }
}

export function toErrorResponse(error, requestId) {
  const known = error instanceof ApiError;
  return {
    statusCode: known ? error.statusCode : 500,
    headers: known ? error.headers : {},
    body: {
      error: {
        code: known ? error.code : "INTERNAL_ERROR",
        message: known ? error.message : "The request could not be completed.",
        requestId
      }
    }
  };
}