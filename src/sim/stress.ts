import type { Replica } from '../session/replica'
import { checkConvergence, type ConvergenceReport } from '../session/replica'
import type { Clock } from './clock'
import { randInt, randomText, seededRng, type Rng } from './rng'

export interface StressOptions {
  /** Total number of random ops to fire across all replicas. */
  readonly ops?: number
  readonly seed?: number
  /** Ops per replica per burst (a burst is one synchronous slice). */
  readonly burst?: number
  /** Simulated ms between bursts. */
  readonly gapMs?: number
  readonly onProgress?: (done: number, total: number) => void
}

export interface StressResult extends ConvergenceReport {
  readonly ops: number
  readonly inserts: number
  readonly deletes: number
  readonly seed: number
  /** Simulated (or wall-clock) ms from start to convergence check. */
  readonly elapsedMs: number
}

/** Perform one random local edit on a replica. Returns [inserts, deletes] counts. */
export function randomEdit(replica: Replica, rng: Rng): [number, number] {
  const len = replica.doc.length
  const doDelete = len > 0 && rng() < 0.4
  if (doDelete) {
    const pos = randInt(rng, len)
    const n = Math.min(1 + randInt(rng, 3), len - pos)
    replica.delete(pos, n)
    return [0, 1]
  }
  replica.insert(randInt(rng, len + 1), randomText(rng))
  return [1, 0]
}

/**
 * Fires `ops` random inserts/deletes across the given replicas in bursts,
 * spaced `gapMs` apart on the supplied clock, then waits `settleMs` for the
 * network to drain and reports convergence. Works on a VirtualClock (tests,
 * bench) and on the real clock (browser UI) alike.
 */
export function runStress(
  replicas: readonly Replica[],
  clock: Clock,
  opts: StressOptions = {},
): { promise: Promise<StressResult>; cancel: () => void } {
  const total = opts.ops ?? 500
  const seed = opts.seed ?? (Date.now() & 0xffff)
  const burst = opts.burst ?? 5
  const gapMs = opts.gapMs ?? 40
  const rng = seededRng(seed)
  let done = 0
  let inserts = 0
  let deletes = 0
  let cancelled = false
  let cancelTimer: () => void = () => {}
  const started = clock.now()

  const promise = new Promise<StressResult>((resolve) => {
    const finish = () => {
      const report = checkConvergence(replicas.map((r) => r.doc))
      resolve({ ...report, ops: done, inserts, deletes, seed, elapsedMs: clock.now() - started })
    }
    const settle = (attempt: number) => {
      if (cancelled) return finish()
      const report = checkConvergence(replicas.map((r) => r.doc))
      // Give anti-entropy up to ~12 s of (simulated) time to repair lost packets.
      if (report.converged || attempt >= 60) return finish()
      cancelTimer = clock.after(200, () => settle(attempt + 1))
    }
    const tick = () => {
      if (cancelled) return finish()
      for (let k = 0; k < burst && done < total; k++) {
        for (const r of replicas) {
          if (done >= total) break
          const [i, d] = randomEdit(r, rng)
          inserts += i
          deletes += d
          done++
        }
      }
      opts.onProgress?.(done, total)
      if (done < total) cancelTimer = clock.after(gapMs, tick)
      else cancelTimer = clock.after(gapMs, () => settle(0))
    }
    tick()
  })

  return {
    promise,
    cancel: () => {
      cancelled = true
      cancelTimer()
    },
  }
}
