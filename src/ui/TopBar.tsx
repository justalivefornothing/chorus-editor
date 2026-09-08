import type { ReactNode } from 'react'
import { LANGUAGES, type LanguageId } from '../editor/languages'
import type { Mode } from '../state/route'
import { useTransient } from '../state/hooks'

export interface TopBarProps {
  readonly mode: Mode
  readonly onMode: (m: Mode) => void
  readonly language: LanguageId
  readonly onLanguage: (l: LanguageId) => void
  readonly roomSlot: ReactNode
  readonly avatars: ReactNode
  readonly shareUrl: string
}

export function TopBar({ mode, onMode, language, onLanguage, roomSlot, avatars, shareUrl }: TopBarProps) {
  const [copied, flashCopied] = useTransient(1400)
  const share = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      flashCopied()
    } catch {
      prompt('Copy this room link', shareUrl)
    }
  }

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-pane px-3 sm:gap-3">
      <a href="#" className="flex shrink-0 items-center gap-2 rounded-md" aria-label="Chorus home" onClick={(e) => e.preventDefault()}>
        <Logo />
        <span className="hidden text-[14px] font-semibold tracking-tight text-fg md:inline">Chorus</span>
      </a>
      <span className="hidden h-5 w-px bg-line-2 sm:block" aria-hidden="true" />

      <nav className="flex shrink-0 rounded-md border border-line bg-pane-2 p-0.5" aria-label="Mode">
        <Tab active={mode === 'room'} onClick={() => onMode('room')} title="One replica per tab, synced over BroadcastChannel">
          Live room
        </Tab>
        <Tab active={mode === 'lab'} onClick={() => onMode('lab')} title="Two replicas on this page joined by a simulated network">
          Split lab
        </Tab>
      </nav>

      {mode === 'room' && roomSlot}

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        {avatars}
        <label className="relative">
          <span className="sr-only">Language</span>
          <select
            value={language}
            onChange={(e) => onLanguage(e.currentTarget.value as LanguageId)}
            className="btn appearance-none pr-6"
            aria-label="Syntax language"
          >
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
          <svg
            className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-muted"
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </label>
        {mode === 'room' && (
          <button type="button" className={'btn ' + (copied ? 'btn-primary' : '')} onClick={share} title="Copy room link">
            <Link />
            <span className="hidden sm:inline">{copied ? 'Copied' : 'Share'}</span>
          </button>
        )}
      </div>
    </header>
  )
}

function Tab({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={
        'rounded px-2 py-0.5 text-[12px] font-medium transition-colors ' +
        (active ? 'bg-pane-3 text-fg shadow-[inset_0_0_0_1px_var(--color-line-2)]' : 'text-muted hover:text-fg-2')
      }
    >
      {children}
    </button>
  )
}

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#13171f" />
      <path d="M8 21V11" stroke="#5eead4" strokeWidth="3" strokeLinecap="round" />
      <path d="M14 23V9" stroke="#7dd3fc" strokeWidth="3" strokeLinecap="round" />
      <path d="M20 19v-6" stroke="#f472b6" strokeWidth="3" strokeLinecap="round" />
      <path d="M26 21V11" stroke="#fbbf24" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

function Link() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7L12 19" />
    </svg>
  )
}
