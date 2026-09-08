import { describe, expect, it } from 'vitest'
import { VirtualClock } from '../sim/clock'
import { SimNetwork } from '../sim/network'
import { seededRng } from '../sim/rng'
import { runStress } from '../sim/stress'
import type { Message, Transport } from '../transport/protocol'
import { PresenceTable } from './presence'
import { checkConvergence, Replica } from './replica'

function pair(opts: { latencyMs?: number; jitter?: number; loss?: number; seed?: number } = {}) {
  const clock = new VirtualClock()
  const net = new SimNetwork(clock, seededRng(opts.seed ?? 7), {
    latencyMs: opts.latencyMs ?? 300,
    jitter: opts.jitter ?? 0.5,
    loss: opts.loss ?? 0,
  })
  const a = new Replica({ peer: { site: 'A', name: 'Ada', color: '#5eead4' }, transport: net.endpoint('A'), clock })
  const b = new Replica({ peer: { site: 'B', name: 'Grace', color: '#f472b6' }, transport: net.endpoint('B'), clock })
  a.start()
  b.start()
  return { clock, net, a, b }
}

describe('Replica over a simulated network', () => {
  it('syncs edits both ways under latency and jitter', () => {
    const { clock, a, b } = pair({ latencyMs: 500, jitter: 0.8 })
    a.insert(0, 'function ')
    b.insert(0, 'export ')
    clock.advance(50)
    a.insert(9, 'main() {}')
    clock.advance(3000)
    const report = checkConvergence([a.doc, b.doc])
    expect(report.converged).toBe(true)
    expect(a.doc.text()).toContain('function main() {}')
    expect(a.doc.text()).toContain('export ')
  })

  it('queues ops during a partition and converges after heal', () => {
    const { clock, net, a, b } = pair({ latencyMs: 200 })
    a.insert(0, 'shared')
    clock.advance(1000)
    expect(b.doc.text()).toBe('shared')

    net.configure({ partitioned: true })
    a.insert(6, ' from A')
    b.insert(0, 'B says: ')
    clock.advance(2000)
    // Nothing crosses the partition.
    expect(a.doc.text()).toBe('shared from A')
    expect(b.doc.text()).toBe('B says: shared')
    expect(net.stats().queued).toBeGreaterThan(0)
    expect(checkConvergence([a.doc, b.doc]).converged).toBe(false)

    net.heal()
    expect(net.link.partitioned).toBe(false)
    clock.advance(2000)
    const report = checkConvergence([a.doc, b.doc])
    expect(report.converged).toBe(true)
    expect(a.doc.text()).toBe('B says: shared from A')
  })

  it('repairs lost packets via version-vector anti-entropy', () => {
    const { clock, a, b } = pair({ latencyMs: 100, loss: 0.5, seed: 3 })
    for (let i = 0; i < 20; i++) {
      a.insert(a.doc.length, 'a')
      b.insert(0, 'b')
      clock.advance(60)
    }
    clock.advance(15_000)
    const report = checkConvergence([a.doc, b.doc])
    expect(report.converged).toBe(true)
    expect(a.doc.length).toBe(40)
  })

  it('buffers an out-of-order dependent op and records it in the timeline', () => {
    const clock = new VirtualClock()
    // A hand-rolled transport with controllable delivery so we can reorder.
    const inboxB: Message[] = []
    const handlersB = new Set<(m: Message) => void>()
    const tA: Transport = { kind: 'x', send: (m) => inboxB.push(m), subscribe: () => () => {}, close() {} }
    const tB: Transport = {
      kind: 'x',
      send: () => {},
      subscribe: (h) => {
        handlersB.add(h)
        return () => handlersB.delete(h)
      },
      close() {},
    }
    const a = new Replica({ peer: { site: 'A', name: 'Ada', color: '#fff' }, transport: tA, clock })
    const b = new Replica({ peer: { site: 'B', name: 'Bo', color: '#fff' }, transport: tB, clock })
    a.start()
    b.start()
    const first = a.insert(0, 'x')[0]
    const second = a.insert(1, 'y')[0]
    for (const h of handlersB) h({ k: 'ops', from: 'A', ops: [second] })
    expect(b.doc.text()).toBe('')
    expect(b.doc.stats().pending).toBe(1)
    expect(b.timeline.at(-1)?.dir).toBe('buffered')
    expect(b.timeline.at(-1)?.note).toContain('waiting for A#1')
    for (const h of handlersB) h({ k: 'ops', from: 'A', ops: [first] })
    expect(b.doc.text()).toBe('xy')
    expect(b.doc.stats().pending).toBe(0)
    expect(b.timeline.filter((e) => e.dir === 'remote')).toHaveLength(2)
    a.stop()
    b.stop()
  })

  it('late joiner catches up from the hello handshake', () => {
    const clock = new VirtualClock()
    const net = new SimNetwork(clock, seededRng(1), { latencyMs: 100, jitter: 0 })
    const a = new Replica({ peer: { site: 'A', name: 'Ada', color: '#fff' }, transport: net.endpoint('A'), clock })
    a.start()
    a.insert(0, 'already here')
    clock.advance(500)
    const b = new Replica({ peer: { site: 'B', name: 'Bo', color: '#fff' }, transport: net.endpoint('B'), clock })
    b.start()
    clock.advance(1000)
    expect(b.doc.text()).toBe('already here')
    expect(checkConvergence([a.doc, b.doc]).converged).toBe(true)
  })

  it('shares item-anchored cursors that survive concurrent edits', () => {
    const { clock, a, b } = pair({ latencyMs: 100, jitter: 0 })
    a.insert(0, 'hello world')
    clock.advance(500)
    // B puts its caret after 'hello' (index 5).
    b.setSelection(5, 5)
    clock.advance(500)
    const peerB = a.peers().find((p) => p.info.site === 'B')!
    expect(peerB).toBeDefined()
    expect(a.resolveCursor(peerB.cursor)).toEqual({ anchor: 5, head: 5 })
    // A inserts text before B's caret: the resolved position shifts with the text.
    a.insert(0, '>> ')
    expect(a.resolveCursor(peerB.cursor)).toEqual({ anchor: 8, head: 8 })
  })

  it('expires silent peers after the presence TTL', () => {
    const { clock, net, a, b } = pair({ latencyMs: 50, jitter: 0 })
    clock.advance(500)
    expect(a.peers().map((p) => p.info.site)).toEqual(['B'])
    // Partition drops presence (ephemeral), so A stops hearing from B.
    net.configure({ partitioned: true })
    clock.advance(4000)
    expect(a.peers()).toHaveLength(1)
    clock.advance(2500)
    expect(a.peers()).toHaveLength(0)
    expect(b.peers()).toHaveLength(0)
  })

  it('stress: 500 random ops on both replicas under lag converge', async () => {
    const { clock, a, b } = pair({ latencyMs: 250, jitter: 0.6, loss: 0.05, seed: 11 })
    const run = runStress([a, b], clock, { ops: 500, seed: 42, burst: 5, gapMs: 30 })
    // Drive the virtual clock until the promise settles.
    let result: Awaited<typeof run.promise> | null = null
    void run.promise.then((r) => (result = r))
    for (let i = 0; i < 400 && result === null; i++) {
      clock.advance(100)
      await Promise.resolve()
    }
    expect(result).not.toBeNull()
    const r = result!
    expect(r.ops).toBe(500)
    expect(r.inserts + r.deletes).toBe(500)
    expect(r.converged).toBe(true)
    expect(a.doc.text()).toBe(b.doc.text())
    expect(a.doc.versionString()).toBe(b.doc.versionString())
  })
})

describe('PresenceTable', () => {
  it('touch/expire lifecycle', () => {
    const t = new PresenceTable(1000)
    const info = { site: 'X', name: 'Xe', color: '#000' }
    expect(t.touch(info, null, false, 0)).toBe(true)
    expect(t.touch(info, null, false, 100)).toBe(false)
    expect(t.touch(info, { anchor: null, head: null }, false, 200)).toBe(true)
    expect(t.get('X')?.movedAt).toBe(200)
    expect(t.expire(1100)).toEqual([])
    expect(t.expire(1201)).toEqual(['X'])
    expect(t.size).toBe(0)
  })
})

describe('checkConvergence', () => {
  it('reports text and version mismatches separately', () => {
    const { a, b } = pair()
    a.doc.localInsert(0, 'x')
    const r = checkConvergence([a.doc, b.doc])
    expect(r.converged).toBe(false)
    expect(r.textMatch).toBe(false)
    expect(r.versionMatch).toBe(false)
    b.doc.receiveMany(a.doc.opsSince(b.doc.version()))
    expect(checkConvergence([a.doc, b.doc]).converged).toBe(true)
  })
})
