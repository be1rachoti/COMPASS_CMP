/**
 * Rendering a component the way the application does.
 *
 * A component test that mounts a bare component and mocks its hooks is testing
 * a component that does not exist — in the running application every one of
 * these sits inside a query client, a toast provider and an auth context, and
 * that is where the interesting failures are. So this renders the real provider
 * stack against MSW.
 *
 * The one deviation from production is the query client's retry setting. In the
 * app a transient failure is retried twice with backoff, which is correct there
 * and means an error-state test would sit for eight seconds before asserting.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  render as rtlRender,
  renderHook as rtlRenderHook,
  type RenderHookOptions,
  type RenderOptions,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";

/**
 * A fresh client per test.
 *
 * Sharing one would let a cached `/auth/me` from a test that signed in as an
 * administrator leak into the next test's DCO, and the failure would look like
 * a permission bug in whichever test happened to run second.
 */
function makeTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export interface RenderResult extends ReturnType<typeof rtlRender> {
  queryClient: QueryClient;
  user: ReturnType<typeof userEvent.setup>;
}

/**
 * Render with the provider stack.
 *
 * Returns a `user` alongside the usual queries — `userEvent.setup()` has to be
 * called before render to install its own clock handling, and forgetting to is
 * the sort of thing that produces one flaky test in twenty.
 */
export function render(
  ui: React.ReactElement,
  options: Omit<RenderOptions, "wrapper"> & { queryClient?: QueryClient } = {},
): RenderResult {
  const { queryClient = makeTestQueryClient(), ...rest } = options;
  const user = userEvent.setup();

  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return { ...rtlRender(ui, { wrapper: Wrapper, ...rest }), queryClient, user };
}

/**
 * The hook equivalent, with the same providers.
 *
 * Declared locally, which is what makes the `export *` below skip Testing
 * Library's own `renderHook` rather than colliding with it. Importing the
 * unwrapped one by accident produces "No QueryClient set", which is a
 * confusing way to be told the wrapper is missing.
 */
export function renderHook<TResult, TProps>(
  hook: (props: TProps) => TResult,
  options: Omit<RenderHookOptions<TProps>, "wrapper"> & { queryClient?: QueryClient } = {},
) {
  const { queryClient = makeTestQueryClient(), ...rest } = options;

  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return { ...rtlRenderHook(hook, { wrapper: Wrapper, ...rest }), queryClient };
}

export * from "@testing-library/react";
export { userEvent };
