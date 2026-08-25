/**
 * Email and mobile.
 *
 * These get their own module for the reason the server's do: a data subject is
 * reached by email or mobile, and both are how they *sign in* — there is no
 * password on a data subject account. That makes them identifiers of a person
 * as much as a way to contact them, and a validation rule that rejects a real
 * number locks somebody out of their own consent record.
 *
 * Mirrors `cmp.validation.contacts`.
 */

import { z } from "zod";

/**
 * An email address.
 *
 * The server validates with `email-validator`, which checks the domain rather
 * than guessing at a regex. Zod's `.email()` is the closest client equivalent;
 * it is deliberately the looser of the two, so anything this accepts and the
 * server rejects comes back as a field error rather than the form silently
 * refusing an address that works.
 */
export const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "An email address is required")
  .max(255, "That email address is too long")
  .email("That does not look like an email address");

/**
 * A mobile number.
 *
 * Deliberately permissive. This system operates in India and receives numbers
 * written with a country code, with spaces, with dashes. Normalising
 * aggressively would reject numbers people actually have, and a number we
 * cannot reach is worse than a number stored with a space in it.
 *
 * Mirrors `validation.contacts.Mobile` exactly, including the character class.
 */
export const mobile = z
  .string()
  .trim()
  .min(6, "A mobile number is required")
  .max(20, "That mobile number is too long")
  .regex(/^\+?[0-9 -]+$/, "A mobile number may contain digits, spaces, dashes and a leading +");

/**
 * Either of the above, for the sign-in form that accepts both.
 *
 * No format check: the sign-in box does not know which one it is being given,
 * and guessing wrong would refuse a valid credential. The server decides.
 */
export const contact = z
  .string()
  .trim()
  .min(3, "Enter your email address or mobile number")
  .max(255, "That is longer than any email address or mobile number");
