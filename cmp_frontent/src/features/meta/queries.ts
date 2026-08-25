/**
 * Reference data the console renders its dropdowns from.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { ApiError } from "@/lib/errors";
import { keys, type Options } from "@/lib/query";
import type { DataCategory, EnumMap } from "@/types";

export function useEnums(options?: Options<EnumMap>) {
  return useQuery<EnumMap, ApiError>({
    queryKey: keys.meta.enums,
    queryFn: () => apiGet<EnumMap>("/meta/enums"),
    // Reference data. It changes when the backend deploys, not while somebody
    // is filling in a form.
    staleTime: 60 * 60_000,
    ...options,
  });
}

export function useDataCategories() {
  return useQuery<{ items: DataCategory[] }, ApiError>({
    queryKey: keys.meta.dataCategories,
    queryFn: () => apiGet<{ items: DataCategory[] }>("/meta/data-categories"),
    staleTime: 60 * 60_000,
  });
}
