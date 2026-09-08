import { useEffect, useState } from 'react'
import type { LanguageId } from '../editor/languages'
import type { RoomSession } from '../session/room-session'
import { useInterval, useReplicaTick } from '../state/hooks'
import { bindPresence, usePeers, useTyping } from '../state/presence-store'
import { makeColorFor } from './colors'
import { Avatar } from './PeerAvatars'
import { EditorPane } from './EditorPane'
import { OpTimeline } from './OpTimeline'

export interface RoomViewProps {
  readonly session: RoomSession
  readonly language: LanguageId
  readonly onForget: () => void
}

/**
 * Live room: one replica in this tab, everyone else in other tabs of the
 * same browser via BroadcastChannel. The rail shows who is here, whether
 * their version vectors match ours, the tombstone readout and the op ticker.
 */
export function RoomView({ session, language, onForget }: RoomViewProps) {
  const replica = session.replica
  const peers = usePeers(replica.site)
  const selfTyping = useTyping(replica.site)
  useReplicaTick(replica, ['change', 'peers', 'timeline'])
  useInterval(1000)
  const [savedFlash, setSavedFlash] = useState(false)

  useEffect(() => bindPresence(replica), [replica])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = replica.events.on('change', () => {
      setSavedFlash(true)
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setSavedFlash(false), 900)
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [replica])

  const colorFor = makeColorFor([replica])
  const stats = replica.stats()
  const sync = replica.syncStatus()
  const total = stats.live + stats.tombstones
  const tombPct = total === 0 ? 0 : Math.round((stats.tombstones / total) * 100)
  const inSync = sync.peers === 0 || sync.inSync === sync.peers

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 p-2 max-[900px]:grid-rows-[minmax(0,1fr)_auto] min-[901px]:grid-cols-[minmax(0,1fr)_300px]">
      <EditorPane
        replica={replica}
        language={language}
        title={session.room}
        subtitle={`you are ${replica.peer.name} · site ${replica.site}`}
        accent={replica.peer.color}
        ariaLabel={`Editor for room ${session.room}`}
        extra={
          <span className={'font-mono text-[10.5px] transition-colors ' + (savedFlash ? 'text-accent' : 'text-dim')} title="Snapshot persisted to IndexedDB">
            {savedFlash ? 'saving…' : session.restored ? 'restored · saved' : 'saved'}
          </span>
        }
      />

      <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-pane max-[900px]:max-h-[44vh]" aria-label="Room details">
        <div className="panel p-3">
          <div
            role="status"
            className={`flex flex-col gap-1 rounded-lg border px-3 py-2.5 ${inSync ? 'border-ok/40 bg-ok/10 text-ok' : 'border-warn/40 bg-warn/10 text-warn'}`}
          >
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${inSync ? 'bg-ok' : 'bg-warn animate-pulse'}`} aria-hidden="true" />
              <span className="font-mono text-[17px] font-bold tracking-[0.14em]">{sync.peers === 0 ? 'SOLO' : inSync ? 'IN SYNC' : 'SYNCING'}</span>
            </div>
            <div className="text-[11px] text-fg-2/80">
              {sync.peers === 0
                ? 'open this URL in another tab to add a peer'
                : `${sync.inSync}/${sync.peers} peer${sync.peers === 1 ? '' : 's'} report an identical version vector`}
            </div>
          </div>
        </div>

        <div className="panel">
          <h2 className="rail-h">
            In this room
            <span className="chip normal-case">{peers.length + 1} here</span>
          </h2>
          <ul className="flex flex-col gap-1 px-3 pb-3">
            <PeerRow info={replica.peer} typing={selfTyping} self vv={replica.doc.versionString()} />
            {peers.map((p) => (
              <PeerRow key={p.info.site} info={p.info} typing={p.typing} lastSeen={p.lastSeen} />
            ))}
          </ul>
        </div>

        <div className="panel">
          <h2 className="rail-h">
            Document
            <button type="button" className="btn btn-ghost !py-0 text-[10.5px] normal-case" onClick={onForget} title="Delete the persisted copy of this room and reload">
              Forget room
            </button>
          </h2>
          <div className="grid grid-cols-3 gap-1.5 px-3 pb-2">
            <div className="stat">
              <span className="stat-v">{stats.live}</span>
              <span className="stat-k">live items</span>
            </div>
            <div className="stat">
              <span className="stat-v">{stats.tombstones}</span>
              <span className="stat-k">tombstones</span>
            </div>
            <div className="stat">
              <span className="stat-v">{stats.ops}</span>
              <span className="stat-k">ops logged</span>
            </div>
          </div>
          <div className="px-3 pb-3">
            <div className="flex items-baseline justify-between text-[10.5px] text-muted">
              <span>tombstone share</span>
              <span className="font-mono">
                {tombPct}% · {stats.pending} buffered
              </span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-line-2" role="meter" aria-valuenow={tombPct} aria-valuemin={0} aria-valuemax={100} aria-label="Tombstone share">
              <div className="h-full bg-fg-2/60" style={{ width: `${tombPct}%` }} />
            </div>
          </div>
        </div>

        <div className="flex min-h-[140px] min-w-0 flex-1 flex-col">
          <h2 className="rail-h">
            Op timeline
            <span className="chip normal-case">broadcast</span>
          </h2>
          <OpTimeline replica={replica} colorFor={colorFor} />
        </div>
      </aside>
    </div>
  )
}

function PeerRow({ info, typing, self, vv, lastSeen }: { info: { site: string; name: string; color: string }; typing: boolean; self?: boolean; vv?: string; lastSeen?: number }) {
  const ago = lastSeen === undefined ? null : Math.max(0, Math.round((performance.now() - lastSeen) / 1000))
  return (
    <li className="flex items-center gap-2 rounded-md border border-line bg-pane-2 px-2 py-1.5">
      <Avatar info={info} typing={typing} self={self} size={22} />
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-[12px] font-medium text-fg">
          {info.name}
          {self && <span className="ml-1 text-[10px] font-normal text-muted">(you)</span>}
        </span>
        <span className="truncate font-mono text-[10px] text-muted">
          {info.site}
          {vv !== undefined && ` · vv ${vv || '∅'}`}
        </span>
      </div>
      <span className="ml-auto shrink-0 font-mono text-[10px] text-dim">{typing ? <span className="text-fg-2">typing</span> : ago === null ? '' : ago <= 1 ? 'live' : `${ago}s`}</span>
    </li>
  )
}
