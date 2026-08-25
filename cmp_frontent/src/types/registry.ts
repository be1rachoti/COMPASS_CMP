/**
 * Purposes, processors and data sources — the reference data consent is given
 * *against*, which is why none of it is deletable.
 */

import type { LawfulBasis, PurposeStatus, RecordStatus, S7Clause } from "@/types/enums";
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
  processor_uuid?: Uuid | null;
  processor_name?: string | null;
}
