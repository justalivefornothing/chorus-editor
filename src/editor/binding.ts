import { Annotation, ChangeSet, type ChangeDesc, type Extension } from '@codemirror/state'
import { EditorView, type ViewUpdate } from '@codemirror/view'
import type { Applied, Effect } from '../crdt'
import type { LocalChange, Replica } from '../session/replica'

/**
 * Transactions carrying this annotation originate from the CRDT (remote ops
 * or a resync) and must not be turned back into ops — otherwise every remote
 * edit would echo around the room forever.
 */
export const remoteAnnotation = Annotation.define<boolean>()

export function isRemote(update: ViewUpdate): boolean {
  return update.transactions.some((tr) => tr.annotation(remoteAnnotation) === true)
}

/**
 * Converts a CodeMirror ChangeDesc (all ranges expressed against the *old*
 * document) into sequential edits the CRDT can apply one after another.
 *
 * `iterChanges` yields ranges in old-document order; once an earlier range has
 * been replaced, later ranges shift by the net length change so far.
 */
export function changesToLocal(changes: ChangeDesc, inserted: (fromB: number, toB: number) => string): LocalChange[] {
  const out: LocalChange[] = []
  let offset = 0
  changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    const insert = inserted(fromB, toB)
    const remove = toA - fromA
    if (remove === 0 && insert.length === 0) return
    out.push({ index: fromA + offset, remove, insert })
    offset += insert.length - remove
  })
  return out
}

/** Extracts local edits from a view update. */
export function updateToLocal(update: ViewUpdate): LocalChange[] {
  return changesToLocal(update.changes, (from, to) => update.state.doc.sliceString(from, to))
}

/**
 * Folds sequential CRDT effects into one ChangeSet against a document of
 * `startLength` characters. Each effect is expressed against the document as
 * it stands after the previous effect, so we compose rather than batch.
 */
export function effectsToChangeSet(effects: readonly Effect[], startLength: number): ChangeSet {
  let cs = ChangeSet.empty(startLength)
  for (const e of effects) {
    const spec = e.kind === 'insert' ? { from: e.index, insert: e.text } : { from: e.index, to: e.index + e.length }
    cs = cs.compose(ChangeSet.of(spec, cs.newLength))
  }
  return cs
}

export function appliedToChangeSet(applied: readonly Applied[], startLength: number): ChangeSet {
  const effects: Effect[] = []
  for (const a of applied) for (const e of a.effects) effects.push(e)
  return effectsToChangeSet(effects, startLength)
}

export interface BindingHooks {
  /** Called when the editor and CRDT disagreed and the editor was reset from the CRDT. */
  onResync?: () => void
}

/**
 * Glue between one EditorView and one Replica.
 *
 *   editor -> CRDT:  update listener turns every non-remote transaction into ops
 *   CRDT  -> editor: the replica's `remote` event becomes one annotated
 *                    transaction (selection is mapped through it by CM itself,
 *                    which is what keeps the local caret where the user left it)
 */
export class EditorBinding {
  private view: EditorView | null = null
  private readonly unsubscribe: () => void
  private applying = false
  private readonly replica: Replica
  private readonly hooks: BindingHooks

  constructor(replica: Replica, hooks: BindingHooks = {}) {
    this.replica = replica
    this.hooks = hooks
    this.unsubscribe = replica.events.on('remote', (applied) => this.applyRemote(applied))
  }

  /** The extension to install in the EditorState. */
  extension(): Extension {
    return EditorView.updateListener.of((update) => this.onUpdate(update))
  }

  attach(view: EditorView): void {
    this.view = view
    const { anchor, head } = view.state.selection.main
    this.replica.setSelection(anchor, head)
  }

  detach(): void {
    this.view = null
  }

  dispose(): void {
    this.unsubscribe()
    this.view = null
  }

  private onUpdate(update: ViewUpdate): void {
    if (update.docChanged && !isRemote(update) && !this.applying) {
      const changes = updateToLocal(update)
      if (changes.length > 0) {
        try {
          this.replica.applyLocal(changes)
        } catch (err) {
          console.error('[chorus] local change rejected, resyncing editor', err)
          this.resync()
          return
        }
        if (import.meta.env?.DEV && update.state.doc.toString() !== this.replica.doc.text()) {
          console.warn('[chorus] editor/CRDT drift after local edit; resyncing')
          this.resync()
        }
      }
    }
    if (update.selectionSet || update.docChanged || update.focusChanged) {
      const { anchor, head } = update.state.selection.main
      this.replica.setSelection(anchor, head)
    }
  }

  private applyRemote(applied: readonly Applied[]): void {
    const view = this.view
    if (!view) return
    const changes = appliedToChangeSet(applied, view.state.doc.length)
    if (changes.empty) return
    this.applying = true
    try {
      view.dispatch({ changes, annotations: remoteAnnotation.of(true) })
    } finally {
      this.applying = false
    }
    if (view.state.doc.toString() !== this.replica.doc.text()) this.resync()
  }

  /** Last-resort self-heal: replace the editor text with the CRDT's. */
  resync(): void {
    const view = this.view
    if (!view) return
    const text = this.replica.doc.text()
    if (view.state.doc.toString() === text) return
    this.applying = true
    try {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        annotations: remoteAnnotation.of(true),
      })
    } finally {
      this.applying = false
    }
    this.hooks.onResync?.()
  }
}
