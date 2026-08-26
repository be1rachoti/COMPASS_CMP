/**
 * Who somebody is, and what the server says they may reach.
 *
 * `Me.nav` is the important field: the console renders its navigation from it
 * rather than from a local copy of the permission matrix. Two copies of an
 * access rule drift, and the one that drifts is the one nobody is testing.
 */

import type { PersonType, Role, UserStatus } from "@/types/enums";
import type { Timestamp, Uuid } from "@/types/primitives";

export interface Me {
  uuid: Uuid;
  full_name: string;
  email: string;
  role: Role;
  person_type: PersonType | null;
  status: UserStatus;
  mfa_verified: boolean;
  session_expires_at: Timestamp;
  /** What this role may navigate to. Rendered from here, not from a local copy
   *  of the permission matrix that would drift from the server's. */
  nav: string[];
}

export interface LoginResponse {
  mfa_required: boolean;
  user_uuid: Uuid | null;
  message: string;
}

export interface SessionInfo {
  uuid: Uuid;
  created_at: Timestamp;
  last_seen_at: Timestamp;
  expires_at: Timestamp;
  ip_address: string | null;
  user_agent: string | null;
  mfa_verified: boolean;
  current: boolean;
}

export interface User {
  uuid: Uuid;
  username: string | null;
  full_name: string;
  email: string;
  mobile: string | null;
  organization_id: string | null;
  role: Role;
  person_type: PersonType | null;
  status: UserStatus;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface PersonTypeHistoryEntry {
  history_uuid: Uuid;
  from_type: PersonType | null;
  to_type: PersonType;
  reason: string | null;
  changed_at: Timestamp;
  changed_by_uuid: Uuid;
  changed_by_name: string;
}

/**
 * One person covering another's row access for a period.
 *
 * Grants, never transfers: sites keep their owners and the access lapses on its
 * own when the arrangement ends. `is_active` is computed server-side from the
 * dates and the revocation, so every surface agrees with the scope predicate
 * about what "active" means rather than each re-deriving it from the dates.
 */
export interface Delegation {
  delegation_uuid: Uuid;
  delegator_uuid: Uuid;
  delegator_name: string;
  delegator_email: string;
  delegator_role: Role;
  delegate_uuid: Uuid;
  delegate_name: string;
  delegate_email: string;
  delegate_role: Role;
  reason: string | null;
  starts_at: Timestamp;
  /** Null is open-ended. A known return date is the better arrangement: cover
   *  that expires by itself is cover nobody has to remember to end. */
  ends_at: Timestamp | null;
  revoked_at: Timestamp | null;
  created_at: Timestamp;
  is_active: boolean;
}

export interface DelegationGranted {
  delegation_uuid: Uuid;
  /**
   * False for a DPO.
   *
   * A DPO already reads every record, so the arrangement is the record of who
   * was covering rather than an expansion of access. The API says so, and the
   * UI repeats it, so nobody believes an effect that is not there.
   */
  grants_access: boolean;
  message: string;
}
