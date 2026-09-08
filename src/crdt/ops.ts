import type { ItemId, SiteId } from './id'

/**
 * Wire format for operations. Kept deliberately compact because every
 * keystroke becomes one of these.
 *
 * Both kinds carry `site` + `seq`: `seq` is a dense, per-site operation
 * counter (1, 2, 3, ...) used by the version vector and for FIFO delivery.
 * Inserts additionally carry `ctr`, the Lamport counter of the *first*
 * character in the run; character j of the run has id `[site, ctr + j]` and
 * its origin is the previous character, so a pasted word is one op.
 */
export interface InsertOp {
  readonly t: 'i'
  readonly site: SiteId
  readonly seq: number
  /** Lamport counter of the first inserted character. */
  readonly ctr: number
  /** Item the run was inserted after; `null` means the start of the document. */
  readonly origin: ItemId | null
  /** The inserted text (length >= 1). */
  readonly s: string
}

export interface DeleteOp {
  readonly t: 'd'
  readonly site: SiteId
  readonly seq: number
  /** First item of a run of `n` items from one site with consecutive counters. */
  readonly target: ItemId
  readonly n: number
}

export type Op = InsertOp | DeleteOp

export function opKey(op: Op): string {
  return op.site + '#' + op.seq
}

export function encodeOp(op: Op): string {
  return JSON.stringify(op)
}

export function encodeOps(ops: readonly Op[]): string {
  return JSON.stringify(ops)
}

function isItemId(v: unknown): v is ItemId {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && Number.isInteger(v[1])
}

/** Validates an untrusted JSON value and returns a typed op, or `null` if malformed. */
export function opFromJSON(v: unknown): Op | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  if (typeof o.site !== 'string' || !Number.isInteger(o.seq) || (o.seq as number) < 1) return null
  if (o.t === 'i') {
    if (!Number.isInteger(o.ctr) || typeof o.s !== 'string' || o.s.length === 0) return null
    if (o.origin !== null && !isItemId(o.origin)) return null
    return { t: 'i', site: o.site, seq: o.seq as number, ctr: o.ctr as number, origin: o.origin, s: o.s }
  }
  if (o.t === 'd') {
    if (!isItemId(o.target) || !Number.isInteger(o.n) || (o.n as number) < 1) return null
    return { t: 'd', site: o.site, seq: o.seq as number, target: o.target, n: o.n as number }
  }
  return null
}

export function decodeOp(json: string): Op | null {
  try {
    return opFromJSON(JSON.parse(json))
  } catch {
    return null
  }
}

export function decodeOps(json: string): Op[] {
  try {
    const arr = JSON.parse(json)
    if (!Array.isArray(arr)) return []
    const out: Op[] = []
    for (const v of arr) {
      const op = opFromJSON(v)
      if (op) out.push(op)
    }
    return out
  } catch {
    return []
  }
}

/** Human-friendly one-line description used by the op timeline. */
export function describeOp(op: Op): string {
  if (op.t === 'i') {
    const text = op.s.length > 14 ? op.s.slice(0, 12) + '…' : op.s
    const shown = JSON.stringify(text)
    return `ins ${shown} after ${op.origin ? op.origin[0] + ':' + op.origin[1] : 'HEAD'}`
  }
  return `del ${op.n} @ ${op.target[0]}:${op.target[1]}`
}
