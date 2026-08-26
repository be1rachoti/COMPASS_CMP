/**
 * Shared scaffolding for every list page.
 *
 * Fifteen list screens with hand-rolled pagination would drift into fifteen
 * subtly different behaviours - one resets the cursor on filter change, one
 * does not; one shows a spinner, one blanks the table. This holds the parts that
 * must behave identically:
 *
 * - **The cursor stack.** The API is cursor-paginated, so "page 3" does not
 *   exist. Keeping the stack of cursors is what gives users a Back button
 *   without inventing an offset the API would not honour.
 * - **Filter changes reset it.** A cursor describes a position in one particular
 *   result set; carrying it across a filter change asks for a page of a set that
 *   no longer exists.
 * - **Loading, empty, error and populated** are four distinct states, and each
 *   gets its own treatment. A table that renders empty while loading reads as
 *   "no results" and sends people looking for a bug that is not there.
 */
"use client";

import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useSearchParams } from "next/navigation";
import * as React from "react";

import {
  Alert,
  Button,
  Card,
  EmptyState,
  Input,
  Select,
  Table,
  TableSkeleton,
  Th,
} from "@/components/ui/primitives";
import type { ApiError } from "@/lib/errors";
import type { Page } from "@/types";

/** Cursor stack, plus the reset that filter changes must trigger. */
export function useCursorStack(): {
  cursor: string | undefined;
  canGoBack: boolean;
  next: (cursor: string | null) => void;
  back: () => void;
  reset: () => void;
} {
  const [stack, setStack] = React.useState<Array<string | undefined>>([undefined]);

  return {
    cursor: stack[stack.length - 1],
    canGoBack: stack.length > 1,
    next: (c) => setStack((s) => [...s, c ?? undefined]),
    back: () => setStack((s) => s.slice(0, -1)),
    reset: () => setStack([undefined]),
  };
}

export interface FilterOption {
  value: string;
  label: string;
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel = "All",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: FilterOption[];
  allLabel?: string;
}) {
  const id = React.useId();
  return (
    <div className="w-52">
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function SearchBox({
  label = "Search",
  placeholder,
  onSubmit,
}: {
  label?: string;
  placeholder?: string;
  onSubmit: (term: string) => void;
}) {
  const id = React.useId();
  const [term, setTerm] = React.useState("");

  return (
    <form method="post"
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(term.trim());
      }}
    >
      <div className="w-64">
        <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
          {label}
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-subtle"
            aria-hidden="true"
          />
          <Input
            id={id}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={placeholder}
            className="pl-8"
          />
        </div>
      </div>
      <Button type="submit" variant="secondary">
        Search
      </Button>
    </form>
  );
}

/**
 * The toolbar above a list.
 *
 * A single panel rather than loose controls: it groups the things that change
 * what the table shows, so the table reads as the answer to the toolbar.
 */
export function FilterBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface/60 p-3 shadow-[var(--shadow-sm)]">
      {children}
    </div>
  );
}

/**
 * Renders the four states of a paginated list.
 *
 * `columns` and `row` stay with the caller: a shared component that also owned
 * the cells would need a column-definition mini-language, and those are always
 * harder to read than the JSX they replace.
 */
export function ResourceList<T>({
  query,
  columns,
  row,
  caption,
  empty,
  stack,
  keyOf,
}: {
  query: { data?: Page<T>; isLoading: boolean; isFetching: boolean; error: ApiError | null };
  columns: string[];
  row: (item: T) => React.ReactNode;
  caption: string;
  empty: {
    title: string;
    description?: string;
    icon?: React.ReactNode;
    illustration?: React.ReactNode;
    action?: React.ReactNode;
  };
  stack: ReturnType<typeof useCursorStack>;
  keyOf: (item: T) => string;
}) {
  if (query.error) {
    return (
      <Alert tone="danger" title="Could not load this list">
        {query.error.isForbidden
          ? "Your role does not permit this. The attempt has been recorded in the audit trail."
          : query.error.userMessage()}
      </Alert>
    );
  }

  if (query.isLoading) {
    return (
      <Card>
        <TableSkeleton rows={6} cols={columns.length} />
      </Card>
    );
  }

  const items = query.data?.items ?? [];

  if (items.length === 0) {
    return (
      <Card>
        <EmptyState {...empty} />
      </Card>
    );
  }

  return (
    <>
      <Table>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <Th key={c}>{c}</Th>
            ))}
          </tr>
        </thead>
        <tbody>{items.map((item) => <React.Fragment key={keyOf(item)}>{row(item)}</React.Fragment>)}</tbody>
      </Table>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs tabular text-text-subtle">
          Showing {items.length}
          {query.data?.total != null && ` of ${query.data.total}`}
          {query.isFetching && (
            <span className="ml-2 inline-flex items-center gap-1.5 text-accent-text">
              <span className="size-1.5 animate-pulse rounded-full bg-accent" aria-hidden="true" />
              refreshing
            </span>
          )}
        </p>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={!stack.canGoBack}
            onClick={stack.back}
          >
            <ChevronLeft aria-hidden="true" />
            Previous
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!query.data?.next_cursor}
            onClick={() => stack.next(query.data?.next_cursor ?? null)}
          >
            Next
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>
    </>
  );
}

/**
 * Seed a filter from the URL.
 *
 * Dashboard figures link to the list that explains them — "3 pending approval"
 * goes to the projects list already filtered to pending approval. That only
 * works if the list reads the query string, and it has to read it *once*, as an
 * initial value: after that the control owns the state, and re-syncing on every
 * render would fight the user every time they changed the dropdown.
 *
 * `useSearchParams` forces client rendering, so any page calling this needs a
 * Suspense boundary above it or Next refuses to prerender the route.
 */
export function useFilterParam(
  name: string,
  fallback = "",
): [string, React.Dispatch<React.SetStateAction<string>>] {
  const params = useSearchParams();
  // Read at mount only. React keeps the initialiser's result and ignores it on
  // subsequent renders, which is exactly the semantics wanted here.
  const [value, setValue] = React.useState(() => params.get(name) ?? fallback);
  return [value, setValue];
}
