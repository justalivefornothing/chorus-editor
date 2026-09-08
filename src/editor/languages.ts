import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { Compartment, type Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

export type LanguageId = 'javascript' | 'typescript' | 'json' | 'markdown'

export interface LanguageInfo {
  readonly id: LanguageId
  readonly label: string
  readonly ext: string
}

export const LANGUAGES: readonly LanguageInfo[] = [
  { id: 'typescript', label: 'TypeScript', ext: 'ts' },
  { id: 'javascript', label: 'JavaScript', ext: 'js' },
  { id: 'json', label: 'JSON', ext: 'json' },
  { id: 'markdown', label: 'Markdown', ext: 'md' },
]

export function isLanguageId(v: unknown): v is LanguageId {
  return LANGUAGES.some((l) => l.id === v)
}

export function languageExtension(id: LanguageId): Extension {
  switch (id) {
    case 'javascript':
      return javascript({ jsx: true })
    case 'typescript':
      return javascript({ typescript: true, jsx: true })
    case 'json':
      return json()
    case 'markdown':
      return markdown()
  }
}

export const languageCompartment = new Compartment()

export function setLanguage(view: EditorView, id: LanguageId): void {
  view.dispatch({ effects: languageCompartment.reconfigure(languageExtension(id)) })
}

export const SAMPLE_TEXT: Readonly<Record<LanguageId, string>> = {
  typescript: `// Chorus — every keystroke becomes a CRDT op.
// Open this room in a second tab and type in both.

type ItemId = readonly [site: string, counter: number]

interface Item {
  id: ItemId
  origin: ItemId | null   // the item we were typed after
  ch: string
  deleted: boolean        // tombstone, never physically removed
}

export function integrate(items: Item[], item: Item, after: number): void {
  let i = after + 1
  // skip concurrent siblings with greater ids — same answer on every replica
  while (i < items.length && compare(items[i].id, item.id) > 0) i++
  items.splice(i, 0, item)
}
`,
  javascript: `// Chorus — collaborative editing without a server.
// Try: open this URL in another tab, then type here.

export function greet(name) {
  const msg = \`hello, \${name}\`
  console.log(msg)
  return msg
}

greet('world')
`,
  json: `{
  "room": "chorus",
  "crdt": "RGA",
  "ids": ["site", "lamport"],
  "tombstones": true,
  "transport": ["BroadcastChannel", "SimNetwork"]
}
`,
  markdown: `# Chorus

A **multi-cursor** collaborative editor on a from-scratch RGA CRDT.

- Type in two tabs and watch them converge
- Drag the latency slider, flip *Partition*, then *Heal*
- Hit **Stress** for 500 random concurrent ops

> Convergence is a property, not a promise.
`,
}
