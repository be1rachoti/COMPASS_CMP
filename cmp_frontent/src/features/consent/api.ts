/**
 * Every request the consent feature makes.
 *
 * Note what is not here: there is no `createConsent`. Consent is written by the
 * data principal through the public flow and by nobody else — the console reads
 * artefacts and revokes links, and that asymmetry is the point of the module
 * rather than an omission from it.
 */

import { apiGet, apiPost, queryString } from "@/lib/api";
import type { ListFilters } from "@/lib/query";
import type {
  ConsentArtefact,
  ConsentAsset,
  ConsentLink,
  ConsentListRow,
  ConsentRow,
  LinkListRow,
  LinkStats,
  Page,
  PurposeGrant,
  Uuid,
} from "@/types";

/* ----------------------------------------------------------------- reads */

export function listProjectConsents(
  projectUuid: Uuid,
  filters: Record<string, unknown> = {},
): Promise<Page<ConsentRow>> {
  return apiGet<Page<ConsentRow>>(`/projects/${projectUuid}/consents${queryString(filters)}`);
}

/** Consents across every project the caller may see. */
export function listConsents(filters: ListFilters = {}): Promise<Page<ConsentListRow>> {
  return apiGet<Page<ConsentListRow>>(`/consents${queryString(filters)}`);
}

export function getConsentSummary(projectUuid: Uuid): Promise<Record<string, number>> {
  return apiGet<Record<string, number>>(`/projects/${projectUuid}/consents/summary`);
}

/**
 * One consent record, staff view.
 *
 * Three endpoints rather than one fat one, and deliberately so: the artefact is
 * cheap and always wanted, the grants are cheap and almost always wanted, and
 * the asset reverse lookup is the expensive one that only matters when somebody
 * is answering an erasure request. Split, the page paints before the third
 * returns.
 */
export function getConsent(uuid: Uuid): Promise<ConsentArtefact> {
  return apiGet<ConsentArtefact>(`/consents/${uuid}`);
}

export function listConsentGrants(uuid: Uuid): Promise<PurposeGrant[]> {
  return apiGet<PurposeGrant[]>(`/consents/${uuid}/grants`);
}

/** Which stored assets this person appears in. The lookup an erasure needs. */
export function listConsentAssets(uuid: Uuid): Promise<ConsentAsset[]> {
  return apiGet<ConsentAsset[]>(`/consents/${uuid}/assets`);
}

export function listProjectLinks(projectUuid: Uuid): Promise<ConsentLink[]> {
  return apiGet<ConsentLink[]>(`/projects/${projectUuid}/links`);
}

export function listLinks(filters: ListFilters = {}): Promise<Page<LinkListRow>> {
  return apiGet<Page<LinkListRow>>(`/links${queryString(filters)}`);
}

export function getLinkStats(uuid: Uuid): Promise<LinkStats> {
  return apiGet<LinkStats>(`/links/${uuid}/stats`);
}

/* ---------------------------------------------------------------- writes */

/**
 * Revoke a capability link.
 *
 * Revoked, not deleted. The link is the provenance of every consent gathered
 * through it, so the row survives with a revocation timestamp — which is also
 * what lets somebody answer "when did this stop working, and who stopped it".
 */
export function revokeLink(uuid: Uuid): Promise<{ ok: boolean; message?: string }> {
  return apiPost<{ ok: boolean; message?: string }>(`/links/${uuid}/revoke`);
}

/**
 * A link that has just been minted, or re-minted.
 *
 * The token is in this response and nowhere else, ever again — the database
 * holds a keyed digest. A screen that loses it before the user copies it has
 * destroyed the thing they asked for, which is why the panel that shows it
 * takes a deliberate action to dismiss.
 */
export interface RemintedLink {
  link_uuid: Uuid;
  replaced_link_uuid: Uuid;
  token: string;
  url_path: string;
  expires_at: string;
  max_uses: number | null;
  warning: string;
}

/**
 * Revoke a link and issue its replacement, in one transaction.
 *
 * This is the answer to "the URL is not visible anywhere". It cannot be — the
 * stored value is a digest — so the honest operation is a new link rather than
 * a weaker store. The replacement inherits the original's expiry and use limit,
 * and the old one stays in the register as revoked with its use count intact.
 */
export function remintLink(uuid: Uuid): Promise<RemintedLink> {
  return apiPost<RemintedLink>(`/links/${uuid}/remint`);
}
