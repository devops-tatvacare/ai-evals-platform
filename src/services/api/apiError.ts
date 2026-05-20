/**
 * Typed error for HTTP error *responses*. Lives in its own module so the
 * shared error-classification helpers in `errorHandling.ts` can reference it
 * without importing `client.ts` (which would create an import cycle).
 */
export class ApiError extends Error {
  status: number;
  data?: unknown;
  headers?: Headers;

  constructor(status: number, message: string, data?: unknown, headers?: Headers) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.headers = headers;
  }
}
