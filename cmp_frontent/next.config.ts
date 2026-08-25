import type { NextConfig } from "next";

/**
 * Where the API actually listens. Server-side only - it is never inlined into
 * the browser bundle, because the browser only ever talks to `/api` on its own
 * origin.
 */
const API_ORIGIN = process.env.API_ORIGIN ?? "http://127.0.0.1:8000";

/**
 * Next configuration.
 *
 * The headers below are the browser-side half of the defence; the API sets its
 * own on every response. Both are needed: they are different origins, and a
 * header on one says nothing about the other.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * Standalone output, for the container image only.
   *
   * It traces the server and the dependencies actually reached, so the runtime
   * image carries those rather than the whole `node_modules` — which is worth a
   * lot in an image and nothing at all on a laptop.
   *
   * Opt-in rather than always-on, because unconditionally it costs more than it
   * gives locally: `next start` does not serve a standalone build (it warns and
   * serves the wrong thing), the static assets have to be copied into
   * `.next/standalone` by hand, and a rebuild fails with EBUSY while a
   * standalone server is holding the directory.
   *
   * The Dockerfile sets `NEXT_OUTPUT=standalone`.
   */
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,

  // Never advertise the framework version to a scanner.
  poweredByHeader: false,

  // Fail the build on a type error rather than shipping it. (Next 16 removed the
  // `eslint` key; linting is its own step - `npm run lint` - and its own CI job.)
  typescript: { ignoreBuildErrors: false },

  /**
   * Next 15.2+ refuses dev-asset requests whose origin it does not recognise, and
   * answers 403. The failure is quiet and confusing: the HTML renders, every
   * JavaScript chunk 403s, the page never hydrates, and every button appears to
   * do nothing.
   *
   * `localhost` and `127.0.0.1` are different origins to that check, so a
   * browser (or a Playwright run) pointed at one while the server assumes the
   * other hits exactly this. Both are listed.
   */
  allowedDevOrigins: ["localhost", "127.0.0.1", "[::1]"],

  /**
   * Proxy the API through this origin.
   *
   * Without it the browser is on one origin (localhost:3000) and the API is on
   * another (127.0.0.1:8000). Browsers treat those as different *sites* - not
   * merely different origins - so the `SameSite=Lax` session cookie the API sets
   * is dropped on every cross-site XHR. The symptom is brutal to diagnose:
   * `POST /auth/login` returns 200, the cookie never lands, and the next request
   * is a 401. Login appears to fail for no reason.
   *
   * Proxying makes every API call same-origin and first-party, so the cookie
   * works and CORS stops being involved at all. It also mirrors production,
   * where nginx sits in front of both - so development exercises the same
   * cookie path that ships.
   */
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_ORIGIN}/:path*` }];
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          // No referrer anywhere: a consent-link URL in a Referer header hands
          // the capability to whatever the page links out to.
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
      {
        // The consent flow and a subject's own records must never be cached by
        // an intermediary. A shared cache holding one person's consent record
        // and serving it to the next is a breach with a 200 status code.
        source: "/(c|my-consents)/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, private" },
        ],
      },
    ];
  },
};

export default nextConfig;
