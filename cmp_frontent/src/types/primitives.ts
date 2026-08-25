/**
 * The three scalar types every other type is built from.
 *
 * Kept apart because every module here imports them and nothing else, so this
 * file can never participate in a cycle.
 */

export type Uuid = string;
/** ISO-8601 with offset. Always parse with `new Date(...)`, never slice. */
export type Timestamp = string;
export type DateOnly = string;
