/**
 * Fields that carry a credential.
 *
 * Kept apart from the other primitives because the handling rules differ: these
 * values are never logged, never echoed back in an error message, and never put
 * in a query string. Nothing in this module has a `.describe()` or a default —
 * a default password is a password.
 *
 * Mirrors `cmp.validation.security`.
 */

import { z } from "zod";

/**
 * A password.
 *
 * Minimum twelve characters, and **no composition rules**. That is a considered
 * position, not an omission: a twelve-character passphrase resists guessing far
 * better than `P@ss1!`, and people can remember it, so they do not write it on
 * a card taped to the monitor. Requiring a symbol mostly produces `Password1!`.
 *
 * The maximum is a denial-of-service control rather than a validation rule.
 * Argon2id is deliberately expensive; hashing an unbounded password is a way to
 * make the server do unbounded work per request. 128 characters is well past
 * any real passphrase and far short of a problem.
 */
export const password = z
  .string()
  .min(12, "Use at least 12 characters — a phrase you can remember beats a short jumble")
  .max(128, "That is longer than this system accepts");

/**
 * A password being set, checked against its confirmation.
 *
 * Applied with `.superRefine` so the error lands on the confirmation field
 * rather than the form root, which is where the user is looking.
 */
export const passwordWithConfirmation = z
  .object({
    password,
    confirm_password: z.string(),
  })
  .superRefine((value, ctx) => {
    if (value.password !== value.confirm_password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirm_password"],
        message: "The two passwords do not match",
      });
    }
  });

/**
 * A one-time code.
 *
 * Digits only, so a mobile keyboard opens numeric. The range is wide because
 * the length is the server's choice and this should not have to change when
 * that does.
 */
export const otpCode = z
  .string()
  .trim()
  .min(4, "Enter the code you were sent")
  .max(10, "That code is longer than the one we sent")
  .regex(/^[0-9]+$/, "The code is digits only");

/**
 * A single-use token from a password-reset email.
 *
 * Bounded and character-classed so a mangled link is refused here, with a
 * message about the link, rather than reaching the server and failing signature
 * verification with something less useful.
 */
export const resetToken = z
  .string()
  .trim()
  .min(16, "That reset link looks incomplete")
  .max(256, "That reset link looks malformed")
  .regex(/^[A-Za-z0-9_.-]+$/, "That reset link looks malformed");

/**
 * A SHA-256 digest as lowercase hex.
 *
 * Used for notice content hashes and export file hashes, both of which are
 * compared character by character. Uppercase is rejected rather than
 * normalised: a hash that arrives in the wrong case came from somewhere the
 * pipeline did not intend, and quietly fixing it hides that.
 */
export const sha256Hex = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "That is not a SHA-256 digest");
