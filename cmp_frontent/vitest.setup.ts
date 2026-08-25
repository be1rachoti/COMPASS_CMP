import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";

import { server } from "@/test/server";

// Unmount between tests. Without this, a component that sets a timer keeps
// running and the failure surfaces in whichever test happens to be next.
afterEach(cleanup);

// jsdom implements neither, and both are read during render by the theme
// provider and the responsive layout.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

if (!("randomUUID" in crypto)) {
  Object.defineProperty(crypto, "randomUUID", {
    value: () => "00000000-0000-4000-8000-000000000000",
  });
}

// ---------------------------------------------------------------- the fake API

// Started once for the whole run rather than per file: MSW's interception is
// global, and starting it repeatedly leaks listeners.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

// `onUnhandledRequest: "error"` above is the important setting. A request no
// handler covers fails the test loudly, rather than hanging until the query
// times out and surfacing as "expected element not found" - which sends people
// looking at the component when the bug is a missing handler.
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
