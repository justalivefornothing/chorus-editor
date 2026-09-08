import { Replica } from '../session/replica'
import type { PeerInfo } from '../transport/protocol'
import { realClock, type Clock } from './clock'
import { SimNetwork, type LinkConfig, type Side } from './network'
import { seededRng } from './rng'
import { runStress, type StressOptions, type StressResult } from './stress'

export const LAB_PEERS: Readonly<Record<Side, PeerInfo>> = {
  A: { site: 'ada', name: 'Ada', color: '#5eead4' },
  B: { site: 'grace', name: 'Grace', color: '#f472b6' },
}

export interface LabOptions {
  readonly clock?: Clock
  readonly seed?: number
  readonly link?: Partial<LinkConfig>
  /** Initial text typed into replica A before B connects. */
  readonly seedText?: string
}

/**
 * Two replicas on one page joined by a simulated link. This is the
 * "split-view demo": everything the network does is observable and tweakable.
 */
export class Lab {
  readonly clock: Clock
  readonly network: SimNetwork
  readonly a: Replica
  readonly b: Replica
  private stress: { cancel: () => void } | null = null

  constructor(opts: LabOptions = {}) {
    this.clock = opts.clock ?? realClock
    this.network = new SimNetwork(this.clock, seededRng(opts.seed ?? 1337), { latencyMs: 600, jitter: 0.3, loss: 0, ...opts.link })
    this.a = new Replica({ peer: LAB_PEERS.A, transport: this.network.endpoint('A'), clock: this.clock, heartbeatMs: 1000 })
    this.b = new Replica({ peer: LAB_PEERS.B, transport: this.network.endpoint('B'), clock: this.clock, heartbeatMs: 1000 })
  }

  get replicas(): readonly [Replica, Replica] {
    return [this.a, this.b]
  }

  start(seedText?: string): void {
    this.a.start()
    if (seedText && this.a.doc.length === 0) this.a.insert(0, seedText)
    this.b.start()
  }

  stop(): void {
    this.stress?.cancel()
    this.a.stop()
    this.b.stop()
  }

  configure(patch: Partial<LinkConfig>): void {
    this.network.configure(patch)
  }

  heal(): number {
    return this.network.heal()
  }

  get isStressing(): boolean {
    return this.stress !== null
  }

  /** Runs the stress test; resolves with the convergence report. */
  runStress(opts: StressOptions = {}): Promise<StressResult> {
    this.stress?.cancel()
    const run = runStress([this.a, this.b], this.clock, { ops: 500, ...opts })
    this.stress = run
    return run.promise.finally(() => {
      if (this.stress === run) this.stress = null
    })
  }

  cancelStress(): void {
    this.stress?.cancel()
    this.stress = null
  }
}
