/**
 * Reference data the console renders its dropdowns from, fetched rather than
 * hardcoded so a value added on the server appears without a deploy.
 */

export interface EnumValue {
  value: string;
  label: string;
}

export type EnumMap = Record<string, EnumValue[]>;

export interface DataCategory {
  value: string;
  label: string;
  group: string;
}
