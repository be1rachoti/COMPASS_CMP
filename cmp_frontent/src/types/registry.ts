/**
 * Purposes, processors and data sources — the reference data consent is given
 * *against*, which is why none of it is deletable.
 */

import type { LawfulBasis, PurposeStatus, RecordStatus, Role, S7Clause } from "@/types/enums";
import type { DateOnly, Timestamp, Uuid } from "@/types/primitives";

export interface Purpose {
  purpose_uuid: Uuid;
  purpose_code: string;
  version: number;
  status: PurposeStatus;
  name: string;
  description: string;
  /** Rule 3(b)(ii): the specific uses this purpose enables. */
  uses: string;
  lawful_basis: LawfulBasis;
  s7_clause: S7Clause | null;
  /** Rule 3(b)(i): itemised. Never empty. */
  data_categories: string[];
  retention_period: string;
  retention_basis: string;
  erasure_trigger: string;
  consent_validity_period: string | null;
  cross_border_permitted: boolean;
  permitted_for_minors: boolean;
  lapse_behaviour: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  /** Present only on a notice's purpose list. */
  is_mandatory?: boolean;
  display_order?: number;
}

export interface Processor {
  processor_uuid: Uuid;
  legal_name: string;
  type: string;
  contract_ref: string;
  /** Rule 6(1)(f). */
  security_confirmed_at: DateOnly;
  status: RecordStatus;
  /** Whether this is the organisation collecting for itself.
   *
   *  It decides where an approved project goes: a third party's goes to a DCO
   *  Admin to be routed, an in-house one goes back to the R&D owner to name the
   *  sources and an RCO. Separate from `type`, which says what kind of thing a
   *  processor is and not whose it is — a lab can be either. */
  is_in_house: boolean;
  created_at: Timestamp;
  sites?: number;
}

export interface DataSource {
  source_uuid: Uuid;
  source_code: string;
  name: string;
  source_role: string;
  exchange_mode: string;
  id_scheme: string | null;
  /** Which elements this source owns. Without it a nightly sync overwrites a
   *  value corrected under a rights request. */
  is_authoritative_for: string[];
  status: RecordStatus;
  created_at: Timestamp;
  processor_uuid: Uuid | null;
  processor_name: string | null;
  /** Whose collection this is, carried down from the processor.
   *
   *  Required rather than optional even though it can be null, so the contract
   *  test compares it: an optional field is satisfied by an API that stopped
   *  sending it, which is exactly the failure this had — the column was joined
   *  and selected, the response model did not declare it, and the screen that
   *  asks who may own the source offered the wrong list of people. */
  is_in_house: boolean | null;
  /** Who is accountable for collection from this source.
   *
   *  `has_owner` is separate from the name so a caller can act on an unowned
   *  source without treating a missing name as meaningful — a source between
   *  owners is a normal state, not an error. */
  has_owner: boolean;
  owner_user_uuid: Uuid | null;
  owner_name: string | null;
  owner_role: Role | null;
}
