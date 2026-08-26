/**
 * Replacing a consent link.
 *
 * The links list already had a "New link" button, and it did something subtly
 * wrong: it minted a *second* link for the site and left the first one live. A
 * site then had two working URLs, one of which nobody was tracking — which is
 * exactly the situation the register exists to prevent.
 *
 * Replacing does both halves in one transaction: the old link is revoked, a new
 * one is issued with the same expiry and use limit, and the old row stays in the
 * register with its use count so the trail still says when it stopped working.
 *
 * This is also the answer to "the link is not visible anywhere". It cannot be —
 * the database holds a keyed digest, so the URL is unrecoverable by design — and
 * the honest operation is a fresh link rather than a weaker store.
 */
"use client";

import { AlertTriangle, Check, Copy, RefreshCw } from "lucide-react";
import * as React from "react";

import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Alert, Button, Mono } from "@/components/ui/primitives";
import { useRemintLink } from "@/features/consent/mutations";
import type { RemintedLink } from "@/features/consent/api";
import { formatDateTime } from "@/lib/format";
import { useToast } from "@/providers";
import type { LinkListRow } from "@/types";

export function ReplaceLinkDialog({
  link,
  onClose,
}: {
  link: LinkListRow | null;
  onClose: () => void;
}) {
  if (!link) return null;
  // Keyed so opening a different link starts from its own state rather than
  // inheriting the previous one's minted URL — which would be a working
  // credential shown against the wrong site.
  return <ReplaceLinkBody key={link.link_uuid} link={link} onClose={onClose} />;
}

function ReplaceLinkBody({ link, onClose }: { link: LinkListRow; onClose: () => void }) {
  const toast = useToast();
  const remint = useRemintLink();
  const [minted, setMinted] = React.useState<RemintedLink | null>(null);

  async function replace() {
    try {
      setMinted(await remint.mutateAsync(link.link_uuid));
    } catch {
      toast.error("Could not replace this link", "The existing link is unchanged.");
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={minted ? "Copy this now" : `Replace the link for ${link.site_label}?`}
        description={
          minted
            ? undefined
            : "The old link stops working immediately. The new URL is shown once."
        }
      >
        {minted ? (
          <MintedPanel link={minted} onDone={onClose} />
        ) : (
          <div>
            <Alert tone="warning" title="This revokes the current link">
              <p className="leading-relaxed">
                Anyone holding the old URL — a field agent, a printed QR code, a
                message thread — will find it stops resolving. It stays in the
                register as revoked, with its {link.use_count} use(s), so the
                consents gathered through it still point at it.
              </p>
            </Alert>

            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-text-subtle">Site</dt>
              <dd>{link.site_label}</dd>
              <dt className="text-text-subtle">Expires</dt>
              <dd>{formatDateTime(link.expires_at)}</dd>
              <dt className="text-text-subtle">Uses</dt>
              <dd className="tabular">
                {link.use_count}
                {link.max_uses !== null && ` of ${link.max_uses}`}
              </dd>
            </dl>

            {/* Said plainly rather than left to be discovered: the replacement
                keeps the original's terms, so this is a replacement and not a
                chance to change the expiry. */}
            <p className="mt-4 text-xs text-text-muted">
              The replacement inherits the same expiry and use limit. To change
              those, revoke this link and mint a new one from the site.
            </p>

            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" loading={remint.isPending} onClick={replace}>
                <RefreshCw className="size-4" />
                Revoke and replace
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The one moment the URL exists outside the browser that minted it.
 *
 * There is no close affordance in the corner and no dismiss-on-outside-click:
 * losing this panel loses the link, and the only way out is a button somebody
 * pressed on purpose.
 */
function MintedPanel({ link, onDone }: { link: RemintedLink; onDone: () => void }) {
  const [copied, setCopied] = React.useState(false);
  const url =
    typeof window !== "undefined" ? `${window.location.origin}${link.url_path}` : link.url_path;

  return (
    <div>
      <Alert tone="warning" title="This is the only time you will see this">
        <p className="flex items-start gap-2 leading-relaxed">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{link.warning}</span>
        </p>
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
          window.setTimeout(() => setCopied(false), 2000);
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
          I have copied it
        </Button>
      </DialogFooter>
    </div>
  );
}
