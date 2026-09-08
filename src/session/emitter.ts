/** Minimal typed event emitter (no DOM dependency). */
type AnyFn = (...args: unknown[]) => void

export class Emitter<Events extends Record<string, unknown[]>> {
  private readonly listeners = new Map<keyof Events, Set<AnyFn>>()

  on<K extends keyof Events>(event: K, fn: (...args: Events[K]) => void): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    const handler = fn as unknown as AnyFn
    set.add(handler)
    return () => {
      set.delete(handler)
    }
  }

  emit<K extends keyof Events>(event: K, ...args: Events[K]): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const fn of [...set]) fn(...args)
  }

  clear(): void {
    this.listeners.clear()
  }
}
