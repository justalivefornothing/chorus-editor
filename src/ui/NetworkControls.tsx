import { useEffect, useReducer, type CSSProperties } from 'react'
import type { Lab } from '../sim/lab'

export interface NetworkControlsProps {
  readonly lab: Lab
}

/**
 * The right-rail network panel: latency + loss sliders with live labels, a
 * red Partition switch, Heal, and counters for what the link is doing.
 */
export function NetworkControls({ lab }: NetworkControlsProps) {
  const [, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => lab.network.onChange(bump), [lab])
  // In-flight packets land on timers, so poll a little for the counters.
  useEffect(() => {
    const id = setInterval(bump, 250)
    return () => clearInterval(id)
  }, [])

  const link = lab.network.link
  const stats = lab.network.stats()
  const lossPct = Math.round(link.loss * 100)

  return (
    <div className="flex flex-col gap-3 px-3 pb-3">
      <Slider
        id="latency"
        label="Latency"
        value={link.latencyMs}
        min={0}
        max={3000}
        step={50}
        format={(v) => `${v} ms`}
        onChange={(v) => lab.configure({ latencyMs: v })}
        hint={link.jitter > 0 ? `±${Math.round(link.jitter * 100)}% jitter` : undefined}
      />
      <Slider
        id="loss"
        label="Packet loss"
        value={lossPct}
        min={0}
        max={90}
        step={5}
        format={(v) => `${v}%`}
        onChange={(v) => lab.configure({ loss: v / 100 })}
        hint={lossPct > 0 ? 'repaired by version-vector sync' : undefined}
      />

      <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-pane-2 px-2.5 py-2">
        <div className="flex flex-col">
          <label htmlFor="partition" className="text-[12px] font-medium text-fg">
            Partition
          </label>
          <span className="text-[10.5px] text-muted">{link.partitioned ? `${stats.queued} op packet${stats.queued === 1 ? '' : 's'} held` : 'link open'}</span>
        </div>
        <div className="flex items-center gap-2">
          {link.partitioned && (
            <button type="button" className="btn btn-primary !py-0.5" onClick={() => lab.heal()}>
              Heal
            </button>
          )}
          <button
            id="partition"
            type="button"
            role="switch"
            aria-checked={link.partitioned}
            aria-label="Partition the network"
            className="switch"
            onClick={() => lab.configure({ partitioned: !link.partitioned })}
          >
            <span className="switch-knob" />
          </button>
        </div>
      </div>

      <dl className="grid grid-cols-4 gap-1.5 font-mono text-[10.5px]">
        <Stat k="sent" v={stats.sent} />
        <Stat k="flying" v={stats.inFlight} tone={stats.inFlight > 0 ? 'text-accent' : undefined} />
        <Stat k="queued" v={stats.queued} tone={stats.queued > 0 ? 'text-danger' : undefined} />
        <Stat k="dropped" v={stats.dropped} tone={stats.dropped > 0 ? 'text-warn' : undefined} />
      </dl>
    </div>
  )
}

function Stat({ k, v, tone }: { k: string; v: number; tone?: string }) {
  return (
    <div className="rounded border border-line bg-pane-2 px-1.5 py-1 text-center">
      <dd className={`text-[13px] leading-none font-medium ${tone ?? 'text-fg-2'}`}>{v}</dd>
      <dt className="mt-0.5 text-[9.5px] tracking-wider text-muted uppercase">{k}</dt>
    </div>
  )
}

interface SliderProps {
  id: string
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
  hint?: string
}

function Slider({ id, label, value, min, max, step, format, onChange, hint }: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-[12px] font-medium text-fg">
          {label}
        </label>
        <output htmlFor={id} className="font-mono text-[12px] text-accent" aria-live="off">
          {format(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        className="slider"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--pct': `${pct}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        aria-valuetext={format(value)}
      />
      {hint && <span className="text-[10.5px] text-muted">{hint}</span>}
    </div>
  )
}
