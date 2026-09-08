/**
 * Item identifiers for the RGA sequence.
 *
 * Every character ever inserted gets a globally unique id made of the site
 * that created it and that site's Lamport counter at creation time. Lamport
 * counters give us the property RGA depends on: an item always has a larger
 * counter than the item it was inserted after (its origin), because the
 * inserting site must have observed the origin first.
 */
export type SiteId = string

export type ItemId = readonly [site: SiteId, counter: number]

/** Canonical string form used as a Map key: `site:counter`. */
export function idKey(id: ItemId): string {
  return id[0] + ':' + id[1]
}

export function keyOf(site: SiteId, counter: number): string {
  return site + ':' + counter
}

export function sameId(a: ItemId | null, b: ItemId | null): boolean {
  if (a === null || b === null) return a === b
  return a[1] === b[1] && a[0] === b[0]
}

/**
 * Total order over ids: higher Lamport counter wins, ties are broken by the
 * site id (plain string comparison). Returns >0 when `a` sorts after `b`.
 */
export function compareIds(aSite: SiteId, aCtr: number, bSite: SiteId, bCtr: number): number {
  if (aCtr !== bCtr) return aCtr - bCtr
  if (aSite === bSite) return 0
  return aSite < bSite ? -1 : 1
}

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'

/** Short random site id (5 chars, ~33 bits). */
export function randomSiteId(random: () => number = Math.random): string {
  let out = ''
  for (let i = 0; i < 5; i++) out += ALPHABET[Math.floor(random() * ALPHABET.length)]
  return out
}
