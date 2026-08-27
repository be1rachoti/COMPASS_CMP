/**
 * Every request the registry feature makes.
 *
 * Purposes, processors and data sources are the reference data consent is given
 * *against*. Nothing here deletes: a purpose that was consented to has to
 * remain resolvable for as long as the consent does, so the lifecycle is
 * draft -> active -> retired, and a retired purpose is still readable.
 */

import { apiGet, apiPost, apiPut, queryString } from "@/lib/api";
import type {
  Acknowledged,
  DataSource,
  Page,
  Processor,
  Purpose,
  PurposeUsageEntry,
  Uuid,
} from "@/types";

/**
 * Where a purpose is in use, and whether it may be retired.
 *
 * `retirable` is the server's verdict, not a count the console interprets. A
 * purpose on a published notice cannot be retired, and deciding that here would
 * put the rule in two places.
 */
export interface PurposeUsage {
  items: PurposeUsageEntry[];
  retirable: boolean;
  total: number;
}

/* ----------------------------------------------------------------- reads */

export function listPurposes(filters: Record<string, unknown> = {}): Promise<Page<Purpose>> {
  return apiGet<Page<Purpose>>(`/purposes${queryString(filters)}`);
}

export function getPurpose(uuid: Uuid): Promise<Purpose> {
  return apiGet<Purpose>(`/purposes/${uuid}`);
}

/**
 * Where this purpose is in use.
 *
 * The question a DPO asks before retiring one: retiring a purpose that is on a
 * published notice would leave that notice referring to something withdrawn.
 */
export function getPurposeUsage(uuid: Uuid): Promise<PurposeUsage> {
  return apiGet<PurposeUsage>(`/purposes/${uuid}/usage`);
}

/** Earlier versions. A consent points at the version it was given against. */
export function listPurposeVersions(uuid: Uuid): Promise<Purpose[]> {
  return apiGet<Purpose[]>(`/purposes/${uuid}/versions`);
}

export function listProcessors(filters: Record<string, unknown> = {}): Promise<Page<Processor>> {
  return apiGet<Page<Processor>>(`/processors${queryString(filters)}`);
}

export function listSources(filters: Record<string, unknown> = {}): Promise<Page<DataSource>> {
  return apiGet<Page<DataSource>>(`/sources${queryString(filters)}`);
}

/* ---------------------------------------------------------------- writes */

export interface PurposeInput {
  purpose_code: string;
  name: string;
  description: string;
  uses: string;
  lawful_basis: string;
  s7_clause?: string | null;
  data_categories: string[];
  retention_days: number;
  retention_basis: string;
  erasure_trigger: string;
  consent_validity_days?: number | null;
  cross_border_permitted: boolean;
  permitted_for_minors: boolean;
  lapse_behaviour: string;
}

export interface ProcessorInput {
  legal_name: string;
  type: string;
  contract_ref: string;
  security_confirmed_at: string;
}

export interface SourceInput {
  source_code: string;
  name: string;
  source_role: string;
  exchange_mode: string;
  id_scheme?: string | null;
  processor_uuid?: string | null;
  is_authoritative_for: string[];
}

export function createPurpose(body: PurposeInput): Promise<Purpose> {
  return apiPost<Purpose>("/purposes", body);
}

export function updatePurpose(uuid: Uuid, body: Partial<PurposeInput>): Promise<Purpose> {
  return apiPut<Purpose>(`/purposes/${uuid}`, body);
}

/** Draft -> active. After this the purpose may appear on a notice. */
export function activatePurpose(uuid: Uuid): Promise<Acknowledged> {
  return apiPost<Acknowledged>(`/purposes/${uuid}/activate`);
}

/** Active -> retired. Existing consents keep pointing at it. */
export function retirePurpose(uuid: Uuid): Promise<Acknowledged> {
  return apiPost<Acknowledged>(`/purposes/${uuid}/retire`);
}

export function createProcessor(body: ProcessorInput): Promise<Processor> {
  return apiPost<Processor>("/processors", body);
}

export function updateProcessor(uuid: Uuid, body: Partial<ProcessorInput>): Promise<Processor> {
  return apiPut<Processor>(`/processors/${uuid}`, body);
}

export function suspendProcessor(uuid: Uuid): Promise<Acknowledged> {
  return apiPost<Acknowledged>(`/processors/${uuid}/suspend`);
}

export function createSource(body: SourceInput): Promise<DataSource> {
  return apiPost<DataSource>("/sources", body);
}

export function updateSource(uuid: Uuid, body: Partial<SourceInput>): Promise<DataSource> {
  return apiPut<DataSource>(`/sources/${uuid}`, body);
}

/** Who is accountable for this source, and how many projects moved with it. */
export interface SourceOwnerAssigned extends DataSource {
  /** Reassigning a rig used by three studies moves three studies. Worth seeing
   *  rather than discovering. */
  projects_moved: number;
}

/**
 * Hand a source to a DCO or an RCO, or take it back with `null`.
 *
 * The only place a person is named. Everywhere else — registering a site,
 * routing an approved project — picks a source, and the owner comes with it, so
 * there is one answer to "who is accountable for CIT" rather than one per
 * project that used it.
 */
export function assignSourceOwner(
  uuid: Uuid,
  ownerUserUuid: Uuid | null,
): Promise<SourceOwnerAssigned> {
  return apiPut<SourceOwnerAssigned>(`/sources/${uuid}/owner`, {
    owner_user_uuid: ownerUserUuid,
  });
}

export function suspendSource(uuid: Uuid): Promise<Acknowledged> {
  return apiPost<Acknowledged>(`/sources/${uuid}/suspend`);
}
