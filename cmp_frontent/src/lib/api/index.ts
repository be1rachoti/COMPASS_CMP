/**
 * The one place the console talks to the network.
 *
 * Everything above this line deals in typed values; everything below deals in
 * HTTP. No component, hook or feature module constructs a request itself — the
 * request id, the credential mode, the CSRF header and the error normalisation
 * all live here, and a call that bypasses them silently loses all four.
 */

export * from "@/lib/api/client";
