/**
 * What a valid user account and role change look like.
 *
 * Note what is *not* here: a password field. Staff accounts are created without
 * one and the holder sets it through an emailed single-use link, so no
 * administrator ever knows a colleague's password and no password ever travels
 * through this form. That is a deliberate design choice rather than a missing
 * feature, and it is why `@/schemas/security` is unused in this file.
 */

import { z } from "zod";

import { email, mobile } from "@/schemas/contacts";
import { optional, organizationId, shortText } from "@/schemas/primitives";

export const userSchema = z.object({
  full_name: shortText("A full name"),
  email,
  role: z.string().min(1, "Choose a role"),
  // Optional because staff sign in with their email; a username is for the
  // organisations that already have one and want it to match.
  username: optional(
    z
      .string()
      .trim()
      .max(120, "A username has to fit in 120 characters")
      .regex(/^[A-Za-z0-9._-]+$/, "Letters, digits, dot, dash and underscore only"),
  ),
  mobile: optional(mobile),
  organization_id: optional(organizationId),
  person_type: optional(z.string()),
  // The data sources this person will be accountable for, assigned as part of
  // creating them.
  //
  // Here because it is the moment somebody knows the answer. An account created
  // without sources is a Data Collection Owner who owns nothing, appears in no
  // routing, and is discovered to be idle later — so the question is asked while
  // the person creating the account still has the context to answer it.
  source_uuids: z.array(z.string()).default([]),
});

export type UserValues = z.infer<typeof userSchema>;

/**
 * A role change.
 *
 * The reason is optional to the form and mandatory to the audit trail — the
 * server records the change either way, and a blank reason is recorded as a
 * blank reason rather than as no change having happened.
 */
export const roleSchema = z.object({
  role: z.string().min(1, "Choose the new role"),
  reason: optional(z.string().trim().max(500, "Keep the reason under 500 characters")),
});

export type RoleValues = z.infer<typeof roleSchema>;
