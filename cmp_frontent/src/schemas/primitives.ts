/**
 * Constrained field types, mirroring the API's `cmp.validation` package.
 *
 * **Why mirror rather than infer.** The server validates every field again and
 * is the only authority — nothing here can be trusted, and none of it is
 * intended to be. What client-side validation buys is a person finding out
 * their notice title is too long *while they are typing it*, rather than after
 * pressing Save on twenty minutes of work.
 *
 * That only helps if the two agree. A client bound that is looser than the
 * server's produces a form that passes and then 422s, which is worse than no
 * validation at all — the user has no idea which field the server objected to.
 * A client bound that is tighter refuses input the system would have accepted.
 *
 * So the rule is: **every bound here cites the server constraint it mirrors,
 * and where they disagree the server is right and this file is the bug.** The
 * contract test in `tests/unit/schemas` checks the ones expressible as data.
 *
 * The messages are the other half. A Zod default reads "String must contain at
 * most 200 character(s)", which tells somebody the shape of the rule and not
 * what to do about it. Every message here says what the field is for.
 */

import { z } from "zod";

/* ------------------------------------------------------------------ text */

/**
 * A name, a label, a reference. The `varchar(200)` family.
 *
 * Mirrors `validation.strings.ShortText`.
 */
export const shortText = (field: string) =>
  z
    .string()
    .trim()
    .min(1, `${field} is required`)
    .max(200, `${field} has to fit in 200 characters`);

/**
 * A description, a notice rendition, a reason.
 *
 * Mirrors `validation.strings.LongText`. 20,000 characters is roughly forty
 * pages — generous for prose, and still a bound.
 */
export const longText = (field: string, whenEmpty?: string) =>
  z
    .string()
    .trim()
    // `whenEmpty` is for the fields where naming the field is not enough help.
    // "A description is required" tells somebody the box is empty, which they
    // can see; "Describe what this project collects and why" tells them what to
    // write. Use it wherever a vague answer would cost a reviewer a round trip.
    .min(1, whenEmpty ?? `${field} is required`)
    .max(20_000, `${field} is longer than this system stores`);

/**
 * A free-text reason attached to a state change.
 *
 * Mirrors `validation.strings.ReasonText`. No minimum: whether a reason is
 * required is the endpoint's decision, not the type's.
 */
export const reasonText = z
  .string()
  .trim()
  .max(1000, "Keep the reason under 1,000 characters");

/**
 * An organisation-supplied identifier that appears in URLs and exports.
 *
 * Mirrors `validation.strings.CodeText`. Deliberately narrow: a code containing
 * a slash breaks a URL path and a CSV column on the same day.
 */
export const codeText = (field: string) =>
  z
    .string()
    .trim()
    .min(1, `${field} is required`)
    .max(80, `${field} has to fit in 80 characters`)
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
      `${field} may use letters, digits, dot, dash and underscore, and must start with a letter or digit`,
    );

/**
 * A contract reference, a manifest reference — external strings echoed back but
 * never parsed. Mirrors `validation.strings.RefText`.
 */
export const refText = (field: string) =>
  z
    .string()
    .trim()
    .min(1, `${field} is required`)
    .max(120, `${field} has to fit in 120 characters`);

/* ----------------------------------------------------------- identifiers */

/**
 * The public identifier of any row.
 *
 * Mirrors `validation.identifiers.Uuid`. There is no integer-id type in this
 * package for the same reason there is none in the server's: a sequential id in
 * a URL tells the reader how many rows exist and invites them to walk the
 * neighbours.
 */
export const uuid = (field = "This") =>
  z.string().uuid(`${field} does not look like a valid reference`);

/**
 * A capability token from a consent link URL.
 *
 * Mirrors `validation.identifiers.LinkToken`. The bound is what stops a
 * multi-megabyte path reaching the server's hasher at all.
 */
export const linkToken = z
  .string()
  .trim()
  .min(16, "That link looks incomplete")
  .max(128, "That link looks malformed")
  .regex(/^[A-Za-z0-9_-]+$/, "That link looks malformed");

/**
 * An organisation's own identifier for a person — an employee number, a
 * registration id. Mirrors `validation.identifiers.OrganizationId`.
 */
export const organizationId = z
  .string()
  .trim()
  .min(1, "An identifier is required")
  .max(80, "An identifier has to fit in 80 characters");

/* ------------------------------------------------------------------ time */

/**
 * A calendar date, `YYYY-MM-DD`.
 *
 * The regex checks shape; `Date.parse` catches `2025-02-31`, which is
 * well-shaped and not a date. Both are needed — a form that accepts 31 February
 * and lets the server reject it has wasted the user's time for no reason.
 */
export const dateOnly = (field: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${field} has to be a date`)
    .refine((value) => {
      const [y, m, d] = value.split("-").map(Number);
      const parsed = new Date(Date.UTC(y, m - 1, d));
      return (
        parsed.getUTCFullYear() === y &&
        parsed.getUTCMonth() === m - 1 &&
        parsed.getUTCDate() === d
      );
    }, `${field} is not a real date`);

/** A date that cannot be in the future — an approval date, a collection date. */
export const pastOrToday = (field: string) =>
  dateOnly(field).refine(
    (value) => value <= new Date().toISOString().slice(0, 10),
    `${field} cannot be in the future`,
  );

/** A date that must be in the future — a retention deadline, a review date. */
export const future = (field: string) =>
  dateOnly(field).refine(
    (value) => value > new Date().toISOString().slice(0, 10),
    `${field} has to be later than today`,
  );

/**
 * A local date **and time**, as `<input type="datetime-local">` produces it.
 *
 * `YYYY-MM-DDTHH:mm`, optionally with seconds — browsers append `:ss` when the
 * input has a `step` finer than a minute, and a validator that rejects that
 * would fail on some machines and not others.
 *
 * Separate from `dateOnly` because the two are not interchangeable and treating
 * them as such is a bug this codebase has already had: `expires_at` is a
 * datetime input and was validated with the date-only rule, so every value a
 * user could possibly enter was rejected with "has to be a date" — which it
 * was.
 *
 * The value carries no timezone, and that is correct rather than a gap. The
 * person choosing "6 February, 2pm" means 2pm where they are; `new Date(value)`
 * reads it in the browser's zone, which is the same intent.
 */
export const dateTimeLocal = (field: string) =>
  z
    .string()
    .min(1, `${field} is required`)
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, `${field} has to be a date and time`)
    .refine((value) => !Number.isNaN(new Date(value).getTime()), `${field} is not a real time`);

/**
 * A moment that must be in the future — a link expiry.
 *
 * Compared against `Date.now()` rather than against today's date, because "in
 * the future" for an expiry means later than *now*: a link expiring at 09:00
 * today is already dead at 14:00, and accepting it would mint something
 * unusable.
 */
export const futureDateTime = (field: string) =>
  dateTimeLocal(field).refine(
    (value) => new Date(value).getTime() > Date.now(),
    `${field} has to be in the future`,
  );

/* ------------------------------------------------------------------- web */

/**
 * http(s) only.
 *
 * Mirrors `validation.urls.HttpUrl`. The scheme restriction is the point:
 * `javascript:` and `data:` are not links a person can act on, and a notice's
 * withdrawal URL is frozen and hashed at publication — a bad one is not
 * editable afterwards, it is a new notice version.
 */
export const httpUrl = (field: string) =>
  z
    .string()
    .trim()
    .min(8, `${field} is required`)
    .max(2000, `${field} is too long for a browser to follow`)
    .regex(/^https?:\/\/[^\s<>"]+$/, `${field} has to start with http:// or https://`);

/**
 * A storage reference recorded against an asset.
 *
 * Mirrors `validation.urls.StorageRef`. Free-form because the source system
 * chooses it (`s3://…`, a UNC path, an internal id) — bounded, and never
 * dereferenced by us.
 */
export const storageRef = z
  .string()
  .trim()
  .min(1, "A storage reference is required")
  .max(500, "A storage reference has to fit in 500 characters");

/* -------------------------------------------------------------- optional */

/**
 * An optional field that submits null rather than "".
 *
 * The distinction matters at the database: `""` is a value the column holds and
 * a `NOT NULL` check passes, so an empty string quietly becomes a stored blank
 * that renders as an empty cell nobody can explain. Null means absent.
 */
export const optional = <TOut, TIn>(schema: z.ZodType<TOut, z.ZodTypeDef, TIn>) =>
  z
    .union([schema, z.literal(""), z.null()])
    .optional()
    // Annotated rather than inferred: a union of a generic schema widens to `{}`
    // in inference, and every consumer would then need a cast at the call site.
    .transform((value): TOut | null =>
      value === "" || value === null || value === undefined ? null : (value as TOut),
    );
