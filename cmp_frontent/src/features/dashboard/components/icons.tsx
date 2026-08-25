/**
 * An icon per figure.
 *
 * Separate from `config.ts` because it imports components and that file does
 * not — keeping the data importable from anywhere, including a test that has no
 * business pulling in an icon set.
 */

"use client";

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  FolderKanban,
  Languages,
  Link2,
  ScrollText,
  Share2,
  ShieldAlert,
  Upload,
} from "lucide-react";

export const COUNT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  total: FolderKanban,
  approved_projects: CheckCircle2,
  draft_notices: ScrollText,
  draft_purposes: FileText,
  active_links: Link2,
  consents: FileText,
  total_consents: FileText,
  exports: Upload,
  times_shared: Share2,
  flagged_assets: AlertTriangle,
  unapproved_languages: Languages,
  access_denials_7d: ShieldAlert,
};
