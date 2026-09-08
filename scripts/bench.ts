/**
 * Chorus CRDT benchmark — `npm run bench`
 *
 * Measures the core operations the editor leans on, on a single thread with
 * the real RgaDoc (no DOM, no network):
 *
 *   1. sequential typing (localInsert one char at a time)
 *   2. remote integration of the same op stream on a fresh replica
 *   3. concurrent 2-replica interleaving (random inserts/deletes) + convergence
 *   4. index -> item mapping (idAt) after edits invalidate the cache
 *   5. snapshot / restore round-trip
 *   6. full sim-network stress run (500 ops, 4 replicas, lag + loss) on a virtual clock
 */
import { RgaDoc, type Op } from '../src/crdt'
import { Replica, checkConvergence } from '../src/session/replica'
import { VirtualClock } from '../src/sim/clock'
import { SimNetwork } from '../src/sim/network'
import { randInt, seededRng } from '../src/sim/rng'
import { runStress } from '../src/sim/stress'

const N = Number(process.argv[2] ?? 20_000)
const rng = seededRng(7)

function time<T>(label: string, fn: () => T): T {
  const t0 = performance.now()
  const out = fn()
  const ms = performance.now() - t0
  results.push({ label, ms })
  process.stdout.write(`  ${label} … ${ms.toFixed(1)} ms\n`)
  return out
}

const results: { label: string; ms: number; note?: string }[] = []
const note = (s: string) => (results[results.length - 1].note = s)

// 1. sequential typing
const a = new RgaDoc('A')
const typed: Op[] = []
time(`localInsert x${N} (append one char each)`, () => {
  for (let i = 0; i < N; i++) typed.push(a.localInsert(a.length, 'abcdefghij'[i % 10])!)
})
note(`${(results.at(-1)!.ms / N * 1000).toFixed(2)} µs/op`)

// 2. remote integration in order
const b = new RgaDoc('B')
time(`receive x${N} (in order, fresh replica)`, () => {
  b.receiveMany(typed)
})
note(`${(results.at(-1)!.ms / N * 1000).toFixed(2)} µs/op, text equal: ${a.text() === b.text()}`)

// 2b. remote integration, reversed (max causal buffering)
const c = new RgaDoc('C')
time(`receive x${N} (reverse order => every op buffered until seq 1 arrives)`, () => {
  c.receiveMany([...typed].reverse())
})
note(`pending ${c.stats().pending}, text equal: ${a.text() === c.text()}`)

// 3. concurrent interleaving
const M = Math.max(1000, Math.floor(N / 4))
const x = new RgaDoc('X')
const y = new RgaDoc('Y')
x.localInsert(0, 'seed text for concurrent editing\n'.repeat(20))
y.receiveMany(x.opsSince({}))
time(`concurrent random edits 2 replicas x${M} rounds + delivery`, () => {
  const outX: Op[] = []
  const outY: Op[] = []
  for (let i = 0; i < M; i++) {
    for (const [doc, out] of [[x, outX], [y, outY]] as const) {
      if (doc.length > 0 && rng() < 0.4) {
        const pos = randInt(rng, doc.length)
        out.push(...doc.localDelete(pos, Math.min(1 + randInt(rng, 3), doc.length - pos)))
      } else {
        const op = doc.localInsert(randInt(rng, doc.length + 1), String.fromCharCode(97 + randInt(rng, 26)))
        if (op) out.push(op)
      }
    }
    if (i % 50 === 49) {
      y.receiveMany(outX.splice(0))
      x.receiveMany(outY.splice(0))
    }
  }
  y.receiveMany(outX)
  x.receiveMany(outY)
})
note(`converged: ${x.text() === y.text() && x.versionString() === y.versionString()}, ${x.stats().live} live / ${x.stats().tombstones} tombstones`)

// 4. index mapping after invalidation
time(`idAt() x${N} with cache invalidated every 100 lookups`, () => {
  for (let i = 0; i < N; i++) {
    if (i % 100 === 0) x.localInsert(0, '.') // dirties the visible index
    x.idAt(randInt(rng, x.length + 1))
  }
})
note(`${(results.at(-1)!.ms / N * 1000).toFixed(2)} µs/lookup incl. rebuilds (${x.length} chars)`)

// 5. snapshot round trip
let json = ''
time('snapshot() + JSON.stringify', () => {
  json = JSON.stringify(x.snapshot())
})
note(`${(json.length / 1024).toFixed(1)} KiB for ${x.stats().live + x.stats().tombstones} items`)
time('JSON.parse + fromSnapshot()', () => {
  const r = RgaDoc.fromSnapshot('Z', JSON.parse(json))
  if (r.text() !== x.text()) throw new Error('snapshot mismatch')
})

// 6. sim-network stress on a virtual clock
const clock = new VirtualClock()




const net = new SimNetwork(clock, seededRng(3), { latencyMs: 250, jitter: 0.5, loss: 0.05 })

const ra = new Replica({ peer: { site: 'A', name: 'A', color: '#fff' }, transport: net.endpoint('A'), clock })
const rb = new Replica({ peer: { site: 'B', name: 'B', color: '#fff' }, transport: net.endpoint('B'), clock })
ra.start()
rb.start()
let stress: Awaited<ReturnType<typeof runStress>['promise']> | null = null
const run = runStress([ra, rb], clock, { ops: 500, seed: 42, burst: 5, gapMs: 30 })
void run.promise.then((r) => (stress = r))
time('stress: 500 ops, 2 replicas, 250ms±50% lag, 5% loss (virtual clock)', () => {
  for (let i = 0; i < 2000 && stress === null; i++) clock.advance(50)
})
// Promise callbacks run after the sync section; flush microtasks before reporting.
await Promise.resolve()
const s = stress as Awaited<ReturnType<typeof runStress>['promise']> | null
note(s ? `converged=${s.converged} in ${s.elapsedMs} simulated ms, ${checkConvergence([ra.doc, rb.doc]).pending} pending` : 'did not finish')
ra.stop()
rb.stop()

// report
const width = Math.max(...results.map((r) => r.label.length))
console.log(`\nChorus bench — N=${N} — node ${process.version}\n`)
for (const r of results) console.log(`${r.label.padEnd(width)}  ${r.ms.toFixed(1).padStart(8)} ms  ${r.note ?? ''}`)
console.log()
