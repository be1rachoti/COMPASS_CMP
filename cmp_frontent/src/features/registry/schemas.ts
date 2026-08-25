/**
 * What a valid purpose, processor and data source look like.
 *
 * The purpose schema carries the cross-field rules the DPDP Act imposes, and
 * they live here rather than in the form component for a reason worth naming:
 * a rule expressed in JSX runs only when that JSX is mounted. Expressed as a
 * refinement, it runs wherever the schema is used — including in the unit
 * tests, which is the only place anybody will notice it broke.
 */

import { z } from "zod";

import {
  codeText,
  longText,
  optional,
  pastOrToday,
  refText,
  shortText,
  uuid,
} from "@/schemas/primitives";

/* --------------------------------------------------------------- purpose */

/** Ten years. Long enough for a clinical retention schedule, bounded. */
const MAX_RETENTION_DAYS = 36_500;

export const purposeSchema = z
  .object({
    purpose_code: codeText("A purpose code"),
    name: shortText("A purpose name"),
    description: longText("A description of what this purpose is"),
    // Distinct from `description` on purpose. The description says what the
    // purpose *is*; this says what it lets the organisation actually do, which
    // is the sentence a data principal is agreeing to.
    uses: longText("A statement of what this purpose lets you do"),
    lawful_basis: z.string().min(1, "Choose a lawful basis"),
    s7_clause: optional(z.string()),
    // Rule 3(b)(i): a notice has to itemise the categories, so a purpose with
    // none cannot appear in one.
    data_categories: z
      .array(z.string())
      .min(1, "Rule 3(b)(i): itemise at least one data category"),
    retention_days: z.coerce
      .number({ invalid_type_error: "Enter a number of days" })
      .int("Retention has to be a whole number of days")
      .min(1, "Retention has to be at least one day")
      .max(MAX_RETENTION_DAYS, "Retention beyond ten years needs a documented exception"),
    retention_basis: z.string().min(1, "Choose a retention basis"),
    erasure_trigger: z.string().min(1, "Choose an erasure trigger"),
    consent_validity_days: optional(
      z.coerce
        .number({ invalid_type_error: "Enter a number of days" })
        .int("Validity has to be a whole number of days")
        .min(1, "Validity has to be at least one day")
        .max(MAX_RETENTION_DAYS, "That is longer than this system tracks"),
    ),
    cross_border_permitted: z.boolean(),
    permitted_for_minors: z.boolean(),
    lapse_behaviour: z.string().min(1, "Choose what happens when consent lapses"),
  })
  /**
   * The two halves of the same rule. A purpose relies on consent (s.6) or on a
   * legitimate use (s.7), never both and never neither — and an s.7 purpose has
   * to name the clause, because "legitimate use" is not itself a basis.
   */
  .refine((v) => v.lawful_basis !== "legitimate_use_s7" || Boolean(v.s7_clause), {
    message: "An s.7 purpose must name the clause it relies on",
    path: ["s7_clause"],
  })
  .refine((v) => v.lawful_basis !== "consent_s6" || !v.s7_clause, {
    message: "A consent purpose must not carry an s.7 clause",
    path: ["s7_clause"],
  })
  /**
   * s.9: a child's data may only be processed where the processing is not
   * detrimental to their wellbeing. Cross-border transfer of a minor's data
   * needs a decision made deliberately, so the form makes it one.
   */
  .refine((v) => !(v.permitted_for_minors && v.cross_border_permitted), {
    message:
      "A purpose permitted for minors cannot also permit cross-border transfer without a documented s.9 assessment",
    path: ["cross_border_permitted"],
  });

export type PurposeValues = z.infer<typeof purposeSchema>;

/* ------------------------------------------------------------- processor */

export const processorSchema = z.object({
  legal_name: z
    .string()
    .trim()
    .min(1, "The registered legal name is required")
    .max(255, "That is longer than the legal name field holds"),
  type: z.string().min(1, "Choose a processor type"),
  // A processor without a contract reference is a processor nobody can prove is
  // under contract, which is the whole s.8(2) obligation.
  contract_ref: refText("A contract reference"),
  security_confirmed_at: pastOrToday("The security confirmation date"),
});

export type ProcessorValues = z.infer<typeof processorSchema>;

/* ----------------------------------------------------------- data source */

export const sourceSchema = z.object({
  // 60 rather than CodeText's 80: this is the `varchar(60)` the column holds.
  source_code: z
    .string()
    .trim()
    .min(1, "A source code is required")
    .max(60, "A source code has to fit in 60 characters")
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
      "Letters, digits, dot, dash and underscore, starting with a letter or digit",
    ),
  name: shortText("A source name"),
  source_role: z.string().min(1, "Choose a source role"),
  exchange_mode: z.string().min(1, "Choose an exchange mode"),
  id_scheme: optional(refText("The identifier scheme")),
  processor_uuid: optional(uuid("The processor")),
  is_authoritative_for: z.array(z.string()),
});

export type SourceValues = z.infer<typeof sourceSchema>;
