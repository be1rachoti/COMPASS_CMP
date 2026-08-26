/**
 * Cover arrangements.
 *
 * A delegation is one person covering another's row access for a period. It
 * grants and never transfers, so there is nothing to undo when it lapses — and
 * that is why there is no PUT: changing the dates of live cover is a revoke and
 * a fresh grant, which reads as two decisions rather than one record that
 * quietly became something else.
 */

import { apiDelete, apiGet, apiPost } from "@/lib/api";
import type { Acknowledged, Delegation, DelegationGranted, Uuid } from "@/types";

export interface DelegationInput {
  delegate_user_uuid: Uuid;
  /** Defaults to the caller. Only an administrator names somebody else — the
   *  realistic case is covering for a person already unreachable. */
  delegator_user_uuid?: Uuid;
  reason?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
}

export function grantDelegation(body: DelegationInput): Promise<DelegationGranted> {
  return apiPost<DelegationGranted>("/delegations", body);
}

/** Either party may end it, and so may an administrator. */
export function revokeDelegation(uuid: Uuid): Promise<Acknowledged> {
  return apiDelete<Acknowledged>(`/delegations/${uuid}`);
}

/** Cover the caller has arranged for their own work. */
export function listMyDelegations(): Promise<Delegation[]> {
  return apiGet<Delegation[]>("/delegations/mine");
}

/**
 * Cover the caller is providing for others.
 *
 * A separate call rather than a filter, because "whose work am I answerable for
 * this week" is a different question from "who is covering mine", and somebody
 * asking it is usually about to act on somebody else's rows.
 */
export function listHeldDelegations(): Promise<Delegation[]> {
  return apiGet<Delegation[]>("/delegations/held");
}

/** Every live arrangement. DPO and administrator only — this is oversight. */
export function listAllDelegations(): Promise<Delegation[]> {
  return apiGet<Delegation[]>("/delegations");
}
