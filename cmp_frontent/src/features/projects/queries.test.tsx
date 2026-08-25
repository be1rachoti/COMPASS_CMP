/**
 * The query layer against a fake network, not a fake hook.
 *
 * These tests run the real axios client, the real interceptors and the real
 * TanStack wiring; only the server is replaced. That is deliberate — the bugs
 * this codebase has actually had were a hook asking for the wrong URL, a filter
 * that never reached the query string, and a mutation that invalidated a key
 * nothing was cached under. A test that mocks `useProjects` cannot see any of
 * them, because it replaces the code where they live.
 */

import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useProject, useProjects } from "@/features/projects";
import { keys } from "@/lib/query";
import { makePage, makeProject } from "@/test/fixtures";
import { API, HttpResponse, errorResponse, http, server } from "@/test/server";
import { renderHook } from "@/test/render";

describe("useProjects", () => {
  it("requests the list endpoint and unwraps the page envelope", async () => {
    server.use(
      http.get(`${API}/projects`, () =>
        HttpResponse.json(makePage([makeProject({ project_name: "Retail footfall study" })])),
      ),
    );

    const { result } = renderHook(() => useProjects());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items[0].project_name).toBe("Retail footfall study");
  });

  it("puts filters in the query string rather than filtering client-side", async () => {
    // Filtering after the fact would be wrong twice over: it would show a page
    // of the wrong rows, and it would mean the server never applied the scope
    // predicate that makes a filter safe for this user to run.
    let seen: URL | null = null;
    server.use(
      http.get(`${API}/projects`, ({ request }) => {
        seen = new URL(request.url);
        return HttpResponse.json(makePage([]));
      }),
    );

    const { result } = renderHook(() => useProjects({ status: "approved", q: "footfall" }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seen!.searchParams.get("status")).toBe("approved");
    expect(seen!.searchParams.get("q")).toBe("footfall");
  });

  it("surfaces a 403 as an ApiError the UI can branch on", async () => {
    server.use(
      http.get(`${API}/projects`, () =>
        errorResponse("forbidden", "Your role does not permit this.", 403),
      ),
    );

    const { result } = renderHook(() => useProjects());

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.isForbidden).toBe(true);
    expect(result.current.error?.status).toBe(403);
  });

  it("does not retry a 403", async () => {
    // A 403 will still be a 403 on the fourth attempt. All retrying achieves is
    // three more audited access denials in somebody's log.
    let calls = 0;
    server.use(
      http.get(`${API}/projects`, () => {
        calls += 1;
        return errorResponse("forbidden", "Not permitted", 403);
      }),
    );

    const { result } = renderHook(() => useProjects());

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(calls).toBe(1);
  });
});

describe("useProject", () => {
  it("does not fire until it has a uuid", async () => {
    // Router params arrive undefined on the first render. A request for
    // `/projects/undefined` is a 404 in the log and a flash of an error state.
    let calls = 0;
    server.use(
      http.get(`${API}/projects/:uuid`, () => {
        calls += 1;
        return HttpResponse.json(makeProject());
      }),
    );

    const { rerender } = renderHook(({ uuid }: { uuid?: string }) => useProject(uuid), {
      initialProps: { uuid: undefined } as { uuid?: string },
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(0);

    rerender({ uuid: "22222222-2222-4222-8222-222222222222" });
    await waitFor(() => expect(calls).toBe(1));
  });
});

describe("query keys", () => {
  it("nests a project's sub-resources under its own key", () => {
    // This is what makes one invalidation enough. TanStack matches on key
    // prefix, so invalidating `keys.project.detail(uuid)` reaches the summary,
    // the history, the transitions, the approvals and the sites - and a key
    // that broke the prefix would silently reach none of them.
    const uuid = "22222222-2222-4222-8222-222222222222";
    const prefix = keys.project.detail(uuid);

    for (const key of [
      keys.project.summary(uuid),
      keys.project.history(uuid),
      keys.project.transitions(uuid),
      keys.project.approvals(uuid),
      keys.project.sites(uuid),
      keys.notice.list(uuid),
      keys.consent.links(uuid),
      keys.exchange.exports(uuid),
    ]) {
      expect(key.slice(0, prefix.length)).toEqual([...prefix]);
    }
  });

  it("keeps cross-project lists outside the per-project prefix", () => {
    // Otherwise invalidating one project would refetch every console-wide list,
    // which is a lot of requests for a change that affected one row.
    expect(keys.notice.all()[0]).toBe("all");
    expect(keys.consent.all()[0]).toBe("all");
    expect(keys.project.allApprovals()[0]).toBe("all");
  });

  it("distinguishes lists by their filters", () => {
    expect(keys.project.list({ status: "approved" })).not.toEqual(keys.project.list());
  });
});
