import { RgaDoc, VersionVector, describeOp, type Applied, type DocStats, type Op, type SiteId, type Snapshot, type VersionVectorJSON } from '../crdt'
import { every, realClock, type Clock } from '../sim/clock'
import type { CursorRef, Message, PeerInfo, Transport } from '../transport/protocol'
import { Emitter } from './emitter'
import { PRESENCE_TTL_MS, PresenceTable, type PeerState } from './presence'

/** One edit in sequential coordinates: delete `remove` chars at `index`, then insert `insert`. */
export interface LocalChange {
  readonly index: number
  readonly remove: number
  readonly insert: string
}

export type TimelineDirection = 'local' | 'remote' | 'buffered'

export interface TimelineEntry {
  readonly id: number
  readonly t: number
  readonly site: SiteId
  readonly seq: number
  readonly kind: Op['t']
  readonly text: string
  readonly dir: TimelineDirection
  /** For buffered ops: a short reason, e.g. "waiting for B#4". */
  readonly note?: string
}

export interface ReplicaOptions {
  readonly peer: PeerInfo
  readonly transport: Transport
  readonly clock?: Clock
  readonly snapshot?: Snapshot | null
  readonly heartbeatMs?: number
  readonly syncEveryMs?: number
  readonly presenceTtlMs?: number
  readonly timelineLimit?: number
}

type ReplicaEvents = {
  /** Remote ops were integrated; effects must be replayed into the editor. */
  remote: [applied: readonly Applied[]]
  /** Document text changed (locally or remotely). */
  change: [source: 'local' | 'remote']
  peers: []
  timeline: []
  /** Any message went out or came in — cheap hook for stats displays. */
  traffic: [direction: 'in' | 'out', msg: Message]
}

export const TYPING_WINDOW_MS = 1000

/**
 * A replica is one participant in a room: a CRDT document, the peer's
 * identity, and the protocol glue that keeps it converged with everyone else
 * on the other end of a `Transport`.
 */
export class Replica {
  readonly doc: RgaDoc
  readonly peer: PeerInfo
  readonly presence: PresenceTable
  readonly events = new Emitter<ReplicaEvents>()
  readonly timeline: TimelineEntry[] = []

  private readonly transport: Transport
  private readonly clock: Clock
  private readonly heartbeatMs: number
  private readonly syncEveryMs: number
  private readonly timelineLimit: number
  private nextEntry = 1
  private cursor: CursorRef | null = null
  private typingUntil = -Infinity
  private lastPresenceSent = -Infinity
  private lastSyncSent = -Infinity
  private presenceTimer: (() => void) | null = null
  private typingTimer: (() => void) | null = null
  private repairTimer: (() => void) | null = null
  private cancels: Array<() => void> = []
  private running = false
  private lastSyncPeer: SiteId | null = null
  /** Last version vector each peer told us about (hello/sync), for the sync indicator. */
  private readonly peerVersions = new Map<SiteId, VersionVectorJSON>()

  constructor(opts: ReplicaOptions) {
    this.peer = opts.peer
    this.transport = opts.transport
    this.clock = opts.clock ?? realClock
    this.heartbeatMs = opts.heartbeatMs ?? 1500
    this.syncEveryMs = opts.syncEveryMs ?? 2500
    this.timelineLimit = opts.timelineLimit ?? 300
    this.presence = new PresenceTable(opts.presenceTtlMs ?? PRESENCE_TTL_MS)
    this.doc = opts.snapshot ? RgaDoc.fromSnapshot(opts.peer.site, opts.snapshot) : new RgaDoc(opts.peer.site)
  }

  get site(): SiteId {
    return this.peer.site
  }

  get isRunning(): boolean {
    return this.running
  }

  // ───────────────────────── lifecycle ─────────────────────────

  start(): void {
    if (this.running) return
    this.running = true
    this.cancels.push(this.transport.subscribe((msg) => this.handle(msg)))
    this.send({ k: 'hello', from: this.site, peer: this.peer, vv: this.doc.versionJSON() })
    this.cancels.push(every(this.clock, this.heartbeatMs, () => this.heartbeat()))
    this.cancels.push(every(this.clock, this.syncEveryMs, () => this.requestSync()))
    this.cancels.push(
      every(this.clock, 1000, () => {
        if (this.presence.expire(this.clock.now()).length > 0) this.events.emit('peers')
      }),
    )
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    this.send({ k: 'bye', from: this.site })
    for (const c of this.cancels) c()
    this.cancels = []
    this.presenceTimer?.()
    this.typingTimer?.()
    this.repairTimer?.()
    this.presenceTimer = this.typingTimer = this.repairTimer = null
    this.transport.close()
  }

  // ───────────────────────── local editing ─────────────────────────

  /** Applies edits produced by the editor and broadcasts the resulting ops. */
  applyLocal(changes: readonly LocalChange[]): Op[] {
    const ops: Op[] = []
    for (const ch of changes) {
      if (ch.remove > 0) for (const op of this.doc.localDelete(ch.index, ch.remove)) ops.push(op)
      if (ch.insert.length > 0) {
        const op = this.doc.localInsert(ch.index, ch.insert)
        if (op) ops.push(op)
      }
    }
    if (ops.length === 0) return ops
    const now = this.clock.now()
    for (const op of ops) this.record(op, 'local', now)
    this.send({ k: 'ops', from: this.site, ops })
    this.markTyping(now)
    this.events.emit('change', 'local')
    return ops
  }

  insert(index: number, text: string): Op[] {
    return this.applyLocal([{ index, remove: 0, insert: text }])
  }

  delete(index: number, length: number): Op[] {
    return this.applyLocal([{ index, remove: length, insert: '' }])
  }

  /** Updates our own caret/selection (numeric positions) and shares it. */
  setSelection(anchor: number, head: number): void {
    const ref: CursorRef = { anchor: this.doc.idAt(anchor), head: this.doc.idAt(head) }
    const prev = this.cursor
    this.cursor = ref
    if (prev && sameRef(prev.anchor, ref.anchor) && sameRef(prev.head, ref.head)) return
    this.schedulePresence(60)
  }

  get isTyping(): boolean {
    return this.clock.now() < this.typingUntil
  }

  /** Resolves a peer's item-anchored cursor into current numeric positions. */
  resolveCursor(ref: CursorRef | null): { anchor: number; head: number } | null {
    if (!ref) return null
    const anchor = this.doc.positionOf(ref.anchor)
    const head = this.doc.positionOf(ref.head)
    if (anchor === null || head === null) return null
    return { anchor, head }
  }

  peers(): PeerState[] {
    return this.presence.list()
  }

  stats(): DocStats {
    return this.doc.stats()
  }

  /** Immediately asks everyone for anything we are missing (and offers what we have). */
  requestSync(): void {
    this.lastSyncSent = this.clock.now()
    this.send({ k: 'sync', from: this.site, vv: this.doc.versionJSON() })
  }

  // ───────────────────────── incoming ─────────────────────────

  private handle(msg: Message): void {
    if (msg.from === this.site) return
    this.events.emit('traffic', 'in', msg)
    switch (msg.k) {
      case 'hello': {
        this.peerVersions.set(msg.from, msg.vv)
        this.presence.touch(msg.peer, null, false, this.clock.now())
        this.events.emit('peers')
        this.offerMissing(msg.vv)
        // Newcomers may hold ops we never saw (restored from their own storage).
        if (!this.doc.version().dominates(VersionVector.from(msg.vv))) this.requestSync()
        // Let them see us right away instead of waiting for the next heartbeat.
        this.sendPresence()
        break
      }
      case 'ops':
        this.integrate(msg.ops)
        break
      case 'sync': {
        this.peerVersions.set(msg.from, msg.vv)
        this.offerMissing(msg.vv)
        const theirs = VersionVector.from(msg.vv)
        const now = this.clock.now()
        if (!this.doc.version().dominates(theirs) && now - this.lastSyncSent > 400) {
          this.lastSyncPeer = msg.from
          this.requestSync()
        }
        break
      }
      case 'presence': {
        if (this.presence.touch(msg.peer, msg.cursor, msg.typing, this.clock.now())) this.events.emit('peers')
        break
      }
      case 'bye':
        this.peerVersions.delete(msg.from)
        if (this.presence.remove(msg.from)) this.events.emit('peers')
        break
    }
  }

  private integrate(ops: readonly Op[]): void {
    const before = this.doc.stats().pending
    const applied = this.doc.receiveMany(ops)
    const now = this.clock.now()
    const appliedKeys = new Set(applied.map((a) => a.op.site + '#' + a.op.seq))
    for (const op of ops) {
      if (appliedKeys.has(op.site + '#' + op.seq)) continue
      if (this.doc.pendingOps().includes(op)) this.record(op, 'buffered', now, this.whyPending(op))
    }
    for (const a of applied) this.record(a.op, 'remote', now)
    if (applied.length > 0) {
      this.events.emit('remote', applied)
      this.events.emit('change', 'remote')
    }
    const after = this.doc.stats().pending
    // Something is missing (lost or reordered packet): repair soon rather than
    // waiting for the periodic sync — but give in-flight packets a moment.
    if (after > 0 && after >= before && !this.repairTimer) {
      this.repairTimer = this.clock.after(600, () => {
        this.repairTimer = null
        if (this.doc.stats().pending > 0) this.requestSync()
      })
    }
  }

  private whyPending(op: Op): string {
    const have = this.doc.version().get(op.site)
    if (op.seq !== have + 1) return `waiting for ${op.site}#${have + 1}`
    if (op.t === 'i' && op.origin && !this.doc.hasItem(op.origin)) return `origin ${op.origin[0]}:${op.origin[1]} unknown`
    return 'waiting for dependencies'
  }

  private offerMissing(theirVV: Record<string, number>): void {
    const missing = this.doc.opsSince(theirVV)
    if (missing.length > 0) this.send({ k: 'ops', from: this.site, ops: missing })
  }

  // ───────────────────────── presence ─────────────────────────

  private markTyping(now: number): void {
    this.typingUntil = now + TYPING_WINDOW_MS
    this.schedulePresence(60)
    this.typingTimer?.()
    this.typingTimer = this.clock.after(TYPING_WINDOW_MS + 20, () => {
      this.typingTimer = null
      this.sendPresence()
    })
  }

  private schedulePresence(delayMs: number): void {
    if (!this.running || this.presenceTimer) return
    const since = this.clock.now() - this.lastPresenceSent
    const wait = Math.max(0, Math.min(delayMs, delayMs - since))
    this.presenceTimer = this.clock.after(wait, () => {
      this.presenceTimer = null
      this.sendPresence()
    })
  }

  private heartbeat(): void {
    this.sendPresence()
  }

  private sendPresence(): void {
    if (!this.running) return
    this.lastPresenceSent = this.clock.now()
    this.send({ k: 'presence', from: this.site, peer: this.peer, cursor: this.cursor, typing: this.isTyping })
  }

  // ───────────────────────── plumbing ─────────────────────────

  private send(msg: Message): void {
    this.transport.send(msg)
    this.events.emit('traffic', 'out', msg)
  }

  private record(op: Op, dir: TimelineDirection, t: number, note?: string): void {
    const entry: TimelineEntry = { id: this.nextEntry++, t, site: op.site, seq: op.seq, kind: op.t, text: describeOp(op), dir, note }
    this.timeline.push(entry)
    if (this.timeline.length > this.timelineLimit) this.timeline.splice(0, this.timeline.length - this.timelineLimit)
    this.events.emit('timeline')
  }

  /**
   * Sync status against the peers currently present: how many have reported
   * a version vector identical to ours in their last hello/sync message.
   */
  syncStatus(): { peers: number; inSync: number } {
    const mine = this.doc.versionString()
    let inSync = 0
    let peers = 0
    for (const p of this.presence.list()) {
      peers++
      const vv = this.peerVersions.get(p.info.site)
      if (vv && VersionVector.from(vv).toString() === mine) inSync++
    }
    return { peers, inSync }
  }

  /** Site we last asked for a repair from (debug/UI). */
  get lastRepairPeer(): SiteId | null {
    return this.lastSyncPeer
  }
}

function sameRef(a: readonly [string, number] | null, b: readonly [string, number] | null): boolean {
  if (a === null || b === null) return a === b
  return a[0] === b[0] && a[1] === b[1]
}

/** Byte-for-byte convergence check between replicas: identical text and version vectors. */
export interface ConvergenceReport {
  readonly converged: boolean
  readonly textMatch: boolean
  readonly versionMatch: boolean
  readonly pending: number
}

export function checkConvergence(docs: readonly RgaDoc[]): ConvergenceReport {
  if (docs.length < 2) return { converged: true, textMatch: true, versionMatch: true, pending: 0 }
  const text = docs[0].text()
  const version = docs[0].versionString()
  let textMatch = true
  let versionMatch = true
  let pending = 0
  for (const d of docs) {
    if (d.text() !== text) textMatch = false
    if (d.versionString() !== version) versionMatch = false
    pending += d.stats().pending
  }
  return { converged: textMatch && versionMatch && pending === 0, textMatch, versionMatch, pending }
}
