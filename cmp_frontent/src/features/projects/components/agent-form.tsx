/**
 * Minting a capability link for a field agent.
 *
 * The token is shown **once**, by `MintedLinkPanel`, and never again — the
 * server stores only a keyed digest of it. A panel that loses it before
 * the user copies it has destroyed the thing they asked for, which is why
 * dismissing it takes a deliberate action.
 */
"use client";

import * as React from "react";
import { Copy, Check } from "lucide-react";
import { FormError, useApiForm } from "@/components/forms";
import { DialogFooter } from "@/components/ui/dialog";
import { Alert, Button, Field, Input, Mono } from "@/components/ui/primitives";
import { type MintedLink, useAssignAgent } from "@/features/projects";
import { useToast } from "@/providers";
import { agentSchema } from "@/features/projects/schemas";

export function AgentForm({ siteUuid, onDone }: { siteUuid: string; onDone: () => void }) {
  const toast = useToast();
  const assign = useAssignAgent(siteUuid);
  const [minted, setMinted] = React.useState<MintedLink | null>(null);

  const form = useApiForm(agentSchema, {
    // Deliberately empty. The absence of a default expiry is the control.
    expires_at: "",
    max_uses: null,
    agent_ref: "",
  });

  const onSubmit = form.submit(async (values) => {
    const result = await assign.mutateAsync({
      expires_at: new Date(values.expires_at).toISOString(),
      max_uses: values.max_uses || null,
      agent_ref: values.agent_ref || null,
    });
    setMinted(result);
    toast.success("Consent link created");
  });

  if (minted) return <MintedLinkPanel link={minted} onDone={onDone} />;

  return (
    <form onSubmit={onSubmit} noValidate>
      <FormError message={form.formError} />

      <div className="space-y-4">
        <Field
          label="Expires at"
          hint="Required, with no default and no maximum. Somebody has to decide how long this link should live."
          error={form.formState.errors.expires_at?.message}
          required
        >
          {(p) => <Input {...p} type="datetime-local" {...form.register("expires_at")} />}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Maximum uses"
            hint="Leave blank for unlimited. A cap limits the damage if the link circulates."
            error={form.formState.errors.max_uses?.message}
          >
            {(p) => (
              <Input {...p} type="number" min={1} {...form.register("max_uses")} placeholder="unlimited" />
            )}
          </Field>

          <Field label="Field agent reference" hint="Optional. For your own records.">
            {(p) => <Input {...p} {...form.register("agent_ref")} />}
          </Field>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={assign.isPending}>
          Create link
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * The token is shown exactly once.
 *
 * What the database holds is its keyed digest, so this panel is the only chance
 * to capture it. Saying so plainly is better than letting someone close the
 * dialog and discover it later.
 */
function MintedLinkPanel({ link, onDone }: { link: MintedLink; onDone: () => void }) {
  const [copied, setCopied] = React.useState(false);
  const url =
    typeof window !== "undefined" ? `${window.location.origin}${link.url_path}` : link.url_path;

  return (
    <div>
      <Alert tone="warning" title="Copy this now">
        <p>{link.warning}</p>
      </Alert>

      <div className="mt-4 rounded-md border border-border bg-bg-subtle p-3">
        <Mono className="block break-all text-sm">{url}</Mono>
      </div>

      <Button
        variant="secondary"
        className="mt-3"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copied ? "Copied" : "Copy link"}
      </Button>

      <p className="mt-4 text-xs text-text-muted">
        Give this to the field agent. Anyone holding it can open the notice and
        consent, so treat it as a credential — it is scrubbed from our access logs
        for the same reason.
      </p>

      <DialogFooter>
        <Button variant="primary" onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </div>
  );
}
