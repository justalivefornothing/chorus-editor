import { useEffect, useReducer, useRef, useState } from 'react'
import type { Replica } from '../session/replica'

/**
 * Re-renders (at most once per animation frame) whenever the replica emits
 * any of the given events. Returns a counter you can pass as a dependency.
 */
export function useReplicaTick(replica: Replica | null, events: readonly ('change' | 'timeline' | 'peers' | 'traffic')[] = ['change']): number {
  const [tick, bump] = useReducer((n: number) => n + 1, 0)
  const key = events.join(',')
  useEffect(() => {
    if (!replica) return
    let frame: number | null = null
    const schedule = () => {
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        bump()
      })
    }
    const offs = key.split(',').map((e) => replica.events.on(e as 'change', schedule))
    return () => {
      for (const off of offs) off()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [replica, key])
  return tick
}

/** Re-renders every `ms` milliseconds (for time-based UI like fades and TTLs). */
export function useInterval(ms: number, enabled = true): number {
  const [tick, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (!enabled) return
    const id = setInterval(bump, ms)
    return () => clearInterval(id)
  }, [ms, enabled])
  return tick
}

/** Tracks a CSS media query. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof matchMedia !== 'undefined' ? matchMedia(query).matches : false))
  useEffect(() => {
    const mq = matchMedia(query)
    const on = () => setMatches(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return matches
}

/** Returns a value that flips back to `false` `ms` after it was last set to `true`. */
export function useTransient(ms: number): [boolean, () => void] {
  const [on, setOn] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  const trigger = () => {
    setOn(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setOn(false), ms)
  }
  return [on, trigger]
}
