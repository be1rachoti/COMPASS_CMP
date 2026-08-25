/**
 * What a valid sign-in, MFA step and profile edit look like.
 *
 * The sign-in schemas are the loosest in the codebase, and that is correct. A
 * credential form must not tell an unauthenticated visitor anything about the
 * account they are guessing at — refusing "that is not a valid email address"
 * before the request is sent confirms which strings are *shaped* like accounts
 * here, and refusing a password on length confirms the password policy to
 * somebody who has not signed in. So these check only that a field is filled.
 * The server decides everything else, and answers the same way whether the
 * account exists or not.
 */

import { z } from "zod";

import { contact, mobile } from "@/schemas/contacts";
import { optional, shortText } from "@/schemas/primitives";
import { otpCode, password, passwordWithConfirmation } from "@/schemas/security";

/**
 * Staff sign-in.
 *
 * `login` accepts an email or a username without deciding which, because the
 * form does not know and guessing wrong would refuse a valid credential.
 */
export const passwordSignInSchema = z.object({
  login: z.string().trim().min(3, "Enter your email address or username"),
  password: z.string().min(1, "Enter your password"),
});

export type PasswordSignInValues = z.infer<typeof passwordSignInSchema>;

/** Data subject sign-in: a one-time code to an email or mobile. */
export const otpRequestSchema = z.object({
  contact,
});

export type OtpRequestValues = z.infer<typeof otpRequestSchema>;

/**
 * The second factor.
 *
 * `otpCode` rather than a bare string: the digits-only rule opens a numeric
 * keyboard on a phone, which is worth the small risk of being marginally
 * stricter than the server.
 */
export const otpVerifySchema = z.object({
  code: otpCode,
});

export type OtpVerifyValues = z.infer<typeof otpVerifySchema>;

/**
 * Setting a password from an emailed link.
 *
 * This is the one place the full policy applies client-side, and it is the one
 * place it leaks nothing: the person is already holding a single-use token, so
 * telling them the minimum length tells them nothing they should not know — and
 * finding out after submitting would mean re-entering it twice.
 */
export const setPasswordSchema = passwordWithConfirmation;

export type SetPasswordValues = z.infer<typeof setPasswordSchema>;

/** Changing a password while signed in. */
export const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, "Enter your current password"),
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
    if (value.password === value.current_password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["password"],
        message: "Choose a password you have not used here before",
      });
    }
  });

export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

/** The signed-in user editing their own profile. */
export const profileSchema = z.object({
  full_name: shortText("Your name"),
  mobile: optional(mobile),
});

export type ProfileValues = z.infer<typeof profileSchema>;

/**
 * Declaring whether one is a minor, or acting for one.
 *
 * s.9 turns on this answer, so the reason field exists to record *why* somebody
 * changed it — a guardian taking over an account, a subject turning eighteen.
 */
export const personTypeSchema = z.object({
  person_type: z.string().min(1, "Choose how you are acting"),
  reason: optional(z.string().trim().max(500, "Keep the reason under 500 characters")),
});

export type PersonTypeValues = z.infer<typeof personTypeSchema>;
