/**
 * A fake API, at the network boundary.
 *
 * MSW intercepts at `fetch`/`XMLHttpRequest` rather than by replacing a module,
 * and that difference is the reason for choosing it. A test that mocks
 * `useProjects` proves the component renders what the mock returned; it says
 * nothing about whether the hook asks for the right URL, sends credentials,
 * attaches the CSRF header, or parses the envelope. Those are where the real
 * bugs have been, and they all live in code a module mock replaces.
 *
 * So the axios client, the interceptors and the query layer all run for real
 * here. Only the server is fake.
 */

import { setupServer } from "msw/node";
import { HttpResponse, http } from "msw";

import { makeMe, makePage } from "@/test/fixtures";

/**
 * The path the client actually requests.
 *
 * Relative, not absolute, because `config.apiUrl` is `/api` — the same-origin
 * rewrite that keeps the session cookie same-site. MSW resolves a relative
 * pattern against the document origin, so this matches what the browser sends
 * rather than a URL a test author guessed at.
 */
export const API = "/api";

/**
 * Defaults that let a component mount without every test declaring the world.
 *
 * Deliberately thin: an authenticated administrator and empty lists. A test
 * that needs rows adds a handler for the endpoint it cares about, which keeps
 * the reason a test passes visible inside the test.
 */
export const defaultHandlers = [
  http.get(`${API}/auth/me`, () => HttpResponse.json(makeMe())),
  http.get(`${API}/meta/enums`, () => HttpResponse.json({})),
  http.get(`${API}/meta/data-categories`, () => HttpResponse.json({ items: [] })),
  http.get(`${API}/notifications`, () => HttpResponse.json(makePage([]))),
];

export const server = setupServer(...defaultHandlers);

/**
 * Reply to one endpoint with an API-shaped error.
 *
 * Kept here because the envelope has to match `ApiError`'s expectations
 * exactly, and a test that hand-rolls a slightly different one tests the
 * hand-rolled shape rather than the contract.
 */
export function errorResponse(
  code: string,
  message: string,
  status: number,
  extra: Record<string, unknown> = {},
) {
  return HttpResponse.json(
    { error: { code, message, request_id: "req_test", ...extra } },
    { status },
  );
}

export { http, HttpResponse };
