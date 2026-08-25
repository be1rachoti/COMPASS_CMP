/**
 * The four states every list screen has to distinguish.
 *
 * Fifteen list pages share this component, so a mistake here is a mistake
 * fifteen times, and the one that matters most is the third test below: a table
 * that renders empty while loading reads as "no results", and sends somebody
 * looking for a bug in the data when the request simply had not finished.
 */

import { describe, expect, it, vi } from "vitest";

import { ResourceList, useCursorStack } from "@/components/data-display/resource-list";
import { ApiError } from "@/lib/errors";
import { render, renderHook, screen, act } from "@/test/render";
import { makeNoticeRow, makePage } from "@/test/fixtures";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

type Row = ReturnType<typeof makeNoticeRow>;

const columns = ["Code", "Status"];
const row = (n: Row) => (
  <>
    <td>{n.notice_code}</td>
    <td>{n.status}</td>
  </>
);

function renderList(
  query: Partial<{
    data: ReturnType<typeof makePage<Row>>;
    isLoading: boolean;
    isFetching: boolean;
    error: ApiError | null;
  }>,
) {
  function Harness() {
    const stack = useCursorStack();
    return (
      <ResourceList
        query={{ isLoading: false, isFetching: false, error: null, ...query }}
        columns={columns}
        row={row}
        caption="Notices"
        empty={{ title: "No notices yet", description: "Create one to get started." }}
        stack={stack}
        keyOf={(n) => n.notice_uuid}
      />
    );
  }
  return render(<Harness />);
}

describe("ResourceList", () => {
  it("renders a row per item", () => {
    renderList({
      data: makePage([
        makeNoticeRow({ notice_code: "NOT-0001" }),
        makeNoticeRow({ notice_uuid: "aaa", notice_code: "NOT-0002" }),
      ]),
    });

    expect(screen.getByText("NOT-0001")).toBeInTheDocument();
    expect(screen.getByText("NOT-0002")).toBeInTheDocument();
  });

  it("shows the empty state when the list is genuinely empty", () => {
    renderList({ data: makePage([]) });

    expect(screen.getByText("No notices yet")).toBeInTheDocument();
  });

  it("does not show the empty state while loading", () => {
    // The bug this guards: an empty table during a pending request is
    // indistinguishable from "there is nothing here", and the second reading is
    // the one people act on.
    renderList({ isLoading: true, data: undefined });

    expect(screen.queryByText("No notices yet")).not.toBeInTheDocument();
  });

  it("explains a 403 in terms of the role, and says it was recorded", () => {
    // A DPO looking at a forbidden list needs to know it is a permission
    // boundary and not an outage, and that the attempt is in the trail - which
    // is true, and is the sort of thing people would rather learn here than in
    // an audit review.
    renderList({
      error: new ApiError(403, {
        code: "forbidden",
        message: "Not permitted",
        request_id: "req_1",
      }),
    });

    expect(screen.getByText(/role does not permit this/i)).toBeInTheDocument();
    expect(screen.getByText(/recorded in the audit trail/i)).toBeInTheDocument();
    expect(screen.queryByText("No notices yet")).not.toBeInTheDocument();
  });
});

describe("useCursorStack", () => {
  it("resets to the first page when a filter changes", () => {
    // A cursor describes a position in one particular result set. Carrying it
    // across a filter change asks the server for a page of a set that no longer
    // exists, and the answer is either wrong rows or an error.
    const { result } = renderHook(() => useCursorStack());

    act(() => result.current.next("cursor-page-2"));
    expect(result.current.cursor).toBe("cursor-page-2");

    act(() => result.current.reset());
    expect(result.current.cursor).toBeUndefined();
  });

  it("goes back one page at a time, not to the start", () => {
    const { result } = renderHook(() => useCursorStack());

    act(() => result.current.next("page-2"));
    act(() => result.current.next("page-3"));
    act(() => result.current.back());

    expect(result.current.cursor).toBe("page-2");
  });
});
