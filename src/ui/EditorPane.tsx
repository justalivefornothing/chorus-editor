import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createEditor, type EditorHandle } from '../editor/create'
import { setLanguage, type LanguageId } from '../editor/languages'
import { updateRemoteCursors, type RemoteCursor } from '../editor/presence'
import type { Replica } from '../session/replica'
import { useReplicaTick } from '../state/hooks'
import { usePeers, usePresenceStore } from '../state/presence-store'

export interface EditorPaneProps {
  readonly replica: Replica
  readonly language: LanguageId
  readonly title: ReactNode
  readonly subtitle?: ReactNode
  readonly accent?: string
  readonly extra?: ReactNode
  readonly ariaLabel?: string
}

/**
 * One CodeMirror instance bound to one replica. Remote carets are re-resolved
 * from item ids to offsets whenever either the peers or the document change,
 * so they stay glued to the right character through concurrent edits.
 */
export function EditorPane({ replica, language, title, subtitle, accent, extra, ariaLabel }: EditorPaneProps) {
  const host = useRef<HTMLDivElement>(null)
  const handle = useRef<EditorHandle | null>(null)
  const [ready, setReady] = useState(false)
  const peers = usePeers(replica.site)
  const presenceTick = usePresenceStore((s) => s.tick)
  const changeTick = useReplicaTick(replica, ['change'])

  useEffect(() => {
    if (!host.current) return
    const h = createEditor({ parent: host.current, replica, language, ariaLabel })
    handle.current = h
    setReady(true)
    return () => {
      h.destroy()
      handle.current = null
      setReady(false)
    }
    // language changes are handled by the compartment effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replica])

  useEffect(() => {
    if (handle.current) setLanguage(handle.current.view, language)
  }, [language])

  useEffect(() => {
    const h = handle.current
    if (!h || !ready) return
    const cursors: RemoteCursor[] = []
    for (const p of peers) {
      const pos = replica.resolveCursor(p.cursor)
      if (!pos) continue
      cursors.push({ site: p.info.site, name: p.info.name, color: p.info.color, anchor: pos.anchor, head: pos.head, movedAt: p.movedAt, typing: p.typing })
    }
    updateRemoteCursors(h.view, cursors)
  }, [peers, presenceTick, changeTick, replica, ready])

  const stats = replica.stats()

  return (
    <section
      className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-pane"
      style={accent ? ({ '--peer': accent } as React.CSSProperties) : undefined}
      aria-label={typeof title === 'string' ? `${title} editor` : undefined}
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-pane-2 px-3">
        {accent && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: accent }} aria-hidden="true" />}
        <div className="min-w-0 truncate text-[12px] font-semibold text-fg">{title}</div>
        {subtitle && <div className="hidden min-w-0 truncate text-[11px] text-muted sm:block">{subtitle}</div>}
        <div className="ml-auto flex shrink-0 items-center gap-2">{extra}</div>
      </header>
      <div ref={host} className="editor-host" />
      <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-line bg-pane-2 px-3 font-mono text-[10.5px] text-muted">
        <span title="Visible characters (live items)">
          <b className="font-medium text-fg-2">{stats.live}</b> live
        </span>
        <span title="Deleted items kept as tombstones">
          <b className="font-medium text-fg-2">{stats.tombstones}</b> tombstones
        </span>
        <span title="Ops in the log" className="hidden sm:inline">
          <b className="font-medium text-fg-2">{stats.ops}</b> ops
        </span>
        {stats.pending > 0 && (
          <span className="text-warn" title="Ops waiting for dependencies">
            {stats.pending} buffered
          </span>
        )}
        <span className="ml-auto truncate" title="Version vector">
          vv {replica.doc.versionString() || '∅'}
        </span>
      </footer>
    </section>
  )
}
