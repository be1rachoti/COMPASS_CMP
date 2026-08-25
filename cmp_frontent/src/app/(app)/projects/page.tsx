/**
 * Project list.
 *
 * Cursor-paginated, because the API is. Offset pagination silently skips or
 * repeats rows when the underlying set changes between pages, which it will
 * during a collection campaign - so "page 2" is not a concept here. The cursor
 * stack below is what gives users a Back button without inventing one.
 */
"use client";

import { Plus, Search } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { PageHeader } from "@/components/layout/app-shell";
import { useFilterParam } from "@/components/data-display/resource-list";
import { EmptyProjects } from "@/components/ui/graphics";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Input,
  Select,
  Table,
  TableSkeleton,
  Td,
  Th,
  Tr,
} from "@/components/ui/primitives";
import { ProjectForm } from "@/features/projects/components/forms";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/ui/status";
import { useEnums } from "@/features/meta";
import { useProjects } from "@/features/projects";
import { formatDateTime } from "@/lib/format";
import { useAuth } from "@/providers";

function ProjectsPageView() {
  const { me } = useAuth();
  const [status, setStatus] = useFilterParam("status");
  const [search, setSearch] = React.useState("");
  const [query, setQuery] = React.useState("");

  // The cursor stack: each entry is the cursor that produced that page, so
  // "Back" is a pop rather than a recomputation.
  const [creating, setCreating] = React.useState(false);
  const [cursors, setCursors] = React.useState<Array<string | undefined>>([undefined]);
  const cursor = cursors[cursors.length - 1];

  const { data: enums } = useEnums();
  const { data, isLoading, isFetching, error } = useProjects({
    status: status || undefined,
    q: query || undefined,
    cursor,
    limit: 25,
  });

  // Any filter change invalidates the whole stack: a cursor describes a position
  // in one particular result set. Reset it where the filter changes rather than
  // in an effect reacting to it - an effect renders once with the new filter and
  // the stale cursor, which is a wasted request against the wrong page.
  const changeStatus = (next: string) => {
    setStatus(next);
    setCursors([undefined]);
  };

  const onSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setQuery(search.trim());
    setCursors([undefined]);
  };

  const canCreate = me?.role === "rnd_user";

  return (
    <>
      <PageHeader
        title="Projects"
        description="Every collection begins here and moves through five states. Only a DPO can publish the notice that unlocks collection."
        actions={
          canCreate ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              Register a project
            </Button>
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <form onSubmit={onSearch} className="flex items-end gap-2">
          <div className="w-64">
            <label htmlFor="project-search" className="mb-1.5 block text-sm font-medium">
              Search
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-subtle"
                aria-hidden="true"
              />
              <Input
                id="project-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Project name"
                className="pl-8"
              />
            </div>
          </div>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>

        <div className="w-52">
          <label htmlFor="project-status" className="mb-1.5 block text-sm font-medium">
            Status
          </label>
          <Select
            id="project-status"
            value={status}
            onChange={(e) => changeStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            {enums?.project_status?.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </Select>
        </div>

        {(status || query) && (
          <Button
            variant="ghost"
            onClick={() => {
              setStatus("");
              setSearch("");
              setQuery("");
              setCursors([undefined]);
            }}
          >
            Clear
          </Button>
        )}
      </div>

      {error && (
        <Alert tone="danger" title="Could not load projects">
          {error.userMessage()}
        </Alert>
      )}

      {isLoading ? (
        <Card>
          <TableSkeleton rows={6} cols={5} />
        </Card>
      ) : !data?.items.length ? (
        <Card>
          <EmptyState
            illustration={<EmptyProjects />}
            title={status || query ? "No projects match those filters" : "No projects yet"}
            description={
              status || query
                ? "Try widening the filters."
                : canCreate
                  ? "Register one to begin. You will need a name, a description and a nominated Data Collection Owner."
                  : "Projects you are assigned to will appear here."
            }
          />
        </Card>
      ) : (
        <>
          <Table>
            <caption className="sr-only">
              Projects visible to you, most recently created first
            </caption>
            <thead>
              <tr>
                <Th>Project</Th>
                <Th>Status</Th>
                <Th>Data Collection Owner</Th>
                <Th>Created by</Th>
                <Th>Updated</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((project) => (
                <Tr key={project.project_uuid}>
                  <Td>
                    <Link
                      href={`/projects/${project.project_uuid}`}
                      className="font-medium text-accent-text hover:underline"
                    >
                      {project.project_name}
                    </Link>
                    {project.internal_project_name && (
                      <p className="mt-0.5 text-xs text-text-subtle">
                        {project.internal_project_name}
                      </p>
                    )}
                  </Td>
                  <Td>
                    <StatusBadge kind="project" value={project.project_status} />
                  </Td>
                  <Td className="text-text-muted">{project.dco_name ?? "—"}</Td>
                  <Td className="text-text-muted">{project.created_by_name ?? "—"}</Td>
                  <Td className="whitespace-nowrap text-text-muted">
                    {formatDateTime(project.updated_at)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>

          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs text-text-subtle">
              Showing {data.items.length}
              {data.total !== null && ` of ${data.total}`}
              {isFetching && " · refreshing"}
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={cursors.length === 1}
                onClick={() => setCursors((s) => s.slice(0, -1))}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!data.next_cursor}
                onClick={() =>
                  setCursors((s) => [...s, data.next_cursor ?? undefined])
                }
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent
          title="Register a project"
          description="Name, description and a nominated Data Collection Owner are all required to leave the starting gate."
        >
          <ProjectForm onDone={() => setCreating(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * `useFilterParam` reads the query string, which forces client rendering, so
 * Next requires a suspense boundary around it. Without one the whole route bails
 * out of prerendering.
 */
export default function ProjectsPage() {
  return (
    <React.Suspense fallback={<PageSkeleton />}>
      <ProjectsPageView />
    </React.Suspense>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="shimmer h-8 w-64 rounded-lg" />
      <div className="shimmer h-14 rounded-xl" />
      <div className="shimmer h-72 rounded-xl" />
    </div>
  );
}
