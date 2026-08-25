/**
 * Edge middleware — the first thing that touches a request.
 *
 * Two jobs, and it is important to be clear about what each one is *for*:
 *
 * 1. **Content Security Policy with a per-request nonce.** This cannot be a
 *    static header in `next.config.ts`, because a nonce that never changes is
 *    not a nonce. It has to be minted per request and handed to the document.
 *
 * 2. **A cheap redirect for a request carrying no session cookie.** This is
 *    *not* the authorisation check and must never be mistaken for one — the
 *    cookie is HttpOnly, so all this can see is whether one is present, not
 *    whether it is valid, unexpired, or belongs to somebody permitted. The API
 *    decides that, on every request, and answers 401/403/404 accordingly.
 *
 *    What it buys is the flash: without it, a signed-out visitor pointed at
 *    `/projects` downloads the page, renders a skeleton, calls the API, gets a
 *    401 and only then bounces. With it, they never receive the page at all.
 *
 * The rule to hold on to: **the client is not a security boundary.** Everything
 * here is a courtesy to the honest user and a speed bump for everyone else. The
 * boundary is the API.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Routes that must be reachable with no session at all. */
const PUBLIC_PREFIXES = ["/sign-in", "/rights", "/c/"] as const;

/** Static assets and internals — never redirect, never CSP-nonce. */
const SKIP_PREFIXES = ["/_next", "/api", "/favicon", "/icon", "/apple-icon", "/robots", "/sitemap"] as const;

const SESSION_COOKIE = process.env.NEXT_PUBLIC_SESSION_COOKIE ?? "cmp_session";

function isPublic(pathname: string): boolean {
  return pathname === "/" || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

function shouldSkip(pathname: string): boolean {
  return SKIP_PREFIXES.some((p) => pathname.startsWith(p)) || pathname.includes(".");
}

/**
 * The policy.
 *
 * `'strict-dynamic'` is what makes the nonce worth having: a script the browser
 * trusts because of its nonce may load further scripts, which is how Next's
 * chunked runtime works, and *nothing else* is trusted — so an injected
 * `<script>` without the nonce does not run, whatever the injection point.
 *
 * `'unsafe-inline'` is listed after `'strict-dynamic'` deliberately. Browsers
 * that support strict-dynamic ignore it; older ones fall back to it rather than
 * breaking the app entirely. That is a considered trade, not an oversight.
 *
 * `style-src` still needs `'unsafe-inline'`: React sets inline styles for chart
 * bar widths and progress values, and nonce-ing every one of those is not
 * something the framework offers.
 */
function contentSecurityPolicy(nonce: string, isDev: boolean): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      "'unsafe-inline'",
      // Dev needs eval for React Refresh. Production never does, and shipping it
      // there would undo most of the value of the policy.
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "blob:", "data:"],
    "font-src": ["'self'", "data:"],
    // Same-origin only. The console talks to `/api` on its own origin — that is
    // the whole point of the rewrite — so there is no third party to allow.
    "connect-src": ["'self'", ...(isDev ? ["ws:", "wss:"] : [])],
    // Nothing may frame us, and we frame nothing.
    "frame-ancestors": ["'none'"],
    "frame-src": ["'none'"],
    "object-src": ["'none'"],
    // Stops a `<base href>` injection from repointing every relative URL on the
    // page at an attacker's origin.
    "base-uri": ["'self'"],
    // A form that posts anywhere but here is a credential-harvesting form.
    "form-action": ["'self'"],
  };

  if (!isDev) {
    directives["upgrade-insecure-requests"] = [];
  }

  return Object.entries(directives)
    .map(([key, values]) => (values.length ? `${key} ${values.join(" ")}` : key))
    .join("; ");
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (shouldSkip(pathname)) {
    return NextResponse.next();
  }

  // Redirect before doing any work: a signed-out visitor should not receive the
  // page at all, rather than receiving it and bouncing after the API says no.
  if (!isPublic(pathname) && !request.cookies.has(SESSION_COOKIE)) {
    const signIn = new URL("/sign-in", request.url);
    // Carry where they were going, so signing in lands them there rather than
    // on a dashboard they then have to navigate away from.
    signIn.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(signIn);
  }

  const nonce = crypto.randomUUID().replace(/-/g, "");
  const isDev = process.env.NODE_ENV !== "production";
  const csp = contentSecurityPolicy(nonce, isDev);

  // Handed to the document through a request header, which is how Next's
  // `headers()` exposes it to the root layout for `<script nonce>`.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);

  return response;
}

export const config = {
  /**
   * Everything except static assets and the API proxy.
   *
   * The proxy is excluded because the API sets its own headers, and a CSP on a
   * JSON response is noise. The negative lookahead is the documented Next
   * idiom; matching everything and returning early would run the middleware on
   * every image request for no reason.
   */
  matcher: [
    "/((?!_next/static|_next/image|api|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
