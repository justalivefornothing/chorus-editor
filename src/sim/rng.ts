/**
 * Small deterministic PRNG (mulberry32 variant) so that fuzzing, the stress
 * test and the benchmark are reproducible from a single seed.
 */
export type Rng = () => number

export function seededRng(seed: number): Rng {
  let state = (seed >>> 0) || 0x9e3779b9
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let z = state
    z = Math.imul(z ^ (z >>> 15), z | 1)
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61)
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296
  }
}

/** Integer in [0, n). */
export function randInt(rng: Rng, n: number): number {
  return n <= 0 ? 0 : Math.floor(rng() * n)
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[randInt(rng, items.length)]
}

/** In-place Fisher–Yates shuffle, returns the same array. */
export function shuffle<T>(rng: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1)
    const tmp = items[i]
    items[i] = items[j]
    items[j] = tmp
  }
  return items
}

const WORDS = 'the quick brown fox jumps over lazy dog const let return if else for while function class import export async await'.split(' ')

/** Short, human-looking text snippet used by the stress test. */
export function randomText(rng: Rng, maxLen = 4): string {
  const r = rng()
  if (r < 0.15) return '\n'
  if (r < 0.3) return ' '
  if (r < 0.5) return pick(rng, WORDS).slice(0, 1 + randInt(rng, maxLen))
  const len = 1 + randInt(rng, maxLen)
  let out = ''
  for (let i = 0; i < len; i++) out += String.fromCharCode(97 + randInt(rng, 26))
  return out
}
