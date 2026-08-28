/**
 * Copying a consent link.
 *
 * This could not exist until the token became recoverable. The link used to be
 * shown once at mint and kept only as a keyed digest, so "copy the link" had no
 * answer but "replace it" — which invalidates the URL an agent may already be
 * holding.
 *
 * The token is now sealed as well as digested, so the address can be shown
 * again to whoever has to share it. Two things follow, and both are visible
 * here rather than assumed:
 *
 * **A link minted before that change cannot be recovered.** Its token was never
 * kept. The control says so and points at replacing, instead of copying an
 * empty string and leaving somebody to discover it at the collection point.
 *
 * **This is a credential, not a reference.** Anyone holding the URL can open the
 * consent form as that site. The button says "Copy" and not "Share", and the
 * revoked and expired states do not offer it at all — a dead link copied in
 * good faith wastes a visit.
 */
"use client";

import { Check, Copy, Link2Off } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/primitives";
import { useToast } from "@/providers";
import type { ConsentLink } from "@/types";

export function CopyLinkButton({
  link,
  onReplace,
  size = "sm",
}: {
  link: Pick<ConsentLink, "url_path" | "status">;
  /** Offered when the URL cannot be recovered — the only way to get a working
   *  one is to issue a fresh link. */
  onReplace?: () => void;
  size?: "sm" | "md";
}) {
  const toast = useToast();
  const [copied, setCopied] = React.useState(false);

  // Only a live link is worth copying. Copying an expired one in good faith
  // sends somebody to a page that refuses them.
  if (link.status !== "active") return null;

  if (!link.url_path) {
    return (
      <Button
        variant="ghost"
        size={size}
        onClick={onReplace}
        disabled={!onReplace}
        title="This link was issued before links could be shown again, so its URL was never kept. Replacing it issues one you can copy."
      >
        <Link2Off className="size-4" />
        URL not kept
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size={size}
      onClick={async () => {
        const url = `${window.location.origin}${link.url_path}`;
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard access is refused in some browsers and contexts. Saying
          // so beats a button that silently does nothing.
          toast.error("Could not copy", "Your browser refused clipboard access.");
        }
      }}
      title="Copy the collection URL. Anyone with it can open the consent form for this site."
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}
