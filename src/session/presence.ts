import type { SiteId } from '../crdt'
import type { CursorRef, PeerInfo } from '../transport/protocol'

export interface PeerState {
  readonly info: PeerInfo
  readonly cursor: CursorRef | null
  readonly typing: boolean
  /** Local clock time of the last heartbeat. */
  readonly lastSeen: number
  /** Local clock time the cursor last moved (drives the name-flag fade). */
  readonly movedAt: number
}

export const PRESENCE_TTL_MS = 5000

/**
 * Pure bookkeeping for who is in the room. Peers are refreshed by heartbeats
 * and dropped once they have been silent for `ttlMs`.
 */
export class PresenceTable {
  private readonly peers = new Map<SiteId, PeerState>()

  constructor(private readonly ttlMs: number = PRESENCE_TTL_MS) {}

  get size(): number {
    return this.peers.size
  }

  get(site: SiteId): PeerState | undefined {
    return this.peers.get(site)
  }

  list(): PeerState[] {
    return [...this.peers.values()].sort((a, b) => (a.info.name < b.info.name ? -1 : a.info.name > b.info.name ? 1 : 0))
  }

  /** Records a heartbeat/presence update. Returns true when something visible changed. */
  touch(info: PeerInfo, cursor: CursorRef | null, typing: boolean, now: number): boolean {
    const prev = this.peers.get(info.site)
    const moved = !prev || !sameCursor(prev.cursor, cursor)
    const next: PeerState = {
      info,
      cursor,
      typing,
      lastSeen: now,
      movedAt: moved ? now : prev.movedAt,
    }
    this.peers.set(info.site, next)
    return !prev || moved || prev.typing !== typing || prev.info.name !== info.name || prev.info.color !== info.color
  }

  remove(site: SiteId): boolean {
    return this.peers.delete(site)
  }

  /** Drops silent peers. Returns the removed site ids. */
  expire(now: number): SiteId[] {
    const gone: SiteId[] = []
    for (const [site, p] of this.peers) {
      if (now - p.lastSeen > this.ttlMs) {
        this.peers.delete(site)
        gone.push(site)
      }
    }
    return gone
  }

  clear(): void {
    this.peers.clear()
  }
}

export function sameCursor(a: CursorRef | null, b: CursorRef | null): boolean {
  if (a === null || b === null) return a === b
  return sameRef(a.anchor, b.anchor) && sameRef(a.head, b.head)
}

function sameRef(a: readonly [string, number] | null, b: readonly [string, number] | null): boolean {
  if (a === null || b === null) return a === b
  return a[0] === b[0] && a[1] === b[1]
}
