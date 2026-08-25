/**
 * The error contract, as the console sees it.
 *
 * Every failure reaching a component is an `ApiError`, whatever went wrong —
 * a 422 from the API, a dropped connection, a timeout. One type means one
 * branch, and callers ask questions of it (`isForbidden`, `fieldErrors`)
 * rather than picking apart status codes at the call site.
 */

export * from "@/lib/errors/api-error";
