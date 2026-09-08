import { create } from 'zustand'
import type { PeerState } from '../session/presence'
import type { Replica } from '../session/replica'

/**
 * Presence UI state, keyed by the *local* replica's site id so that the
 * split-view lab can show two independent peer lists at once.
 */
export interface PresenceSlice {
  /** Remote peers as seen by each local replica. */
  peers: Record<string, readonly PeerState[]>
  /** Whether each local replica is currently typing (drives the avatar pulse). */
  typing: Record<string, boolean>
  /** Monotonic tick bumped when any peer moves — lets cursor layers re-resolve. */
  tick: number
  setPeers(site: string, peers: readonly PeerState[]): void
  setTyping(site: string, typing: boolean): void
  forget(site: string): void
}

export const usePresenceStore = create<PresenceSlice>((set) => ({
  peers: {},
  typing: {},
  tick: 0,
  setPeers: (site, peers) => set((s) => ({ peers: { ...s.peers, [site]: peers }, tick: s.tick + 1 })),
  setTyping: (site, typing) =>
    set((s) => (s.typing[site] === typing ? s : { typing: { ...s.typing, [site]: typing } })),
  forget: (site) =>
    set((s) => {
      const peers = { ...s.peers }
      const typing = { ...s.typing }
      delete peers[site]
      delete typing[site]
      return { peers, typing }
    }),
}))

const EMPTY: readonly PeerState[] = []

export function usePeers(site: string): readonly PeerState[] {
  return usePresenceStore((s) => s.peers[site] ?? EMPTY)
}

export function useTyping(site: string): boolean {
  return usePresenceStore((s) => s.typing[site] ?? false)
}

/**
 * Mirrors a replica's presence table into the store. Returns an unsubscribe
 * function. Typing state is polled because it is time-based (a peer stops
 * "typing" when the window elapses, not on an event).
 */
export function bindPresence(replica: Replica, intervalMs = 250): () => void {
  const { setPeers, setTyping, forget } = usePresenceStore.getState()
  const push = () => setPeers(replica.site, replica.peers())
  push()
  const offPeers = replica.events.on('peers', push)
  const offChange = replica.events.on('change', () => setTyping(replica.site, replica.isTyping))
  const timer = setInterval(() => {
    setTyping(replica.site, replica.isTyping)
    // Cursor flags fade on a timer too, so nudge subscribers periodically.
    if (replica.peers().length > 0) push()
  }, intervalMs)
  return () => {
    offPeers()
    offChange()
    clearInterval(timer)
    forget(replica.site)
  }
}
