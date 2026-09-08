/** Minimal typed event emitter (no DOM dependency). */
export class Emitter<Events extends Record<string, unknown[]>> {
  private readonly listeners = new Map<keyof Events, Set<(...args: never[]) => void>>()

  on<K extends keyof Events>(event: K, fn: (...args: Events[K]) => void): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(fn as (...args: never[]) => void)
    return () => {
      set!.delete(fn as (...args: never[]) => void)
    }
  }

  emit<K extends keyof Events>(event: K, ...args: Events[K]): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const fn of [...set]) (fn as (...a: Events[K]) => void)(...args)
  }

  clear(): void {
    this.listeners.clear()
  }
}
