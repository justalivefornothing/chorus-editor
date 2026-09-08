import { PEER_COLORS } from '../session/identity'
import type { Replica } from '../session/replica'

/** Stable fallback colour for a site id we have never seen presence for. */
export function hashColor(site: string): string {
  let h = 0
  for (let i = 0; i < site.length; i++) h = (h * 31 + site.charCodeAt(i)) >>> 0
  return PEER_COLORS[h % PEER_COLORS.length]
}

/** Builds a site -> colour lookup from every replica's own identity and known peers. */
export function makeColorFor(replicas: readonly Replica[]): (site: string) => string {
  const map = new Map<string, string>()
  for (const r of replicas) {
    map.set(r.site, r.peer.color)
    for (const p of r.peers()) map.set(p.info.site, p.info.color)
  }
  return (site) => map.get(site) ?? hashColor(site)
}
