import type { SiteId } from './id'

/**
 * A version vector maps each site to the highest *contiguous* operation
 * sequence number received from that site. Because ops from one site are
 * applied in order (FIFO per site), "I have seq 7 from site X" implies I have
 * seqs 1..7 too — which is what makes delta sync (`opsSince`) a simple range.
 */
export type VersionVectorJSON = Readonly<Record<SiteId, number>>

export type VectorOrder = 'equal' | 'before' | 'after' | 'concurrent'

export class VersionVector {
  private readonly clocks = new Map<SiteId, number>()

  static from(json: VersionVectorJSON | null | undefined): VersionVector {
    const vv = new VersionVector()
    if (json) {
      for (const site of Object.keys(json)) {
        const n = json[site]
        if (typeof n === 'number' && n > 0) vv.clocks.set(site, n)
      }
    }
    return vv
  }

  get(site: SiteId): number {
    return this.clocks.get(site) ?? 0
  }

  /** Record that `seq` from `site` has been applied. Must be the next in order. */
  set(site: SiteId, seq: number): void {
    if (seq > this.get(site)) this.clocks.set(site, seq)
  }

  sites(): SiteId[] {
    return [...this.clocks.keys()].sort()
  }

  /** Pointwise maximum, returned as a new vector. Neither input is mutated. */
  merge(other: VersionVector): VersionVector {
    const out = this.clone()
    for (const [site, n] of other.clocks) out.set(site, n)
    return out
  }

  clone(): VersionVector {
    const out = new VersionVector()
    for (const [site, n] of this.clocks) out.clocks.set(site, n)
    return out
  }

  equals(other: VersionVector): boolean {
    if (this.clocks.size !== other.clocks.size) return false
    for (const [site, n] of this.clocks) if (other.get(site) !== n) return false
    return true
  }

  /** Does this vector dominate (>=) `other` on every site? */
  dominates(other: VersionVector): boolean {
    for (const [site, n] of other.clocks) if (this.get(site) < n) return false
    return true
  }

  compare(other: VersionVector): VectorOrder {
    const ge = this.dominates(other)
    const le = other.dominates(this)
    if (ge && le) return 'equal'
    if (ge) return 'after'
    if (le) return 'before'
    return 'concurrent'
  }

  /** Sum of all clocks — a cheap "how many ops do I know about" number. */
  total(): number {
    let sum = 0
    for (const n of this.clocks.values()) sum += n
    return sum
  }

  toJSON(): Record<SiteId, number> {
    const out: Record<SiteId, number> = {}
    for (const site of this.sites()) out[site] = this.clocks.get(site)!
    return out
  }

  /** Deterministic string form (sorted by site), handy for byte-for-byte comparison. */
  toString(): string {
    return this.sites()
      .map((s) => `${s}:${this.clocks.get(s)}`)
      .join(' ')
  }
}
