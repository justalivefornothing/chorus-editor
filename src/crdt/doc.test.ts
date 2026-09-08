import { describe, expect, it } from 'vitest'
import { RgaDoc } from './doc'
import { compareIds } from './id'
import { decodeOp, decodeOps, encodeOp, encodeOps, opFromJSON, type Op } from './ops'
import { VersionVector } from './version-vector'

/** Deliver every op from `from` to `to` in the order given. */
function deliver(to: RgaDoc, ops: readonly Op[]): void {
  to.receiveMany(ops)
}

describe('ids', () => {
  it('orders by Lamport counter first, then site id', () => {
    expect(compareIds('A', 1, 'B', 2)).toBeLessThan(0)
    expect(compareIds('A', 3, 'B', 2)).toBeGreaterThan(0)
    expect(compareIds('A', 2, 'B', 2)).toBeLessThan(0)
    expect(compareIds('B', 2, 'A', 2)).toBeGreaterThan(0)
    expect(compareIds('A', 2, 'A', 2)).toBe(0)
  })
})

describe('RgaDoc local editing', () => {
  it('inserts and deletes text sequentially', () => {
    const d = new RgaDoc('A')
    d.localInsert(0, 'hello')
    expect(d.text()).toBe('hello')
    d.localInsert(5, ' world')
    expect(d.text()).toBe('hello world')
    d.localDelete(0, 6)
    expect(d.text()).toBe('world')
    d.localInsert(2, 'XY')
    expect(d.text()).toBe('woXYrld')
    expect(d.length).toBe(7)
  })

  it('tracks live items vs tombstones in stats', () => {
    const d = new RgaDoc('A')
    d.localInsert(0, 'abcdef')
    d.localDelete(1, 3)
    expect(d.text()).toBe('aef')
    const s = d.stats()
    expect(s.live).toBe(3)
    expect(s.tombstones).toBe(3)
    expect(s.pending).toBe(0)
  })

  it('rejects out-of-range edits', () => {
    const d = new RgaDoc('A')
    d.localInsert(0, 'abc')
    expect(() => d.localInsert(5, 'x')).toThrow(RangeError)
    expect(() => d.localDelete(2, 5)).toThrow(RangeError)
  })

  it('returns null for empty inserts and no ops for empty deletes', () => {
    const d = new RgaDoc('A')
    expect(d.localInsert(0, '')).toBeNull()
    expect(d.localDelete(0, 0)).toEqual([])
  })

  it('splits a delete spanning items from different sites into multiple ops', () => {
    const a = new RgaDoc('A')
    const b = new RgaDoc('B')
    const opA = a.localInsert(0, 'aa')!
    deliver(b, [opA])
    const opB = b.localInsert(2, 'bb')!
    deliver(a, [opB])
    expect(a.text()).toBe('aabb')
    const dels = a.localDelete(1, 2) // deletes 'a' from A and 'b' from B
    expect(dels).toHaveLength(2)
    expect(dels[0].target[0]).toBe('A')
    expect(dels[1].target[0]).toBe('B')
    deliver(b, dels)
    expect(b.text()).toBe(a.text())
  })
})

describe('integrate(): concurrent inserts at the same origin', () => {
  it('orders concurrent inserts deterministically regardless of delivery order', () => {
    const a = new RgaDoc('A')
    const b = new RgaDoc('B')
    const c = new RgaDoc('C')
    // Both insert at the head concurrently.
    const opA = a.localInsert(0, 'aaa')!
    const opB = b.localInsert(0, 'bbb')!
    const opC = c.localInsert(0, 'ccc')!
    // Deliver in different orders.
    deliver(a, [opB, opC])
    deliver(b, [opC, opA])
    deliver(c, [opA, opB])
    expect(a.text()).toBe(b.text())
    expect(b.text()).toBe(c.text())
    // Same Lamport counter (1) — tie broken by site id descending => 'ccc' first? No:
    // integrate walks right while cur.id > new.id, so higher ids come first.
    expect(a.text()).toBe('cccbbbaaa')
  })

  it('places an insert with a higher Lamport counter before one with a lower counter at the same origin', () => {
    const a = new RgaDoc('A')
    const b = new RgaDoc('B')
    const base = a.localInsert(0, 'x')!
    deliver(b, [base])
    // A types more, bumping its clock; B inserts once. Both after 'x'.
    a.localInsert(1, '1')
    a.localDelete(1, 1) // A's clock is now 2
    const opA = a.localInsert(1, 'A')! // ctr 3
    const opB = b.localInsert(1, 'B')! // ctr 2
    expect(opA.ctr).toBeGreaterThan(opB.ctr)
    deliver(a, [opB])
    deliver(b, [...a.opsSince(b.version())])
    expect(a.text()).toBe(b.text())
    expect(a.text()).toBe('xAB')
  })

  it('keeps a run inserted after a concurrent sibling contiguous', () => {
    const a = new RgaDoc('A')
    const b = new RgaDoc('B')
    const base = a.localInsert(0, 'ab')!
    deliver(b, [base])
    const opA = a.localInsert(1, 'XYZ')! // between a and b
    const opB = b.localInsert(1, 'pq')! // also between a and b
    deliver(a, [opB])
    deliver(b, [opA])
    expect(a.text()).toBe(b.text())
    // Both runs must stay contiguous.
    expect(a.text()).toMatch(/^a(XYZpq|pqXYZ)b$/)
  })

  it('applyInsert is idempotent when the same op arrives twice', () => {
    const a = new RgaDoc('A')
    const b = new RgaDoc('B')
    const op = a.localInsert(0, 'hi')!
    expect(b.receive(op)).toHaveLength(1)
    expect(b.receive(op)).toHaveLength(0)
    expect(b.text()).toBe('hi')
    expect(b.stats().live).toBe(2)
  })
})

describe('tombstone deletes', () => {
  it('marks items deleted without removing them so concurrent inserts still resolve', () => {
    const a = new RgaDoc('A')
    const b = new RgaDoc('B')
    const base = a.localInsert(0, 'abc')!
    deliver(b, [base])
    // A deletes 'b'; B concurrently inserts after 'b'.
    const del = a.localDelete(1, 1)
    const ins = b.localInsert(2, 'Z')!
    deliver(a, [ins])
    deliver(b, del)
    expect(a.text()).toBe('aZc')
    expect(b.text()).toBe('aZc')
    expect(a.stats().tombstones).toBe(1)
    expect(b.stats().tombstones).toBe(1)
  })

  it('concurrent deletes of the same item converge with one tombstone', () => {
    const a = new RgaDoc('A')
    const b = new RgaDoc('B')
    const base = a.localInsert(0, 'abc')!
    deliver(b, [base])
    const delA = a.localDelete(1, 1)
    const delB = b.localDelete(1, 1)
    deliver(a, delB)
    deliver(b, delA)
    expect(a.text()).toBe('ac')
    expect(b.text()).toBe('ac')
    expect(a.stats().tombstones).toBe(1)
    expect(a.versionString()).toBe(b.versionString())
  })

  it('produces minimal effects in sequential coordinates for remote deletes', () => {
    const a = new RgaDoc('A')
    const b = new RgaDoc('B')
    const base = a.localInsert(0, 'abcdef')!
    deliver(b, [base])
    const del = a.localDelete(1, 2) // remove 'bc'
    const applied = b.receiveMany(del)
    expect(applied).toHaveLength(1)
    expect(applied[0].effects).toEqual([{ kind: 'delete', index: 1, length: 2 }])
    expect(b.text()).toBe('adef')
  })
})

describe('causal buffering', () => {
  it('parks an insert whose origin is unknown until the origin arrives', () => {
    const a = new RgaDoc('A')
    const b = new RgaDoc('B')
    const op1 = a.localInsert(0, 'x')!
    const op2 = a.localInsert(1, 'y')! // origin is x
    // Deliver out of order.
    expect(b.receive(op2)).toHaveLength(0)
    expect(b.stats().pending).toBe(1)
    expect(b.text()).toBe('')
    const applied = b.receive(op1)
    expect(applied.map((x) => x.op.seq)).toEqual([1, 2])
    expect(b.stats().pending).toBe(0)
    expect(b.text()).toBe('xy')
  })

  it('parks a delete whose target is unknown', () => {
    const a = new RgaDoc('A')
    const b = new RgaDoc('B')
    const c = new RgaDoc('C')
    const ins = a.localInsert(0, 'abc')!
    deliver(b, [ins])
    const del = b.localDelete(0, 1)
    // C gets the delete before the insert.
    expect(c.receiveMany(del)).toHaveLength(0)
    expect(c.stats().pending).toBe(1)
    c.receive(ins)
    expect(c.stats().pending).toBe(0)
    expect(c.text()).toBe('bc')
  })

  it('enforces per-site FIFO order (seq gaps wait)', () => {
    const a = new RgaDoc('A')
    const b = new RgaDoc('B')
    const op1 = a.localInsert(0, 'p')!
    const op2 = a.localInsert(0, 'q')! // also at head, no origin dep
    const op3 = a.localInsert(0, 'r')!
    b.receive(op3)
    b.receive(op2)
    expect(b.text()).toBe('')
    expect(b.stats().pending).toBe(2)
    b.receive(op1)
    expect(b.text()).toBe(a.text())
    expect(b.stats().pending).toBe(0)
  })

  it('isReady reports readiness correctly', () => {
    const a = new RgaDoc('A')
    const b = new RgaDoc('B')
    const op1 = a.localInsert(0, 'x')!
    const op2 = a.localInsert(1, 'y')!
    expect(b.isReady(op2)).toBe(false)
    expect(b.isReady(op1)).toBe(true)
    b.receive(op1)
    expect(b.isReady(op2)).toBe(true)
  })

  it('ignores duplicates of a pending op', () => {
    const a = new RgaDoc('A')
    const b = new RgaDoc('B')
    a.localInsert(0, 'x')
    const op2 = a.localInsert(1, 'y')!
    b.receive(op2)
    b.receive(op2)
    expect(b.stats().pending).toBe(1)
  })
})

describe('version vectors', () => {
  it('merges as a pointwise maximum', () => {
    const v1 = VersionVector.from({ A: 3, B: 1 })
    const v2 = VersionVector.from({ B: 4, C: 2 })
    const m = v1.merge(v2)
    expect(m.toJSON()).toEqual({ A: 3, B: 4, C: 2 })
    // Inputs untouched.
    expect(v1.toJSON()).toEqual({ A: 3, B: 1 })
    expect(v2.toJSON()).toEqual({ B: 4, C: 2 })
  })

  it('compares vectors', () => {
    const v1 = VersionVector.from({ A: 3, B: 1 })
    const v2 = VersionVector.from({ A: 3, B: 2 })
    const v3 = VersionVector.from({ A: 4, B: 1 })
    expect(v1.compare(v1.clone())).toBe('equal')
    expect(v1.compare(v2)).toBe('before')
    expect(v2.compare(v1)).toBe('after')
    expect(v2.compare(v3)).toBe('concurrent')
    expect(v1.equals(v1.clone())).toBe(true)
    expect(v1.equals(v2)).toBe(false)
  })

  it('serialises deterministically', () => {
    const v = VersionVector.from({ Z: 1, A: 2, M: 3 })
    expect(v.toString()).toBe('A:2 M:3 Z:1')
    expect(Object.keys(v.toJSON())).toEqual(['A', 'M', 'Z'])
    expect(v.total()).toBe(6)
  })

  it('advances per site as ops are applied and matches across replicas', () => {
    const a = new RgaDoc('A')
    const b = new RgaDoc('B')
    a.localInsert(0, 'ab')
    a.localDelete(0, 1)
    expect(a.versionJSON()).toEqual({ A: 2 })
    deliver(b, a.opsSince(b.version()))
    b.localInsert(1, 'z')
    expect(b.versionJSON()).toEqual({ A: 2, B: 1 })
    deliver(a, b.opsSince(a.version()))
    expect(a.versionString()).toBe(b.versionString())
    expect(a.text()).toBe(b.text())
  })

  it('opsSince returns exactly the missing ops', () => {
    const a = new RgaDoc('A')
    const b = new RgaDoc('B')
    a.localInsert(0, 'abc')
    a.localInsert(3, 'd')
    deliver(b, a.opsSince(b.version()))
    a.localDelete(0, 1)
    a.localInsert(0, 'Q')
    const missing = a.opsSince(b.version())
    expect(missing).toHaveLength(2)
    expect(a.opsSince(a.version())).toHaveLength(0)
    deliver(b, missing)
    expect(b.text()).toBe(a.text())
  })
})

describe('sample sequence from the spec', () => {
  /**
   * A inserts 'hello'; B concurrently inserts ' world' at index 0 and deletes 'h'.
   * B can only delete 'h' once it knows about it, so the scenario is: A's
   * 'hello' reaches B, then B (concurrently with any further A edits) inserts
   * ' world' at 0 and deletes 'h'. Ops are delivered to a third replica in
   * both orders and to A in both orders; all replicas must agree.
   */
  function scenario(orderFirst: 'insert' | 'delete') {
    const a = new RgaDoc('A')
    const b = new RgaDoc('B')
    const hello = a.localInsert(0, 'hello')!
    deliver(b, [hello])
    const world = b.localInsert(0, ' world')!
    const delH = b.localDelete(6, 1) // after ' world' is inserted, 'h' is at index 6
    expect(b.text()).toBe(' worldello')
    const bOps: Op[] = orderFirst === 'insert' ? [world, ...delH] : [...delH, world]
    deliver(a, bOps)
    const c = new RgaDoc('C')
    deliver(c, orderFirst === 'insert' ? [hello, world, ...delH] : [...delH, world, hello])
    return { a, b, c }
  }

  it('converges when the insert is delivered before the delete', () => {
    const { a, b, c } = scenario('insert')
    expect(a.text()).toBe(' worldello')
    expect(b.text()).toBe(' worldello')
    expect(c.text()).toBe(' worldello')
    expect(a.versionString()).toBe(b.versionString())
    expect(c.versionString()).toBe(b.versionString())
  })

  it('converges when the delete is delivered before the insert (buffered)', () => {
    const { a, b, c } = scenario('delete')
    expect(a.text()).toBe(' worldello')
    expect(b.text()).toBe(' worldello')
    expect(c.text()).toBe(' worldello')
    expect(a.stats().pending).toBe(0)
    expect(c.stats().pending).toBe(0)
    expect(a.versionString()).toBe(c.versionString())
  })

  it('converges when A keeps typing concurrently with B', () => {
    const a = new RgaDoc('A')
    const b = new RgaDoc('B')
    const hello = a.localInsert(0, 'hello')!
    deliver(b, [hello])
    const bang = a.localInsert(5, '!')!
    const world = b.localInsert(0, ' world')!
    const delH = b.localDelete(6, 1)
    deliver(a, [...delH, world])
    deliver(b, [bang])
    expect(a.text()).toBe(b.text())
    expect(a.text()).toBe(' worldello!')
  })
})

describe('index <-> item mapping', () => {
  it('idAt and positionOf round-trip and skip tombstones', () => {
    const d = new RgaDoc('A')
    d.localInsert(0, 'abcde')
    d.localDelete(1, 2) // 'ade'
    expect(d.idAt(0)).toBeNull()
    const idA = d.idAt(1)!
    const idD = d.idAt(2)!
    expect(idA).toEqual(['A', 1])
    expect(idD).toEqual(['A', 4])
    expect(d.positionOf(idA)).toBe(1)
    expect(d.positionOf(idD)).toBe(2)
    // A tombstone resolves to where it would be.
    expect(d.positionOf(['A', 2])).toBe(1)
    expect(d.positionOf(['Z', 99])).toBeNull()
    expect(d.positionOf(null)).toBe(0)
  })

  it('remote insert effects use final visible indices', () => {
    const a = new RgaDoc('A')
    const b = new RgaDoc('B')
    const base = a.localInsert(0, 'ace')!
    deliver(b, [base])
    a.localDelete(1, 1) // 'ae'
    deliver(b, a.opsSince(b.version()))
    const ins = a.localInsert(1, 'X')! // 'aXe' — origin is 'a'
    const applied = b.receiveMany([ins])
    expect(applied[0].effects).toEqual([{ kind: 'insert', index: 1, text: 'X' }])
    expect(b.text()).toBe('aXe')
  })
})

describe('snapshots', () => {
  it('round-trips through snapshot()/fromSnapshot with tombstones intact', () => {
    const a = new RgaDoc('A')
    const b = new RgaDoc('B')
    const base = a.localInsert(0, 'hello world')!
    deliver(b, [base])
    const ins = b.localInsert(5, ',')!
    deliver(a, [ins])
    a.localDelete(0, 1)
    const snap = a.snapshot()
    const json = JSON.stringify(snap)
    const restored = RgaDoc.fromSnapshot('A', JSON.parse(json))
    expect(restored.text()).toBe(a.text())
    expect(restored.versionString()).toBe(a.versionString())
    expect(restored.stats()).toEqual(a.stats())
    // The restored replica can keep editing and stay in sync.
    const more = restored.localInsert(0, 'H')!
    expect(more.seq).toBe(a.versionJSON().A + 1)
    deliver(b, [...a.opsSince(b.version()), more])
    expect(b.text()).toBe(restored.text())
  })

  it('mergeSnapshot replays only missing ops', () => {
    const a = new RgaDoc('A')
    const b = new RgaDoc('B')
    a.localInsert(0, 'abc')
    b.localInsert(0, 'xyz')
    const applied = b.mergeSnapshot(a.snapshot())
    expect(applied).toHaveLength(1)
    a.mergeSnapshot(b.snapshot())
    expect(a.text()).toBe(b.text())
    expect(b.mergeSnapshot(a.snapshot())).toHaveLength(0)
  })
})

describe('op encoding', () => {
  it('encodes ops as compact JSON and decodes them back', () => {
    const d = new RgaDoc('A')
    const ins = d.localInsert(0, 'hey')!
    const del = d.localDelete(0, 1)[0]
    const insJson = encodeOp(ins)
    expect(JSON.parse(insJson)).toEqual({ t: 'i', site: 'A', seq: 1, ctr: 1, origin: null, s: 'hey' })
    expect(decodeOp(insJson)).toEqual(ins)
    expect(decodeOp(encodeOp(del))).toEqual(del)
    expect(decodeOps(encodeOps([ins, del]))).toEqual([ins, del])
  })

  it('rejects malformed ops', () => {
    expect(opFromJSON(null)).toBeNull()
    expect(opFromJSON({ t: 'i', site: 'A', seq: 0, ctr: 1, origin: null, s: 'x' })).toBeNull()
    expect(opFromJSON({ t: 'i', site: 'A', seq: 1, ctr: 1, origin: null, s: '' })).toBeNull()
    expect(opFromJSON({ t: 'i', site: 'A', seq: 1, ctr: 1, origin: ['A'], s: 'x' })).toBeNull()
    expect(opFromJSON({ t: 'd', site: 'A', seq: 1, target: ['A', 1], n: 0 })).toBeNull()
    expect(opFromJSON({ t: 'z', site: 'A', seq: 1 })).toBeNull()
    expect(decodeOp('not json')).toBeNull()
    expect(decodeOps('{"a":1}')).toEqual([])
  })
})
