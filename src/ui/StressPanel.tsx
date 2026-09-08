import { useEffect, useRef, useState } from 'react'
import type { Lab } from '../sim/lab'
import type { StressResult } from '../sim/stress'

export interface StressPanelProps {
  readonly lab: Lab
  readonly ops?: number
  readonly onResult?: (r: StressResult) => void
}

type Phase = { kind: 'idle' } | { kind: 'running'; done: number; total: number } | { kind: 'settling' } | { kind: 'done'; result: StressResult }

/**
 * Fires N random concurrent inserts/deletes on both replicas under whatever
 * latency/loss the sliders are set to, waits for the link to drain and shows
 * the convergence verdict.
 */
export function StressPanel({ lab, ops = 500, onResult }: StressPanelProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      lab.cancelStress()
    }
  }, [lab])

  const run = async () => {
    if (lab.network.link.partitioned) lab.heal()
    setPhase({ kind: 'running', done: 0, total: ops })
    const result = await lab.runStress({
      ops,
      onProgress: (done, total) => {
        if (!alive.current) return
        setPhase(done >= total ? { kind: 'settling' } : { kind: 'running', done, total })
      },
    })
    if (!alive.current) return
    setPhase({ kind: 'done', result })
    onResult?.(result)
  }

  const busy = phase.kind === 'running' || phase.kind === 'settling'

  return (
    <div className="flex flex-col gap-2 px-3 pb-3">
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-primary" onClick={run} disabled={busy} aria-busy={busy}>
          <Bolt />
          {busy ? 'Running…' : `Stress test · ${ops} ops`}
        </button>
        {busy && (
          <button type="button" className="btn btn-ghost" onClick={() => lab.cancelStress()}>
            Stop
          </button>
        )}
      </div>
      {phase.kind === 'running' && (
        <div className="flex flex-col gap-1" aria-live="polite">
          <div className="h-1 overflow-hidden rounded-full bg-line-2">
            <div className="h-full bg-accent transition-[width] duration-100" style={{ width: `${(phase.done / phase.total) * 100}%` }} />
          </div>
          <span className="font-mono text-[10.5px] text-muted">
            {phase.done}/{phase.total} random ops fired on both replicas
          </span>
        </div>
      )}
      {phase.kind === 'settling' && (
        <span className="font-mono text-[10.5px] text-muted" aria-live="polite">
          all ops fired — waiting for the link to drain…
        </span>
      )}
      {phase.kind === 'done' && <Result r={phase.result} />}
      {phase.kind === 'idle' && (
        <p className="text-[11px] leading-snug text-muted">Random inserts and deletes hit both replicas at once under the current lag and loss. The badge must come back green.</p>
      )}
    </div>
  )
}

function Result({ r }: { r: StressResult }) {
  const ok = r.converged
  return (
    <div
      className={`rounded-md border px-2.5 py-2 font-mono text-[11px] ${ok ? 'border-ok/40 bg-ok/10 text-ok' : 'border-danger/40 bg-danger/10 text-danger'} animate-fade-in`}
      role="status"
      data-stress-converged={ok}
    >
      <div className="font-semibold tracking-wider">{ok ? 'CONVERGED ✓' : 'DIVERGED ✗'}</div>
      <div className="mt-0.5 text-fg-2/80">
        {r.ops} ops ({r.inserts} ins / {r.deletes} del) · settled in {(r.elapsedMs / 1000).toFixed(1)} s · seed {r.seed}
      </div>
      {!ok && (
        <div className="mt-0.5 text-fg-2/80">
          {!r.textMatch && 'text differs · '}
          {!r.versionMatch && 'version vectors differ · '}
          {r.pending > 0 && `${r.pending} buffered`}
        </div>
      )}
    </div>
  )
}

function Bolt() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
    </svg>
  )
}
