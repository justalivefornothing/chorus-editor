import { useEffect, useMemo, useState } from 'react'
import { SAMPLE_TEXT, type LanguageId } from '../editor/languages'
import { Lab } from '../sim/lab'
import type { StressResult } from '../sim/stress'
import { useInterval, useReplicaTick } from '../state/hooks'
import { bindPresence } from '../state/presence-store'
import { makeColorFor } from './colors'
import { ConvergenceBadge } from './ConvergenceBadge'
import { EditorPane } from './EditorPane'
import { NetworkControls } from './NetworkControls'
import { OpTimeline } from './OpTimeline'
import { StressPanel } from './StressPanel'

export interface LabViewProps {
  readonly language: LanguageId
}

/**
 * Split-view demo: two replicas, one simulated link, everything observable.
 */
export function LabView({ language }: LabViewProps) {
  const lab = useMemo(() => new Lab(), [])
  const [lastStress, setLastStress] = useState<StressResult | null>(null)

  useEffect(() => {
    lab.start(SAMPLE_TEXT[language])
    const offA = bindPresence(lab.a)
    const offB = bindPresence(lab.b)
    return () => {
      offA()
      offB()
      lab.stop()
    }
    // the seed language is only used on first mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lab])

  // The badge depends on both docs and on packets landing on timers.
  useReplicaTick(lab.a, ['change', 'peers'])
  useReplicaTick(lab.b, ['change', 'peers'])
  useInterval(300)

  const colorFor = makeColorFor([lab.a, lab.b])
  const net = lab.network.stats()
  const link = lab.network.link
  const hint = link.partitioned
    ? `partitioned · ${net.queued} packet${net.queued === 1 ? '' : 's'} held`
    : net.inFlight > 0
      ? `${net.inFlight} packet${net.inFlight === 1 ? '' : 's'} in flight · ${link.latencyMs} ms`
      : `link idle · ${link.latencyMs} ms · ${Math.round(link.loss * 100)}% loss`

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 p-2 max-[900px]:grid-rows-[minmax(0,1fr)_auto] min-[901px]:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid min-h-0 grid-cols-1 gap-2 min-[901px]:grid-cols-2">
        <EditorPane
          replica={lab.a}
          language={language}
          title={`Replica A · ${lab.a.peer.name}`}
          subtitle={`site ${lab.a.site}`}
          accent={lab.a.peer.color}
          ariaLabel="Replica A editor"
        />
        <EditorPane
          replica={lab.b}
          language={language}
          title={`Replica B · ${lab.b.peer.name}`}
          subtitle={`site ${lab.b.site}`}
          accent={lab.b.peer.color}
          ariaLabel="Replica B editor"
        />
      </div>

      <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-pane max-[900px]:max-h-[46vh]" aria-label="Network lab controls">
        <div className="panel p-3">
          <ConvergenceBadge docs={[lab.a.doc, lab.b.doc]} hint={hint} />
        </div>
        <div className="panel">
          <h2 className="rail-h">
            Simulated network
            <span className="chip normal-case">{lab.network.link.jitter ? 'jitter on' : 'no jitter'}</span>
          </h2>
          <NetworkControls lab={lab} />
        </div>
        <div className="panel">
          <h2 className="rail-h">Stress</h2>
          <StressPanel lab={lab} onResult={setLastStress} />
        </div>
        <div className="flex min-h-[160px] min-w-0 flex-1 flex-col">
          <h2 className="rail-h">
            Op timeline
            <span className="chip normal-case">{lastStress ? `last stress: ${lastStress.converged ? 'ok' : 'fail'}` : 'A ↔ B'}</span>
          </h2>
          <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-line">
            <OpTimeline replica={lab.a} colorFor={colorFor} title="A sees" />
            <OpTimeline replica={lab.b} colorFor={colorFor} title="B sees" />
          </div>
        </div>
      </aside>
    </div>
  )
}
