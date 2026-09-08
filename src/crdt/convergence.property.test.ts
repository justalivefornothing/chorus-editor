import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { RgaDoc } from './doc'
import type { Op } from './ops'

/**
 * Property: N in [2,4] replicas, each generating a random script of local
 * inserts/deletes in random rounds, with ops delivered to every other replica
 * in a random (per-receiver) order, always converge to identical text and
 * identical version vectors once every op has been delivered.
 */

type Step = { kind: 'insert'; pos: number; text: string } | { kind: 'delete'; pos: number; len: number }

const SITES = ['A', 'B', 'C', 'D'] as const

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  { weight: 3, arbitrary: fc.record({ kind: fc.constant<'insert'>('insert'), pos: fc.nat(1000), text: fc.string({ minLength: 1, maxLength: 4 }) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant<'delete'>('delete'), pos: fc.nat(1000), len: fc.integer({ min: 1, max: 4 }) }) },
)

/**
 * A round is: each replica performs a step (or skips), then everything
 * produced so far is broadcast. `sync` says whether to flush this round.
 */
interface Round {
  readonly steps: readonly (Step | null)[]
  readonly sync: boolean
}

function roundArb(n: number): fc.Arbitrary<Round> {
  return fc.record({
    steps: fc.array(fc.option(stepArb, { nil: null }), { minLength: n, maxLength: n }),
    sync: fc.boolean(),
  })
}

const scenarioArb = fc
  .integer({ min: 2, max: 4 })
  .chain((n) =>
    fc.record({
      n: fc.constant(n),
      rounds: fc.array(roundArb(n), { minLength: 1, maxLength: 14 }),
      seed: fc.nat(),
    }),
  )

/** Apply a step to a doc, clamping positions to the current length. */
function applyStep(doc: RgaDoc, step: Step): Op[] {
  const len = doc.length
  if (step.kind === 'insert') {
    const op = doc.localInsert(step.pos % (len + 1), step.text)
    return op ? [op] : []
  }
  if (len === 0) return []
  const pos = step.pos % len
  const n = Math.min(step.len, len - pos)
  return doc.localDelete(pos, n)
}

/** Deterministic shuffle (mulberry32) so a failing case is reproducible. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  let s = (seed >>> 0) || 1
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let z = s
    z = Math.imul(z ^ (z >>> 15), z | 1)
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61)
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296
  }
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    const t = out[i]
    out[i] = out[j]
    out[j] = t
  }
  return out
}

function runScenario(n: number, rounds: readonly Round[], seed: number) {
  const docs = SITES.slice(0, n).map((s) => new RgaDoc(s))
  // Ops produced but not yet delivered to each receiver.
  const outbox: Op[][] = docs.map(() => [])
  let salt = seed
  for (const round of rounds) {
    for (let i = 0; i < n; i++) {
      const step = round.steps[i]
      if (!step) continue
      const ops = applyStep(docs[i], step)
      for (let j = 0; j < n; j++) if (j !== i) outbox[j].push(...ops)
    }
    if (round.sync) {
      for (let j = 0; j < n; j++) {
        const ops = shuffled(outbox[j], salt++)
        outbox[j] = []
        docs[j].receiveMany(ops)
      }
    }
  }
  // Final flush in a random order for each receiver.
  for (let j = 0; j < n; j++) {
    docs[j].receiveMany(shuffled(outbox[j], salt++))
    outbox[j] = []
  }
  return docs
}

describe('property: random concurrent edits across 2-4 replicas converge', () => {
  it('all replicas end with identical text and identical version vectors', () => {
    fc.assert(
      fc.property(scenarioArb, ({ n, rounds, seed }) => {
        const docs = runScenario(n, rounds, seed)
        const text = docs[0].text()
        const vv = docs[0].versionString()
        for (const d of docs) {
          expect(d.stats().pending).toBe(0)
          expect(d.text()).toBe(text)
          expect(d.versionString()).toBe(vv)
        }
      }),
      { numRuns: 300 },
    )
  })

  it('every replica holds the same number of live items and tombstones', () => {
    fc.assert(
      fc.property(scenarioArb, ({ n, rounds, seed }) => {
        const docs = runScenario(n, rounds, seed)
        const s0 = docs[0].stats()
        for (const d of docs) {
          const s = d.stats()
          expect(s.live).toBe(s0.live)
          expect(s.tombstones).toBe(s0.tombstones)
          expect(s.live).toBe(d.text().length)
        }
      }),
      { numRuns: 150 },
    )
  })

  it('a replica restored from a snapshot converges with the others', () => {
    fc.assert(
      fc.property(scenarioArb, ({ n, rounds, seed }) => {
        const docs = runScenario(n, rounds, seed)
        const restored = RgaDoc.fromSnapshot(docs[0].site, JSON.parse(JSON.stringify(docs[0].snapshot())))
        expect(restored.text()).toBe(docs[0].text())
        expect(restored.versionString()).toBe(docs[0].versionString())
        // Further edits from the restored replica reach everyone.
        const op = restored.localInsert(0, '#')
        if (op) for (const d of docs.slice(1)) d.receive(op)
        for (const d of docs.slice(1)) expect(d.text()).toBe(restored.text())
      }),
      { numRuns: 60 },
    )
  })
})

describe('property: delivery order does not matter for a fixed op set', () => {
  it('any permutation of a causally-complete op set yields the same document', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 4 }).chain((n) =>
          fc.record({
            n: fc.constant(n),
            rounds: fc.array(roundArb(n), { minLength: 1, maxLength: 8 }),
            seed: fc.nat(),
            perms: fc.array(fc.nat(), { minLength: 3, maxLength: 3 }),
          }),
        ),
        ({ n, rounds, seed, perms }) => {
          const docs = runScenario(n, rounds, seed)
          const allOps = docs[0].opsSince({})
          const reference = docs[0].text()
          for (const p of perms) {
            const fresh = new RgaDoc('Z')
            fresh.receiveMany(shuffled(allOps, p))
            expect(fresh.stats().pending).toBe(0)
            expect(fresh.text()).toBe(reference)
            expect(fresh.versionString()).toBe(docs[0].versionString())
          }
        },
      ),
      { numRuns: 120 },
    )
  })
})
