import { useEffect, useId, useRef, useState } from 'react'
import type { RoomRecord } from '../persistence/store'
import { randomRoomName, slugifyRoom } from '../session/identity'

export interface RoomSwitcherProps {
  readonly room: string
  readonly recent: readonly RoomRecord[]
  readonly onSwitch: (room: string) => void
}

/**
 * Shows the current room name; click (or press Enter) to type a new one,
 * pick a recent room, or roll a random name. Rooms are just hash strings —
 * anyone with the URL is in.
 */
export function RoomSwitcher({ room, recent, onSwitch }: RoomSwitcherProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(room)
  const input = useRef<HTMLInputElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const listId = useId()

  useEffect(() => {
    if (open) {
      setDraft(room)
      requestAnimationFrame(() => input.current?.select())
    }
  }, [open, room])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    addEventListener('pointerdown', onDown)
    addEventListener('keydown', onKey)
    return () => {
      removeEventListener('pointerdown', onDown)
      removeEventListener('keydown', onKey)
    }
  }, [open])

  const commit = (name: string) => {
    const slug = slugifyRoom(name)
    if (slug && slug !== room) onSwitch(slug)
    setOpen(false)
  }

  const others = recent.filter((r) => r.room !== room).slice(0, 6)

  return (
    <div ref={wrap} className="relative min-w-0">
      <button
        type="button"
        className="btn btn-ghost max-w-[40vw] gap-2 sm:max-w-none"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Switch room"
      >
        <Hash />
        <span className="truncate font-mono text-[12.5px] text-fg">{room}</span>
        <Chevron />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Switch room"
          className="absolute top-full left-0 z-30 mt-1.5 w-[min(320px,calc(100vw-24px))] rounded-lg border border-line-2 bg-pane-2 p-2 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.7)] animate-fade-in"
        >
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              commit(draft)
            }}
          >
            <input
              ref={input}
              value={draft}
              onChange={(e) => setDraft(e.currentTarget.value)}
              className="min-w-0 flex-1 rounded-md border border-line-2 bg-ink px-2 py-1 font-mono text-[12.5px] text-fg placeholder:text-dim focus:border-accent/60"
              placeholder="room-name"
              aria-label="Room name"
              aria-controls={listId}
              spellCheck={false}
              autoComplete="off"
            />
            <button type="submit" className="btn btn-primary">
              Join
            </button>
          </form>
          <button type="button" className="btn btn-ghost mt-1.5 w-full justify-start text-muted" onClick={() => commit(randomRoomName())}>
            <Dice /> New random room
          </button>
          {others.length > 0 && (
            <>
              <div className="mt-1.5 px-1 pt-1.5 pb-1 text-[10px] font-semibold tracking-[0.12em] text-muted uppercase">Recent on this device</div>
              <ul id={listId} className="flex max-h-48 flex-col overflow-y-auto">
                {others.map((r) => (
                  <li key={r.room}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-pane-3 focus-visible:bg-pane-3"
                      onClick={() => commit(r.room)}
                    >
                      <span className="truncate font-mono text-[12px] text-fg-2">{r.room}</span>
                      <span className="ml-auto shrink-0 font-mono text-[10px] text-dim">
                        {r.chars} ch · {r.language}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Hash() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="text-muted" aria-hidden="true">
      <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />
    </svg>
  )
}

function Chevron() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

function Dice() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01" />
    </svg>
  )
}
