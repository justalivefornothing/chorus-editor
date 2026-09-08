import { useEffect, useRef } from 'react'
import type { Replica, TimelineEntry } from '../session/replica'
import { useReplicaTick } from '../state/hooks'

export interface OpTimelineProps {
  readonly replica: Replica
  /** Colour lookup by site id (falls back to a hash colour). */
  readonly colorFor: (site: string) => string
  readonly maxRows?: number
  readonly title?: string
}

/**
 * Monospace ticker of ops as seen by one replica: local (out), remote (in)
 * and buffered (waiting for a dependency). Auto-follows the tail unless the
 * user has scrolled up to inspect history.
 */
export function OpTimeline({ replica, colorFor, maxRows = 120, title }: OpTimelineProps) {
  useReplicaTick(replica, ['timeline'])
  const list = useRef<HTMLOListElement>(null)
  const pinned = useRef(true)
  const rows = replica.timeline.slice(-maxRows)

  useEffect(() => {
    const el = list.current
    if (!el || !pinned.current) return
    el.scrollTop = el.scrollHeight
  })

  const onScroll = () => {
    const el = list.current
    if (!el) return
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {title && (
        <div className="flex items-center gap-2 px-3 pb-1 text-[10.5px] text-muted">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: colorFor(replica.site) }} aria-hidden="true" />
          {title}
          <span className="ml-auto font-mono">{replica.timeline.length} ops</span>
        </div>
      )}
      <ol
        ref={list}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto py-1"
        aria-label={`Operation timeline for ${replica.peer.name}`}
        aria-live="off"
      >
        {rows.length === 0 && <li className="px-3 py-2 text-[11px] text-dim italic">No ops yet — start typing.</li>}
        {rows.map((e) => (
          <Row key={e.id} entry={e} color={colorFor(e.site)} />
        ))}
      </ol>
    </div>
  )
}

function Row({ entry, color }: { entry: TimelineEntry; color: string }) {
  const arrow = entry.dir === 'local' ? '→' : entry.dir === 'remote' ? '←' : '⋯'
  const arrowTitle = entry.dir === 'local' ? 'sent' : entry.dir === 'remote' ? 'applied from peer' : 'buffered: ' + (entry.note ?? '')
  return (
    <li className={'ticker-row animate-fade-in' + (entry.dir === 'buffered' ? ' is-buffered' : '')} style={{ '--site': color } as React.CSSProperties}>
      <span className="truncate text-[10px]" style={{ color }} title={`site ${entry.site}, seq ${entry.seq}`}>
        {entry.site}
        <span className="text-dim">#{entry.seq}</span>
      </span>
      <span className="text-muted" title={arrowTitle} aria-label={arrowTitle}>
        {arrow}
      </span>
      <span className="truncate text-fg-2">
        {entry.text}
        {entry.note && <span className="text-warn/70"> · {entry.note}</span>}
      </span>
    </li>
  )
}
