import type { ItemId, Op, SiteId, VersionVectorJSON } from '../crdt'
import { opFromJSON } from '../crdt'

/**
 * Everything that travels between replicas, regardless of transport. The
 * protocol is deliberately tiny: replicas gossip ops, exchange version
 * vectors to repair gaps, and broadcast ephemeral presence.
 */
export interface PeerInfo {
  readonly site: SiteId
  readonly name: string
  readonly color: string
}

/**
 * A cursor pinned to CRDT items rather than numeric offsets: each end refers
 * to the item immediately *left* of the caret (null = document start). Because
 * items are immutable and tombstones survive, the receiver can resolve the
 * position even after concurrent edits shifted every offset.
 */
export interface CursorRef {
  readonly anchor: ItemId | null
  readonly head: ItemId | null
}

export type Message =
  | { readonly k: 'hello'; readonly from: SiteId; readonly peer: PeerInfo; readonly vv: VersionVectorJSON }
  | { readonly k: 'ops'; readonly from: SiteId; readonly ops: readonly Op[] }
  | { readonly k: 'sync'; readonly from: SiteId; readonly vv: VersionVectorJSON }
  | {
      readonly k: 'presence'
      readonly from: SiteId
      readonly peer: PeerInfo
      readonly cursor: CursorRef | null
      readonly typing: boolean
    }
  | { readonly k: 'bye'; readonly from: SiteId }

export type MessageKind = Message['k']

/** Presence is fire-and-forget; everything else must eventually arrive. */
export function isEphemeral(msg: Message): boolean {
  return msg.k === 'presence'
}

export interface Transport {
  readonly kind: string
  send(msg: Message): void
  subscribe(handler: (msg: Message) => void): () => void
  close(): void
}

// ─────────────────────────── validation ───────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function isItemIdOrNull(v: unknown): v is ItemId | null {
  return v === null || (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && Number.isInteger(v[1]))
}

function isVV(v: unknown): v is VersionVectorJSON {
  if (!isRecord(v)) return false
  for (const key of Object.keys(v)) if (!Number.isInteger(v[key])) return false
  return true
}

function isPeerInfo(v: unknown): v is PeerInfo {
  return isRecord(v) && typeof v.site === 'string' && typeof v.name === 'string' && typeof v.color === 'string'
}

/**
 * Validates an untrusted decoded JSON value (another tab could be running an
 * older build) and returns a typed message or `null`.
 */
export function messageFromJSON(v: unknown): Message | null {
  if (!isRecord(v) || typeof v.from !== 'string') return null
  const from = v.from
  switch (v.k) {
    case 'hello':
      if (!isPeerInfo(v.peer) || !isVV(v.vv)) return null
      return { k: 'hello', from, peer: v.peer, vv: v.vv }
    case 'ops': {
      if (!Array.isArray(v.ops)) return null
      const ops: Op[] = []
      for (const raw of v.ops) {
        const op = opFromJSON(raw)
        if (!op) return null
        ops.push(op)
      }
      return { k: 'ops', from, ops }
    }
    case 'sync':
      if (!isVV(v.vv)) return null
      return { k: 'sync', from, vv: v.vv }
    case 'presence': {
      if (!isPeerInfo(v.peer) || typeof v.typing !== 'boolean') return null
      let cursor: CursorRef | null = null
      if (v.cursor !== null && v.cursor !== undefined) {
        if (!isRecord(v.cursor) || !isItemIdOrNull(v.cursor.anchor) || !isItemIdOrNull(v.cursor.head)) return null
        cursor = { anchor: v.cursor.anchor, head: v.cursor.head }
      }
      return { k: 'presence', from, peer: v.peer, cursor, typing: v.typing }
    }
    case 'bye':
      return { k: 'bye', from }
    default:
      return null
  }
}

export function encodeMessage(msg: Message): string {
  return JSON.stringify(msg)
}

export function decodeMessage(json: string): Message | null {
  try {
    return messageFromJSON(JSON.parse(json))
  } catch {
    return null
  }
}
