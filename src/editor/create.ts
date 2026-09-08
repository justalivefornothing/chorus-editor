import { closeBrackets } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import { EditorState, type Extension } from '@codemirror/state'
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
  rectangularSelection,
} from '@codemirror/view'
import type { Replica } from '../session/replica'
import { EditorBinding } from './binding'
import { languageCompartment, languageExtension, type LanguageId } from './languages'
import { remoteCursors } from './presence'
import { chorusEditorTheme } from './theme'

export interface EditorHandle {
  readonly view: EditorView
  readonly binding: EditorBinding
  destroy(): void
}

export interface CreateEditorOptions {
  readonly parent: HTMLElement
  readonly replica: Replica
  readonly language: LanguageId
  readonly readOnly?: boolean
  readonly extensions?: Extension
  readonly ariaLabel?: string
}

/**
 * Builds a CodeMirror view bound to a replica. The document is seeded from
 * the CRDT (so a restored room shows its text immediately) and stays in sync
 * both ways via `EditorBinding`.
 */
export function createEditor(opts: CreateEditorOptions): EditorHandle {
  const binding = new EditorBinding(opts.replica)
  const state = EditorState.create({
    doc: opts.replica.doc.text(),
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      drawSelection(),
      rectangularSelection(),
      bracketMatching(),
      closeBrackets(),
      indentOnInput(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorState.allowMultipleSelections.of(true),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': opts.ariaLabel ?? 'Code editor', spellcheck: 'false' }),
      placeholder('Start typing — every character becomes a CRDT op…'),
      languageCompartment.of(languageExtension(opts.language)),
      chorusEditorTheme(),
      remoteCursors(),
      binding.extension(),
      opts.readOnly ? EditorState.readOnly.of(true) : [],
      opts.extensions ?? [],
    ],
  })
  const view = new EditorView({ state, parent: opts.parent })
  binding.attach(view)
  return {
    view,
    binding,
    destroy() {
      binding.dispose()
      view.destroy()
    },
  }
}
