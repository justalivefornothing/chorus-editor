import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

/**
 * Chorus editor theme: near-black chrome, low-contrast gutters, and a
 * restrained syntax palette that stays legible next to the peer colours.
 */
const bg = '#0b0d12'
const pane = '#0f1218'
const border = '#1c212c'
const fg = '#d7dce5'
const muted = '#5b6473'
const accent = '#7dd3fc'

export const chorusTheme = EditorView.theme(
  {
    '&': { color: fg, backgroundColor: pane, height: '100%', fontSize: '13.5px' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: "'JetBrains Mono Variable', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      lineHeight: '1.65',
      overflow: 'auto',
    },
    '.cm-content': { caretColor: accent, padding: '12px 0' },
    '.cm-line': { padding: '0 14px 0 6px' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: accent, borderLeftWidth: '2px' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(125, 211, 252, 0.22) !important',
    },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.025)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#9aa4b2' },
    '.cm-gutters': {
      backgroundColor: pane,
      color: muted,
      border: 'none',
      borderRight: `1px solid ${border}`,
      minWidth: '3.2em',
    },
    '.cm-gutterElement': { padding: '0 10px 0 6px' },
    '.cm-lineNumbers .cm-gutterElement': { fontFeatureSettings: '"tnum"' },
    '.cm-matchingBracket': { backgroundColor: 'rgba(125, 211, 252, 0.15)', outline: `1px solid rgba(125,211,252,0.35)` },
    '.cm-tooltip': { backgroundColor: bg, border: `1px solid ${border}`, color: fg },
    '.cm-placeholder': { color: muted, fontStyle: 'italic' },
  },
  { dark: true },
)

export const chorusHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: '#c4b5fd' },
  { tag: [t.definitionKeyword, t.moduleKeyword], color: '#c4b5fd' },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: fg },
  { tag: [t.propertyName], color: '#93c5fd' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#7dd3fc' },
  { tag: [t.definition(t.variableName)], color: '#e2e8f0' },
  { tag: [t.typeName, t.className, t.namespace], color: '#fcd34d' },
  { tag: [t.string, t.special(t.string), t.inserted], color: '#86efac' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#fdba74' },
  { tag: [t.regexp, t.escape], color: '#f9a8d4' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: muted, fontStyle: 'italic' },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: '#8b95a5' },
  { tag: [t.meta, t.annotation, t.processingInstruction], color: '#a5b4fc' },
  { tag: t.heading, color: '#7dd3fc', fontWeight: '700' },
  { tag: [t.heading1, t.heading2, t.heading3], color: '#7dd3fc', fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700', color: '#e2e8f0' },
  { tag: t.link, color: '#93c5fd', textDecoration: 'underline' },
  { tag: t.url, color: '#93c5fd' },
  { tag: t.quote, color: '#a3b1c2', fontStyle: 'italic' },
  { tag: t.monospace, color: '#fdba74' },
  { tag: t.invalid, color: '#fca5a5' },
])

export function chorusEditorTheme(): Extension {
  return [chorusTheme, syntaxHighlighting(chorusHighlight)]
}
