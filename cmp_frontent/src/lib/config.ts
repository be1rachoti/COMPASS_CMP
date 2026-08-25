/**
 * Runtime configuration.
 *
 * Every value is read from an environment variable with an explicit default, and
 * validated once at module load. A missing API URL should fail the build, not
 * produce a page that renders and then 404s every request.
 *
 * Only `NEXT_PUBLIC_*` variables reach the browser. Nothing secret belongs here:
 * anything in this file is readable by anyone who opens devtools.
 */

export const config = {
  /**
   * Where the browser sends API calls.
   *
   * Same-origin by default, proxied to the real API by the rewrite in
   * `next.config.ts`. This is not a convenience: a cross-origin API means the
   * session cookie is cross-site, and a `SameSite=Lax` cookie is not sent on
   * cross-site XHR - so login succeeds, the cookie is dropped, and every
   * subsequent request is a 401.
   *
   * Override only when the API is genuinely served from the same site (a shared
   * parent domain), or for a non-browser client.
   */
  apiUrl: (process.env.NEXT_PUBLIC_API_URL ?? "/api").replace(/\/+$/, ""),

  appName: process.env.NEXT_PUBLIC_APP_NAME ?? "Consent Management Platform",

  /** Matches the backend's csrf_header_name. Changing one without the other
   *  breaks every write, so both read from the same documented default. */
  csrfHeader: process.env.NEXT_PUBLIC_CSRF_HEADER ?? "X-CSRF-Token",
  csrfCookie: process.env.NEXT_PUBLIC_CSRF_COOKIE ?? "cmp_csrf",

  isProduction: process.env.NODE_ENV === "production",

  /** How long TanStack Query treats a response as fresh. Short, because this is
   *  compliance data and a stale consent count is a wrong answer, not a slow one. */
  staleTimeMs: 30_000,
} as const;

export type Config = typeof config;
