import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RgaDoc } from '../crdt'
import { DebouncedSaver, IdbRoomStore, MemoryRoomStore, indexedDbSupported, type RoomRecord, type RoomStore } from './store'

function record(room: string, doc: RgaDoc): RoomRecord {
  return { room, snapshot: doc.snapshot(), savedAt: Date.now(), language: 'javascript', chars: doc.length }
}

function suite(name: string, make: () => RoomStore) {
  describe(name, () => {
    let store: RoomStore
    beforeEach(async () => {
      store = make()
      // The IDB-backed store is a shared database: start each test clean.
      for (const r of await store.list()) await store.remove(r.room)
    })

    it('saves a CRDT snapshot per room and restores it with tombstones', async () => {
      const doc = new RgaDoc('A')
      doc.localInsert(0, 'const x = 1;\n')
      doc.localDelete(6, 1) // tombstone the 'x'
      doc.localInsert(6, 'y')
      await store.save(record('room-1', doc))
      const loaded = await store.load('room-1')
      expect(loaded).toBeDefined()
      // Reload under a fresh site id, as a reopened tab would.
      const restored = RgaDoc.fromSnapshot('B', loaded!.snapshot)
      expect(restored.text()).toBe('const y = 1;\n')
      expect(restored.stats().tombstones).toBe(1)
      expect(restored.versionString()).toBe(doc.versionString())
      expect(await store.load('nope')).toBeUndefined()
    })

    it('overwrites, lists newest first, and removes', async () => {
      const d1 = new RgaDoc('A')
      d1.localInsert(0, 'one')
      const d2 = new RgaDoc('A')
      d2.localInsert(0, 'two')
      await store.save({ ...record('r1', d1), savedAt: 1 })
      await store.save({ ...record('r2', d2), savedAt: 2 })
      await store.save({ ...record('r1', d2), savedAt: 3 })
      const list = await store.list()
      expect(list.map((r) => r.room)).toEqual(['r1', 'r2'])
      expect(RgaDoc.fromSnapshot('Z', list[0].snapshot).text()).toBe('two')
      await store.remove('r1')
      expect((await store.list()).map((r) => r.room)).toEqual(['r2'])
    })

    it('persists the local peer identity', async () => {
      expect(await store.loadPeer()).toBeUndefined()
      await store.savePeer({ id: 'self', site: 'abcde', name: 'Ada', color: '#5eead4' })
      expect(await store.loadPeer()).toMatchObject({ site: 'abcde', name: 'Ada' })
    })
  })
}

suite('IdbRoomStore (idb over fake-indexeddb)', () => new IdbRoomStore())
suite('MemoryRoomStore', () => new MemoryRoomStore())

describe('indexedDbSupported', () => {
  it('detects the polyfilled global', () => {
    expect(indexedDbSupported()).toBe(true)
  })
})

describe('DebouncedSaver', () => {
  it('coalesces rapid saves into one write of the latest payload', async () => {
    vi.useFakeTimers()
    const store = new MemoryRoomStore()
    const spy = vi.spyOn(store, 'save')
    const saver = new DebouncedSaver(store, 100)
    const doc = new RgaDoc('A')
    for (const ch of 'hello') {
      doc.localInsert(doc.length, ch)
      saver.schedule(() => record('r', doc))
    }
    expect(spy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(120)
    await saver.flush()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(RgaDoc.fromSnapshot('B', (await store.load('r'))!.snapshot).text()).toBe('hello')
    vi.useRealTimers()
  })

  it('flush writes immediately and dispose drops pending work', async () => {
    const store = new MemoryRoomStore()
    const saver = new DebouncedSaver(store, 10_000)
    const doc = new RgaDoc('A')
    doc.localInsert(0, 'x')
    saver.schedule(() => record('r', doc))
    await saver.flush()
    expect(await store.load('r')).toBeDefined()
    saver.schedule(() => record('r2', doc))
    saver.dispose()
    await saver.flush()
    expect(await store.load('r2')).toBeUndefined()
  })
})
