import type { RgaDoc } from '../crdt'
import { checkConvergence, type ConvergenceReport } from '../session/replica'

export interface ConvergenceBadgeProps {
  readonly docs: readonly RgaDoc[]
  /** Optional externally computed report (e.g. after a stress run). */
  readonly report?: ConvergenceReport
  readonly compact?: boolean
  /** Extra context, e.g. "partitioned" or "12 in flight". */
  readonly hint?: string
}

/**
 * The convergence badge: green CONVERGED only when every replica's visible
 * text *and* version vector are byte-for-byte identical and nothing is
 * buffered. Amber DIVERGED otherwise — which is the honest, expected state
 * while packets are still in flight.
 */
export function ConvergenceBadge({ docs, report, compact, hint }: ConvergenceBadgeProps) {
  const r = report ?? checkConvergence(docs)
  const ok = r.converged
  const label = ok ? 'CONVERGED' : 'DIVERGED'
  const detail = ok
    ? 'text + version vectors identical'
    : [!r.textMatch && 'text differs', !r.versionMatch && 'version vectors differ', r.pending > 0 && `${r.pending} op${r.pending === 1 ? '' : 's'} buffered`]
        .filter(Boolean)
        .join(' · ')
  const tone = ok
    ? 'border-ok/40 bg-ok/10 text-ok shadow-[0_0_24px_-6px_color-mix(in_srgb,var(--color-ok)_50%,transparent)]'
    : 'border-warn/40 bg-warn/10 text-warn'

  if (compact) {
    return (
      <span
        key={label}
        role="status"
        aria-live="polite"
        data-converged={ok}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10.5px] font-semibold tracking-wider ${tone} animate-badge-in`}
        title={detail}
      >
        <Dot ok={ok} />
        {label}
      </span>
    )
  }

  return (
    <div
      key={label}
      role="status"
      aria-live="polite"
      data-converged={ok}
      className={`flex flex-col gap-1 rounded-lg border px-3 py-2.5 ${tone} animate-badge-in`}
    >
      <div className="flex items-center gap-2">
        <Dot ok={ok} large />
        <span className="font-mono text-[17px] font-bold tracking-[0.14em]">{label}</span>
      </div>
      <div className="text-[11px] text-fg-2/80">{detail}</div>
      {hint && <div className="font-mono text-[10.5px] text-muted">{hint}</div>}
    </div>
  )
}

function Dot({ ok, large }: { ok: boolean; large?: boolean }) {
  const size = large ? 'h-2.5 w-2.5' : 'h-1.5 w-1.5'
  return (
    <span className="relative inline-flex" aria-hidden="true">
      <span className={`${size} rounded-full ${ok ? 'bg-ok' : 'bg-warn'}`} />
      {!ok && <span className={`absolute inset-0 ${size} animate-ping rounded-full bg-warn/60`} />}
    </span>
  )
}
