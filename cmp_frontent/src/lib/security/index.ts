/**
 * Client-side security helpers.
 *
 * Everything here is defence in depth or user experience. The security
 * boundary is the API; see `permissions/` for why the console reads the
 * server's answer instead of re-deriving one.
 */

export * from "@/lib/security/sanitize";
export * from "@/lib/security/session-timeout";
export { useHydrated } from "@/lib/security/use-hydrated";
