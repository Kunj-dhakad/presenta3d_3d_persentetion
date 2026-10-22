/** HTTP-facing errors thrown by services; independent of Next.js so services stay framework-free. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = "ERROR",
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = "Resource") => new HttpError(404, `${what} not found`, "NOT_FOUND");
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, "BAD_REQUEST", details);
