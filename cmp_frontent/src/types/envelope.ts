/**
 * The two shapes every response takes.
 *
 * Every list is a `Page<T>`, cursor-paginated. There is no `offset` anywhere in
 * this API, and none should appear here: offset pagination silently skips or
 * repeats rows when the underlying set changes between pages, which it does
 * during a collection campaign.
 */

export interface Page<T> {
  items: T[];
  /** Opaque and signed. Pass back as `?cursor=`; never construct one. */
  next_cursor: string | null;
  total: number | null;
}

export interface Acknowledged {
  ok: boolean;
  message?: string | null;
}
