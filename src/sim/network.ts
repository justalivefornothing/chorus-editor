import type { Message, MessageKind, Transport } from '../transport/protocol'
import { isEphemeral } from '../transport/protocol'
import type { Clock } from './clock'
import type { Rng } from './rng'

/**
 * A two-ended simulated network link. Each end is a `Transport`, so the same
 * session code that talks over BroadcastChannel runs unchanged on top of it.
 *
 *   • latency (+ jitter) delays every packet; jitter can reorder packets,
 *     which is exactly what exercises the CRDT's causal buffering;
 *   • loss silently drops a fraction of packets (anti-entropy repairs them);
 *   • partition parks reliable packets in a queue until `heal()`.
 */
export type Side = 'A' | 'B'

export interface LinkConfig {
  /** Base one-way delay in milliseconds. */
  readonly latencyMs: number
  /** Jitter as a fraction of latency, 0..1 (0.25 = ±25%). */
  readonly jitter: number
  /** Packet loss probability, 0..1. */
  readonly loss: number
  readonly partitioned: boolean
}

export interface Packet {
  readonly id: number
  readonly from: Side
  readonly kind: MessageKind
  readonly departAt: number
  readonly arriveAt: number
  readonly size: number
}

export interface NetStats {
  readonly sent: number
  readonly delivered: number
  readonly dropped: number
  readonly inFlight: number
  readonly queued: number
  readonly bytes: number
}

export const DEFAULT_LINK: LinkConfig = { latencyMs: 400, jitter: 0.25, loss: 0, partitioned: false }

export function otherSide(side: Side): Side {
  return side === 'A' ? 'B' : 'A'
}

type Handler = (msg: Message) => void

export class SimNetwork {
  private config: LinkConfig
  private readonly handlers: Record<Side, Set<Handler>> = { A: new Set(), B: new Set() }
  private readonly queues: Record<Side, Message[]> = { A: [], B: [] }
  private readonly flying = new Map<number, Packet>()
  private readonly listeners = new Set<() => void>()
  private nextPacket = 1
  private sent = 0
  private delivered = 0
  private dropped = 0
  private bytes = 0
  private readonly clock: Clock
  private readonly rng: Rng

  constructor(clock: Clock, rng: Rng, config: Partial<LinkConfig> = {}) {
    this.clock = clock
    this.rng = rng
    this.config = { ...DEFAULT_LINK, ...config }
  }

  get link(): LinkConfig {
    return this.config
  }

  configure(patch: Partial<LinkConfig>): void {
    const wasPartitioned = this.config.partitioned
    this.config = { ...this.config, ...patch }
    if (wasPartitioned && !this.config.partitioned) this.heal()
    this.notify()
  }

  /** Releases every queued packet. Returns how many were released. */
  heal(): number {
    let released = 0
    for (const side of ['A', 'B'] as const) {
      const q = this.queues[side]
      this.queues[side] = []
      for (const msg of q) {
        this.launch(side, msg)
        released++
      }
    }
    if (this.config.partitioned) this.config = { ...this.config, partitioned: false }
    this.notify()
    return released
  }

  endpoint(side: Side): Transport {
    return {
      kind: `sim:${side}`,
      send: (msg) => this.send(side, msg),
      subscribe: (handler) => {
        this.handlers[side].add(handler)
        return () => this.handlers[side].delete(handler)
      },
      close: () => this.handlers[side].clear(),
    }
  }

  stats(): NetStats {
    return {
      sent: this.sent,
      delivered: this.delivered,
      dropped: this.dropped,
      inFlight: this.flying.size,
      queued: this.queues.A.length + this.queues.B.length,
      bytes: this.bytes,
    }
  }

  inFlight(): Packet[] {
    return [...this.flying.values()]
  }

  queuedFor(side: Side): number {
    return this.queues[side].length
  }

  /** Subscribe to any change in stats / config / packets. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private send(from: Side, msg: Message): void {
    this.sent++
    this.bytes += JSON.stringify(msg).length
    if (this.config.partitioned) {
      // Presence is ephemeral: a partition simply silences the peer.
      if (isEphemeral(msg)) this.dropped++
      else this.queues[from].push(msg)
      this.notify()
      return
    }
    if (this.config.loss > 0 && this.rng() < this.config.loss) {
      this.dropped++
      this.notify()
      return
    }
    this.launch(from, msg)
    this.notify()
  }

  private launch(from: Side, msg: Message): void {
    const { latencyMs, jitter } = this.config
    const wobble = jitter > 0 ? latencyMs * jitter * (2 * this.rng() - 1) : 0
    const delay = Math.max(0, latencyMs + wobble)
    const id = this.nextPacket++
    const now = this.clock.now()
    const packet: Packet = { id, from, kind: msg.k, departAt: now, arriveAt: now + delay, size: JSON.stringify(msg).length }
    this.flying.set(id, packet)
    this.clock.after(delay, () => {
      this.flying.delete(id)
      this.delivered++
      for (const handler of this.handlers[otherSide(from)]) {
        try {
          handler(msg)
        } catch (err) {
          // A misbehaving receiver must not take the link down.
          console.error('[sim] handler threw', err)
        }
      }
      this.notify()
    })
  }

  private notify(): void {
    for (const l of this.listeners) l()
  }
}
