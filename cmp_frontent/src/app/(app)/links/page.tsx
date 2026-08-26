/**
 * Consent links.
 *
 * `registrations` is the number worth watching. It counts everyone who came
 * through the link - including anyone who registered and abandoned before
 * consenting, who leaves no artefact behind. If a link circulates beyond its
 * intended population, a registration count far above the consent count is the
 * first visible sign.
 */
"use client";

import { Ban, RefreshCw } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { PageHeader } from "@/components/layout/app-shell";
import {
  FilterBar,
  FilterSelect,
  ResourceList,
  useCursorStack,
  useFilterParam,
} from "@/components/data-display/resource-list";
import { AgentForm } from "@/features/projects/components";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyLink } from "@/components/ui/graphics";
import { Alert, Button, Td, Tr } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/ui/status";
import { useAllLinks, useRevokeLink } from "@/features/consent";
import { useEnums } from "@/features/meta";
import type { LinkListRow } from "@/types";
import { formatDateTime } from "@/lib/format";
import { useToast } from "@/providers";
import { ReplaceLinkDialog } from "@/features/consent/components";

function LinksPageView() {
  const stack = useCursorStack();
  const toast = useToast();
  const [status, setStatus] = useFilterParam("status");
  const [replacing, setReplacing] = React.useState<LinkListRow | null>(null);
  const [reissue, setReissue] = React.useState<
    { siteUuid: string; siteLabel: string } | null
  >(null);
  const revoke = useRevokeLink();

  const { data: enums } = useEnums();
  const query = useAllLinks({
    status: status || undefined,
    cursor: stack.cursor,
    limit: 25,
  });

  async function onRevoke(uuid: string, label: string) {
    try {
      await revoke.mutateAsync(uuid);
      toast.success("Link revoked", `${label} no longer resolves for anyone holding it.`);
    } catch (err) {
      const message =
        err && typeof err === "object" && "userMessage" in err
          ? (err as { userMessage: () => string }).userMessage()
          : "Could not revoke the link.";
      toast.error("Revocation failed", message);
    }
  }

  return (
    <>
      <PageHeader
        title="Consent links"
        description="One per site. A link only exists for a project in approved, and revoking it stops collection immediately."
      />

      {/* The most common question on this screen is "what *is* the link" — and
          the honest answer is that we cannot tell you, because we never kept it.
          Saying so, next to the way to get a new one, beats letting somebody
          hunt for a reveal button that cannot exist. */}
      <Alert tone="info" title="The link itself is not stored" className="mb-4">
        <p className="leading-relaxed">
          What the database holds is a keyed digest of the token, not the token —
          so a leaked backup is not a set of working consent links, and nobody
          here can read one back out. The URL is shown once, when it is minted. If
          it has been lost, issue a new one for the site; the old one keeps
          working until you revoke it.
        </p>
      </Alert>

      <FilterBar>
        <FilterSelect
          label="Status"
          value={status}
          onChange={(v) => {
            setStatus(v);
            stack.reset();
          }}
          options={enums?.link_status ?? []}
          allLabel="All statuses"
        />
      </FilterBar>

      <ResourceList<LinkListRow>
        query={query}
        stack={stack}
        caption="Consent links across all projects in scope"
        columns={["Site", "Project", "Status", "Uses", "Registrations", "Expires", "Actions"]}
        keyOf={(l) => l.link_uuid}
        empty={{
          illustration: <EmptyLink />,
          title: status ? "No links match" : "No consent links yet",
          description:
            "A link is minted by assigning a Field Agent to a site, once the project is approved.",
        }}
        row={(l) => (
          <Tr>
            <Td className="font-medium">{l.site_label}</Td>
            <Td>
              <Link
                href={`/projects/${l.project_uuid}`}
                className="text-text-muted hover:text-text hover:underline"
              >
                {l.project_name}
              </Link>
            </Td>
            <Td>
              <StatusBadge kind="link" value={l.status} />
            </Td>
            <Td className="tabular text-text-muted">
              {l.use_count}
              {l.max_uses !== null && ` / ${l.max_uses}`}
            </Td>
            <Td className="tabular text-text-muted">{l.registrations}</Td>
            <Td className="whitespace-nowrap text-text-muted">
              {formatDateTime(l.expires_at)}
            </Td>
            <Td>
              <div className="flex items-center justify-end gap-1">
                {/* Replace, not "New link". Minting a second link for a site
                    that already has a live one leaves two working URLs and only
                    one of them tracked. Replacing revokes and reissues in one
                    transaction. */}
                {l.status === "active" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setReplacing(l)}
                    title="Revoke this link and issue a replacement"
                  >
                    <RefreshCw className="size-4" />
                    Replace
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setReissue({ siteUuid: l.site_uuid, siteLabel: l.site_label })}
                    title="Mint a new link for this site and show the URL"
                  >
                    <RefreshCw className="size-4" />
                    New link
                  </Button>
                )}
                {l.status === "active" && (
                  <Button
                    variant="subtle"
                    size="sm"
                    loading={revoke.isPending}
                    onClick={() => onRevoke(l.link_uuid, l.site_label)}
                  >
                    <Ban className="size-4" />
                    Revoke
                  </Button>
                )}
              </div>
            </Td>
          </Tr>
        )}
      />

      <ReplaceLinkDialog link={replacing} onClose={() => setReplacing(null)} />

      <Dialog open={reissue !== null} onOpenChange={(o) => !o && setReissue(null)}>
        <DialogContent
          title={reissue ? `New link for ${reissue.siteLabel}` : "New link"}
          description="The URL is shown once and then only its digest is kept. Copy it before closing."
        >
          {reissue && <AgentForm siteUuid={reissue.siteUuid} onDone={() => setReissue(null)} />}
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
export default function LinksPage() {
  return (
    <React.Suspense fallback={<PageSkeleton />}>
      <LinksPageView />
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
