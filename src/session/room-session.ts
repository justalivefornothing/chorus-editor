import type { Snapshot } from '../crdt'
import type { LanguageId } from '../editor/languages'
import { DebouncedSaver, type RoomStore } from '../persistence/store'
import { BroadcastTransport } from '../transport/broadcast'
import type { PeerInfo, Transport } from '../transport/protocol'
import { Replica } from './replica'

export interface RoomSessionOptions {
  readonly room: string
  readonly peer: PeerInfo
  readonly store: RoomStore
  readonly language: LanguageId
  /** Factory so tests can swap BroadcastChannel for a simulated link. */
  readonly transport?: (room: string) => Transport
  /** Text used to seed a brand-new room (only if nothing was persisted). */
  readonly seed?: string
  readonly saveDelayMs?: number
}

/**
 * A live room: one replica over a transport, persisted to IndexedDB.
 *
 *   open()  -> load snapshot (if any) -> Replica.fromSnapshot -> start -> hello
 *   change  -> debounced snapshot write
 *   close() -> flush -> bye
 */
export class RoomSession {
  readonly room: string
  readonly replica: Replica
  readonly restored: boolean
  language: LanguageId
  private readonly saver: DebouncedSaver
  private readonly store: RoomStore
  private readonly offChange: () => void
  private closed = false

  private constructor(opts: RoomSessionOptions, snapshot: Snapshot | null, transport: Transport) {
    this.room = opts.room
    this.store = opts.store
    this.language = opts.language
    this.restored = snapshot !== null
    this.replica = new Replica({ peer: opts.peer, transport, snapshot })
    this.saver = new DebouncedSaver(opts.store, opts.saveDelayMs ?? 400)
    this.offChange = this.replica.events.on('change', () => this.scheduleSave())
  }

  static async open(opts: RoomSessionOptions): Promise<RoomSession> {
    const record = await opts.store.load(opts.room)
    const transport = (opts.transport ?? ((room) => new BroadcastTransport(room)))(opts.room)
    const session = new RoomSession({ ...opts, language: record?.language && isLang(record.language) ? record.language : opts.language }, record?.snapshot ?? null, transport)
    session.replica.start()
    if (!record && opts.seed && session.replica.doc.length === 0) {
      // Give a fresh room something to look at. Because this is a real op it
      // syncs to any tab that joins later; a tab that already exists would have
      // answered our hello with its own state first — so only seed when the
      // room is genuinely empty after a short grace period.
      await new Promise<void>((r) => setTimeout(r, 120))
      if (session.replica.doc.length === 0 && session.replica.peers().length === 0) session.replica.insert(0, opts.seed)
    }
    session.scheduleSave()
    return session
  }

  setLanguage(language: LanguageId): void {
    this.language = language
    this.scheduleSave()
  }

  private scheduleSave(): void {
    if (this.closed) return
    this.saver.schedule(() => ({
      room: this.room,
      snapshot: this.replica.doc.snapshot(),
      savedAt: Date.now(),
      language: this.language,
      chars: this.replica.doc.length,
    }))
  }

  /** Force a write now (e.g. on pagehide). */
  flush(): Promise<void> {
    return this.saver.flush()
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.offChange()
    await this.saver.flush()
    this.saver.dispose()
    this.replica.stop()
  }

  /** Deletes the persisted copy of this room (the live doc is untouched). */
  async forget(): Promise<void> {
    this.saver.dispose()
    await this.store.remove(this.room)
  }
}

function isLang(v: string): v is LanguageId {
  return v === 'javascript' || v === 'typescript' || v === 'json' || v === 'markdown'
}
