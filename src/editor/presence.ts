import { StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'

/** A peer's caret/selection already resolved to numeric positions. */
export interface RemoteCursor {
  readonly site: string
  readonly name: string
  readonly color: string
  readonly anchor: number
  readonly head: number
  /** Timestamp of the last move; changing it restarts the name-flag fade. */
  readonly movedAt: number
  readonly typing: boolean
}

export const setRemoteCursors = StateEffect.define<readonly RemoteCursor[]>()

class CursorWidget extends WidgetType {
  private readonly c: RemoteCursor

  constructor(c: RemoteCursor) {
    super()
    this.c = c
  }

  eq(other: CursorWidget): boolean {
    const o = other.c
    return o.site === this.c.site && o.color === this.c.color && o.name === this.c.name && o.movedAt === this.c.movedAt && o.typing === this.c.typing
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'cm-chorus-cursor' + (this.c.typing ? ' is-typing' : '')
    wrap.style.setProperty('--peer', this.c.color)
    wrap.setAttribute('aria-hidden', 'true')
    wrap.dataset.site = this.c.site
    const flag = document.createElement('span')
    flag.className = 'cm-chorus-flag'
    flag.textContent = this.c.name
    wrap.appendChild(flag)
    return wrap
  }

  override ignoreEvent(): boolean {
    return false
  }
}

function build(cursors: readonly RemoteCursor[], docLength: number): DecorationSet {
  const ranges = []
  for (const c of cursors) {
    const head = Math.max(0, Math.min(docLength, c.head))
    const anchor = Math.max(0, Math.min(docLength, c.anchor))
    if (anchor !== head) {
      const from = Math.min(anchor, head)
      const to = Math.max(anchor, head)
      ranges.push(
        Decoration.mark({
          class: 'cm-chorus-selection',
          attributes: { style: `--peer:${c.color}` },
        }).range(from, to),
      )
    }
    ranges.push(Decoration.widget({ widget: new CursorWidget(c), side: -1 }).range(head))
  }
  return Decoration.set(ranges, true)
}

export const remoteCursorsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = value.map(tr.changes)
    for (const e of tr.effects) if (e.is(setRemoteCursors)) next = build(e.value, tr.newDoc.length)
    return next
  },
  provide: (f) => EditorView.decorations.from(f),
})

/** Dispatches a fresh set of remote cursors into the view. */
export function updateRemoteCursors(view: EditorView, cursors: readonly RemoteCursor[]): void {
  view.dispatch({ effects: setRemoteCursors.of(cursors) })
}

export const remoteCursorsTheme = EditorView.baseTheme({
  '.cm-chorus-selection': {
    backgroundColor: 'color-mix(in srgb, var(--peer) 28%, transparent)',
    borderRadius: '2px',
  },
  '.cm-chorus-cursor': {
    position: 'relative',
    display: 'inline-block',
    width: '0',
    height: '1.2em',
    verticalAlign: 'text-bottom',
    borderLeft: '2px solid var(--peer)',
    marginLeft: '-1px',
    pointerEvents: 'auto',
  },
  '.cm-chorus-cursor.is-typing': {
    animation: 'chorus-caret-pulse 0.9s ease-in-out infinite',
  },
  '.cm-chorus-flag': {
    position: 'absolute',
    top: '-1.25em',
    left: '-2px',
    padding: '0 5px',
    fontFamily: "'Inter Variable', system-ui, sans-serif",
    fontSize: '10px',
    lineHeight: '1.5',
    fontWeight: '600',
    letterSpacing: '0.02em',
    color: '#0b0d12',
    background: 'var(--peer)',
    borderRadius: '3px 3px 3px 0',
    whiteSpace: 'nowrap',
    userSelect: 'none',
    zIndex: '10',
    animation: 'chorus-flag-fade 1.5s ease-in forwards',
  },
  '.cm-chorus-cursor:hover .cm-chorus-flag': {
    animation: 'none',
    opacity: '1',
  },
  '@keyframes chorus-flag-fade': {
    '0%': { opacity: '1' },
    '60%': { opacity: '1' },
    '100%': { opacity: '0' },
  },
  '@keyframes chorus-caret-pulse': {
    '0%, 100%': { opacity: '1' },
    '50%': { opacity: '0.35' },
  },
})

export function remoteCursors(): Extension {
  return [remoteCursorsField, remoteCursorsTheme]
}
