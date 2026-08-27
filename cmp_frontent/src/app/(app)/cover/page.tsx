/**
 * Cover arrangements: who is standing in for whom.
 *
 * The problem this exists for is mundane and its usual workaround is not: a DPO
 * goes on leave, a DCO is off for a fortnight and their campuses keep
 * collecting, and the only previous option was to reassign the work and remember
 * to move it back. What people do instead is share a password, and a shared
 * password is the end of the audit trail's ability to say who did anything.
 *
 * Three sections, in the order somebody arriving here needs them:
 *
 * 1. **Cover for my work** — the thing they came to arrange.
 * 2. **Work I am covering** — whose rows they are answerable for right now,
 *    which is the question somebody asks *before* acting on a project that is
 *    not theirs.
 * 3. **Everyone** — oversight, DPO and administrator only.
 *
 * One property is repeated in the copy because it is the one people get wrong:
 * cover **grants** and never transfers. Ownership stays put, and the access
 * lapses on its own when the arrangement ends. Nobody has to remember to undo
 * it, which is exactly why it is safe to use.
 */
"use client";

import { CalendarClock, HandHelping, Plus, ShieldCheck, UserRoundCheck } from "lucide-react";
import * as React from "react";

import { PageHeader } from "@/components/layout/app-shell";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyRecords } from "@/components/ui/graphics";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
} from "@/components/ui/primitives";
import { StatusBadge } from "@/components/ui/status";
import {
  useAllDelegations,
  useHeldDelegations,
  useMyDelegations,
  useRevokeDelegation,
} from "@/features/delegations";
import { GrantCoverForm } from "@/features/delegations/components/grant-cover-form";
import { formatDate, formatRelative } from "@/lib/format";
import { useAuth, useToast } from "@/providers";
import type { Delegation } from "@/types";

export default function CoverPage() {
  const { me } = useAuth();
  const [arranging, setArranging] = React.useState(false);

  const mine = useMyDelegations();
  const held = useHeldDelegations();
  const oversight = me?.role === "dpo" || me?.role === "admin";
  const everyone = useAllDelegations(oversight);

  // Cover applies to roles whose access is defined by *assignment* — every
  // collection owner, not only the DCO. An R&D User's rows are the ones they
  // created, and nobody can cover authorship.
  const canArrange =
    me?.role === "dpo" ||
    me?.role === "dco" ||
    me?.role === "rco" ||
    me?.role === "dco_admin";

  return (
    <>
      <PageHeader
        title="Cover"
        description="Arrange for somebody to cover your work while you are away. Cover grants access for a period and transfers nothing — it ends on its own."
        actions={
          canArrange ? (
            <Button variant="primary" onClick={() => setArranging(true)}>
              <Plus className="size-4" />
              Arrange cover
            </Button>
          ) : null
        }
      />

      {!canArrange && (
        <Alert tone="info" className="mb-4">
          Cover applies to roles whose access is defined by assignment — a DPO or
          a Data Collection Owner. Your projects are the ones you created, and
          authorship is not something somebody else can stand in for.
        </Alert>
      )}

      <div className="space-y-6">
        <Section
          title="Cover for my work"
          icon={<HandHelping className="size-4" aria-hidden="true" />}
          query={mine}
          empty="Nobody is covering for you"
          emptyHint="Arrange cover before you go, and it will end on the date you set."
          perspective="delegate"
        />

        <Section
          title="Work I am covering"
          icon={<UserRoundCheck className="size-4" aria-hidden="true" />}
          query={held}
          empty="You are not covering for anybody"
          emptyHint="When somebody arranges cover with you, their projects appear in your lists until it ends."
          perspective="delegator"
        />

        {oversight && (
          <Section
            title="Everyone, right now"
            icon={<ShieldCheck className="size-4" aria-hidden="true" />}
            query={everyone}
            empty="No cover is in place"
            emptyHint="Live arrangements across the organisation appear here."
            perspective="both"
          />
        )}
      </div>

      <Dialog open={arranging} onOpenChange={(open) => !open && setArranging(false)}>
        <DialogContent
          title="Arrange cover"
          description="They will reach your projects for as long as the arrangement lasts, and nothing changes hands."
        >
          <GrantCoverForm onDone={() => setArranging(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function Section({
  title,
  icon,
  query,
  empty,
  emptyHint,
  perspective,
}: {
  title: string;
  icon: React.ReactNode;
  query: { data?: Delegation[]; isLoading: boolean };
  empty: string;
  emptyHint: string;
  /** Which name to lead with. In "cover for my work" the reader is the
   *  delegator, so the useful name is the delegate's, and the reverse. */
  perspective: "delegate" | "delegator" | "both";
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardBody>
        {query.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : !query.data?.length ? (
          <EmptyState illustration={<EmptyRecords />} title={empty} description={emptyHint} />
        ) : (
          <ul className="divide-y divide-border">
            {query.data.map((d) => (
              <DelegationRow key={d.delegation_uuid} delegation={d} perspective={perspective} />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function DelegationRow({
  delegation: d,
  perspective,
}: {
  delegation: Delegation;
  perspective: "delegate" | "delegator" | "both";
}) {
  const toast = useToast();
  const revoke = useRevokeDelegation();

  const who =
    perspective === "both"
      ? `${d.delegate_name} covering for ${d.delegator_name}`
      : perspective === "delegate"
        ? d.delegate_name
        : d.delegator_name;

  const email = perspective === "delegate" ? d.delegate_email : d.delegator_email;

  async function end() {
    try {
      const result = await revoke.mutateAsync(d.delegation_uuid);
      toast.success("Cover ended", result.message ?? undefined);
    } catch {
      toast.error("Could not end this arrangement", "Nothing has been changed.");
    }
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {who}
          <StatusBadge kind="role" value={d.delegator_role} dot={false} />
          {!d.is_active && (
            <span className="text-xs font-normal text-text-subtle">
              {d.revoked_at ? "ended" : "not active"}
            </span>
          )}
        </p>
        <p className="mt-0.5 text-xs text-text-muted">
          {perspective !== "both" && `${email} · `}
          <span className="inline-flex items-center gap-1">
            <CalendarClock className="size-3" aria-hidden="true" />
            {d.ends_at ? (
              <>
                until {formatDate(d.ends_at)}{" "}
                <span className="text-text-subtle">({formatRelative(d.ends_at)})</span>
              </>
            ) : (
              // Named rather than left blank: "no end date" is a decision
              // somebody made and should be able to see they made.
              "open-ended"
            )}
          </span>
        </p>
        {d.reason && <p className="mt-1 text-xs italic text-text-subtle">“{d.reason}”</p>}
      </div>

      {/* Either party may end it — the delegate as well as the delegator,
          because being handed access one does not want is a real situation and
          refusing it should not need a ticket. */}
      {d.is_active && (
        <Button variant="subtle" size="sm" loading={revoke.isPending} onClick={end}>
          End now
        </Button>
      )}
    </li>
  );
}
