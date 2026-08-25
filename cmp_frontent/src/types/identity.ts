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
