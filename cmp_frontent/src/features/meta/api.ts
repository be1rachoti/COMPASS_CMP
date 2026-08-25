/**
 * Reference data the console renders its dropdowns from.
 *
 * Fetched rather than hardcoded so a value added on the server appears without
 * a deploy — and so the label a user sees is the one the API would use in an
 * error message about the same field.
 */

import { apiGet } from "@/lib/api";
import type { DataCategory, EnumMap } from "@/types";

export function getEnums(): Promise<EnumMap> {
  return apiGet<EnumMap>("/meta/enums");
}

export function listDataCategories(): Promise<{ items: DataCategory[] }> {
  return apiGet<{ items: DataCategory[] }>("/meta/data-categories");
}
