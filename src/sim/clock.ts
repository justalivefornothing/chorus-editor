/**
 * Time abstraction shared by the simulated network and the session layer.
 * Production code uses `realClock`; tests drive a `VirtualClock` so that
 * seconds of simulated latency run in microseconds and deterministically.
 */
export interface Clock {
  now(): number
  /** Run `fn` after `ms` milliseconds. Returns a cancel function. */
  after(ms: number, fn: () => void): () => void
}

export const realClock: Clock = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  after(ms, fn) {
    const handle = setTimeout(fn, Math.max(0, ms))
    return () => clearTimeout(handle)
  },
}

/** Repeats `fn` every `ms` until the returned cancel function is called. */
export function every(clock: Clock, ms: number, fn: () => void): () => void {
  let cancelled = false
  let cancelCurrent: () => void = () => {}
  const tick = () => {
    if (cancelled) return
    fn()
    if (!cancelled) cancelCurrent = clock.after(ms, tick)
  }
  cancelCurrent = clock.after(ms, tick)
  return () => {
    cancelled = true
    cancelCurrent()
  }
}

interface Timer {
  readonly id: number
  readonly at: number
  readonly fn: () => void
}

export class VirtualClock implements Clock {
  private time = 0
  private nextId = 1
  private timers: Timer[] = []

  now(): number {
    return this.time
  }

  after(ms: number, fn: () => void): () => void {
    const timer: Timer = { id: this.nextId++, at: this.time + Math.max(0, ms), fn }
    // Keep the list sorted by (at, id) so equal deadlines fire FIFO.
    let i = this.timers.length
    while (i > 0 && this.timers[i - 1].at > timer.at) i--
    this.timers.splice(i, 0, timer)
    return () => {
      const idx = this.timers.indexOf(timer)
      if (idx >= 0) this.timers.splice(idx, 1)
    }
  }

  get pendingTimers(): number {
    return this.timers.length
  }

  /** Advance simulated time by `ms`, firing every timer that comes due in order. */
  advance(ms: number): void {
    const target = this.time + ms
    while (this.timers.length > 0 && this.timers[0].at <= target) {
      const t = this.timers.shift()!
      this.time = t.at
      t.fn()
    }
    this.time = target
  }

  /** Run timers until none are left or `maxMs` of simulated time has passed. */
  drain(maxMs = 60_000): void {
    const end = this.time + maxMs
    while (this.timers.length > 0 && this.timers[0].at <= end) {
      const t = this.timers.shift()!
      this.time = t.at
      t.fn()
    }
  }
}
