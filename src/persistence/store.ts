import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Snapshot } from '../crdt'

/**
 * IndexedDB persistence. One record per room holding the full CRDT snapshot
 * (live items + tombstones, run-length encoded) plus the op log so a reloaded
 * tab can both restore instantly and answer other peers' sync requests.
 */
export const DB_NAME = 'chorus'
export const DB_VERSION = 1

export interface RoomRecord {
  readonly room: string
  readonly snapshot: Snapshot
  readonly savedAt: number
  /** Cached document title / language so the room list can show it without decoding. */
  readonly language: string
  readonly chars: number
}

export interface PeerRecord {
  readonly id: 'self'
  readonly site: string
  readonly name: string
  readonly color: string
}

interface ChorusDB extends DBSchema {
  rooms: { key: string; value: RoomRecord; indexes: { savedAt: number } }
  meta: { key: string; value: PeerRecord }
}

export interface RoomStore {
  load(room: string): Promise<RoomRecord | undefined>
  save(record: RoomRecord): Promise<void>
  remove(room: string): Promise<void>
  list(): Promise<RoomRecord[]>
  loadPeer(): Promise<PeerRecord | undefined>
  savePeer(peer: PeerRecord): Promise<void>
}

export function indexedDbSupported(): boolean {
  return typeof indexedDB !== 'undefined'
}

let dbPromise: Promise<IDBPDatabase<ChorusDB>> | null = null

function db(): Promise<IDBPDatabase<ChorusDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ChorusDB>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        const rooms = database.createObjectStore('rooms', { keyPath: 'room' })
        rooms.createIndex('savedAt', 'savedAt')
        database.createObjectStore('meta', { keyPath: 'id' })
      },
    })
  }
  return dbPromise
}

export class IdbRoomStore implements RoomStore {
  async load(room: string): Promise<RoomRecord | undefined> {
    return (await db()).get('rooms', room)
  }

  async save(record: RoomRecord): Promise<void> {
    await (await db()).put('rooms', record)
  }

  async remove(room: string): Promise<void> {
    await (await db()).delete('rooms', room)
  }

  async list(): Promise<RoomRecord[]> {
    const all = await (await db()).getAllFromIndex('rooms', 'savedAt')
    return all.reverse()
  }

  async loadPeer(): Promise<PeerRecord | undefined> {
    return (await db()).get('meta', 'self')
  }

  async savePeer(peer: PeerRecord): Promise<void> {
    await (await db()).put('meta', peer)
  }
}

/** In-memory fallback for environments without IndexedDB (tests, private mode). */
export class MemoryRoomStore implements RoomStore {
  private readonly rooms = new Map<string, RoomRecord>()
  private peer: PeerRecord | undefined

  async load(room: string): Promise<RoomRecord | undefined> {
    return this.rooms.get(room)
  }

  async save(record: RoomRecord): Promise<void> {
    this.rooms.set(record.room, record)
  }

  async remove(room: string): Promise<void> {
    this.rooms.delete(room)
  }

  async list(): Promise<RoomRecord[]> {
    return [...this.rooms.values()].sort((a, b) => b.savedAt - a.savedAt)
  }

  async loadPeer(): Promise<PeerRecord | undefined> {
    return this.peer
  }

  async savePeer(peer: PeerRecord): Promise<void> {
    this.peer = peer
  }
}

export function createRoomStore(): RoomStore {
  return indexedDbSupported() ? new IdbRoomStore() : new MemoryRoomStore()
}

/**
 * Coalesces rapid saves: the first call schedules a write `delayMs` later and
 * later calls within that window just replace the pending payload.
 */
export class DebouncedSaver {
  private timer: ReturnType<typeof setTimeout> | null = null
  private pending: (() => RoomRecord) | null = null
  private inflight: Promise<void> = Promise.resolve()

  constructor(
    private readonly store: RoomStore,
    private readonly delayMs = 400,
    private readonly onError: (err: unknown) => void = (err) => console.error('[chorus] persist failed', err),
  ) {}

  schedule(build: () => RoomRecord): void {
    this.pending = build
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, this.delayMs)
  }

  /** Writes immediately if something is pending. Resolves once the write is done. */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const build = this.pending
    this.pending = null
    if (!build) return this.inflight
    this.inflight = this.inflight.then(() => this.store.save(build())).catch(this.onError)
    return this.inflight
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.pending = null
  }
}
