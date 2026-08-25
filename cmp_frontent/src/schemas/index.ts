/**
 * The validation layer.
 *
 * Two levels. This directory holds the *primitives* — the constrained field
 * types that mirror the API's `cmp.validation` package one for one. Each
 * feature holds the *forms* built from them, in `features/<domain>/schemas.ts`,
 * because a form schema is domain knowledge and belongs with its domain.
 *
 * The split is what keeps the mirror honest: there is one place to check when
 * the server changes a bound, and it is small enough to read in a sitting.
 */

export * from "@/schemas/primitives";
export * from "@/schemas/contacts";
export * from "@/schemas/security";
export * from "@/schemas/files";
