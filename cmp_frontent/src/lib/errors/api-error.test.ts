/**
 * The error contract.
 *
 * Every failure in the product flows through this class, so a mistake here shows
 * up as the wrong message on every screen at once - or, worse, as a retry loop
 * against an endpoint that is refusing on purpose.
 */
import { describe, expect, it } from "vitest";

import { ApiError, isApiError, networkError } from "./api-error";

function make(status: number, body: Partial<ConstructorParameters<typeof ApiError>[1]> = {}) {
  return new ApiError(status, {
    code: "test_error",
    message: "Something went wrong",
    request_id: "01J8F7K2",
    ...body,
  });
}

describe("ApiError classification", () => {
  it("recognises the statuses the UI branches on", () => {
    expect(make(401).isAuthError).toBe(true);
    expect(make(403).isForbidden).toBe(true);
    expect(make(404).isNotFound).toBe(true);
    expect(make(409).isConflict).toBe(true);
    expect(make(422).isValidation).toBe(true);
    expect(make(429).isRateLimited).toBe(true);
  });

  it("treats only 5xx and network failures as worth retrying", () => {
    // A 403 will still be a 403 on the fourth attempt. Retrying it just produces
    // three more audited access denials in the DPO's log.
    expect(make(403).isTransient).toBe(false);
    expect(make(404).isTransient).toBe(false);
    expect(make(422).isTransient).toBe(false);
    expect(make(500).isTransient).toBe(true);
    expect(make(503).isTransient).toBe(true);
    expect(networkError().isTransient).toBe(true);
  });

  it("distinguishes an outstanding MFA step from a lost session", () => {
    // Both are 401. One means "sign in again", the other means "you are signed
    // in, finish the second factor" - and sending the second to the sign-in page
    // loses the partial session.
    const mfa = make(401, { code: "mfa_required" });
    expect(mfa.isAuthError).toBe(true);
    expect(mfa.needsMfa).toBe(true);
    expect(make(401, { code: "unauthenticated" }).needsMfa).toBe(false);
  });

  it("exposes the retry-after a rate limit carries", () => {
    expect(make(429, { retry_after_s: 1800 }).retryAfterSeconds).toBe(1800);
    expect(make(429).retryAfterSeconds).toBeUndefined();
  });
});

describe("field errors", () => {
  it("maps a validation body to a per-field record", () => {
    const error = make(422, {
      code: "validation_failed",
      message: "Validation failed",
      errors: [
        { field: "email", message: "Not a valid email", type: "value_error" },
        { field: "data_categories", message: "At least one is required", type: "too_short" },
      ],
    });
    expect(error.fieldErrors()).toEqual({
      email: "Not a valid email",
      data_categories: "At least one is required",
    });
  });

  it("falls back to the single `field` the server named", () => {
    const error = make(422, { field: "board_complaint_url", message: "Required" });
    expect(error.fieldErrors()).toEqual({ board_complaint_url: "Required" });
  });

  it("returns nothing when the error is not about a field", () => {
    expect(make(409).fieldErrors()).toEqual({});
  });

  it("ignores entries with no field rather than keying on null", () => {
    const error = make(422, {
      errors: [{ field: null, message: "Body is malformed", type: "value_error" }],
    });
    expect(error.fieldErrors()).toEqual({});
  });
});

describe("user-facing message", () => {
  it("passes the server's sentence through for a 4xx", () => {
    // The server has already decided how much to disclose. Paraphrasing here
    // would either leak more or lose the actionable part.
    const error = make(409, { message: "No approval with a proof file" });
    expect(error.userMessage()).toBe("No approval with a proof file");
  });

  it("replaces a 5xx with a generic sentence plus the request id", () => {
    const message = make(500, { message: "psycopg.OperationalError at line 44" }).userMessage();
    expect(message).not.toContain("psycopg");
    expect(message).toContain("01J8F7K2");
  });

  it("explains a network failure in terms the user can act on", () => {
    expect(networkError().userMessage()).toMatch(/connection/i);
  });
});

describe("isApiError", () => {
  it("narrows correctly", () => {
    expect(isApiError(make(400))).toBe(true);
    expect(isApiError(new Error("plain"))).toBe(false);
    expect(isApiError(null)).toBe(false);
    expect(isApiError({ status: 400 })).toBe(false);
  });
});
