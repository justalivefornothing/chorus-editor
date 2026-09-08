import { compareIds, idKey, keyOf, type ItemId, type SiteId } from './id'
import type { DeleteOp, InsertOp, Op } from './ops'
import { VersionVector, type VersionVectorJSON } from './version-vector'

/**
 * One character in the sequence. Items are never removed — a delete just
 * flips `deleted` (a tombstone) so that concurrent inserts that used the item
 * as their origin can still be positioned.
 */
export interface Item {
  readonly site: SiteId
  readonly ctr: number
  readonly origin: Item | null
  readonly ch: string
  deleted: boolean
  next: Item | null
  prev: Item | null
  /**
   * Cached visible index. For a live item this is its index in the visible
   * text; for a tombstone it is the index where it *would* be (the number of
   * live items before it). Only valid when `RgaDoc.dirty` is false.
   */
  vis: number
}

/** A change to the visible text, in sequential coordinates (apply in order). */
export type Effect =
  | { readonly kind: 'insert'; readonly index: number; readonly text: string }
  | { readonly kind: 'delete'; readonly index: number; readonly length: number }

export interface Applied {
  readonly op: Op
  readonly effects: readonly Effect[]
}

export interface DocStats {
  readonly live: number
  readonly tombstones: number
  readonly pending: number
  readonly ops: number
}

/** Run-length encoded item: [site, firstCtr, originSite|null, originCtr, text, deleted] */
export type SnapshotRun = readonly [SiteId, number, SiteId | null, number, string, 0 | 1]

export interface Snapshot {
  readonly v: 1
  readonly clock: number
  readonly vv: VersionVectorJSON
  readonly runs: readonly SnapshotRun[]
  readonly log: Readonly<Record<SiteId, readonly Op[]>>
}

/**
 * Replicated Growable Array — a sequence CRDT.
 *
 *   • Items live in a doubly linked list in document order (tombstones included).
 *   • `integrate()` places a new item after its origin, skipping over any items
 *     with a *greater* id. Because ids are Lamport-ordered this yields the same
 *     order on every replica regardless of delivery order.
 *   • Ops from each site are applied in seq order; ops whose dependencies
 *     (origin / delete target / previous seq) are missing wait in `pending`.
 *   • A visible-index cache maps editor positions <-> items in O(1) after an
 *     O(n) rebuild that is only done lazily when something changed.
 */
export class RgaDoc {
  readonly site: SiteId
  /** Lamport clock: >= every item counter this replica has seen. */
  private clock = 0
  /** Dense sequence number of the last op *this* site produced. */
  private seq = 0
  private readonly vv = new VersionVector()
  /** Per-site op log (index seq-1). Powers delta sync and persistence. */
  private readonly log = new Map<SiteId, Op[]>()
  /**
   * Causal buffer: ops we cannot apply yet, grouped by site and keyed by seq.
   * Grouping lets `drain()` walk each site's FIFO chain (seq n, n+1, n+2 …) in
   * a single pass instead of rescanning a flat list after every application.
   */
  private readonly pending = new Map<SiteId, Map<number, Op>>()
  private pendingCount = 0

  private readonly head: Item
  private readonly byKey = new Map<string, Item>()
  private readonly visible: Item[] = []
  private dirty = false
  private liveCount = 0
  private totalCount = 0

  constructor(site: SiteId) {
    this.site = site
    this.head = { site: '', ctr: -1, origin: null, ch: '', deleted: true, next: null, prev: null, vis: 0 }
  }

  // ───────────────────────── reading ─────────────────────────

  get length(): number {
    return this.liveCount
  }

  text(): string {
    const parts: string[] = []
    for (let it = this.head.next; it; it = it.next) if (!it.deleted) parts.push(it.ch)
    return parts.join('')
  }

  version(): VersionVector {
    return this.vv.clone()
  }

  versionJSON(): VersionVectorJSON {
    return this.vv.toJSON()
  }

  /** Deterministic version string; equal strings <=> identical op sets. */
  versionString(): string {
    return this.vv.toString()
  }

  stats(): DocStats {
    let ops = 0
    for (const arr of this.log.values()) ops += arr.length
    return { live: this.liveCount, tombstones: this.totalCount - this.liveCount, pending: this.pendingCount, ops }
  }

  /** Snapshot of the causal buffer (site order, then seq order). */
  pendingOps(): Op[] {
    const out: Op[] = []
    for (const bySeq of this.pending.values()) for (const seq of [...bySeq.keys()].sort((a, b) => a - b)) out.push(bySeq.get(seq)!)
    return out
  }

  isPending(op: Op): boolean {
    return this.pending.get(op.site)?.has(op.seq) ?? false
  }

  hasItem(id: ItemId): boolean {
    return this.byKey.has(idKey(id))
  }

  /** The id of the character immediately left of `pos` (null at the start). */
  idAt(pos: number): ItemId | null {
    if (pos <= 0) return null
    this.ensureIndex()
    const it = this.visible[Math.min(pos, this.visible.length) - 1]
    return it ? [it.site, it.ctr] : null
  }

  /**
   * Position just right of the item `id` — used to keep remote cursors pinned
   * to text rather than to numeric offsets. Returns null for unknown ids.
   */
  positionOf(id: ItemId | null): number | null {
    if (id === null) return 0
    const it = this.byKey.get(idKey(id))
    if (!it) return null
    this.ensureIndex()
    return it.deleted ? it.vis : it.vis + 1
  }

  // ───────────────────────── local edits ─────────────────────────

  localInsert(index: number, text: string): InsertOp | null {
    if (text.length === 0) return null
    if (index < 0 || index > this.liveCount) throw new RangeError(`insert index ${index} out of range 0..${this.liveCount}`)
    this.ensureIndex()
    const originItem = index === 0 ? null : this.visible[index - 1]
    const op: InsertOp = {
      t: 'i',
      site: this.site,
      seq: this.seq + 1,
      ctr: this.clock + 1,
      origin: originItem ? [originItem.site, originItem.ctr] : null,
      s: text,
    }
    this.applyInsert(op)
    this.commit(op)
    return op
  }

  /** Deletes `length` visible characters at `index`; returns one op per same-site run. */
  localDelete(index: number, length: number): DeleteOp[] {
    if (length <= 0) return []
    if (index < 0 || index + length > this.liveCount) {
      throw new RangeError(`delete range ${index}+${length} out of range (length ${this.liveCount})`)
    }
    this.ensureIndex()
    const ops: DeleteOp[] = []
    let run: { site: SiteId; ctr: number; n: number } | null = null
    const flush = () => {
      if (!run) return
      const op: DeleteOp = { t: 'd', site: this.site, seq: this.seq + 1, target: [run.site, run.ctr], n: run.n }
      ops.push(op)
      this.commit(op)
      run = null
    }
    const first = this.visible[index]
    for (let i = index; i < index + length; i++) {
      const it = this.visible[i]
      it.deleted = true
      this.liveCount--
      if (run && run.site === it.site && run.ctr + run.n === it.ctr) run.n++
      else {
        flush()
        run = { site: it.site, ctr: it.ctr, n: 1 }
      }
    }
    flush()
    // Everything before `index` is untouched; re-index from the first tombstone on.
    this.reindexFrom(first, index)
    return ops
  }

  // ───────────────────────── remote ops ─────────────────────────

  /**
   * Receive an op from the network. Applies it (and any pending ops it
   * unblocks) if its dependencies are met, otherwise parks it. Duplicates and
   * our own echoes are ignored.
   */
  receive(op: Op): Applied[] {
    if (!this.enqueue(op)) return []
    return this.drain()
  }

  /** Batch variant: buffers everything first, then drains once. */
  receiveMany(ops: readonly Op[]): Applied[] {
    let any = false
    for (const op of ops) if (this.enqueue(op)) any = true
    return any ? this.drain() : []
  }

  /** Adds an op to the causal buffer unless it is ours, already applied, or already buffered. */
  private enqueue(op: Op): boolean {
    if (op.site === this.site) return false
    if (op.seq <= this.vv.get(op.site)) return false
    let bySeq = this.pending.get(op.site)
    if (!bySeq) {
      bySeq = new Map()
      this.pending.set(op.site, bySeq)
    }
    if (bySeq.has(op.seq)) return false
    bySeq.set(op.seq, op)
    this.pendingCount++
    return true
  }

  /**
   * Applies every buffered op whose dependencies are met. Each site's chain is
   * followed from `vv[site] + 1` upwards; applying an op can unblock ops from
   * other sites (their origin just arrived), so we loop until a full pass
   * makes no progress. Total cost is O(pending × chain-depth), not O(pending²).
   */
  private drain(): Applied[] {
    const applied: Applied[] = []
    let progressed = true
    while (progressed && this.pendingCount > 0) {
      progressed = false
      for (const [site, bySeq] of this.pending) {
        let next = this.vv.get(site) + 1
        let op = bySeq.get(next)
        while (op && this.isReady(op)) {
          bySeq.delete(next)
          this.pendingCount--
          const effects = op.t === 'i' ? this.applyInsert(op) : this.applyDelete(op)
          this.commit(op)
          applied.push({ op, effects })
          progressed = true
          next++
          op = bySeq.get(next)
        }
        if (bySeq.size === 0) this.pending.delete(site)
      }
    }
    return applied
  }

  /** Causal readiness: previous seq from the same site applied, and every referenced item known. */
  isReady(op: Op): boolean {
    if (op.seq !== this.vv.get(op.site) + 1) return false
    if (op.t === 'i') return op.origin === null || this.byKey.has(idKey(op.origin))
    for (let j = 0; j < op.n; j++) if (!this.byKey.has(keyOf(op.target[0], op.target[1] + j))) return false
    return true
  }

  private commit(op: Op): void {
    let arr = this.log.get(op.site)
    if (!arr) {
      arr = []
      this.log.set(op.site, arr)
    }
    arr[op.seq - 1] = op
    this.vv.set(op.site, op.seq)
    if (op.site === this.site) this.seq = op.seq
    if (op.t === 'i') this.clock = Math.max(this.clock, op.ctr + op.s.length - 1)
  }

  private applyInsert(op: InsertOp): Effect[] {
    let origin: Item | null = null
    if (op.origin) {
      origin = this.byKey.get(idKey(op.origin)) ?? null
      if (!origin) throw new Error(`origin ${idKey(op.origin)} missing for ${op.site}#${op.seq}`)
    }
    const wasClean = !this.dirty
    const inserted: Item[] = []
    for (let j = 0; j < op.s.length; j++) {
      const key = keyOf(op.site, op.ctr + j)
      if (this.byKey.has(key)) continue // idempotent re-application guard
      const item: Item = {
        site: op.site,
        ctr: op.ctr + j,
        origin,
        ch: op.s[j],
        deleted: false,
        next: null,
        prev: null,
        vis: 0,
      }
      this.integrate(item)
      this.byKey.set(key, item)
      this.liveCount++
      this.totalCount++
      inserted.push(item)
      origin = item
    }
    if (inserted.length === 0) return []
    // Fast path: the run landed as one contiguous block into a clean index, so
    // only items from the first new one onward need re-indexing (O(1) when
    // typing at the end of the document). Otherwise fall back to a full rebuild.
    let contiguous = wasClean
    for (let k = 1; contiguous && k < inserted.length; k++) if (inserted[k - 1].next !== inserted[k]) contiguous = false
    if (contiguous) {
      const first = inserted[0]
      const prev = first.prev!
      const start = prev === this.head ? 0 : prev.deleted ? prev.vis : prev.vis + 1
      this.reindexFrom(first, start)
    } else {
      this.dirty = true
      this.ensureIndex()
    }
    // Group the new items into runs of adjacent visible indices. Because we
    // walk them in document order, each run's sequential index equals its
    // final visible index.
    inserted.sort((a, b) => a.vis - b.vis)
    const effects: Effect[] = []
    let start = inserted[0].vis
    let text = inserted[0].ch
    for (let k = 1; k < inserted.length; k++) {
      const it = inserted[k]
      if (it.vis === start + text.length) text += it.ch
      else {
        effects.push({ kind: 'insert', index: start, text })
        start = it.vis
        text = it.ch
      }
    }
    effects.push({ kind: 'insert', index: start, text })
    return effects
  }

  /**
   * The heart of RGA. Walk right from the origin while the current item has a
   * greater id than ours: those are concurrent inserts (or their descendants)
   * that must precede us. Stop at the first smaller id — either something we
   * knew about when we typed, or a concurrent insert that lost the tie-break.
   */
  private integrate(item: Item): void {
    let prev: Item = item.origin ?? this.head
    let cur = prev.next
    while (cur && compareIds(cur.site, cur.ctr, item.site, item.ctr) > 0) {
      prev = cur
      cur = cur.next
    }
    item.prev = prev
    item.next = cur
    prev.next = item
    if (cur) cur.prev = item
  }

  private applyDelete(op: DeleteOp): Effect[] {
    this.ensureIndex()
    const indices: number[] = []
    const targets: Item[] = []
    for (let j = 0; j < op.n; j++) {
      const it = this.byKey.get(keyOf(op.target[0], op.target[1] + j))
      if (!it) throw new Error(`delete target ${op.target[0]}:${op.target[1] + j} missing`)
      if (it.deleted) continue
      indices.push(it.vis)
      targets.push(it)
    }
    for (const it of targets) it.deleted = true
    this.liveCount -= targets.length
    if (targets.length > 0) {
      let first = targets[0]
      for (const it of targets) if (it.vis < first.vis) first = it
      this.reindexFrom(first, first.vis)
    }
    indices.sort((a, b) => a - b)
    // Sequential coordinates: after removing k earlier chars, index shifts by k.
    const effects: Effect[] = []
    let i = 0
    while (i < indices.length) {
      const startOrig = indices[i]
      let len = 1
      while (i + len < indices.length && indices[i + len] === startOrig + len) len++
      effects.push({ kind: 'delete', index: startOrig - i, length: len })
      i += len
    }
    return effects
  }

  // ───────────────────────── index cache ─────────────────────────

  /**
   * Rebuilds the visible-index cache in full. Only needed after a snapshot
   * restore or when an insert could not take the incremental path.
   */
  private ensureIndex(): void {
    if (!this.dirty) return
    if (this.head.next) this.reindexFrom(this.head.next, 0)
    else this.visible.length = 0
    this.dirty = false
  }

  /**
   * Re-numbers `start` and everything after it, assuming `start` is the
   * `n`-th visible item (or sits where the `n`-th would be, if it is a
   * tombstone). The `visible` array is reused rather than reallocated — a
   * fresh 20k-element array per keystroke lands in V8's large-object space
   * and costs far more than the walk itself.
   */
  private reindexFrom(start: Item, n: number): void {
    const vis = this.visible
    for (let it: Item | null = start; it; it = it.next) {
      it.vis = n
      if (!it.deleted) vis[n++] = it
    }
    vis.length = n
    this.dirty = false
  }

  /** Returns a snapshot of the visible items (for tests/debugging). */
  visibleItems(): readonly Item[] {
    this.ensureIndex()
    return this.visible
  }

  // ───────────────────────── sync & persistence ─────────────────────────

  /** Every op we hold that a replica at `remote` is missing (delta sync). */
  opsSince(remote: VersionVector | VersionVectorJSON): Op[] {
    const vv = remote instanceof VersionVector ? remote : VersionVector.from(remote)
    const out: Op[] = []
    for (const [site, arr] of this.log) {
      const have = vv.get(site)
      for (let s = have; s < arr.length; s++) {
        const op = arr[s]
        if (op) out.push(op)
      }
    }
    // Inserts before deletes, low Lamport first — minimises buffering on the receiver.
    out.sort((a, b) => {
      if (a.t !== b.t) return a.t === 'i' ? -1 : 1
      if (a.t === 'i' && b.t === 'i') return a.ctr - b.ctr
      return a.seq - b.seq
    })
    return out
  }

  /** Total ops logged (including our own). */
  opCount(): number {
    let n = 0
    for (const arr of this.log.values()) n += arr.length
    return n
  }

  snapshot(): Snapshot {
    const runs: SnapshotRun[] = []
    let run: { site: SiteId; ctr: number; oSite: SiteId | null; oCtr: number; text: string; del: 0 | 1 } | null = null
    let prev: Item | null = null
    for (let it = this.head.next; it; it = it.next) {
      const del: 0 | 1 = it.deleted ? 1 : 0
      const continues =
        run !== null &&
        prev !== null &&
        it.site === run.site &&
        it.ctr === run.ctr + run.text.length &&
        it.origin === prev &&
        run.del === del
      if (continues && run) run.text += it.ch
      else {
        if (run) runs.push([run.site, run.ctr, run.oSite, run.oCtr, run.text, run.del])
        run = {
          site: it.site,
          ctr: it.ctr,
          oSite: it.origin ? it.origin.site : null,
          oCtr: it.origin ? it.origin.ctr : 0,
          text: it.ch,
          del,
        }
      }
      prev = it
    }
    if (run) runs.push([run.site, run.ctr, run.oSite, run.oCtr, run.text, run.del])
    const log: Record<SiteId, Op[]> = {}
    for (const [site, arr] of this.log) log[site] = arr.filter((o): o is Op => o !== undefined)
    return { v: 1, clock: this.clock, vv: this.vv.toJSON(), runs, log }
  }

  /**
   * Rebuilds a document from a snapshot under a (possibly new) site id. Items
   * are already in sequence order so no integration is needed.
   */
  static fromSnapshot(site: SiteId, snap: Snapshot): RgaDoc {
    const doc = new RgaDoc(site)
    let tail = doc.head
    for (const [rSite, rCtr, oSite, oCtr, text, del] of snap.runs) {
      let origin = oSite === null ? null : (doc.byKey.get(keyOf(oSite, oCtr)) ?? null)
      for (let j = 0; j < text.length; j++) {
        const item: Item = {
          site: rSite,
          ctr: rCtr + j,
          origin,
          ch: text[j],
          deleted: del === 1,
          next: null,
          prev: tail,
          vis: 0,
        }
        tail.next = item
        tail = item
        doc.byKey.set(keyOf(rSite, rCtr + j), item)
        doc.totalCount++
        if (!item.deleted) doc.liveCount++
        origin = item
      }
    }
    doc.clock = snap.clock
    for (const s of Object.keys(snap.log)) doc.log.set(s, [...snap.log[s]])
    const vv = VersionVector.from(snap.vv)
    for (const s of vv.sites()) doc.vv.set(s, vv.get(s))
    doc.seq = doc.vv.get(site)
    doc.dirty = true
    return doc
  }

  /** Merge another replica's snapshot by replaying the ops we are missing. */
  mergeSnapshot(snap: Snapshot): Applied[] {
    const ops: Op[] = []
    for (const s of Object.keys(snap.log)) for (const op of snap.log[s]) ops.push(op)
    const tmp = new RgaDoc(' ')
    for (const op of ops) {
      let arr = tmp.log.get(op.site)
      if (!arr) tmp.log.set(op.site, (arr = []))
      arr[op.seq - 1] = op
    }
    return this.receiveMany(tmp.opsSince(this.vv))
  }
}
