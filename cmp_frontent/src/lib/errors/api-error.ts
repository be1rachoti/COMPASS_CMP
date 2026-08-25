/**
 * The API's error contract, as a type the UI can actually branch on.
 *
 * The backend returns one shape for every failure:
 *
 *     { "error": { "code", "message", "field", "request_id" } }
 *
 * so the frontend needs exactly one parser. `ApiError` preserves all four parts
 * because each is used differently: `message` goes to the user, `field`
 * highlights a form input, `code` drives behaviour, and `request_id` is what a
 * user quotes to support.
 */

export interface ApiErrorBody {
  code: string;
  message: string;
  field?: string;
  request_id: string;
  /** Present on validation failures - one entry per offending field. */
  errors?: Array<{ field: string | null; message: string; type: string }>;
  /** Present on transition conflicts, rate limits, and similar. */
  [key: string]: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly field?: string;
  readonly requestId: string;
  readonly details: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.field = body.field;
    this.requestId = body.request_id;
    this.details = body;
  }

  /** Not signed in, or the session expired. The app redirects rather than retries. */
  get isAuthError(): boolean {
    return this.status === 401;
  }

  /** Signed in, but this action is not permitted. Never retry - it will not change. */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  /** A state conflict, e.g. a transition that is not permitted right now. */
  get isConflict(): boolean {
    return this.status === 409;
  }

  get isValidation(): boolean {
    return this.status === 422;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  /** Worth retrying: the request was fine, the server was not. */
  get isTransient(): boolean {
    return this.status >= 500 || this.status === 0;
  }

  /** The staff MFA step is outstanding; the partial session unlocks nothing else. */
  get needsMfa(): boolean {
    return this.code === "mfa_required";
  }

  get retryAfterSeconds(): number | undefined {
    const value = this.details.retry_after_s;
    return typeof value === "number" ? value : undefined;
  }

  /**
   * Field-level messages for a form.
   *
   * Returns a map the form library can consume directly, so a 422 highlights
   * the offending inputs instead of showing one banner and leaving the user to
   * guess which field it meant.
   */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (this.details.errors?.length) {
      for (const entry of this.details.errors) {
        if (entry.field) out[entry.field] = entry.message;
      }
    } else if (this.field) {
      out[this.field] = this.message;
    }
    return out;
  }

  /**
   * What to show the user.
   *
   * A 500 gets a generic sentence plus the request id - the server has already
   * decided not to disclose more, and inventing detail here would be a guess.
   */
  userMessage(): string {
    if (this.status === 0) {
      return "Could not reach the server. Check your connection and try again.";
    }
    if (this.status >= 500) {
      return `Something went wrong at our end. Quote reference ${this.requestId} if you report this.`;
    }
    return this.message;
  }
}

/** Network failure, timeout, or an unparseable response. */
export function networkError(message = "Network request failed"): ApiError {
  return new ApiError(0, {
    code: "network_error",
    message,
    request_id: "-",
  });
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
